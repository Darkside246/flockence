import { NextResponse } from "next/server";
import { requireCurrentUser, authError } from "@/lib/current-user";

export async function GET(request: Request) {
  try {
    const user = await requireCurrentUser(request);
    return NextResponse.json({ user });
  } catch (error) {
    const response = authError(error);
    if (response) return response;
    return NextResponse.json({ error: "Unable to load account." }, { status: 500 });
  }
}
