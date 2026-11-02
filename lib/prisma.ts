import { PrismaClient } from "@prisma/client";
import {
  CHILD_MODELS, FARM_MODELS, FarmScopeError, GLOBAL_MODELS, currentFarmId, farmFilter, isUnscoped, linkedIds, withFarm,
} from "@/lib/farm-scope";

/**
 * The one database client. Every query on a farm's tables is limited to the farm of the request (lib/farm-scope.ts):
 * reads, updates and deletes get the farm added to their filter; new and changed rows get the farm set (another farm
 * is refused); and every id a write points at (a flock, a customer, a sale...) must belong to the same farm. A query
 * with no farm is refused. Only sign-in lookups run unscoped.
 */

const FILTERED = new Set([
  "findMany", "findFirst", "findFirstOrThrow", "findUnique", "findUniqueOrThrow", "count", "aggregate", "groupBy",
  "update", "updateMany", "updateManyAndReturn", "delete", "deleteMany", "upsert",
]);

type Data = Record<string, unknown>;
type Delegate = { count: (args: { where: Data }) => Promise<number> };

const base = new PrismaClient();

function delegateFor(client: unknown, model: string): Delegate {
  return (client as Record<string, Delegate>)[model.charAt(0).toLowerCase() + model.slice(1)];
}

function buildClient() {
  // eslint-disable-next-line prefer-const
  let scoped: ReturnType<typeof extend>;
  const extend = () => base.$extends({
    name: "farm-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (GLOBAL_MODELS.has(model) || isUnscoped()) return query(args);
          const farmId = currentFarmId();
          const filter = farmFilter(model, farmId);
          if (!filter) throw new FarmScopeError("UNKNOWN_TABLE");
          const next = { ...((args ?? {}) as Data) } as Data;
          if (FILTERED.has(operation)) next.where = withFarm(next.where as Data | undefined, filter);

          /** Sets or checks the farm on a row being written, and checks every id it points at. */
          const prepare = async (data: unknown, creating: boolean): Promise<Data> => {
            if (!data || typeof data !== "object") return data as Data;
            const row = { ...(data as Data) };
            if (model === "Farm") {
              if (creating && row.id !== farmId) throw new FarmScopeError("OTHER_FARM");
            } else if (FARM_MODELS.has(model)) {
              const relation = row.farm as { connect?: { id?: unknown } } | undefined;
              if (relation && relation.connect?.id !== farmId) throw new FarmScopeError("OTHER_FARM");
              if (row.farmId !== undefined && row.farmId !== farmId && (row.farmId as { set?: unknown })?.set !== farmId) throw new FarmScopeError("OTHER_FARM");
              if (creating && row.farmId === undefined && !relation) row.farmId = farmId;
            }
            const links = linkedIds(model, row);
            const child = CHILD_MODELS[model];
            if (creating && child && typeof row[child.field] !== "string" && !(row[child.relation] as { connect?: unknown })?.connect) throw new FarmScopeError("PARENT_REQUIRED");
            const connected = child ? (row[child.relation] as { connect?: { id?: unknown } } | undefined)?.connect?.id : undefined;
            if (typeof connected === "string") links.push({ target: child!.parent, id: connected });
            for (const link of links) {
              const found = await delegateFor(scoped, link.target).count({ where: { id: link.id } });
              if (found !== 1) throw new FarmScopeError("LINK_OUTSIDE_FARM");
            }
            return row;
          };

          if (operation === "create") next.data = await prepare(next.data, true);
          else if (operation === "createMany" || operation === "createManyAndReturn") {
            const rows = Array.isArray(next.data) ? next.data : [next.data];
            next.data = await Promise.all(rows.map((r) => prepare(r, true)));
          } else if (operation === "update" || operation === "updateMany" || operation === "updateManyAndReturn") next.data = await prepare(next.data, false);
          else if (operation === "upsert") {
            next.create = await prepare(next.create, true);
            next.update = await prepare(next.update, false);
          }
          return query(next as typeof args);
        },
      },
    },
  });
  scoped = extend();
  return scoped;
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// The extension only changes what queries do, not what can be called, so callers keep the ordinary client type
// (helpers typed with Prisma.TransactionClient keep working inside transactions, which are scoped the same way).
export const prisma: PrismaClient = globalForPrisma.prisma ?? (buildClient() as unknown as PrismaClient);

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
