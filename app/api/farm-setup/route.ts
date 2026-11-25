import { NextResponse } from "next/server";
import { currentUserOrRoleResponse } from "@/lib/current-user";
import { runAsFarm } from "@/lib/farm-scope";
import { prisma } from "@/lib/prisma";
import { farmSetupSchema } from "@/lib/farm-setup";

const PROFILE = "FARM_PROFILE_V1";
const DRAFT = "FARM_SETUP_DRAFT_V1";
const headers = { "Cache-Control": "private, no-store" };

function parseProfile(value?: string) {
  if (!value) return null;
  try {
    const result = farmSetupSchema.safeParse(JSON.parse(value));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const access = await currentUserOrRoleResponse(request, ["OWNER", "MANAGER"]);
  if (access.response) return access.response;
  const farmId = access.user.farmId;
  return runAsFarm(farmId, async () => {
    const [farm, settings] = await Promise.all([
      prisma.farm.findUniqueOrThrow({ where: { id: farmId }, select: { name: true } }),
      prisma.setting.findMany({ where: { key: { in: [PROFILE, DRAFT] } } }),
    ]);
    const profile = parseProfile(settings.find((row) => row.key === PROFILE)?.value);
    const draft = parseProfile(settings.find((row) => row.key === DRAFT)?.value);
    return NextResponse.json({
      profile: { name: farm.name, operation: profile?.operation ?? "", country: profile?.country ?? "Barbados",
        parish: profile?.parish ?? "", community: profile?.community ?? "", unit: profile?.unit ?? "ft" },
      draft,
    }, { headers });
  });
}

export async function PUT(request: Request) {
  const access = await currentUserOrRoleResponse(request, ["OWNER", "MANAGER"]);
  if (access.response) return access.response;
  const input = await request.json().catch(() => null);
  const parsed = farmSetupSchema.safeParse(input?.profile);
  const mode = input?.mode;
  if (!parsed.success || (mode !== "draft" && mode !== "finish")) {
    return NextResponse.json({ error: "Check the farm details and location." }, { status: 400, headers });
  }

  const profile = parsed.data;
  if (mode === "finish" && (profile.name.length < 2 || !profile.operation)) {
    return NextResponse.json({ error: "Enter a farm name and choose a production type." }, { status: 400, headers });
  }

  const farmId = access.user.farmId;
  await runAsFarm(farmId, () => prisma.$transaction(async (tx) => {
    // The farm row serializes draft and completion requests from different tabs.
    await tx.$queryRaw`SELECT id FROM "Farm" WHERE id = ${farmId} FOR UPDATE`;
    const key = mode === "finish" ? PROFILE : DRAFT;
    const value = JSON.stringify(profile);
    await tx.setting.upsert({ where: { farmId_key: { farmId, key } }, create: { farmId, key, value }, update: { value } });
    if (mode === "finish") {
      await tx.farm.update({ where: { id: farmId }, data: { name: profile.name } });
      await tx.setting.deleteMany({ where: { key: DRAFT } });
    }
  }));
  return NextResponse.json({ saved: true }, { headers });
}
