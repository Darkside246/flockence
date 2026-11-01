import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { FARM_ID, ensureFarm } from "@/lib/operations";
import { createSession, hashPassword, setSessionCookie, normalizeEmail, validatePassword } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";

const inviteHash = (value: string) => createHash("sha256").update(value).digest("hex");
const validRoles = ["OWNER", "MANAGER", "WORKER", "READ_ONLY"] as const;

function constantTimeSecretMatch(expected: string, supplied: string) {
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length > 0
    && expectedBytes.length === suppliedBytes.length
    && timingSafeEqual(expectedBytes, suppliedBytes);
}

export async function POST(request: Request) {
  try {
    await ensureFarm();
    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? normalizeEmail(body.email) : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (name.length < 2 || name.length > 120) return NextResponse.json({ error: "Enter your name (2 to 120 characters)." }, { status: 400 });
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    const passwordCheck = validatePassword(password);
    if (!passwordCheck.valid) return NextResponse.json({ error: passwordCheck.errors.join(" ") }, { status: 400 });
    if (password.length > 128) return NextResponse.json({ error: "Password is too long." }, { status: 400 });

    const clientIp = request.headers.get("cf-connecting-ip")?.trim() || request.headers.get("x-real-ip")?.trim() || "";
    const [emailLimit, ipLimit] = await Promise.all([
      checkRateLimit("signup:email:" + email, 5, 60 * 60 * 1000),
      clientIp ? checkRateLimit("signup:ip:" + clientIp, 10, 60 * 60 * 1000) : Promise.resolve({ allowed: true, retryAfterSeconds: 0 }),
    ]);
    if (!emailLimit.allowed || !ipLimit.allowed) {
      const retryAfterSeconds = Math.max(emailLimit.retryAfterSeconds, ipLimit.retryAfterSeconds);
      return NextResponse.json({ error: "Too many account setup attempts. Please try again later.", retryAfterSeconds }, {
        status: 429, headers: { "Retry-After": String(retryAfterSeconds) },
      });
    }

    const inviteCode = typeof body.inviteCode === "string" ? body.inviteCode : "";
    const passwordHash = await hashPassword(password);
    const user = await prisma.$transaction(async (tx) => {
      // Serialize first-owner claims and invitation checks for this farm.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${FARM_ID}, 0))`;

      const existing = await tx.user.findUnique({ where: { email }, select: { id: true } });
      if (existing) throw new Error("ACCOUNT_ALREADY_EXISTS");

      const userCount = await tx.user.count({ where: { farmId: FARM_ID } });
      let assignedRole: typeof validRoles[number] = userCount === 0 ? "OWNER" : "WORKER";
      if (process.env.NODE_ENV === "production") {
        if (userCount === 0) {
          const expectedOwnerCode = process.env.FARM_OWNER_SETUP_CODE || "";
          if (!constantTimeSecretMatch(expectedOwnerCode, inviteCode)) throw new Error("OWNER_SETUP_CODE_REQUIRED");
        } else {
          const inviteKey = "FARM_INVITE::" + inviteHash(inviteCode);
          const invite = inviteCode ? await tx.setting.findUnique({
            where: { farmId_key: { farmId: FARM_ID, key: inviteKey } },
          }) : null;

          if (invite) {
            let payload: { role?: string; expiresAt?: string };
            try { payload = JSON.parse(invite.value) as { role?: string; expiresAt?: string }; }
            catch { throw new Error("FARM_INVITE_INVALID"); }
            if (!payload.expiresAt || new Date(payload.expiresAt).getTime() <= Date.now()) {
              throw new Error("FARM_INVITE_EXPIRED");
            }
            if (!validRoles.includes(payload.role as typeof validRoles[number]) || payload.role === "OWNER") {
              throw new Error("FARM_INVITE_INVALID");
            }
            assignedRole = payload.role as typeof validRoles[number];
            // The invite is single-use. Deletion and user creation share one transaction.
            await tx.setting.delete({ where: { id: invite.id } });
          } else {
            throw new Error("FARM_INVITE_CODE_REQUIRED");
          }
        }
      }

      const created = await tx.user.create({
        data: { farmId: FARM_ID, name, email, role: assignedRole },
      });
      await tx.setting.upsert({
        where: { farmId_key: { farmId: FARM_ID, key: `AUTH_PASSWORD::${created.id}` } },
        create: { farmId: FARM_ID, key: `AUTH_PASSWORD::${created.id}`, value: passwordHash },
        update: { value: passwordHash },
      });
      return created;
    });

    const session = await createSession(user.id);
    const response = NextResponse.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    }, { status: 201 });
    response.headers.set("Set-Cookie", setSessionCookie(session.token));
    return response;
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "ACCOUNT_ALREADY_EXISTS") return NextResponse.json({ error: "An account already exists for that email." }, { status: 409 });
    if (code === "OWNER_SETUP_CODE_REQUIRED") return NextResponse.json({ error: "Initial farm setup requires the owner setup code. Contact the system administrator." }, { status: 403 });
    if (code === "FARM_INVITE_CODE_REQUIRED") return NextResponse.json({ error: "Enter a valid farm invitation code created by an owner or manager." }, { status: 403 });
    if (code === "FARM_INVITE_EXPIRED") return NextResponse.json({ error: "This farm invitation has expired. Ask the owner or manager for a new one." }, { status: 403 });
    if (code === "FARM_INVITE_INVALID") return NextResponse.json({ error: "This farm invitation is invalid. Ask the owner or manager for a new one." }, { status: 403 });
    if (code.includes("P2002")) return NextResponse.json({ error: "An account already exists for that email." }, { status: 409 });
    return NextResponse.json({ error: "Unable to create account." }, { status: 500 });
  }
}
