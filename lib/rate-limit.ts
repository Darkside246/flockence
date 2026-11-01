import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

function hashKey(key: string) {
  return createHash("sha256").update(key).digest("hex");
}

let lastCleanupAt = 0;

/**
 * PostgreSQL-backed fixed-window limiter shared across app instances.
 * The atomic upsert prevents parallel login attempts from bypassing the limit.
 */
export async function checkRateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const resetAt = new Date(now + windowMs);
  const keyHash = hashKey(key);

  const rows = await prisma.$queryRaw<Array<{ count: number; resetAt: Date }>>`
    INSERT INTO "RateLimitBucket" ("keyHash", "count", "resetAt")
    VALUES (${keyHash}, 1, ${resetAt})
    ON CONFLICT ("keyHash") DO UPDATE
    SET
      "count" = CASE
        WHEN "RateLimitBucket"."resetAt" <= NOW() THEN 1
        ELSE "RateLimitBucket"."count" + 1
      END,
      "resetAt" = CASE
        WHEN "RateLimitBucket"."resetAt" <= NOW() THEN EXCLUDED."resetAt"
        ELSE "RateLimitBucket"."resetAt"
      END
    RETURNING "count", "resetAt"
  `;

  if (now - lastCleanupAt > 10 * 60 * 1000) {
    lastCleanupAt = now;
    void prisma.$executeRaw`DELETE FROM "RateLimitBucket" WHERE "resetAt" < NOW() - INTERVAL '1 hour'`.catch(() => undefined);
  }

  const row = rows[0];
  const count = Number(row?.count || 1);
  const effectiveReset = row?.resetAt instanceof Date ? row.resetAt.getTime() : now + windowMs;
  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    retryAfterSeconds: Math.max(1, Math.ceil((effectiveReset - now) / 1000)),
  };
}
