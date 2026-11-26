import { NextResponse } from "next/server";
import { currentUserOrRoleResponse } from "@/lib/current-user";
import { visionPens } from "@/lib/vision-pens";

export async function GET(request: Request) {
  const session = await currentUserOrRoleResponse(request, ["OWNER", "MANAGER"]);
  if (session.response) return session.response;
  return NextResponse.json(await visionPens(), { headers: { "Cache-Control": "private, no-store" } });
}
