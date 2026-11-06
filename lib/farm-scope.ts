import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Which farm a request belongs to (owner, 2026-11-02: "one account for Oriya and Flockence"; many farms on one
 * Flockence server). Each request carries its farm in an AsyncLocalStorage holder; the database layer (lib/prisma.ts)
 * adds the farm to every query, checks that every linked record belongs to the same farm, and refuses any query that
 * runs without a farm. The same idea as Oriya's per-business row security, done in the one place every query passes.
 *
 *   - Signed-in requests: lib/current-user.ts opens the holder synchronously at the start of the request, then fills in
 *     the farm of the signed-in person once their session is checked.
 *   - Oriya calls, scripts and background work: runAsFarm(farmId, ...) for exactly one farm.
 *   - Sign-in itself (finding which farm a session or an email belongs to): runUnscoped(...), kept to lib/auth.ts and
 *     the sign-in routes.
 */

interface FarmHolder { farmId: string | null; system?: boolean; created?: Set<string> }
const storage = new AsyncLocalStorage<FarmHolder>();

export class FarmScopeError extends Error {
  constructor(message = "NO_FARM_SCOPE") { super(message); this.name = "FarmScopeError"; }
}

/** The farm used by a single-farm install (the PC) and by the first owner bootstrap. */
export const DEFAULT_FARM_ID = process.env.FARM_ID ?? "default-farm";

const FARM_ID_PATTERN = /^[A-Za-z0-9_-]{3,64}$/;

/**
 * Opens a fresh holder for this request. Must be called synchronously, before the first await of the request, so the
 * route that called it sees the same holder; it starts with no farm.
 */
export function beginRequestScope(): FarmHolder {
  const holder: FarmHolder = { farmId: null };
  storage.enterWith(holder);
  return holder;
}

export function setRequestFarm(holder: FarmHolder, farmId: string) {
  if (!FARM_ID_PATTERN.test(farmId)) throw new FarmScopeError("INVALID_FARM_ID");
  if (holder.farmId && holder.farmId !== farmId) throw new FarmScopeError("FARM_ALREADY_SET");
  holder.farmId = farmId;
}

export function currentFarmIdOrNull(): string | null {
  return storage.getStore()?.farmId ?? null;
}

/** The farm of this request, or an error: no query runs for "no farm". */
export function currentFarmId(): string {
  const farmId = currentFarmIdOrNull();
  if (!farmId) throw new FarmScopeError();
  return farmId;
}

/**
 * Rows this request has created through the scoped client. A write inside a transaction that points at a row created
 * earlier in the same transaction cannot find it from another connection yet, so the link check accepts these ids:
 * they were written by this request after the farm checks, and a rolled-back row would fail the database foreign key.
 */
export function rememberCreated(id: unknown) {
  const holder = storage.getStore();
  if (!holder || typeof id !== "string") return;
  (holder.created ??= new Set()).add(id);
}

export function wasCreatedInRequest(id: string): boolean {
  return storage.getStore()?.created?.has(id) === true;
}

export function isUnscoped(): boolean {
  return storage.getStore()?.system === true;
}

/**
 * For a route authenticated by a token that belongs to exactly one farm: sets this request's farm. Like
 * beginRequestScope, call it synchronously before the route's first await.
 */
export function enterFarm(farmId: string): void {
  if (!FARM_ID_PATTERN.test(farmId)) throw new FarmScopeError("INVALID_FARM_ID");
  storage.enterWith({ farmId });
}

/**
 * Work for exactly one farm (Oriya calls, scripts, background jobs). The work is awaited inside the farm: database
 * calls only run when awaited, so returning one unawaited would run it outside the farm (and be refused).
 */
export function runAsFarm<T>(farmId: string, work: () => T | Promise<T>): Promise<T> {
  if (!FARM_ID_PATTERN.test(farmId)) return Promise.reject(new FarmScopeError("INVALID_FARM_ID"));
  return storage.run({ farmId }, async () => await work());
}

/** Only for finding which farm a session or sign-in belongs to. Every other query needs a farm. Awaited inside. */
export function runUnscoped<T>(work: () => T | Promise<T>): Promise<T> {
  return storage.run({ farmId: null, system: true }, async () => await work());
}

// ── What the database layer enforces ─────────────────────────────────────────────────────────────────────────────

/** Tables that carry farmId themselves. */
export const FARM_MODELS = new Set([
  "AuditLog", "Batch", "BeddingPurchase", "BiosecurityLog", "Customer", "DailyFlockCheck", "DiagnosticTest", "EggCollection",
  "EggPackRun", "Equipment", "Expense", "FarmTask", "FeedPurchase", "HealthCase", "HealthObservation", "InventoryMovement",
  "LayerStageEvent", "ManureRecord", "Product", "ProductionPlan", "RecurringExpense", "Sale", "Setting", "StorageLocation",
  "StorageTemperatureLog", "Supplier", "ThermometerReading", "TransportEvent", "TransportationExpense", "Treatment", "User",
  "VisionMedia", "WeatherSnapshot",
]);

/** Tables that belong to a farm through a parent: the relation to follow and the parent id field. */
export const CHILD_MODELS: Record<string, { relation: string; field: string; parent: string }> = {
  BirdCount: { relation: "batch", field: "batchId", parent: "Batch" },
  MortalityEvent: { relation: "batch", field: "batchId", parent: "Batch" },
  FeedUsage: { relation: "batch", field: "batchId", parent: "Batch" },
  BeddingUsage: { relation: "batch", field: "batchId", parent: "Batch" },
  SlaughterEvent: { relation: "batch", field: "batchId", parent: "Batch" },
  ProcessingOutput: { relation: "batch", field: "batchId", parent: "Batch" },
  HouseholdConsumption: { relation: "batch", field: "batchId", parent: "Batch" },
  WeightRecord: { relation: "batch", field: "batchId", parent: "Batch" },
  InventoryItem: { relation: "product", field: "productId", parent: "Product" },
  SaleItem: { relation: "sale", field: "saleId", parent: "Sale" },
  EggCollectionGrade: { relation: "eggCollection", field: "eggCollectionId", parent: "EggCollection" },
  EggPackInput: { relation: "packRun", field: "packRunId", parent: "EggPackRun" },
};

/** Tables with no farm at all (shared by the whole server). */
export const GLOBAL_MODELS = new Set(["RateLimitBucket"]);

/** Every link from one table to another (field -> table), so a write can never point at another farm's record. */
export const FOREIGN_KEYS: Record<string, Record<string, string>> = {
  DailyFlockCheck: { batchId: "Batch" }, LayerStageEvent: { batchId: "Batch" }, EggCollection: { batchId: "Batch" },
  EggCollectionGrade: { eggCollectionId: "EggCollection", inventoryItemId: "InventoryItem" },
  EggPackRun: { batchId: "Batch", outputInventoryItemId: "InventoryItem" },
  EggPackInput: { packRunId: "EggPackRun", inventoryItemId: "InventoryItem" },
  Batch: { supplierId: "Supplier" }, BirdCount: { batchId: "Batch" }, MortalityEvent: { batchId: "Batch" },
  FeedPurchase: { batchId: "Batch", supplierId: "Supplier" }, FeedUsage: { batchId: "Batch" },
  BeddingPurchase: { batchId: "Batch", supplierId: "Supplier" }, BeddingUsage: { batchId: "Batch" },
  Expense: { batchId: "Batch" }, TransportationExpense: { batchId: "Batch" }, SlaughterEvent: { batchId: "Batch" },
  ProcessingOutput: { batchId: "Batch", inventoryItemId: "InventoryItem", slaughterEventId: "SlaughterEvent", storageLocationId: "StorageLocation" },
  TransportEvent: { batchId: "Batch", slaughterEventId: "SlaughterEvent" },
  InventoryItem: { productId: "Product", batchId: "Batch", storageLocationId: "StorageLocation" },
  StorageTemperatureLog: { storageLocationId: "StorageLocation" }, InventoryMovement: { inventoryItemId: "InventoryItem" },
  ManureRecord: { batchId: "Batch" }, Sale: { customerId: "Customer" },
  SaleItem: { saleId: "Sale", batchId: "Batch", inventoryItemId: "InventoryItem" },
  HouseholdConsumption: { batchId: "Batch" }, WeightRecord: { batchId: "Batch" }, AuditLog: { userId: "User" },
  HealthCase: { batchId: "Batch", openedByUserId: "User" },
  HealthObservation: { visionMediaId: "VisionMedia", batchId: "Batch", healthCaseId: "HealthCase" },
  Treatment: { batchId: "Batch", healthCaseId: "HealthCase", administeredByUserId: "User" },
  DiagnosticTest: { batchId: "Batch", healthCaseId: "HealthCase" }, FarmTask: { batchId: "Batch", assignedToUserId: "User" },
};

type Where = Record<string, unknown> | undefined;

/** The farm filter for one table, or null for shared tables. */
export function farmFilter(model: string, farmId: string): Record<string, unknown> | null {
  if (model === "Farm") return { id: farmId };
  if (FARM_MODELS.has(model)) return { farmId };
  const child = CHILD_MODELS[model];
  if (child) return { [child.relation]: { is: { farmId } } };
  return null;
}

/** where AND farm filter, keeping whatever the query already asked for. */
export function withFarm(where: Where, filter: Record<string, unknown>): Record<string, unknown> {
  if (!where || Object.keys(where).length === 0) return { ...filter };
  const existing = where.AND === undefined ? [] : Array.isArray(where.AND) ? where.AND : [where.AND];
  return { ...where, AND: [...existing, filter] };
}

/** The ids a write points at, by target table (only plain id fields and connect: { id }). */
export function linkedIds(model: string, data: unknown): Array<{ target: string; id: string }> {
  const keys = FOREIGN_KEYS[model];
  if (!keys || !data || typeof data !== "object") return [];
  const out: Array<{ target: string; id: string }> = [];
  for (const [field, target] of Object.entries(keys)) {
    const value = (data as Record<string, unknown>)[field];
    if (typeof value === "string") out.push({ target, id: value });
    else if (value && typeof value === "object" && typeof (value as { set?: unknown }).set === "string") out.push({ target, id: (value as { set: string }).set });
  }
  return out;
}
