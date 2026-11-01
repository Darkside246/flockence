import { prisma } from "@/lib/prisma";
import { FARM_ID, ensureFarm } from "@/lib/operations";
import { SESSION_COOKIE, userIdFromSession } from "@/lib/auth";

export async function requireCurrentUser(request: Request) {
  await ensureFarm();
  const cookieHeader = request.headers.get("cookie") || "";
  const token = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`))?.slice(`${SESSION_COOKIE}=`.length);
  const sessionUserId = token ? await userIdFromSession(decodeURIComponent(token)) : null;

  let userId = sessionUserId || null;
  if (!userId && process.env.NODE_ENV !== "production") {
    userId = request.headers.get("x-user-id") || process.env.CHICKEN_OP_USER_ID || null;
    if (!userId) {
      const devUser = await prisma.user.upsert({
        where: { email: "dev@chicken-op.local" },
        update: { farmId: FARM_ID, name: "Chicken Op Local User", role: "OWNER" },
        create: { farmId: FARM_ID, name: "Chicken Op Local User", email: "dev@chicken-op.local", role: "OWNER" },
        select: { id: true }
      });
      userId = devUser.id;
    }
  }

  if (!userId) throw new Error("AUTH_REQUIRED");
  const user = await prisma.user.findFirst({ where: { id: userId, farmId: FARM_ID }, select: { id: true, farmId: true, name: true, email: true, role: true } });
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
