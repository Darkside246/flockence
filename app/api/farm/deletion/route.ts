import { NextResponse } from "next/server";
import { z } from "zod";
import { SETTINGS_ROLES } from "@/lib/farm-roles";
import { currentUserOrRoleResponse } from "@/lib/current-user";
import { isTrustedAppOrigin } from "@/lib/request-origin";
import { prisma } from "@/lib/prisma";
import { DEFAULT_FARM_ID } from "@/lib/farm-scope";
import { sendEmail } from "@/lib/mail";
import { cancelFarmDeletion, farmDeletionState, requestFarmDeletion } from "@/lib/farm-deletion";
import { canDeleteFarm, confirmsFarmName, GRACE_DAYS } from "@/lib/farm-deletion-rules.mjs";

const headers = { "Cache-Control": "private, no-store" };
const requestSchema = z.object({ confirm: z.string().max(200) });

async function farmName(farmId: string) {
  return (await prisma.farm.findUnique({ where: { id: farmId }, select: { name: true } }))?.name ?? "";
}

/** Settings > Farm profile > Delete this farm (owner only). */
export async function GET(request: Request) {
  const access = await currentUserOrRoleResponse(request, SETTINGS_ROLES);
  if (access.response) return access.response;
  const farmId = access.user.farmId;
  return NextResponse.json({ ...(await farmDeletionState()), farmName: await farmName(farmId), deletable: canDeleteFarm(farmId, DEFAULT_FARM_ID), graceDays: GRACE_DAYS }, { headers });
}

export async function POST(request: Request) {
  const access = await currentUserOrRoleResponse(request, SETTINGS_ROLES);
  if (access.response) return access.response;
  if (!isTrustedAppOrigin(request)) return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403, headers });
  const user = access.user;
  if (!canDeleteFarm(user.farmId, DEFAULT_FARM_ID)) return NextResponse.json({ error: "This is the site's home farm and cannot be deleted here." }, { status: 403, headers });
  const input = requestSchema.safeParse(await request.json().catch(() => null));
  const name = await farmName(user.farmId);
  if (!input.success || !confirmsFarmName(input.data.confirm, name)) return NextResponse.json({ error: "Type the farm name exactly to confirm." }, { status: 400, headers });
  const deletion = await requestFarmDeletion(user.id);
  const when = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Barbados" }).format(new Date(deletion.deleteAfter));
  let site: URL;
  try { site = new URL(process.env.APP_URL ?? "https://flockence.com"); } catch { site = new URL("https://flockence.com"); }
  const exportUrl = new URL("/api/export?type=farm", site).href, settingsUrl = new URL("/settings#farm", site).href;
  // Best effort: the request stands even if the email cannot be sent; the Settings page shows the same information.
  await sendEmail(user.email, {
    subject: `${name} will be deleted on ${when}`,
    text: `You asked to delete ${name} from Flockence. The farm is locked now: only you can sign in. It will be deleted permanently on ${when}.\n\nDownload all farm records first (sign in as the owner): ${exportUrl}\n\nChanged your mind? Cancel the deletion before ${when} under Settings > Farm profile: ${settingsUrl}`,
  }, `flockence-farm-deletion-${user.farmId}-${deletion.requestedAt}`).catch(() => false);
  return NextResponse.json({ ...(await farmDeletionState()), farmName: name, deletable: true, graceDays: GRACE_DAYS }, { headers });
}

export async function DELETE(request: Request) {
  const access = await currentUserOrRoleResponse(request, SETTINGS_ROLES);
  if (access.response) return access.response;
  if (!isTrustedAppOrigin(request)) return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403, headers });
  await cancelFarmDeletion();
  return NextResponse.json({ ...(await farmDeletionState()), farmName: await farmName(access.user.farmId), deletable: true, graceDays: GRACE_DAYS }, { headers });
}
