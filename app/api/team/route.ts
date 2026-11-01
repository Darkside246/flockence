import { NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { FARM_ID } from "@/lib/operations";
import { currentUserOrRoleResponse } from "@/lib/current-user";

const roles = ["OWNER", "MANAGER", "WORKER", "READ_ONLY"] as const;
const inviteRoles = ["MANAGER", "WORKER", "READ_ONLY"] as const;
const invitePrefix = "FARM_INVITE::";
const hashInvite = (value: string) => createHash("sha256").update(value).digest("hex");
type UserRole = typeof roles[number];

export async function GET(request: Request) {
  const access = await currentUserOrRoleResponse(request, ["OWNER", "MANAGER"]);
  if (access.response) return access.response;

  const users = await prisma.user.findMany({
    where: { farmId: FARM_ID },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });
  return NextResponse.json({ users, currentUserId: access.user!.id, currentUserRole: access.user!.role });
}

export async function POST(request: Request) {
  const access = await currentUserOrRoleResponse(request, ["OWNER", "MANAGER"]);
  if (access.response) return access.response;

  try {
    const input = await request.json();
    const requestedRole = String(input.role || "WORKER").toUpperCase();
    if (!inviteRoles.includes(requestedRole as typeof inviteRoles[number])) {
      return NextResponse.json({ error: "Choose Manager, Farm worker or Read only." }, { status: 400 });
    }
    if (access.user!.role === "MANAGER" && requestedRole === "MANAGER") {
      return NextResponse.json({ error: "Only an owner can invite another manager." }, { status: 403 });
    }
    const requestedDays = Number(input.expiresInDays ?? 7);
    if (!Number.isInteger(requestedDays) || requestedDays < 1 || requestedDays > 30) {
      return NextResponse.json({ error: "Invite expiry must be between 1 and 30 days." }, { status: 400 });
    }
    const inviteCode = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + requestedDays * 86400000);
    const invite = await prisma.$transaction(async (tx) => {
      const row = await tx.setting.create({
        data: {
          farmId: FARM_ID,
          key: invitePrefix + hashInvite(inviteCode),
          value: JSON.stringify({ role: requestedRole, expiresAt: expiresAt.toISOString(), createdBy: access.user!.id }),
        },
      });
      await tx.auditLog.create({
        data: {
          farmId: FARM_ID,
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
  } catch {
    return NextResponse.json({ error: "Unable to create a farm invitation." }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const access = await currentUserOrRoleResponse(request, ["OWNER", "MANAGER"]);
  if (access.response) return access.response;

  try {
    const input = await request.json();
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
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${FARM_ID}, 0))`;
      const target = await tx.user.findFirst({
        where: { id: userId, farmId: FARM_ID },
        select: { id: true, name: true, email: true, role: true, createdAt: true },
      });
      if (!target) throw new Error("TEAM_MEMBER_NOT_FOUND");
      if (access.user!.role === "MANAGER" && (target.role === "OWNER" || target.role === "MANAGER")) {
        throw new Error("MANAGER_CANNOT_EDIT_MANAGEMENT");
      }
      if (target.role === "OWNER" && role !== "OWNER") {
        const ownerCount = await tx.user.count({ where: { farmId: FARM_ID, role: "OWNER" } });
        if (ownerCount <= 1) throw new Error("LAST_OWNER_REQUIRED");
      }
      const updated = await tx.user.update({
        where: { id: target.id },
        data: { role },
        select: { id: true, name: true, email: true, role: true, createdAt: true },
      });
      await tx.auditLog.create({
        data: {
          farmId: FARM_ID,
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
