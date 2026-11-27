import { NextResponse } from "next/server";
import { z } from "zod";
import { accountFormOriginResponse, readAccountForm } from "@/lib/account-form-security";
import { currentUserOrRoleResponse } from "@/lib/current-user";
import { ensureFarm } from "@/lib/operations";
import { detectorConfigured, detectorOnForFarm, setDetectorForFarm } from "@/lib/bird-detector";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };

/** The bird counter: whether this server has one, and the farm's switch (lib/bird-detector.ts). Changed by owners. */
export async function GET(request: Request) {
  const session = await currentUserOrRoleResponse(request, ["OWNER", "MANAGER"]);
  if (session.response) return session.response;
  await ensureFarm();
  return NextResponse.json({ available: detectorConfigured(), on: await detectorOnForFarm(), canChange: session.user.role === "OWNER" }, { headers });
}

export async function PUT(request: Request) {
  const session = await currentUserOrRoleResponse(request, ["OWNER"]);
  if (session.response) return session.response;
  const origin = accountFormOriginResponse(request);
  if (origin) return origin;
  const parsed = z.strictObject({ on: z.boolean() }).safeParse(await readAccountForm(request));
  if (!parsed.success) return NextResponse.json({ error: "Choose on or off." }, { status: 400, headers });
  if (parsed.data.on && !detectorConfigured()) return NextResponse.json({ error: "The bird counter is not set up on this server yet." }, { status: 409, headers });
  await ensureFarm();
  await setDetectorForFarm(parsed.data.on);
  return NextResponse.json({ on: parsed.data.on }, { headers });
}
