import { NextResponse } from "next/server";
import { hardenCameraHeaders } from "@/lib/camera-guard";

export function gatewayResponse(value: object, status = 200) {
  const response = NextResponse.json(value, { status });
  hardenCameraHeaders(response.headers);
  return response;
}

export function isGatewayOrigin(request: Request) {
  try {
    return request.headers.get("origin") === new URL(process.env.APP_URL ?? "").origin;
  } catch {
    return false;
  }
}

export async function boundedBody(request: Request, limit: number) {
  const size = request.headers.get("content-length");
  if (size !== null && (!/^\d+$/.test(size) || Number(size) > limit)) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > limit) { await reader.cancel(); return null; }
      chunks.push(chunk.value);
    }
    return Buffer.concat(chunks, total);
  } finally {
    reader.releaseLock();
  }
}
