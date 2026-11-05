import { NextResponse } from "next/server";
import { requireCurrentUser, authError } from "@/lib/current-user";

import { prisma } from "@/lib/prisma";
import { operationKey, isOperation } from "@/lib/farm-operation";

export async function GET(request: Request) {
  try {
    const user = await requireCurrentUser(request);
    const setting = await prisma.setting.findUnique({ where: { farmId_key: { farmId: user.farmId, key: operationKey } } });
    return NextResponse.json({ user: { ...user, operation: isOperation(setting?.value) ? setting.value : null } }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const response = authError(error);
    if (response) return response;
    return NextResponse.json({ error: "Unable to load account." }, { status: 500 });
  }
}
