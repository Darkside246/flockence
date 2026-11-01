import { NextResponse } from "next/server";
import { currentUserOrResponse, currentUserOrRoleResponse } from "@/lib/current-user";
import { calculateScenario } from "@/lib/scenarios";

export async function POST(request: Request) {
  const session = await currentUserOrRoleResponse(request, ["OWNER", "MANAGER"]);
  if (session.response) return session.response;
  try {
    const input = await request.json();
    const result = calculateScenario({
      chicks: Number(input.chicks), chickCost: Number(input.chickCost), mortalityPct: Number(input.mortalityPct),
      feedBags: Number(input.feedBags), feedBagCost: Number(input.feedBagCost), beddingCost: Number(input.beddingCost),
      medicineCost: Number(input.medicineCost), slaughterCostPerBird: Number(input.slaughterCostPerBird),
      averageSaleWeightLb: Number(input.averageSaleWeightLb), salePricePerLb: Number(input.salePricePerLb),
      utilityCost: Number(input.utilityCost || 0), transportCost: Number(input.transportCost || 0)
    });
    return NextResponse.json(result);
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid scenario." }, { status: 400 }); }
}
