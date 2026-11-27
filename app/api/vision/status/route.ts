import { NextResponse } from "next/server";
import { currentUserOrRoleResponse } from "@/lib/current-user";
import { ensureFarm } from "@/lib/operations";
import { validRequestId } from "@/lib/photo-size.mjs";
import { uploadStatus } from "@/lib/vision-upload-requests";

export const runtime = "nodejs";

const headers = { "Cache-Control": "private, no-store" };

/**
 * Where a background Farm Vision check is (lib/vision-upload-requests.ts):
 *  RUNNING: still being analysed; ask again shortly.
 *  DONE: `result` holds what the upload itself would have answered (the inspection, or the error).
 *  UNKNOWN: this farm has no such check (for example the service restarted mid-check). Nothing was saved or charged;
 *           the phone sends the photo again with the same id.
 */
export async function GET(request: Request) {
  const session = await currentUserOrRoleResponse(request);
  if (session.response) return session.response;
  const id = new URL(request.url).searchParams.get("id");
  if (!validRequestId(id)) return NextResponse.json({ error: "Invalid upload id." }, { status: 400, headers });
  await ensureFarm();
  const status = await uploadStatus(id);
  if (status.state !== "DONE") return NextResponse.json({ state: status.state }, { headers });
  return NextResponse.json({ state: "DONE", httpStatus: status.reply.status, result: status.reply.body }, { headers });
}
