import { NextResponse } from "next/server";
import { accountFormOriginResponse, accountRateLimitResponse, readAccountForm } from "@/lib/account-form-security";
import { changeAccountPassword, clearSessionCookie, validatePassword } from "@/lib/auth";
import { currentUserOrResponse } from "@/lib/current-user";

const headers = { "Cache-Control": "private, no-store" };
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers });

export async function POST(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  const origin = accountFormOriginResponse(request);
  if (origin) return origin;
  if (process.env.FLOCKENCE_ORIYA_ONLY === "on") return fail("Manage your password through Oriya.", 403);

  try {
    const userId = session.user.id;
    const limit = await accountRateLimitResponse("account-password:" + userId, 5, 15 * 60_000, "Too many attempts. Try again later.");
    if (limit) return limit;
    const data = await readAccountForm(request);
    const current = data?.currentPassword;
    const next = data?.newPassword;
    if (typeof current !== "string" || !current || current.length > 128 || typeof next !== "string" || next.length > 128) {
      return fail("Enter your current and new passwords.", 400);
    }
    const check = validatePassword(next);
    if (!check.valid || current === next) return fail(check.errors.join(" ") || "Choose a different password.", 400);
    const result = await changeAccountPassword(userId, current, next);
    if (result === "no-password") return fail("Manage your password through your original sign-in provider.", 409);
    if (result === "incorrect") return fail("The current password is incorrect.", 403);
    const response = NextResponse.json({ changed: true }, { headers });
    response.headers.set("Set-Cookie", clearSessionCookie());
    return response;
  } catch {
    return fail("Could not change your password.", 503);
  }
}
