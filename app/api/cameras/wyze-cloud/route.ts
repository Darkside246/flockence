import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUserOrRoleResponse } from "@/lib/current-user";
import { cameraViewRoles } from "@/lib/camera-guard";
import { premiumFeatureResponse } from "@/lib/farm-feature-access";
import { isTrustedAppOrigin } from "@/lib/request-origin";
import { accountRateLimitResponse } from "@/lib/account-form-security";
import { validCode } from "@/lib/wyze-cloud-rules.mjs";
import { disconnectWyze, finishWyzeSignIn, startWyzeSignIn, wyzeCloudCameras, wyzeCloudEnabled, wyzeCloudStatus } from "@/lib/wyze-cloud";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
const off = () => json({ error: "Wyze sign-in is not switched on for this server yet. The administrator sets FLOCKENCE_WYZE_CLOUD=on." }, 503);

/** Connection status and, when connected, the cameras on the Wyze account. Anyone who may view cameras. */
export async function GET(request: Request) {
  const session = await currentUserOrRoleResponse(request, cameraViewRoles());
  if (session.response) return session.response;
  const locked = await premiumFeatureResponse();
  if (locked) return locked;
  const status = await wyzeCloudStatus();
  let cameras: { name: string; model: string; thumbnailAt: string | null }[] = [];
  let problem: string | null = null;
  if (status.enabled && status.connected) {
    try { cameras = (await wyzeCloudCameras()).map(({ name, model, thumbnailAt }) => ({ name, model, thumbnailAt })); }
    catch (e) { problem = e instanceof Error ? e.message : "Wyze did not answer."; }
  }
  return json({ ...status, owner: session.user.role === "OWNER", cameras, problem });
}

const signIn = z.discriminatedUnion("step", [
  z.object({ step: z.literal("password"), email: z.string().trim().email().max(254), password: z.string().min(1).max(256),
    keyId: z.string().trim().max(128).optional(), apiKey: z.string().trim().max(256).optional() }),
  z.object({ step: z.literal("code"), code: z.string().refine(validCode) }),
]);

/** Sign in: email and password first, then the code if Wyze asks for one. Owners only. */
export async function POST(request: Request) {
  const session = await currentUserOrRoleResponse(request, ["OWNER"]);
  if (session.response) return session.response;
  if (!isTrustedAppOrigin(request)) return json({ error: "Open Camera connections in Flockence." }, 403);
  const locked = await premiumFeatureResponse();
  if (locked) return locked;
  if (!wyzeCloudEnabled()) return off();
  const limit = await accountRateLimitResponse("wyze-cloud:" + session.user.farmId, 10, 15 * 60_000, "Too many Wyze sign-in attempts. Try again in 15 minutes.");
  if (limit) return limit;
  const input = signIn.safeParse(await request.json().catch(() => null));
  if (!input.success) return json({ error: "Enter the Wyze email and password, or the code Wyze sent." }, 400);
  try {
    const result = input.data.step === "password" ? await startWyzeSignIn(input.data) : await finishWyzeSignIn(input.data.code);
    return json(result, "error" in result ? 400 : 200);
  } catch {
    return json({ error: "Wyze did not answer. Try again in a minute." }, 502);
  }
}

/** Disconnect: forget the Wyze tokens for this farm. Owners only. */
export async function DELETE(request: Request) {
  const session = await currentUserOrRoleResponse(request, ["OWNER"]);
  if (session.response) return session.response;
  if (!isTrustedAppOrigin(request)) return json({ error: "Open Camera connections in Flockence." }, 403);
  await disconnectWyze();
  return json({ connected: false });
}
