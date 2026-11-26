import { NextResponse } from "next/server";
import { sessionCookieFromRequest, activeAccountSessions, revokeOtherAccountSessions } from "@/lib/auth";
import { currentUserOrResponse } from "@/lib/current-user";
import { isTrustedAppOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer" };
const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers });

export async function GET(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  const token = sessionCookieFromRequest(request);
  if (!token) return reply({ error: "Sign-in is required." }, 401);
  try {
    return reply({ sessions: await activeAccountSessions(session.user.id, token) });
  } catch {
    return reply({ error: "Unable to load sessions." }, 503);
  }
}

export async function DELETE(request: Request) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session.response;
  if (!isTrustedAppOrigin(request)) return reply({ error: "Open Account in Flockence to manage sessions." }, 403);
  const token = sessionCookieFromRequest(request);
  if (!token) return reply({ error: "Sign-in is required." }, 401);

  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  const all = params.get("scope") === "others";
  if ((all && id !== null) || (!all && !/^[A-Za-z0-9_-]{1,128}$/.test(id ?? ""))) {
    return reply({ error: "Choose a different session or sign out of all other sessions." }, 400);
  }

  try {
    const count = await revokeOtherAccountSessions(session.user.id, token, id ?? undefined);
    return !all && count === 0 ? reply({ error: "Session not found." }, 404) : reply({ revoked: count });
  } catch {
    return reply({ error: "Unable to revoke the selected sessions." }, 503);
  }
}
