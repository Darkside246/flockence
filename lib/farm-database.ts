import { Prisma, PrismaClient } from "@prisma/client";
import { currentFarmId } from "@/lib/farm-scope";
import { prisma } from "@/lib/prisma";

const profiles = {
  customer: { env: "CUSTOMER_RLS_DATABASE_URL", role: "flockence_customer_runtime", tables: ["Customer"] },
  oriya: { env: "ORIYA_RLS_DATABASE_URL", role: "flockence_oriya_reader", tables: ["Batch","BirdCount","MortalityEvent","SlaughterEvent","FeedPurchase","FeedUsage","HealthCase","ThermometerReading"] },
} as const;

type Profile = keyof typeof profiles;
const pools: Partial<Record<Profile, PrismaClient>> = {};

export async function withProtectedFarmData<T>(profile: Profile, run: (db: Prisma.TransactionClient) => Promise<T>) {
  const farmId = currentFarmId();
  const config = profiles[profile];
  const url = process.env[config.env];
  // An unset URL keeps the existing scoped client in use before staging cutover.
  if (!url) return run(prisma);
  const db = pools[profile] ??= new PrismaClient({ datasourceUrl: url });
  return db.$transaction(async (tx) => {
    const [status] = await tx.$queryRaw<{ farm: string; role: string; protectedTables: number }[]>`
      SELECT current_user::text AS role, set_config('app.farm_id', ${farmId}, true) AS farm,
        (
          SELECT count(*)::int FROM pg_policies
          WHERE schemaname = 'public' AND tablename::text IN (${Prisma.join(config.tables)})
            AND policyname = 'flockence_runtime_boundary'
            AND permissive = 'RESTRICTIVE' AND ${config.role}::name = ANY(roles)
            AND row_security_active(to_regclass(format('public.%I', tablename)))
        ) AS "protectedTables"
    `;
    if (status?.farm !== farmId || status.role !== config.role || status.protectedTables !== config.tables.length) {
      throw new Error("FARM_DATABASE_RLS_REQUIRED");
    }
    return run(tx);
  });
}
