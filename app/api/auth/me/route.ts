import { NextResponse } from "next/server";
import { requireCurrentUser, authError } from "@/lib/current-user";

import { prisma } from "@/lib/prisma";
import { runAsFarm } from "@/lib/farm-scope";

export async function GET(request: Request) {
  try {
    const user = await requireCurrentUser(request);
    const membership = await runAsFarm(user.farmId, () => prisma.setting.findUnique({
      where: { farmId_key: { farmId: user.farmId, key: "MEMBERSHIP_V1" } },
      select: { value: true },
    }));
    return NextResponse.json({ user: { ...user, freeAppearance: membership?.value === "FREE" } });
  } catch (error) {
    const response = authError(error);
    if (response) return response;
    return NextResponse.json({ error: "Unable to load account." }, { status: 500 });
  }
}
