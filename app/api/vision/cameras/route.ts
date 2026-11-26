import { NextResponse } from "next/server";
import { currentUserOrRoleResponse } from "@/lib/current-user";
import { visionCameraRoles, visionCameras } from "@/lib/vision-camera";

export const runtime = "nodejs";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const session = await currentUserOrRoleResponse(request, visionCameraRoles());
  if (session.response) return session.response;
  try {
    return NextResponse.json(await visionCameras(), { headers });
  } catch {
    return NextResponse.json({ error: "Camera list is temporarily unavailable." }, { status: 503, headers });
  }
}
