import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUserOrResponse } from "@/lib/current-user";
import { isTrustedAppOrigin } from "@/lib/request-origin";
import { checkRateLimit } from "@/lib/rate-limit";
import { getPasswordHash, verifyPassword } from "@/lib/auth";
import { checkSecondFactor, confirmTwoFactor, disableTwoFactor, newRecoveryCodesFor, startTwoFactor, twoFactorStatus } from "@/lib/two-factor";

const headers = { "Cache-Control": "private, no-store" };
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), password: z.string().min(1).max(128) }),
  z.object({ action: z.literal("confirm"), code: z.string().min(1).max(32) }),
  z.object({ action: z.literal("disable"), password: z.string().min(1).max(128), code: z.string().min(1).max(32) }),
  z.object({ action: z.literal("recovery"), password: z.string().min(1).max(128), code: z.string().min(1).max(32) }),
]);

/** Account page: two-factor sign-in for the signed-in person's own password account. */
export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  const hasPassword = Boolean(await getPasswordHash(session.user.id));
  return NextResponse.json({ ...(await twoFactorStatus(session.user.id)), available: hasPassword }, { headers });
}

export async function POST(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  if (!isTrustedAppOrigin(request)) return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403, headers });
  const user = session.user;
  const limit = await checkRateLimit("two-factor:" + user.id, 10, 15 * 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429, headers });
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "Check the form and try again." }, { status: 400, headers });
  const data = input.data;
  const stored = await getPasswordHash(user.id);
  if (!stored) return NextResponse.json({ error: "Two-factor sign-in is for password accounts. Oriya accounts use Oriya's sign-in security." }, { status: 400, headers });
  if ("password" in data && !(await verifyPassword(data.password, stored))) return NextResponse.json({ error: "Your password is not right." }, { status: 401, headers });

  if (data.action === "start") {
    const { secret, url } = await startTwoFactor(user.id, user.email);
    return NextResponse.json({ secret, url }, { headers });
  }
  if (data.action === "confirm") {
    const recovery = await confirmTwoFactor(user.id, data.code);
    if (!recovery) return NextResponse.json({ error: "That code is not right. Use the newest code from the app and check the phone's time." }, { status: 400, headers });
    return NextResponse.json({ ...(await twoFactorStatus(user.id)), recovery }, { headers });
  }
  if (!(await checkSecondFactor(user.id, data.code))) return NextResponse.json({ error: "That code is not right or has already been used." }, { status: 400, headers });
  if (data.action === "disable") {
    await disableTwoFactor(user.id);
    return NextResponse.json(await twoFactorStatus(user.id), { headers });
  }
  const recovery = await newRecoveryCodesFor(user.id);
  return NextResponse.json({ ...(await twoFactorStatus(user.id)), recovery }, { headers });
}
