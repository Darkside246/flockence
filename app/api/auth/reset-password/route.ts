import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { checkRateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { currentFarmId, ensureFarm } from "@/lib/operations";
import { consumePasswordReset, hashPassword, invalidateUserSessions, savePasswordHash, validatePassword } from "@/lib/auth";
import { runAsFarm } from "@/lib/farm-scope";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const token = typeof body.token === "string" ? body.token : "";
    const password = typeof body.password === "string" ? body.password : "";
    const clientIp = request.headers.get("cf-connecting-ip")?.trim() || request.headers.get("x-real-ip")?.trim() || "";
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const [tokenLimit, ipLimit] = await Promise.all([
      checkRateLimit("password-reset-complete:token:" + tokenHash, 5, 60 * 60 * 1000),
      clientIp ? checkRateLimit("password-reset-complete:ip:" + clientIp, 10, 60 * 60 * 1000) : Promise.resolve({ allowed: true, retryAfterSeconds: 0 }),
    ]);
    if (!tokenLimit.allowed || !ipLimit.allowed) {
      const retryAfterSeconds = Math.max(tokenLimit.retryAfterSeconds, ipLimit.retryAfterSeconds);
      return NextResponse.json({ error: "Too many password reset attempts. Request a new reset link later.", retryAfterSeconds }, {
        status: 429,
        headers: { "Retry-After": String(retryAfterSeconds) },
      });
    }
    if (!token || token.length > 256) {
      return NextResponse.json({ error: "This reset link is invalid or has expired." }, { status: 400 });
    }
    const check = validatePassword(password);
    if (!check.valid) return NextResponse.json({ error: check.errors.join(" ") }, { status: 400 });
    if (password.length > 128) return NextResponse.json({ error: "Password is too long." }, { status: 400 });
    const reset = await consumePasswordReset(token);
    if (!reset) return NextResponse.json({ error: "This reset link is invalid or has expired." }, { status: 400 });
    // The reset link's own farm only.
    const passwordHash = await hashPassword(password);
    const done = await runAsFarm(reset.farmId, async () => {
      await ensureFarm();
      const user = await prisma.user.findFirst({ where: { id: reset.userId, farmId: currentFarmId() }, select: { id: true } });
      if (!user) return false;
      await savePasswordHash(user.id, passwordHash);
      await prisma.setting.delete({ where: { id: reset.settingId } }).catch(() => undefined);
      await invalidateUserSessions(user.id);
      return true;
    });
    if (!done) return NextResponse.json({ error: "This reset link is invalid or has expired." }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Unable to reset the password." }, { status: 500 });
  }
}
