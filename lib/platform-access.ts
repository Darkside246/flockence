import { currentUserOrResponse } from "@/lib/current-user";

export async function platformAdministrator(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return null;
  const userIds = new Set((process.env.FLOCKENCE_PLATFORM_ADMIN_IDS ?? "").split(",")
    .map((id) => id.trim()).filter(Boolean));
  return userIds.has(session.user.id) ? session.user : null;
}

export function platformStatus() {
  return {
    emailDeliveryConfigured: Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM),
    welcomeEmailEnabled: process.env.FLOCKENCE_WELCOME_EMAIL === "on",
    aiVisionConfigured: Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY),
    oriyaSignInConfigured: Boolean(process.env.ORIYA_PLATFORM_SECRET && process.env.ORIYA_URL),
    databaseIsolationConfigured: Boolean(process.env.FARM_RLS_DATABASE_URL),
    premiumEnforcementEnabled: process.env.FLOCKENCE_ENFORCE_PREMIUM === "on",
  };
}
