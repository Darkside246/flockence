import { activeEmailInvitations, issueEmailTeamInvite, revokeEmailInvitation, teamInviteEmail } from "@/lib/email-team-invites";
import { farmRoles } from "@/lib/farm-roles";
import { NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { currentFarmId } from "@/lib/operations";
import { currentUserOrRoleResponse } from "@/lib/current-user";
import { accountFormOriginResponse, readAccountForm } from "@/lib/account-form-security";
import { checkRateLimit } from "@/lib/rate-limit";

const roles = farmRoles;
const inviteRoles = ["MANAGER", "WORKER", "READ_ONLY"] as const;
const invitePrefix = "FARM_INVITE::";
const hashInvite = (value: string) => createHash("sha256").update(value).digest("hex");
type UserRole = typeof roles[number];

export async function GET(request: Request) {
  const access = await currentUserOrRoleResponse(request, ["OWNER", "MANAGER"]);
  if (access.response) return access.response;

  const users = await prisma.user.findMany({
    where: { farmId: currentFarmId() },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });
  const invitations = await activeEmailInvitations();
  return NextResponse.json({ users, invitations, currentUserId: access.user!.id, currentUserRole: access.user!.role });
}

export async function POST(request: Request) {
  const access = await currentUserOrRoleResponse(request, ["OWNER", "MANAGER"]);
  if (access.response) return access.response;

  const originResponse = accountFormOriginResponse(request);
  if (originResponse) return originResponse;

  try {
    const limit = await checkRateLimit("team:invite:" + currentFarmId(), 12, 15 * 60_000);
    if (!limit.allowed) return NextResponse.json({ error: "Too many team changes. Try again later." }, {
      status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) },
    });
    const input = await readAccountForm(request);
    if (!input) return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
    const requestedRole = String(input.role || "WORKER").toUpperCase();
    if (!inviteRoles.includes(requestedRole as typeof inviteRoles[number])) {
      return NextResponse.json({ error: "Choose Supervisor, Farm Hand or Read Only." }, { status: 400 });
    }
    if (access.user!.role === "MANAGER" && requestedRole === "MANAGER") {
      return NextResponse.json({ error: "Only an owner can invite a supervisor." }, { status: 403 });
    }
    const requestedDays = Number(input.expiresInDays ?? 7);
    if (!Number.isInteger(requestedDays) || requestedDays < 1 || requestedDays > 30) {
      return NextResponse.json({ error: "Invite expiry must be between 1 and 30 days." }, { status: 400 });
    }
    if (input.email !== undefined) {
      const email = teamInviteEmail(input.email);
      if (!email) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
      const expires = new Date(Date.now() + requestedDays * 86400000);
      const invitation = await issueEmailTeamInvite(access.user.id, email, requestedRole, expires);
      return NextResponse.json({ invitation }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
    }
    const inviteCode = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + requestedDays * 86400000);
    const invite = await prisma.$transaction(async (tx) => {
      const row = await tx.setting.create({
        data: {
          farmId: currentFarmId(),
          key: invitePrefix + hashInvite(inviteCode),
          value: JSON.stringify({ role: requestedRole, expiresAt: expiresAt.toISOString(), createdBy: access.user!.id }),
        },
      });
      await tx.auditLog.create({
        data: {
          farmId: currentFarmId(),
          userId: access.user!.id,
          action: "FARM_INVITE_CREATED",
          entity: "FarmInvitation",
          entityId: row.id,
          afterJson: JSON.stringify({ role: requestedRole, expiresAt: expiresAt.toISOString() }),
        },
      });
      return row;
    });
    return NextResponse.json({
      inviteCode,
      role: requestedRole,
      expiresAt: expiresAt.toISOString(),
      message: "This code is shown once. Copy it and share it securely with the invited person.",
    }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "EMAIL_INVITE_FORBIDDEN") return NextResponse.json({ error: "Your current role cannot send this invitation." }, { status: 403 });
    if (code === "EMAIL_INVITE_MEMBER") return NextResponse.json({ error: "This person is already a member of your farm." }, { status: 409 });
    if (code === "EMAIL_INVITES_UNAVAILABLE" || code === "EMAIL_INVITE_DELIVERY_FAILED") {
      return NextResponse.json({ error: "Invitation email could not be sent. Check the configured sender and try again." }, { status: 503 });
    }
    return NextResponse.json({ error: "Unable to create a farm invitation." }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const access = await currentUserOrRoleResponse(request, ["OWNER", "MANAGER"]);
  if (access.response) return access.response;

  const originResponse = accountFormOriginResponse(request);
  if (originResponse) return originResponse;

  try {
    const limit = await checkRateLimit("team:role:" + currentFarmId(), 30, 15 * 60_000);
    if (!limit.allowed) return NextResponse.json({ error: "Too many team changes. Try again later." }, {
      status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) },
    });
    const input = await readAccountForm(request);
    if (!input) return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
    const userId = typeof input.userId === "string" ? input.userId : "";
    const role = String(input.role || "").toUpperCase() as UserRole;
    if (!userId || !roles.includes(role)) {
      return NextResponse.json({ error: "Select a team member and a valid role." }, { status: 400 });
    }
    if (userId === access.user!.id) {
      return NextResponse.json({ error: "Ask another owner or manager to change your role. You cannot change your own access." }, { status: 409 });
    }
    if (access.user!.role === "MANAGER" && (role === "OWNER" || role === "MANAGER")) {
      return NextResponse.json({ error: "Managers can manage worker and read-only access. Only an owner can assign owner or manager roles." }, { status: 403 });
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${currentFarmId()}, 0))::text`;
      const actor = await tx.user.findFirst({ where: { id: access.user.id, farmId: currentFarmId() }, select: { role: true } });
      if (!actor || (actor.role !== "OWNER" && actor.role !== "MANAGER")
        || (actor.role === "MANAGER" && (role === "OWNER" || role === "MANAGER"))) {
        throw new Error("MANAGER_CANNOT_EDIT_MANAGEMENT");
      }
      const target = await tx.user.findFirst({
        where: { id: userId, farmId: currentFarmId() },
        select: { id: true, name: true, email: true, role: true, createdAt: true },
      });
      if (!target) throw new Error("TEAM_MEMBER_NOT_FOUND");
      if (actor.role === "MANAGER" && (target.role === "OWNER" || target.role === "MANAGER")) {
        throw new Error("MANAGER_CANNOT_EDIT_MANAGEMENT");
      }
      if (target.role === "OWNER" && role !== "OWNER") {
        const ownerCount = await tx.user.count({ where: { farmId: currentFarmId(), role: "OWNER" } });
        if (ownerCount <= 1) throw new Error("LAST_OWNER_REQUIRED");
      }
      const updated = await tx.user.update({
        where: { id: target.id },
        data: { role },
        select: { id: true, name: true, email: true, role: true, createdAt: true },
      });
      await tx.auditLog.create({
        data: {
          farmId: currentFarmId(),
          userId: access.user!.id,
          action: "FARM_MEMBER_ROLE_CHANGED",
          entity: "User",
          entityId: target.id,
          beforeJson: JSON.stringify({ role: target.role }),
          afterJson: JSON.stringify({ role: updated.role }),
        },
      });
      return updated;
    });

    return NextResponse.json({ user: updated });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "TEAM_MEMBER_NOT_FOUND") return NextResponse.json({ error: "That team member was not found in this farm." }, { status: 404 });
    if (code === "MANAGER_CANNOT_EDIT_MANAGEMENT") return NextResponse.json({ error: "Managers cannot change owner or manager accounts." }, { status: 403 });
    if (code === "LAST_OWNER_REQUIRED") return NextResponse.json({ error: "A farm must always have at least one owner. Assign another owner before changing this role." }, { status: 409 });
    return NextResponse.json({ error: "Unable to update team permissions." }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const access = await currentUserOrRoleResponse(request, ["OWNER", "MANAGER"]);
  if (access.response) return access.response;
  const originResponse = accountFormOriginResponse(request);
  if (originResponse) return originResponse;
  try {
    const limit = await checkRateLimit("team:invite-revoke:" + currentFarmId(), 30, 15 * 60_000);
    if (!limit.allowed) return NextResponse.json({ error: "Too many team changes. Try again later." }, { status: 429 });
    const data = await readAccountForm(request);
    if (typeof data?.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(data.id)) {
      return NextResponse.json({ error: "Choose an invitation." }, { status: 400 });
    }
    if (!await revokeEmailInvitation(data.id, access.user.id)) {
      return NextResponse.json({ error: "An active invitation was not found." }, { status: 404 });
    }
    return NextResponse.json({ revoked: true });
  } catch (error) {
    if (error instanceof Error && error.message === "EMAIL_INVITE_FORBIDDEN") {
      return NextResponse.json({ error: "Your current role cannot revoke this invitation." }, { status: 403 });
    }
    return NextResponse.json({ error: "Could not revoke the invitation." }, { status: 503 });
  }
}
