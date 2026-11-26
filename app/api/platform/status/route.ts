import { NextResponse } from "next/server";
import { platformAdministrator, platformStatus } from "@/lib/platform-access";

export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  if (!(await platformAdministrator(request))) {
    return NextResponse.json({ error: "Not found." }, { status: 404, headers });
  }
  return NextResponse.json(platformStatus(), { headers });
}
