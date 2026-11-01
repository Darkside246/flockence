import { NextResponse } from "next/server";
import { currentUserOrResponse, currentUserOrRoleResponse } from "@/lib/current-user";
import { blinkConfigured, blinkFetch } from "@/lib/blink-sidecar";

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
  headers.set("cache-control", "no-store");
  return new Response(upstream.body, { status: upstream.status, headers });
}

const notConfigured = () => NextResponse.json({ error: "Camera service is not configured." }, { status: 503 });
const notRunning = () => NextResponse.json({ error: "Camera service is not running." }, { status: 503 });

export async function GET(request: Request, ctx: Ctx) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
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
  if (!blinkConfigured()) return notConfigured();
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
