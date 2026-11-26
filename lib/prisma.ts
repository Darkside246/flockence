import { AsyncLocalStorage } from "node:async_hooks";
import { Prisma, PrismaClient } from "@prisma/client";
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

type Tx = Prisma.TransactionClient;
const transactions = new AsyncLocalStorage<{ farm: string | null; client: Tx }>();

function buildClient(base: PrismaClient) {
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
              const found = await delegateFor(transactions.getStore()?.client ?? scoped, link.target).count({ where: { id: link.id } });
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

type Work = (client: Tx) => unknown;
type TxOptions = { maxWait?: number; timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel };
const farmTables = ["Farm", ...FARM_MODELS, ...Object.keys(CHILD_MODELS)];
const modelKeys = new Map(Object.values(Prisma.ModelName).map((name) => [name[0].toLowerCase() + name.slice(1), name]));
const raw = new Set(["$queryRaw", "$queryRawUnsafe", "$executeRaw", "$executeRawUnsafe"]);

function tenantFacade(identity: PrismaClient, tenant: PrismaClient): PrismaClient {
  const jobs = new WeakMap<object, Work>();

  function scope() {
    return isUnscoped() ? null : currentFarmId();
  }

  function inTransaction<T>(farm: string | null, work: (tx: Tx) => Promise<T>, options?: TxOptions) {
    const db = farm === null ? identity : tenant;
    return db.$transaction(async (tx) => {
      if (farm !== null) {
        const [bound] = await tx.$queryRaw<{ farm: string; role: string; active: number }[]>`
          SELECT set_config('app.farm_id', ${farm}, true) AS farm, current_user::text AS role,
            (
              SELECT count(*)::int FROM pg_policies
              WHERE schemaname = 'public' AND tablename::text IN (${Prisma.join(farmTables)})
                AND policyname = 'flockence_farm_boundary' AND permissive = 'RESTRICTIVE'
                AND 'flockence_tenant' = ANY(roles)
                AND row_security_active(to_regclass(format('public.%I', tablename)))
            ) AS active
        `;
        if (bound?.farm !== farm || bound.role !== "flockence_tenant" || bound.active !== farmTables.length) {
          throw new FarmScopeError("FARM_DATABASE_RLS_REQUIRED");
        }
      }
      return transactions.run({ farm, client: tx }, () => work(tx));
    }, options);
  }

  async function execute(work: Work, shared = false) {
    if (shared && !transactions.getStore()) return await work(tenant);
    const farm = scope();
    const active = transactions.getStore();
    if (active) {
      if (active.farm !== farm) throw new FarmScopeError("FARM_TRANSACTION_SCOPE_MISMATCH");
      return await work(active.client);
    }
    if (farm === null) return await work(identity);
    return await inTransaction(farm, async (tx) => await work(tx));
  }

  function task(work: Work, shared = false) {
    let promise: Promise<unknown> | undefined;
    const run = () => promise ??= execute(work, shared);
    const result = {
      then: (yes: (value: unknown) => unknown, no: (reason: unknown) => unknown) => run().then(yes, no),
      catch: (no: (reason: unknown) => unknown) => run().catch(no),
      finally: (done: () => void) => run().finally(done),
      [Symbol.toStringTag]: "PrismaPromise",
    };
    const lazy: object = new Proxy(result, {
      get(target, method, receiver) {
        if (typeof method !== "string" || Reflect.has(target, method)) return Reflect.get(target, method, receiver);
        // Prisma findUnique exposes relation methods before its promise runs.
        return (...args: unknown[]) => task((tx) => invoke(work(tx), method, args), shared);
      },
    });
    jobs.set(lazy, work);
    return lazy;
  }

  function invoke(receiver: unknown, method: string, args: unknown[]) {
    return Reflect.apply(Reflect.get(receiver as object, method), receiver, args);
  }

  return new Proxy(identity, {
    get(target, key, receiver) {
      if (key === "$transaction") return (input: unknown, options?: TxOptions) => {
        if (transactions.getStore()) throw new FarmScopeError("NESTED_FARM_TRANSACTION");
        const farm = scope();
        if (typeof input === "function") return inTransaction(farm, async (tx) => await input(tx), options);
        if (!Array.isArray(input)) throw new TypeError("Expected a Prisma transaction callback or operations");
        const work = input.map((operation) => {
          const item = jobs.get(operation);
          if (!item) throw new TypeError("Expected unconsumed operations from the Flockence database client");
          return item;
        });
        return inTransaction(farm, async (tx) => {
          const results: unknown[] = [];
          for (const item of work) results.push(await item(tx));
          return results;
        }, options);
      };
      if (key === "$disconnect") return () => Promise.all([identity.$disconnect(), tenant.$disconnect()]).then(() => undefined);
      if (key === "$connect") return () => Promise.all([identity.$connect(), tenant.$connect()]).then(() => undefined);
      if (typeof key === "string" && raw.has(key)) return (...args: unknown[]) => task((tx) => invoke(tx, key, args));

      const model = typeof key === "string" ? modelKeys.get(key) : undefined;
      const delegate = Reflect.get(target, key, receiver);
      if (!model) return delegate;
      return new Proxy(delegate as object, {
        get(modelTarget, method, modelReceiver) {
          const value = Reflect.get(modelTarget, method, modelReceiver);
          if (typeof method !== "string" || typeof value !== "function") return value;
          return (...args: unknown[]) => task(
            (tx) => invoke(Reflect.get(tx as object, key), method, args),
            GLOBAL_MODELS.has(model),
          );
        },
      });
    },
  });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const legacy = buildClient(base) as unknown as PrismaClient;
const url = process.env.FARM_RLS_DATABASE_URL;
const restricted = url ? buildClient(new PrismaClient({ datasourceUrl: url })) as unknown as PrismaClient : null;

export const prisma: PrismaClient = globalForPrisma.prisma ?? (restricted ? tenantFacade(legacy, restricted) : legacy);
// Only the rate limiter uses this client. The table contains no farm records.
export const rateLimitDatabase = restricted ?? legacy;

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
