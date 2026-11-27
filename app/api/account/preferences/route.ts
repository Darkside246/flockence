import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUserOrResponse } from "@/lib/current-user";
import { accountFormOriginResponse, accountRateLimitResponse, readAccountForm } from "@/lib/account-form-security";
import { accountPreferenceKey, preferenceSchema } from "@/lib/account-preferences";
import { prisma } from "@/lib/prisma";

const headers = { "Cache-Control": "private, no-store" };
const form = z.strictObject({ name: z.string().trim().min(2).max(120), preferences: preferenceSchema });

export async function PUT(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  const origin = accountFormOriginResponse(request);
  if (origin) return origin;

  try {
    const { id, farmId } = session.user;
    const limit = await accountRateLimitResponse("account-preferences:" + id, 20, 15 * 60_000, "Too many changes. Try again shortly.");
    if (limit) return limit;
    const parsed = form.safeParse(await readAccountForm(request));
    if (!parsed.success) return NextResponse.json({ error: "Enter a name and valid preferences." }, { status: 400, headers });
    const { name, preferences } = parsed.data;
    const key = accountPreferenceKey(id);
    const value = JSON.stringify(preferences);
    await prisma.$transaction(async tx => {
      await tx.user.update({ where: { id, farmId }, data: { name } });
      await tx.setting.upsert({ where: { farmId_key: { farmId, key } }, create: { farmId, key, value }, update: { value } });
    });
    return NextResponse.json({ name, preferences }, { headers });
  } catch {
    return NextResponse.json({ error: "Could not save your account preferences." }, { status: 503, headers });
  }
}
