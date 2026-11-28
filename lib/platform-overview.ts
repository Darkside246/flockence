import { prisma } from "@/lib/prisma";
import { runUnscoped } from "@/lib/farm-scope";
import { monthKey } from "@/lib/vision-usage";
import { DELETION_KEY } from "@/lib/farm-deletion";
import { buildFarmRows, readVisionMonth } from "@/lib/platform-overview-rules.mjs";

/**
 * Every farm on this Flockence, for the operator's platform console (lib/platform-access.ts decides who sees it).
 * Read only, and a handful of grouped queries no matter how many farms there are. No farm records are shown, only counts.
 */
export async function platformFarmOverview(now = new Date()) {
  const usageKey = "VISION_USAGE::" + monthKey(now);
  return runUnscoped(async () => {
    const [farms, users, flocks, activity, storage, usage, deletions] = await Promise.all([
      prisma.farm.findMany({ select: { id: true, name: true, createdAt: true } }),
      prisma.user.findMany({ select: { farmId: true, name: true, email: true, role: true } }),
      prisma.batch.groupBy({ by: ["farmId"], where: { status: "ACTIVE" }, _count: { _all: true } }),
      prisma.auditLog.groupBy({ by: ["farmId"], _max: { createdAt: true } }),
      prisma.visionMedia.groupBy({ by: ["farmId"], _sum: { byteSize: true } }),
      prisma.setting.findMany({ where: { key: usageKey }, select: { farmId: true, value: true } }),
      prisma.setting.findMany({ where: { key: DELETION_KEY }, select: { farmId: true } }),
    ]);
    const byFarm = new Map<string, { total: number; owners: { name: string; email: string }[] }>();
    for (const u of users) {
      const entry = byFarm.get(u.farmId) ?? { total: 0, owners: [] };
      entry.total += 1;
      if (u.role === "OWNER") entry.owners.push({ name: u.name, email: u.email });
      byFarm.set(u.farmId, entry);
    }
    return buildFarmRows(farms, {
      users: byFarm,
      activeFlocks: new Map(flocks.map((f) => [f.farmId, f._count._all])),
      lastActivity: new Map(activity.flatMap((a) => (a._max.createdAt ? [[a.farmId, a._max.createdAt] as const] : []))),
      storageBytes: new Map(storage.map((s) => [s.farmId, s._sum.byteSize ?? 0])),
      visionMonth: new Map(usage.map((u) => [u.farmId, readVisionMonth(u.value)])),
      deletionPending: new Set(deletions.map((d) => d.farmId)),
    }, now);
  });
}
