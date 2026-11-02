import { prisma } from "@/lib/prisma";
import { currentFarmId, ensureFarm } from "@/lib/operations";
import { SESSION_COOKIE, sessionFromToken } from "@/lib/auth";
import { beginRequestScope, setRequestFarm } from "@/lib/farm-scope";

export async function requireCurrentUser(request: Request) {
  // The farm of this request (many farms on one server): opened before the first await so the calling route shares
  // it, and filled in only from a valid session. Until then every farm query is refused.
  const scope = beginRequestScope();
  const cookieHeader = request.headers.get("cookie") || "";
  const token = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`))?.slice(`${SESSION_COOKIE}=`.length);
  const session = token ? await sessionFromToken(decodeURIComponent(token)) : null;
  const sessionUserId = session?.userId ?? null;

  // No sign-in, no user, in every mode (security review 2026-11-01). There used to be a development shortcut that
  // signed every request in as the owner whenever NODE_ENV was not "production" and trusted an x-user-id header, so a
  // dev server reachable on a network showed the camera feed to anyone; a Host-header check cannot make it safe
  // (the caller controls that header), so it is gone. Sign in with the owner account (scripts/bootstrap-local-owner.mjs).
  const userId = sessionUserId || null;
  if (!userId || !session) throw new Error("AUTH_REQUIRED");
  setRequestFarm(scope, session.farmId);
  await ensureFarm();
  const user = await prisma.user.findFirst({ where: { id: userId, farmId: currentFarmId() }, select: { id: true, farmId: true, name: true, email: true, role: true } });
  if (!user) throw new Error("USER_NOT_FOUND");
  return user;
}

export function authError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return new Response(JSON.stringify({ error: "Sign-in is required." }), { status: 401, headers: { "Content-Type": "application/json" } });
  if (code === "USER_NOT_FOUND") return new Response(JSON.stringify({ error: "User account was not found." }), { status: 403, headers: { "Content-Type": "application/json" } });
  return null;
}

/** Authenticate browser/API requests without leaking thrown auth errors to route handlers. */
export async function currentUserOrResponse(request: Request) {
  try {
    return { user: await requireCurrentUser(request), response: null };
  } catch (error) {
    const response = authError(error);
    return {
      user: null,
      response: response ?? new Response(JSON.stringify({ error: "Unable to verify the current account." }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    };
  }
}

export type FarmAccessRole = "OWNER" | "MANAGER" | "WORKER" | "READ_ONLY";

/** Enforce write permissions at the API boundary, not only by hiding UI controls. */
export async function currentUserOrRoleResponse(
  request: Request,
  allowedRoles: readonly FarmAccessRole[] = ["OWNER", "MANAGER", "WORKER"],
) {
  const session = await currentUserOrResponse(request);
  if (session.response) return session;
  if (!allowedRoles.includes(session.user.role as FarmAccessRole)) {
    return {
      user: null,
      response: new Response(JSON.stringify({ error: "Your farm role does not have permission to perform this action." }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    };
  }
  return session;
}
