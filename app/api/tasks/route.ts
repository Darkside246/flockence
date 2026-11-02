import { NextResponse } from "next/server";
import { currentUserOrResponse, currentUserOrRoleResponse } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { currentFarmId, ensureFarm } from "@/lib/operations";

const priorities = new Set(["LOW","MODERATE","HIGH","URGENT"]);

export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await ensureFarm();
  return NextResponse.json(await prisma.farmTask.findMany({
    where: { farmId: currentFarmId() },
    include: { batch: true, assignedTo: true },
    orderBy: [{ completedAt: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }],
    take: 200,
  }));
}

export async function POST(request: Request) {
  const session = await currentUserOrRoleResponse(request);
  if (session.response) return session.response;
  try {
    await ensureFarm();
    const input = await request.json();
    const title = String(input.title || "").trim();
    if (!title) return NextResponse.json({ error: "Task title is required." }, { status: 400 });
    const priority = String(input.priority || "MODERATE").toUpperCase();
    if (!priorities.has(priority)) return NextResponse.json({ error: "Invalid task priority." }, { status: 400 });
    if (input.batchId) {
      const batch = await prisma.batch.findFirst({ where: { id: String(input.batchId), farmId: currentFarmId() }, select: { id: true } });
      if (!batch) return NextResponse.json({ error: "Batch not found." }, { status: 404 });
    }
    const row = await prisma.farmTask.create({
      data: {
        farmId: currentFarmId(),
        batchId: input.batchId || null,
        title,
        description: input.description ? String(input.description) : null,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        priority: priority as any,
      },
    });
    return NextResponse.json(row, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create task." }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const session = await currentUserOrRoleResponse(request);
  if (session.response) return session.response;
  try {
    await ensureFarm();
    const input = await request.json();
    const id = String(input.id || "");
    if (!id) return NextResponse.json({ error: "Task id is required." }, { status: 400 });
    const completed = Boolean(input.completed);
    const result = await prisma.farmTask.updateMany({
      where: { id, farmId: currentFarmId() },
      data: { completedAt: completed ? new Date() : null },
    });
    if (result.count !== 1) return NextResponse.json({ error: "Task not found." }, { status: 404 });
    return NextResponse.json(await prisma.farmTask.findFirst({ where: { id, farmId: currentFarmId() } }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update task." }, { status: 400 });
  }
}
