import type { Prisma } from "@prisma/client";

/**
 * Serialize food-safety and stock-changing operations for the same flock.
 * Every treatment, egg collection, sale and carton pack must acquire this lock.
 */
export async function lockFlockOperations(tx: Prisma.TransactionClient, batchIds: readonly string[]) {
  const ids = [...new Set(batchIds.filter((id) => typeof id === "string" && id.length > 0))].sort();
  for (const id of ids) {
    // $executeRaw, not $queryRaw: the lock function returns void, which Prisma cannot read back as a result row.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"chicken-op-flock:" + id}, 0))`;
  }
}
