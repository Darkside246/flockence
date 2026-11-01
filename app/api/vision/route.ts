import { NextResponse } from "next/server";
import { currentUserOrResponse, currentUserOrRoleResponse } from "@/lib/current-user";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { checkRateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { FARM_ID, ensureFarm } from "@/lib/operations";
import { safeJson, visionPrompt, VISION_MODEL, visionCategories, type VisionCategory } from "@/lib/vision";

export const runtime = "nodejs";

function isCategory(value: string): value is VisionCategory {
  return (visionCategories as readonly string[]).includes(value);
}

export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await ensureFarm();
  const rows = await prisma.healthObservation.findMany({
    where: { farmId: FARM_ID, category: { startsWith: "VISION:" } },
    orderBy: { observedAt: "desc" },
    take: 100,
  });
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const session = await currentUserOrRoleResponse(request);
  if (session.response) return session.response;
  let uploadedPath: string | null = null;
  try {
    const rate = await checkRateLimit("vision:" + session.user!.id, 6, 10 * 60 * 1000);
    if (!rate.allowed) {
      return NextResponse.json({ error: "Farm Vision rate limit exceeded.", retryAfterSeconds: rate.retryAfterSeconds }, {
        status: 429,
        headers: { "Retry-After": String(rate.retryAfterSeconds) },
      });
    }
    await ensureFarm();
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "Farm Vision is not configured. Add OPENAI_API_KEY to the server environment." }, { status: 503 });
    }

    const form = await request.formData();
    const file = form.get("image");
    const categoryRaw = String(form.get("category") || "OTHER");
    const batchIdRaw = String(form.get("batchId") || "");
    const notes = String(form.get("notes") || "").trim().slice(0, 2000);

    if (!(file instanceof File)) return NextResponse.json({ error: "An image is required." }, { status: 400 });
    if (!isCategory(categoryRaw)) return NextResponse.json({ error: "Invalid inspection category." }, { status: 400 });
    const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
    if (!allowedImageTypes.has(file.type.toLowerCase())) {
      return NextResponse.json({ error: "Use a JPEG, PNG, WebP or GIF image." }, { status: 400 });
    }
    if (file.size > 8 * 1024 * 1024) return NextResponse.json({ error: "Image is too large. Maximum size is 8 MB." }, { status: 413 });

    let batchContext = "";
    let batchId: string | null = batchIdRaw || null;
    if (batchId) {
      const batch = await prisma.batch.findFirst({ where: { id: batchId, farmId: FARM_ID }, include: { mortalityEvents: true, birdCounts: { orderBy: { date: "desc" }, take: 1 } } });
      if (!batch) return NextResponse.json({ error: "Batch not found." }, { status: 404 });
      const mortality = batch.mortalityEvents.reduce((sum, item) => sum + item.quantity, 0);
      const live = batch.birdCounts[0]?.liveCount ?? Math.max(0, batch.initialChicks - mortality);
      const ageDays = Math.max(0, Math.floor((Date.now() - new Date(batch.startDate).getTime()) / 86400000));
      batchContext = `Batch ${batch.name}; age about ${ageDays} days; initial chicks ${batch.initialChicks}; current live count about ${live}; recorded mortality ${mortality}.`;
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const base64 = bytes.toString("base64");
    const dataUrl = `data:${file.type};base64,${base64}`;

    const openaiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: VISION_MODEL,
        store: false,
        max_output_tokens: 1400,
        input: [{
          role: "user",
          content: [
            { type: "input_text", text: visionPrompt(categoryRaw, batchContext + (notes ? ` Farmer note: ${notes}` : "")) },
            { type: "input_image", image_url: dataUrl },
          ],
        }],
      }),
    });

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text();
      return NextResponse.json({ error: "The vision service could not analyze this image.", detail: errorText.slice(0, 500) }, { status: 502 });
    }

    const ai = await openaiResponse.json() as { output_text?: string };
    const parsed = safeJson(ai.output_text || "");
    if (!parsed) return NextResponse.json({ error: "Vision returned an unreadable result." }, { status: 502 });

    const extensions: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/gif": "gif",
    };
    const fileName = `${randomUUID()}.${extensions[file.type.toLowerCase()]}`;
    const uploadDir = path.resolve(process.env.VISION_STORAGE_DIR || path.join(process.cwd(), "storage", "vision"));
    await mkdir(uploadDir, { recursive: true });
    uploadedPath = path.join(uploadDir, fileName);
    await writeFile(uploadedPath, bytes, { flag: "wx", mode: 0o600 });

    const findingLines = Array.isArray(parsed.observations)
      ? parsed.observations.map((item: { title?: string; detail?: string }) => `${item.title || "Observation"}: ${item.detail || ""}`).join("\n")
      : "No structured observations returned.";
    const concerns = Array.isArray(parsed.concerns) ? parsed.concerns : [];
    const checks = Array.isArray(parsed.checks) ? parsed.checks : [];
    const noteBody = [
      parsed.summary ? `Summary: ${parsed.summary}` : "",
      `Confidence: ${parsed.confidence || "UNKNOWN"}`,
      `Severity: ${parsed.severity || "UNKNOWN"}`,
      findingLines ? `Observations:\n${findingLines}` : "",
      concerns.length ? `Concerns:\n${concerns.map((x: {title?: string; whyItMatters?: string}) => `- ${x.title || "Concern"}: ${x.whyItMatters || ""}`).join("\n")}` : "",
      checks.length ? `Checks:\n${checks.map((x: string) => `- ${x}`).join("\n")}` : "",
      parsed.escalate ? `Escalation: ${parsed.escalationReason || "Review by qualified animal-health personnel."}` : "",
      notes ? `Farmer note: ${notes}` : "",
      parsed.medicalDisclaimer || "Image findings are observations only. They do not confirm disease or cause of death.",
    ].filter(Boolean).join("\n\n");

    const saved = await prisma.$transaction(async (tx) => {
      const media = await tx.visionMedia.create({
        data: {
          farmId: FARM_ID,
          storageKey: fileName,
          mimeType: file.type.toLowerCase(),
          byteSize: bytes.byteLength,
        },
      });
      const imageUrl = `/api/vision/media/${media.id}`;
      const observation = await tx.healthObservation.create({
        data: {
          farmId: FARM_ID,
          batchId,
          observedAt: new Date(),
          symptom: "Farm Vision inspection",
          category: `VISION:${categoryRaw}`,
          affectedCount: 0,
          severity: parsed.severity === "URGENT" ? "URGENT" : parsed.severity === "HIGH" ? "HIGH" : parsed.severity === "LOW" ? "LOW" : "MODERATE",
          notes: noteBody,
          imageUrl,
          visionMediaId: media.id,
        },
      });
      return { observation, imageUrl };
    });

    uploadedPath = null;
    return NextResponse.json({ ...saved, analysis: parsed, model: VISION_MODEL }, { status: 201 });
  } catch (error) {
    if (uploadedPath) await unlink(uploadedPath).catch(() => undefined);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not analyze image." }, { status: 500 });
  }
}
