import { prisma } from "@/lib/prisma";
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

async function* farmJson(farmId: string) {
  const farm = await runAsFarm(farmId, () => prisma.farm.findUniqueOrThrow({
    where: { id: farmId },
    select: { id: true, name: true, businessType: true, currency: true, createdAt: true, updatedAt: true },
  }));
  yield '{\n  "format": "flockence.farm-export",\n  "version": 1,\n';
  yield `  "exportedAt": ${JSON.stringify(new Date())},\n  "farm": ${JSON.stringify(farm)},\n  "records": {\n`;
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
