import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUserOrRoleResponse } from "@/lib/current-user";

export const runtime = "nodejs";

const count = z.number().int().nonnegative();
const ratio = z.number().min(0).max(1);
const coco = z.object({ averagePrecision: ratio, images: count });
const reportSchema = z.object({
  version: z.literal(1),
  release: z.literal("10.5281/zenodo.20672799"),
  createdAt: z.iso.datetime({ offset: true }),
  archives: z.array(z.object({
    archive: z.enum(["ChickenDet.zip", "ChickenAct.zip"]),
    imageFiles: count, videoFiles: count, annotationFiles: count,
  })).length(2),
  detection: coco.optional(),
  segmentation: coco.optional(),
  behavior: z.object({ clips: count, accuracy: ratio, macroF1: ratio }).optional(),
});

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(request: Request) {
  if (process.env.CHICKENVERSE_RESEARCH !== "on") return new Response(null, { status: 404, headers });
  const access = await currentUserOrRoleResponse(request, ["OWNER"]);
  if (access.response) return access.response;
  // The research report is privately installed for this farm by the VPS administrator.
  if (access.user.farmId !== process.env.CHICKENVERSE_RESEARCH_FARM_ID) return new Response(null, { status: 404, headers });
  const filename = process.env.CHICKENVERSE_RESEARCH_REPORT;
  if (!filename) return NextResponse.json({ report: null }, { headers });
  try {
    const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      if (!(await file.stat()).isFile()) return new Response(null, { status: 503, headers });
      const buffer = Buffer.alloc(8193);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      if (bytesRead === buffer.length) return new Response(null, { status: 503, headers });
      const parsed = reportSchema.safeParse(JSON.parse(buffer.toString("utf8", 0, bytesRead)));
      return parsed.success ? NextResponse.json({ report: parsed.data }, { headers }) : new Response(null, { status: 503, headers });
    } finally {
      await file.close();
    }
  } catch {
    return new Response(null, { status: 503, headers });
  }
}
