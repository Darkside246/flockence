import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { currentFarmId } from "@/lib/farm-scope";
import type { VisionCamera } from "@/lib/vision-camera";
import { visionPens } from "@/lib/vision-pens";

const prefix = "VISION_CAMERA_PEN::";
function keyFor(camera: VisionCamera) {
  return prefix + createHash("sha256").update(JSON.stringify([camera.source, camera.deviceKey])).digest("hex");
}

export async function camerasWithPens(cameras: VisionCamera[]) {
  if (!cameras.length) return [];
  const [rows, pens] = await Promise.all([
    prisma.setting.findMany({ where: { key: { in: cameras.map(keyFor) } }, select: { key: true, value: true } }),
    visionPens(),
  ]);
  const assignments = new Map(rows.map(row => [row.key, row.value]));
  const livePens = new Map(pens.map(pen => [pen.id, pen]));
  return cameras.map(camera => {
    const pen = livePens.get(assignments.get(keyFor(camera)) ?? "");
    return { name: camera.name, source: camera.source, ...(pen ? { pen } : {}) };
  });
}

export async function assignedCameraPen(camera: VisionCamera) {
  const link = await prisma.setting.findUnique({
    where: { farmId_key: { farmId: currentFarmId(), key: keyFor(camera) } }, select: { value: true },
  });
  return link ? (await visionPens(link.value))[0] ?? null : null;
}

export async function saveCameraPen(camera: VisionCamera, penId: string | null, userId: string) {
  const farmId = currentFarmId();
  const key = keyFor(camera);
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([farmId, key])}, 0))::text`;
    const existing = await tx.setting.findUnique({ where: { farmId_key: { farmId, key } } });
    if ((existing?.value ?? null) === penId) return;
    if (penId === null) await tx.setting.deleteMany({ where: { farmId, key } });
    else await tx.setting.upsert({
      where: { farmId_key: { farmId, key } }, create: { farmId, key, value: penId }, update: { value: penId },
    });
    const now = new Date();
    await tx.cameraPenLink.updateMany({ where: { farmId, cameraName: camera.name, toAt: null }, data: { toAt: now } });
    if (penId !== null) await tx.cameraPenLink.create({ data: { farmId, cameraName: camera.name, penId, fromAt: now } });
    await tx.auditLog.create({ data: {
      farmId, userId, action: "VISION_CAMERA_PEN_CHANGED", entity: "CameraPen", entityId: key,
      beforeJson: JSON.stringify({ penId: existing?.value ?? null }), afterJson: JSON.stringify({ penId }),
    } });
  });
}
