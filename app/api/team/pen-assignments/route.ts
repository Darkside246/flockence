import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { currentFarmId } from "@/lib/farm-scope";
import { currentUserOrRoleResponse } from "@/lib/current-user";
import { isTrustedAppOrigin } from "@/lib/request-origin";
import { checkRateLimit } from "@/lib/rate-limit";
import { visionPens } from "@/lib/vision-pens";
import { allPenAssignments, savePenAssignment } from "@/lib/pen-access";

const headers = { "Cache-Control": "private, no-store" };

/** Pens on this farm and which pens each Farm Hand records for. Owners and Supervisors only. */
export async function GET(request: Request) {
  const access = await currentUserOrRoleResponse(request, ["OWNER", "MANAGER"]);
  if (access.response) return access.response;
  const [pens, assignments] = await Promise.all([visionPens(), allPenAssignments()]);
  return NextResponse.json({ pens, assignments }, { headers });
}

const schema = z.object({ userId: z.string().min(1).max(64), pens: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)).max(200) });

/** Set the pens one Farm Hand records for. An empty list means every pen again. */
export async function PUT(request: Request) {
  const access = await currentUserOrRoleResponse(request, ["OWNER", "MANAGER"]);
  if (access.response) return access.response;
  if (!isTrustedAppOrigin(request)) return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403, headers });
  const limit = await checkRateLimit("team:pens:" + currentFarmId(), 60, 15 * 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "Too many team changes. Try again later." }, { status: 429, headers });
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "Choose the team member and pens." }, { status: 400, headers });
  const member = await prisma.user.findFirst({ where: { id: input.data.userId, farmId: currentFarmId() }, select: { role: true } });
  if (!member) return NextResponse.json({ error: "Team member not found." }, { status: 404, headers });
  if (member.role !== "WORKER") return NextResponse.json({ error: "Pens are assigned to Farm Hands only. Owners and Supervisors record for every pen." }, { status: 400, headers });
  const pens = await savePenAssignment(input.data.userId, input.data.pens);
  return NextResponse.json({ userId: input.data.userId, pens }, { headers });
}
