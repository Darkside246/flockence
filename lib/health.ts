import { prisma } from "@/lib/prisma";
import { FARM_ID, daysBetween } from "@/lib/operations";

export const HEALTH_SYMPTOMS = [
  "Not eating", "Not drinking", "Weak / sitting down", "Sudden deaths",
  "Coughing", "Sneezing", "Open-mouth breathing", "Nasal discharge",
  "Swollen face / eyes", "Runny eyes", "Diarrhea", "Bloody droppings",
  "Green droppings", "Drooping wings", "Limping", "Swollen joints",
  "Twisted neck", "Paralysis", "Poor growth", "Weight loss",
  "Feather problems", "Pale comb", "Blue / purple comb or wattles",
  "Abnormal behavior", "Excessive pecking", "Other"
] as const;

export const HEALTH_CATEGORIES = ["Respiratory", "Digestive", "Neurological", "Musculoskeletal", "External parasites", "Skin / feathers", "Behavior", "Environmental", "Other"] as const;

export const HEALTH_KNOWLEDGE: Record<string, string[]> = {
  Respiratory: ["Infectious bronchitis", "Mycoplasma-related disease", "Infectious coryza", "Environmental irritation"],
  Digestive: ["Coccidiosis", "Enteritis", "Parasites / worms", "Feed or water-related problems"],
  Neurological: ["Neurological disease", "Toxin exposure", "Nutritional or metabolic problem"],
  Musculoskeletal: ["Lameness", "Joint injury or inflammation", "Nutritional or management problem"],
  "External parasites": ["Mites", "Lice", "Other external parasites"],
  Environmental: ["Heat stress", "Cold stress", "Ammonia / poor ventilation", "Overcrowding"],
  "Skin / feathers": ["Pecking or injury", "Parasites", "Nutritional or environmental problem"],
  Behavior: ["Stress", "Overcrowding", "Feed / water access", "Environmental change"]
};

export async function healthDashboard() {
  const now = new Date();
  const [cases, treatments, tests, observations, batches] = await Promise.all([
    prisma.healthCase.findMany({ where: { farmId: FARM_ID }, orderBy: { openedAt: "desc" }, take: 100, include: { batch: true, observations: { orderBy: { observedAt: "desc" }, take: 3 }, treatments: { orderBy: { startedAt: "desc" }, take: 3 }, diagnosticTests: { orderBy: { testDate: "desc" }, take: 3 } } }),
    prisma.treatment.findMany({ where: { farmId: FARM_ID, status: { in: ["ACTIVE", "WITHDRAWAL_CLEARED"] } }, orderBy: { withdrawalClearsAt: "asc" }, take: 100, include: { batch: true, healthCase: true } }),
    prisma.diagnosticTest.findMany({ where: { farmId: FARM_ID }, orderBy: { testDate: "desc" }, take: 100 }),
    prisma.healthObservation.findMany({ where: { farmId: FARM_ID }, orderBy: { observedAt: "desc" }, take: 100, include: { batch: true, healthCase: true } }),
    prisma.batch.findMany({ where: { farmId: FARM_ID, status: "ACTIVE" }, select: { id: true, name: true, initialChicks: true, startDate: true, mortalityEvents: true } })
  ]);

  const openCases = cases.filter(c => c.status === "OPEN" || c.status === "MONITORING");
  const urgentCases = openCases.filter(c => c.severity === "URGENT");
  const activeWithdrawals = treatments.filter(t => t.status === "ACTIVE" && t.withdrawalClearsAt && t.withdrawalClearsAt > now);
  const pendingTests = tests.filter(t => t.status === "PENDING");
  const recentDeaths = batches.reduce((sum, b) => sum + b.mortalityEvents.filter(m => daysBetween(m.date, now) <= 1).reduce((x, m) => x + m.quantity, 0), 0);
  const alerts: string[] = [];
  if (urgentCases.length) alerts.push(`${urgentCases.length} urgent flock health case${urgentCases.length === 1 ? "" : "s"} need attention.`);
  if (recentDeaths >= 3) alerts.push(`${recentDeaths} mortality event${recentDeaths === 1 ? "" : "s"} recorded in the last 24 hours.`);
  if (activeWithdrawals.length) alerts.push(`${activeWithdrawals.length} treatment record${activeWithdrawals.length === 1 ? "" : "s"} still under withdrawal.`);
  if (pendingTests.length) alerts.push(`${pendingTests.length} diagnostic test${pendingTests.length === 1 ? "" : "s"} pending.`);
  return { cases, openCases, treatments, activeWithdrawals, tests, observations, alerts, urgentCases, pendingTests };
}

export function healthGuidance(category?: string, symptoms: string[] = []) {
  const likely = category ? HEALTH_KNOWLEDGE[category] ?? [] : [];
  const urgent = symptoms.some(s => ["Sudden deaths", "Open-mouth breathing", "Blue / purple comb or wattles", "Paralysis", "Twisted neck"].includes(s));
  return {
    possibleCauses: likely,
    urgent,
    message: urgent
      ? "These signs can occur in serious or contagious conditions. Treat this as an urgent investigation and contact an appropriate veterinarian or animal-health authority. This screen does not confirm a diagnosis."
      : "These observations can have multiple causes. Use this information to guide observation and recordkeeping, not as a confirmed diagnosis. Veterinary or laboratory testing may be needed."
  };
}
