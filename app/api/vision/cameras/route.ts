import { accountFormOriginResponse, readAccountForm } from "@/lib/account-form-security";
import { checkRateLimit } from "@/lib/rate-limit";
import { camerasWithPens, saveCameraPen } from "@/lib/vision-camera-pens";
import { visionPens } from "@/lib/vision-pens";
import { premiumFeatureResponse } from "@/lib/farm-feature-access";
import { NextResponse } from "next/server";
import { currentUserOrRoleResponse } from "@/lib/current-user";
import { validVisionCameraName, visionCameraRoles, visionCameras } from "@/lib/vision-camera";

export const runtime = "nodejs";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const session = await currentUserOrRoleResponse(request, visionCameraRoles());
  if (session.response) return session.response;
  const locked = await premiumFeatureResponse();
  if (locked) return locked;
  try {
    return NextResponse.json(await camerasWithPens(await visionCameras()), { headers });
  } catch {
    return NextResponse.json({ error: "Camera list is temporarily unavailable." }, { status: 503, headers });
  }
}

export async function PUT(request: Request) {
  const session = await currentUserOrRoleResponse(request, visionCameraRoles());
  if (session.response) return session.response;
  const origin = accountFormOriginResponse(request);
  if (origin) return origin;
  const locked = await premiumFeatureResponse();
  if (locked) return locked;
  const data = await readAccountForm(request);
  if (!data || !validVisionCameraName(data.camera) || (data.penId !== null
    && (typeof data.penId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(data.penId)))) {
    return NextResponse.json({ error: "Choose a camera and a valid pen." }, { status: 400, headers });
  }
  try {
    const limit = await checkRateLimit("camera-pen:" + session.user.farmId, 30, 60_000);
    if (!limit.allowed) return NextResponse.json({ error: "Too many assignment changes. Try again shortly." }, { status: 429, headers });
    const matching = (await visionCameras()).filter(camera => camera.name === data.camera);
    if (matching.length !== 1) return NextResponse.json({ error: "A unique connected camera was not found." }, { status: 404, headers });
    const pen = data.penId ? (await visionPens(data.penId))[0] : null;
    if (data.penId && !pen) return NextResponse.json({ error: "Pen not found." }, { status: 404, headers });
    await saveCameraPen(matching[0], pen?.id ?? null, session.user.id);
    return NextResponse.json({ pen }, { headers });
  } catch {
    return NextResponse.json({ error: "Could not save the camera assignment." }, { status: 503, headers });
  }
}
