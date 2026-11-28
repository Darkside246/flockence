import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUserOrRoleResponse } from "@/lib/current-user";
import { isTrustedAppOrigin } from "@/lib/request-origin";
import { checkRateLimit } from "@/lib/rate-limit";
import { saveVisionLabel, visionAccuracy } from "@/lib/vision-accuracy";
import { evaluationCsv } from "@/lib/vision-accuracy-rules.mjs";

const headers = { "Cache-Control": "private, no-store" };
const roles = ["OWNER", "MANAGER"] as const;

/** Recent checks with labels and the measured accuracy; `?format=csv` downloads the labelled evaluation set. */
export async function GET(request: Request) {
  const access = await currentUserOrRoleResponse(request, [...roles]);
  if (access.response) return access.response;
  const { rows, report } = await visionAccuracy();
  if (new URL(request.url).searchParams.get("format") === "csv") {
    return new NextResponse(evaluationCsv(rows), { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="farm-vision-labels.csv"' } });
  }
  return NextResponse.json({ rows, report }, { headers });
}

const schema = z.object({
  observationId: z.string().min(1).max(64),
  birds: z.union([z.number(), z.string(), z.null()]).optional(),
  deadOrDown: z.union([z.number(), z.string(), z.null()]).optional(),
  floorEggs: z.union([z.number(), z.string(), z.null()]).optional(),
});

/** Label one check with what was really in the picture. Empty values clear the label. */
export async function PUT(request: Request) {
  const access = await currentUserOrRoleResponse(request, [...roles]);
  if (access.response) return access.response;
  if (!isTrustedAppOrigin(request)) return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403, headers });
  const limit = await checkRateLimit("vision-label:" + access.user.id, 300, 15 * 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "Too many labels at once. Try again shortly." }, { status: 429, headers });
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "Choose a check and enter whole numbers." }, { status: 400, headers });
  try {
    const saved = await saveVisionLabel(input.data.observationId, input.data, access.user.id);
    if (!saved) return NextResponse.json({ error: "Check not found." }, { status: 404, headers });
    return NextResponse.json({ saved: true }, { headers });
  } catch {
    return NextResponse.json({ error: "Enter whole numbers of zero or more, or leave a box empty." }, { status: 400, headers });
  }
}
