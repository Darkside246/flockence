import { NextResponse } from "next/server";
import { currentUserOrRoleResponse } from "@/lib/current-user";
import { blinkConfigured, blinkFetch } from "@/lib/blink-sidecar";
import { auditCameraAction, cameraRequestAllowed, camerasBelongToThisFarm, cameraViewRoles, hardenCameraHeaders } from "@/lib/camera-guard";

// Allow-listed pass-through to the camera sidecar. Anything not matched here is a 404,
// so the sidecar's surface is never exposed wholesale.
const VIEW_GET = [
  /^status$/, /^cameras$/, /^cameras\/[^/]+\/snapshot$/, /^clips$/,
  /^media\/(clip|thumb)$/, /^live\/[A-Za-z0-9_]+\/[A-Za-z0-9_.-]+$/,
  /^recordings\/[A-Za-z0-9_]+\/[0-9]{8}-[0-9]{6}\.mp4$/,
  /^imports\/[A-Za-z0-9_]+\/[0-9]{8}-[0-9]{6}-[0-9a-f]{6}\.mp4$/,
];
// Managers can add clips downloaded from another app; only the owner can remove them.
const MANAGE_POST = [/^cameras\/[^/]+\/live\/(start|stop)$/, /^rtsp\/cameras\/[^/]+\/record\/(start|stop)$/, /^imports\/clips$/];
const OWNER_POST = [/^auth\/(login|verify|logout)$/, /^rtsp\/cameras$/];
const OWNER_DELETE = [/^rtsp\/cameras\/[^/]+$/, /^imports\/[A-Za-z0-9_]+\/[0-9]{8}-[0-9]{6}-[0-9a-f]{6}\.mp4$/];

type Ctx = { params: Promise<{ path: string[] }> };
const matches = (list: RegExp[], p: string) => list.some((r) => r.test(p));

async function relay(upstream: Response) {
  const headers = new Headers();
  for (const h of ["content-type", "content-range", "accept-ranges", "content-length"]) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  hardenCameraHeaders(headers);
  return new Response(upstream.body, { status: upstream.status, headers });
}

const notConfigured = () => NextResponse.json({ error: "Camera service is not configured." }, { status: 503 });
const notRunning = () => NextResponse.json({ error: "Camera service is not running." }, { status: 503 });

const tooMany = () => NextResponse.json({ error: "Too many camera requests. Wait a minute." }, { status: 429, headers: { "retry-after": "60" } });

export async function GET(request: Request, ctx: Ctx) {
  const session = await currentUserOrRoleResponse(request, cameraViewRoles());
  if (session.response) return session.response;
  if (!camerasBelongToThisFarm()) return Response.json({ error: "Cameras are not set up for this farm yet." }, { status: 403, headers: { "Cache-Control": "no-store, private" } });
  if (!cameraRequestAllowed(session.user.id)) return tooMany();
  const segments = (await ctx.params).path;
  const path = segments.join("/");
  if (!matches(VIEW_GET, path)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (!blinkConfigured()) return notConfigured();
  const range = request.headers.get("range");
  try {
    return relay(await blinkFetch(`/${segments.map(encodeURIComponent).join("/")}${new URL(request.url).search}`, { headers: range ? { range } : {} }));
  } catch {
    return notRunning();
  }
}

async function mutate(request: Request, ctx: Ctx, method: "POST" | "DELETE", ownerList: RegExp[], manageList: RegExp[]) {
  const segments = (await ctx.params).path;
  const path = segments.join("/");
  const owner = matches(ownerList, path);
  if (!owner && !matches(manageList, path)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const session = await currentUserOrRoleResponse(request, owner ? ["OWNER"] : ["OWNER", "MANAGER"]);
  if (session.response) return session.response;
  if (!camerasBelongToThisFarm()) return Response.json({ error: "Cameras are not set up for this farm yet." }, { status: 403, headers: { "Cache-Control": "no-store, private" } });
  if (!cameraRequestAllowed(session.user.id)) return tooMany();
  if (!blinkConfigured()) return notConfigured();
  const live = /^cameras\/([^/]+)\/live\/(start|stop)$/.exec(path);
  if (live) await auditCameraAction(session.user.id, `CAMERA_LIVE_${live[2].toUpperCase()}`, decodeURIComponent(live[1]));
  else if (path === "imports/clips" || method === "DELETE") await auditCameraAction(session.user.id, method === "DELETE" ? "CAMERA_CLIP_DELETE" : "CAMERA_CLIP_IMPORT", path);
  try {
    // A clip upload is streamed straight through (never buffered here); its details travel in the query string.
    if (method === "POST" && path === "imports/clips") {
      return relay(await blinkFetch(`/imports/clips${new URL(request.url).search}`, {
        method, body: request.body, duplex: "half",
        headers: { "content-type": request.headers.get("content-type") || "application/octet-stream" },
      } as RequestInit, 15 * 60_000));
    }
    const body = method === "POST" && owner ? await request.text() : undefined;
    return relay(await blinkFetch(`/${segments.map(encodeURIComponent).join("/")}`, {
      method, body, headers: body !== undefined ? { "content-type": "application/json" } : {},
    }));
  } catch {
    return notRunning();
  }
}

export const POST = (request: Request, ctx: Ctx) => mutate(request, ctx, "POST", OWNER_POST, MANAGE_POST);
export const DELETE = (request: Request, ctx: Ctx) => mutate(request, ctx, "DELETE", OWNER_DELETE, []);
