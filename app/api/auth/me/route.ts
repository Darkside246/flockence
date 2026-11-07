import { NextResponse } from "next/server";
import { requireCurrentUser, authError } from "@/lib/current-user";

import { prisma } from "@/lib/prisma";
import { runAsFarm } from "@/lib/farm-scope";

export async function GET(request: Request) {
  try {
    const user = await requireCurrentUser(request);
    // The farm membership and its dashboard choices come with the sign-in check, so the dashboard needs no extra request.
    const [membership, hiddenRow] = await runAsFarm(user.farmId, () => Promise.all([
      prisma.setting.findUnique({ where: { farmId_key: { farmId: user.farmId, key: "MEMBERSHIP_V1" } }, select: { value: true } }),
      prisma.setting.findUnique({ where: { farmId_key: { farmId: user.farmId, key: "dashboard_hidden" } }, select: { value: true } }),
    ]));
    let dashboardHidden: string[] = [];
    try { const v = JSON.parse(hiddenRow?.value ?? "[]"); if (Array.isArray(v)) dashboardHidden = v.filter((x): x is string => typeof x === "string"); } catch { /* ignore a bad value */ }
    return NextResponse.json({ user: { ...user, freeAppearance: membership?.value === "FREE", dashboardHidden } }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const response = authError(error);
    if (response) return response;
    return NextResponse.json({ error: "Unable to load account." }, { status: 500 });
  }
}
