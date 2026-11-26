import { createHash } from "node:crypto";
import { z } from "zod";
import { isTrustedAppOrigin } from "@/lib/request-origin";

const offlineScope = z.strictObject({
  id: z.uuid(),
  farmId: z.string().min(1).max(64),
  userId: z.string().min(1).max(100),
});

export function offlineEventId(request: Request, input: unknown, session: { farmId: string; id: string }) {
  const parsed = offlineScope.safeParse(input);
  if (!isTrustedAppOrigin(request) || !parsed.success || parsed.data.farmId !== session.farmId || parsed.data.userId !== session.id) return null;
  return "offline-" + createHash("sha256")
    .update(JSON.stringify([session.farmId, session.id, parsed.data.id.toLowerCase()])).digest("hex");
}
