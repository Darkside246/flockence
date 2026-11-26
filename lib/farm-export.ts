import { prisma } from "@/lib/prisma";
import { farmPreferenceKeys } from "@/lib/farm-preferences";
import { farmSetupSchema } from "@/lib/farm-setup";
import { runAsFarm } from "@/lib/farm-scope";

const recordTables = [
  "batch", "beddingPurchase", "beddingUsage", "biosecurityLog", "birdCount",
  "customer", "dailyFlockCheck", "diagnosticTest", "eggCollection", "eggCollectionGrade",
  "eggPackInput", "eggPackRun", "equipment", "expense", "farmTask",
  "feedPurchase", "feedUsage", "healthCase", "healthObservation", "householdConsumption",
  "inventoryItem", "inventoryMovement", "layerStageEvent", "manureRecord", "mortalityEvent",
  "processingOutput", "product", "productionPlan", "recurringExpense", "sale",
  "saleItem", "slaughterEvent", "storageLocation", "storageTemperatureLog", "supplier",
  "thermometerReading", "transportEvent", "transportationExpense", "treatment", "weatherSnapshot",
  "weightRecord",
] as const;

type FarmRow = { id: string };
type PagedRecords = {
  findMany(args: { where: { id: { gt: string } }; orderBy: { id: "asc" }; take: number }): Promise<FarmRow[]>;
};

const penFields = [
  "name", "housingMode", "lengthM", "widthM", "status", "active", "capacity", "occupants", "notes",
  "orientation", "feederPans", "feederPanDiameterCm", "chainFeederMeters", "nipples", "bellDrinkers",
  "fans", "fanCapacityM3H", "heatSources", "waterTankLitres",
];

function parseObject(value: string | undefined): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

async function farmConfiguration(farmId: string) {
  const rows = await runAsFarm(farmId, () => prisma.setting.findMany({
    where: { OR: [{ key: { in: [...farmPreferenceKeys, "FARM_PROFILE_V1"] } },
      { key: { startsWith: "PEN::" } }, { key: { startsWith: "PENCFG::" } }] },
    select: { key: true, value: true }, orderBy: { key: "asc" },
  }));
  const settings = new Map(rows.map(({ key, value }) => [key, value]));
  const profile = farmSetupSchema.safeParse(parseObject(settings.get("FARM_PROFILE_V1")));
  const preferences = Object.fromEntries(farmPreferenceKeys.flatMap((key) =>
    settings.has(key) ? [[key, settings.get(key)]] : [],
  ));
  const pens = rows.flatMap(({ key, value }) => {
    const [kind, ownerId, id, extra] = key.split("::");
    if (!["PEN", "PENCFG"].includes(kind) || !ownerId || !id || extra !== undefined) return [];
    const data = parseObject(value);
    if (!data) return [];
    const fields = Object.fromEntries(penFields.flatMap((field) => {
      const item = data[field];
      return typeof item === "string" || typeof item === "number" || typeof item === "boolean" ? [[field, item]] : [];
    }));
    return [{ id, ownerId, kind, ...fields }];
  });
  return { profile: profile.success ? profile.data : null, preferences, pens };
}

async function* farmJson(farmId: string) {
  const farm = await runAsFarm(farmId, () => prisma.farm.findUniqueOrThrow({
    where: { id: farmId },
    select: { id: true, name: true, businessType: true, currency: true, createdAt: true, updatedAt: true },
  }));
  yield '{\n  "format": "flockence.farm-export",\n  "version": 1,\n';
  yield `  "exportedAt": ${JSON.stringify(new Date())},\n  "farm": ${JSON.stringify(farm)},\n`;
  yield `  "configuration": ${JSON.stringify(await farmConfiguration(farmId))},\n  "records": {\n`;
  for (const [tableIndex, table] of recordTables.entries()) {
    if (tableIndex) yield ",\n";
    yield `    "${table}": [`;
    const delegate = prisma[table] as unknown as PagedRecords;
    let lastId = "";
    for (;;) {
      const rows = await runAsFarm(farmId, () => delegate.findMany({
        where: { id: { gt: lastId } }, orderBy: { id: "asc" }, take: 200,
      }));
      for (const row of rows) {
        yield `${lastId ? "," : ""}\n      ${JSON.stringify(row)}`;
        lastId = row.id;
      }
      if (rows.length < 200) break;
    }
    yield lastId ? "\n    ]" : "]";
  }
  yield "\n  }\n}\n";
}

export function farmExport(farmId: string) {
  const iterator = farmJson(farmId);
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const result = await iterator.next();
      if (result.done) controller.close();
      else controller.enqueue(encoder.encode(result.value));
    },
    async cancel() {
      await iterator.return(undefined);
    },
  });
}
