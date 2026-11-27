import { accountPreferences } from "@/lib/account-preferences";
import { premiumFeatureResponse } from "@/lib/farm-feature-access";
import { NextResponse, after } from "next/server";
import { currentUserOrResponse, currentUserOrRoleResponse } from "@/lib/current-user";
import { isTrustedAppOrigin } from "@/lib/request-origin";
import { maxVisionImageBytes, validVisionCameraName, visionCameraByName, visionCameraRoles, visionCamerasEnabled, visionLiveEnabled } from "@/lib/vision-camera";
import { checkRateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { currentFarmId, ensureFarm } from "@/lib/operations";
import { visionPens } from "@/lib/vision-pens";
import { visionCategories, type VisionCategory } from "@/lib/vision";
import { visionConfigured } from "@/lib/vision-provider";
import { currentVisionPlan } from "@/lib/vision-plan";
import { monthUsage } from "@/lib/vision-usage";
import { runVisionInspection } from "@/lib/vision-inspection";
import { validRequestId } from "@/lib/photo-size.mjs";
import { earlierReply, runOnce, uploadStatus } from "@/lib/vision-upload-requests";

export const runtime = "nodejs";
export const maxDuration = 120;

function isCategory(value: string): value is VisionCategory {
  return (visionCategories as readonly string[]).includes(value);
}

export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  await ensureFarm();
  const rows = await prisma.healthObservation.findMany({
    where: { farmId: currentFarmId(), category: { startsWith: "VISION:" } },
    orderBy: { observedAt: "desc" },
    take: 100,
  });
  return NextResponse.json(rows, { headers: { "Cache-Control": "private, no-store" } });
}

/**
 * Start an inspection. A phone sends an Idempotency-Key with each upload and the same key when it retries after a lost
 * connection, so a retry never analyses, saves or charges the picture twice (lib/vision-upload-requests.ts).
 * With "Prefer: respond-async" the answer is 202 at once and the check finishes in the background; the phone collects
 * the result from /api/vision/status.
 */
export async function POST(request: Request) {
  const session = await currentUserOrRoleResponse(request);
  if (session.response) return session.response;
  const requestId = request.headers.get("idempotency-key");
  if (requestId === null) return inspect(request);
  if (!validRequestId(requestId)) return NextResponse.json({ error: "Invalid upload id." }, { status: 400 });
  if (!isTrustedAppOrigin(request)) return NextResponse.json({ error: "Open Farm Vision from the Flockence website." }, { status: 403 });
  await ensureFarm();
  const background = /respond-async/i.test(request.headers.get("prefer") ?? "");
  const status = background ? await uploadStatus(requestId) : null;
  if (status?.state === "RUNNING") return NextResponse.json({ requestId, state: "RUNNING" }, { status: 202, headers: { "Cache-Control": "private, no-store" } });
  const earlier = status?.state === "DONE" && status.reply.status < 300 ? status.reply : background ? null : await earlierReply(requestId);
  if (background && !earlier) {
    // Read the whole photo now, while the phone is still connected; then answer and carry on without it.
    const form = await request.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: "The photo did not arrive completely. Try again." }, { status: 400 });
    after(runOnce(requestId, () => inspectReply(request, requestId, form)));
    return NextResponse.json({ requestId, state: "RUNNING" }, { status: 202, headers: { "Cache-Control": "private, no-store" } });
  }
  const reply = earlier ?? await runOnce(requestId, () => inspectReply(request, requestId));
  const retryAfter: Record<string, string> = typeof reply.body.retryAfterSeconds === "number" ? { "Retry-After": String(reply.body.retryAfterSeconds) } : {};
  return NextResponse.json(reply.body, { status: reply.status, headers: { "Cache-Control": "private, no-store", ...retryAfter } });
}

async function inspectReply(request: Request, requestId: string, form?: FormData) {
  const response = await inspect(request, requestId, form);
  const body = await response.json().catch(() => ({ error: "Could not analyze image." }));
  const retryAfter = response.headers.get("Retry-After");
  return { status: response.status, body: retryAfter ? { ...body, retryAfterSeconds: Number(retryAfter) } : body };
}

async function inspect(request: Request, requestId?: string, preparedForm?: FormData): Promise<Response> {
  const session = await currentUserOrRoleResponse(request);
  if (session.response) return session.response;
  const locked = await premiumFeatureResponse();
  if (locked) return locked;
  try {
    if (!isTrustedAppOrigin(request)) return NextResponse.json({ error: "Open Farm Vision from the Flockence website." }, { status: 403 });
    const preferences = await accountPreferences(session.user.farmId, session.user.id);
    if (!preferences.allowVisionImages) {
      return NextResponse.json({ error: "Your account has disabled image sharing for Farm Vision." }, { status: 403 });
    }
    const rate = await checkRateLimit("vision:" + session.user!.id, 6, 10 * 60 * 1000);
    if (!rate.allowed) {
      return NextResponse.json({ error: "Farm Vision rate limit exceeded.", retryAfterSeconds: rate.retryAfterSeconds }, {
        status: 429,
        headers: { "Retry-After": String(rate.retryAfterSeconds) },
      });
    }
    await ensureFarm();
    if (!visionConfigured()) {
      return NextResponse.json({ error: "Farm Vision is not configured. Add OPENROUTER_API_KEY, ANTHROPIC_API_KEY or OPENAI_API_KEY to the server environment." }, { status: 503 });
    }

    // Each plan includes a number of hand-started inspections a month (VISION_PLAN_LIMITS).
    const plan = await currentVisionPlan();
    if ((await monthUsage()).manual >= plan.limits.manualPerMonth) {
      return NextResponse.json({ error: plan.limits.manualPerMonth > 0
        ? `The ${plan.label} plan includes ${plan.limits.manualPerMonth} Farm Vision inspections a month, and they have been used. More are included with Premium.`
        : `Farm Vision inspections are not included in the ${plan.label} plan. Upgrade to Premium to use them.`, code: "PLAN_LIMIT" }, { status: 403 });
    }

    const form = preparedForm ?? await request.formData();
    const file = form.get("image");
    const categoryRaw = String(form.get("category") || "OTHER");
    const batchIdRaw = String(form.get("batchId") || "");
    const notes = String(form.get("notes") || "").trim().slice(0, 2000);

    const penId = form.get("penId");
    let pen: { id: string; name: string } | undefined;
    if (penId !== null && penId !== "") {
      if (session.user.role !== "OWNER" && session.user.role !== "MANAGER") {
        return NextResponse.json({ error: "Only owners and managers can assign an inspection to a pen." }, { status: 403 });
      }
      if (typeof penId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(penId)) {
        return NextResponse.json({ error: "Invalid pen." }, { status: 400 });
      }
      [pen] = await visionPens(penId);
      if (!pen) return NextResponse.json({ error: "Pen not found." }, { status: 404 });
    }
    const cameraName = form.get("camera");
    const video = form.get("captureMode") === "video-sample";
    if (cameraName !== null) {
      if (!isTrustedAppOrigin(request) || !visionCameraRoles().includes(session.user.role)) {
        return NextResponse.json({ error: "Camera inspections require an authorized farm manager or owner." }, { status: 403 });
      }
      if (video && !visionLiveEnabled()) return NextResponse.json({ error: "Live video inspections are unavailable." }, { status: 503 });
      if (!visionCamerasEnabled()) return NextResponse.json({ error: "Camera inspections are unavailable." }, { status: 503 });
      if (file !== null || form.get("shareCameraImage") !== "yes" || !validVisionCameraName(cameraName)) {
        return NextResponse.json({ error: "Choose one camera and confirm that its image can be shared for analysis." }, { status: 400 });
      }
      const cameraLimit = await checkRateLimit("vision-camera:" + session.user.farmId, 6, 10 * 60 * 1000);
      if (!cameraLimit.allowed) return NextResponse.json({ error: "Camera inspection limit reached. Try again shortly." }, {
        status: 429, headers: { "Retry-After": String(cameraLimit.retryAfterSeconds) },
      });
    } else if (video || !(file instanceof File)) {
      return NextResponse.json({ error: "An image is required." }, { status: 400 });
    }
    if (!isCategory(categoryRaw)) return NextResponse.json({ error: "Invalid inspection category." }, { status: 400 });
    const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
    const mimeType = file instanceof File ? file.type.toLowerCase() : "image/jpeg";
    if (!allowedImageTypes.has(mimeType)) {
      return NextResponse.json({ error: "Use a JPEG, PNG, WebP or GIF image." }, { status: 400 });
    }
    if (file instanceof File && file.size > maxVisionImageBytes) return NextResponse.json({ error: "Image is too large. Maximum size is 8 MB." }, { status: 413 });

    const camera = typeof cameraName === "string" ? await visionCameraByName(cameraName).catch(() => null) : null;
    if (cameraName !== null && !camera) return NextResponse.json({ error: "The camera could not deliver a usable image." }, { status: 502 });
    const result = await runVisionInspection({
      category: categoryRaw, batchId: batchIdRaw || null, notes, pen, camera, video,
      upload: file instanceof File ? { bytes: Buffer.from(await file.arrayBuffer()), mimeType } : undefined,
      ...(requestId ? { requestId } : {}),
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ observation: result.observation, imageUrl: result.imageUrl, analysis: result.analysis, model: result.model }, {
      status: 201, headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    console.error("[farm-vision] Inspection failed", error instanceof Error ? error.name : "UnknownError", code);
    return NextResponse.json({ error: "Could not analyze image." }, { status: 500 });
  }
}
