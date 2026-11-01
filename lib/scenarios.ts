export type ScenarioInput = { chicks: number; chickCost: number; mortalityPct: number; feedBags: number; feedBagCost: number; beddingCost: number; medicineCost: number; slaughterCostPerBird: number; averageSaleWeightLb: number; salePricePerLb: number; utilityCost: number; transportCost: number };

export function calculateScenario(input: ScenarioInput) {
  const survivors = Math.max(0, Math.round(input.chicks * (1 - input.mortalityPct / 100)));
  const revenue = survivors * input.averageSaleWeightLb * input.salePricePerLb;
  const costs = input.chicks * input.chickCost + input.feedBags * input.feedBagCost + input.beddingCost + input.medicineCost + survivors * input.slaughterCostPerBird + input.utilityCost + input.transportCost;
  const breakEvenPerLb = survivors && input.averageSaleWeightLb ? costs / (survivors * input.averageSaleWeightLb) : null;
  const breakEvenBirdPrice = survivors ? costs / survivors : null;
  return { survivors, revenue, costs, profit: revenue - costs, margin: revenue ? (revenue - costs) / revenue : null, breakEvenPerLb, breakEvenBirdPrice };
}

export function buildRollingPlan(start: Date, batchSize: number, staggerWeeks: number, slaughterWeeks: number, expectedMortalityPct: number, months = 6) {
  const rows = [];
  for (let i = 0; i < Math.ceil((months * 4.35) / staggerWeeks); i++) {
    const startDate = new Date(start); startDate.setDate(startDate.getDate() + i * staggerWeeks * 7);
    const slaughterDate = new Date(startDate); slaughterDate.setDate(slaughterDate.getDate() + slaughterWeeks * 7);
    rows.push({ sequence: i + 1, startDate: startDate.toISOString().slice(0, 10), expectedSlaughter: slaughterDate.toISOString().slice(0, 10), chicks: batchSize, expectedSurvivors: Math.round(batchSize * (1 - expectedMortalityPct / 100)) });
  }
  return rows;
}
