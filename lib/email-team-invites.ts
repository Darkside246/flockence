import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { createSession, hashPassword, normalizeEmail, savePasswordHash, validatePassword } from "@/lib/auth";
import { currentFarmId, runAsFarm } from "@/lib/farm-scope";
import { canInviteRole } from "@/lib/farm-roles";
import { sendTeamInvitationEmail } from "@/lib/mail";
import { ensureFarm } from "@/lib/operations";
import { prisma } from "@/lib/prisma";

const prefix = "FARM_EMAIL_INVITE::";
const tokenPattern = /^([A-Za-z0-9_-]{3,64})\.([A-Za-z0-9_-]{43})$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const schema = z.object({
  email: z.string().max(254).regex(emailPattern),
  role: z.enum(["MANAGER", "WORKER", "READ_ONLY"]),
  createdBy: z.string().min(1),
  expiresAt: z.string().refine(value => Number.isFinite(Date.parse(value))),
});

function invitation(value: string) {
  try {
    const invite = schema.safeParse(JSON.parse(value));
    return invite.success && Date.parse(invite.data.expiresAt) > Date.now() ? invite.data : null;
  } catch {
    return null;
  }
}

function keyOf(token: string) {
  return prefix + createHash("sha256").update(token).digest("hex");
}

function tokenScope(token: string) {
  const [, farmId] = tokenPattern.exec(token) ?? [];
  return farmId ? { farmId, key: keyOf(token) } : null;
}

export function teamInviteEmail(value: unknown) {
  const email = typeof value === "string" ? normalizeEmail(value) : "";
  return email.length <= 254 && emailPattern.test(email) ? email : null;
}

export async function issueEmailTeamInvite(actorId: string, email: string, role: string, expiresAt: Date) {
  if (process.env.FLOCKENCE_ORIYA_ONLY === "on") throw new Error("EMAIL_INVITES_UNAVAILABLE");
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM) throw new Error("EMAIL_INVITES_UNAVAILABLE");
  const origin = new URL(process.env.APP_URL ?? "");
  if (origin.protocol !== "https:" || origin.username || origin.password) throw new Error("EMAIL_INVITES_UNAVAILABLE");
  const farmId = currentFarmId();
  const token = farmId + "." + randomBytes(32).toString("base64url");
  const key = keyOf(token);
  const url = new URL("/signup/team", origin);
  url.hash = "invite=" + token;
  const row = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${farmId}, 0))::text`;
    const actor = await tx.user.findFirst({ where: { id: actorId, farmId }, select: { role: true } });
    if (!actor || !canInviteRole(actor.role, role)) throw new Error("EMAIL_INVITE_FORBIDDEN");
    const member = await tx.user.findFirst({ where: { farmId, email }, select: { id: true } });
    if (member) throw new Error("EMAIL_INVITE_MEMBER");
    const farm = await tx.farm.findUniqueOrThrow({ where: { id: farmId }, select: { name: true } });
    const value = JSON.stringify({ email, role, createdBy: actorId, expiresAt: expiresAt.toISOString() });
    const invite = await tx.setting.create({ data: { farmId, key, value } });
    await tx.auditLog.create({ data: {
      farmId, userId: actorId, action: "FARM_EMAIL_INVITE_CREATED",
      entity: "FarmInvitation", entityId: invite.id,
      afterJson: JSON.stringify({ role, expiresAt: expiresAt.toISOString() }),
    } });
    return { id: invite.id, farmName: farm.name };
  });

  try {
    if (!await sendTeamInvitationEmail(email, url.href, row.farmName, expiresAt, row.id, farmId)) throw new Error("MAIL_REJECTED");
  } catch {
    await prisma.setting.deleteMany({ where: { farmId, key } }).catch(() => undefined);
    throw new Error("EMAIL_INVITE_DELIVERY_FAILED");
  }
  return { id: row.id, email, role, expiresAt: expiresAt.toISOString() };
}

export async function activeEmailInvitations() {
  const rows = await prisma.setting.findMany({
    where: { farmId: currentFarmId(), key: { startsWith: prefix } }, orderBy: { updatedAt: "desc" }, take: 100,
    select: { id: true, value: true },
  });
  return rows.flatMap(row => {
    const invite = invitation(row.value);
    return invite ? [{ id: row.id, email: invite.email, role: invite.role, expiresAt: invite.expiresAt }] : [];
  });
}

export async function revokeEmailInvitation(id: string, actorId: string) {
  const farmId = currentFarmId();
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${farmId}, 0))::text`;
    const row = await tx.setting.findFirst({ where: { id, farmId, key: { startsWith: prefix } } });
    const invite = row && invitation(row.value);
    if (!row || !invite) return false;
    const actor = await tx.user.findFirst({ where: { id: actorId, farmId }, select: { role: true } });
    if (!actor || !canInviteRole(actor.role, invite.role)) throw new Error("EMAIL_INVITE_FORBIDDEN");
    await tx.setting.delete({ where: { id: row.id } });
    await tx.auditLog.create({ data: {
      farmId, userId: actorId, action: "FARM_EMAIL_INVITE_REVOKED", entity: "FarmInvitation", entityId: row.id,
    } });
    return true;
  });
}

export async function inspectEmailTeamInvite(token: string) {
  const target = tokenScope(token);
  if (!target) return null;
  const { farmId, key } = target;
  return runAsFarm(farmId, async () => {
    const row = await prisma.setting.findUnique({ where: { farmId_key: { farmId, key } } });
    const invite = row && invitation(row.value);
    if (!invite) return null;
    const inviter = await prisma.user.findFirst({ where: { id: invite.createdBy, farmId }, select: { role: true } });
    if (!inviter || !canInviteRole(inviter.role, invite.role)) return null;
    const farm = await prisma.farm.findUnique({ where: { id: farmId }, select: { name: true } });
    return farm ? { farmName: farm.name, role: invite.role } : null;
  });
}

export async function redeemEmailTeamInvite(token: string, name: string, password: string) {
  const target = tokenScope(token);
  if (!target || name.length < 2 || name.length > 120 || password.length > 128 || !validatePassword(password).valid) return null;
  if (!await inspectEmailTeamInvite(token)) return null;
  const passwordHash = await hashPassword(password);
  const { farmId, key } = target;
  return runAsFarm(farmId, async () => {
    await ensureFarm();
    return prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${farmId}, 0))::text`;
      const row = await tx.setting.findUnique({ where: { farmId_key: { farmId, key } } });
      const invite = row && invitation(row.value);
      if (!row || !invite) return null;
      const inviter = await tx.user.findFirst({ where: { id: invite.createdBy, farmId }, select: { role: true } });
      if (!inviter || !canInviteRole(inviter.role, invite.role)) return null;
      const user = await tx.user.create({
        data: { farmId, email: invite.email, name, role: invite.role },
        select: { id: true },
      });
      await savePasswordHash(user.id, passwordHash, tx);
      const session = await createSession(user.id, undefined, tx);
      await tx.setting.delete({ where: { id: row.id } });
      await tx.auditLog.create({ data: {
        farmId, userId: user.id, action: "FARM_EMAIL_INVITE_ACCEPTED", entity: "FarmInvitation", entityId: row.id,
        afterJson: JSON.stringify({ role: invite.role }),
      } });
      return session;
    });
  });
}
