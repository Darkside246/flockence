type BatchInsight = { mortalityRate: number; feedCostPerBird: number | null; revenue: number; cost: number; days: number };

export function farmScore(input: { mortalityRate: number; margin: number | null; inventoryTurnover: number; expenseControl: number; consistency: number }) {
  const mortality = Math.max(0, Math.min(100, 100 - input.mortalityRate * 500));
  const margin = Math.max(0, Math.min(100, (input.margin ?? 0) * 100));
  const turnover = Math.max(0, Math.min(100, input.inventoryTurnover * 100));
  const expense = Math.max(0, Math.min(100, input.expenseControl * 100));
  const consistency = Math.max(0, Math.min(100, input.consistency * 100));
  return Math.round(mortality * .3 + margin * .25 + turnover * .15 + expense * .15 + consistency * .15);
}

export function alerts(batches: Array<{ name: string; status: string; expectedSlaughter: Date | null; initialChicks: number; mortality: number }>, now = new Date()) {
  return batches.flatMap(b => {
    const out: string[] = [];
    if (b.initialChicks && b.mortality / b.initialChicks >= .15) out.push(`${b.name}: mortality is at or above 15%.`);
    if (b.expectedSlaughter && b.expectedSlaughter <= new Date(now.getTime() + 7 * 86400000) && b.status === "ACTIVE") out.push(`${b.name}: expected slaughter is within 7 days.`);
    return out;
  });
}
