import { prisma } from "./prisma";
import { FARM_ID } from "./operations";

export type WithdrawalBlocker = {
  treatmentId: string;
  batchId: string;
  productName: string;
  status: string;
  clearsAt: string | null;
  reason: "ACTIVE_WITHOUT_CLEARANCE_DATE" | "WITHDRAWAL_NOT_CLEARED";
};

export async function getWithdrawalBlockers(batchId: string, effectiveDate = new Date()): Promise<WithdrawalBlocker[]> {
  const dayStart = new Date(effectiveDate);
  if (!Number.isFinite(dayStart.getTime())) throw new Error("A valid effective date is required for withdrawal validation.");
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  const rows = await prisma.treatment.findMany({
    where: {
      farmId: FARM_ID,
      batchId,
      startedAt: { lt: dayEnd },
      OR: [
        { status: "ACTIVE", withdrawalClearsAt: null },
        { withdrawalClearsAt: { gt: dayStart } },
      ],
    },
    orderBy: { withdrawalClearsAt: "asc" },
  });

  return rows.map((row) => ({
    treatmentId: row.id,
    batchId: row.batchId ?? batchId,
    productName: row.productName,
    status: row.status,
    clearsAt: row.withdrawalClearsAt?.toISOString() ?? null,
    reason: row.withdrawalClearsAt ? "WITHDRAWAL_NOT_CLEARED" : "ACTIVE_WITHOUT_CLEARANCE_DATE",
  }));
}

export async function assertHarvestAllowed(batchId: string, effectiveDate = new Date()) {
  const blockers = await getWithdrawalBlockers(batchId, effectiveDate);
  if (!blockers.length) return;
  const first = blockers[0];
  const clearance = first.clearsAt ? ` Withdrawal clearance: ${first.clearsAt}.` : " No withdrawal clearance date has been recorded.";
  throw new Error(`HARVEST_BLOCKED_WITHDRAWAL: ${first.productName} is not cleared for harvest.${clearance}`);
}

export async function withdrawalStatusForBatch(batchId: string, effectiveDate = new Date()) {
  const blockers = await getWithdrawalBlockers(batchId, effectiveDate);
  return {
    blocked: blockers.length > 0,
    blockers,
  };
}
