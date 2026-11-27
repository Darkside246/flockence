import { currentFarmId } from "@/lib/operations";
import { PLAN_LABELS, planLimits, visionPlan, type PlanLimits, type VisionPlan } from "@/lib/vision-schedule-rules.mjs";

/**
 * The current farm's Farm Vision plan and its limits. The plan follows the farm's membership (Free, Premium; farms from
 * before Premium was enforced count as Standard). VISION_PREMIUM_FARMS lists farm ids given Premium vision limits, for
 * example the owner's own farm. The limits themselves come from VISION_PLAN_LIMITS (lib/vision-schedule-rules.mjs).
 */
export async function currentVisionPlan(): Promise<{ plan: VisionPlan; label: string; limits: PlanLimits }> {
  // Loaded here because it also carries web response helpers the timer does not need.
  const { farmFeatureAccess } = await import("@/lib/farm-feature-access");
  const access = await farmFeatureAccess().catch(() => ({ state: "UNAVAILABLE" as const }));
  const plan = visionPlan(access.state, currentFarmId(), process.env.VISION_PREMIUM_FARMS ?? "");
  return { plan, label: PLAN_LABELS[plan], limits: planLimits(plan, process.env.VISION_PLAN_LIMITS ?? "") };
}
