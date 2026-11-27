import { NextResponse } from "next/server";
import { z } from "zod";
import { accountFormOriginResponse, readAccountForm } from "@/lib/account-form-security";
import { currentUserOrRoleResponse } from "@/lib/current-user";
import { checkRateLimit } from "@/lib/rate-limit";
import { ensureFarm } from "@/lib/operations";
import { loadDailySettings, reportPeople, saveDailySettings } from "@/lib/vision-daily-report";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
const roles = ["OWNER", "MANAGER"] as const;
const form = z.strictObject({ enabled: z.boolean(), hour: z.number().int().min(0).max(23) });

/**
 * The farm's daily Vision email: on or off, the hour it goes out (farm time), and which owners and managers have chosen
 * report emails on their Account page. Every plan, Free included, gets the daily report.
 */
export async function GET(request: Request) {
  const session = await currentUserOrRoleResponse(request, [...roles]);
  if (session.response) return session.response;
  await ensureFarm();
  const [settings, people] = await Promise.all([loadDailySettings(), reportPeople()]);
  return NextResponse.json({
    settings,
    people: people.map((p) => ({ name: p.name, role: p.role, wantsReports: p.wantsReports, you: p.id === session.user.id })),
    email: Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM),
  }, { headers });
}

export async function PUT(request: Request) {
  const session = await currentUserOrRoleResponse(request, [...roles]);
  if (session.response) return session.response;
  const origin = accountFormOriginResponse(request);
  if (origin) return origin;
  const limit = await checkRateLimit("vision-daily-report:" + session.user.farmId, 30, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "Too many changes. Try again shortly." }, { status: 429, headers });
  const parsed = form.safeParse(await readAccountForm(request));
  if (!parsed.success) return NextResponse.json({ error: "Choose on or off and an hour from 0 to 23." }, { status: 400, headers });
  await ensureFarm();
  await saveDailySettings(parsed.data);
  return NextResponse.json({ settings: parsed.data }, { headers });
}
