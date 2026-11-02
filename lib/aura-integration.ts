import { createHmac, timingSafeEqual } from "node:crypto";
import { DEFAULT_FARM_ID, enterFarm } from "@/lib/farm-scope";

function configuredToken() {
  return process.env.AURA_INTEGRATION_TOKEN?.trim() ?? "";
}

function quoteSecret() {
  return process.env.AURA_QUOTE_SECRET?.trim() || configuredToken();
}
export function authorizeAuraIntegration(request: Request) {
  const configured = configuredToken();
  const header = request.headers.get("authorization") ?? "";
  if (!configured || !header.startsWith("Bearer ")) return false;
  const supplied = header.slice(7).trim();
  if (!supplied) return false;
  const expected = Buffer.from(configured, "utf8"), actual = Buffer.from(supplied, "utf8");
  const ok = expected.length === actual.length && timingSafeEqual(expected, actual);
  // The integration token belongs to this install's own farm; the route then works only inside it.
  if (ok) enterFarm(DEFAULT_FARM_ID);
  return ok;
}
export function signAuraQuote(payload: Record<string, unknown>) {
  const secret = quoteSecret();
  if (!secret) throw new Error("AURA_QUOTE_SECRET is not configured.");
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return encoded + "." + signature;
}
export function readAuraQuote<T extends Record<string, unknown>>(token: string): T | null {
  const secret = quoteSecret();
  const parts = token.split(".");
  if (!secret || parts.length !== 2) return null;
  const expectedSignature = createHmac("sha256", secret).update(parts[0]).digest("base64url");
  const actual = Buffer.from(parts[1], "utf8"), expected = Buffer.from(expectedSignature, "utf8");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try { return JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as T; } catch { return null; }
}
