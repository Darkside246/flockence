import { keyFrom, open, seal, storage } from "./offline-store.js";

const form = document.getElementById("entry");
const unlockForm = document.getElementById("unlock");
const notice = document.getElementById("notice");
const find = (id) => document.getElementById(id);
const lease = 7 * 86400000;
let vault;
let current = null;
let syncing = false;
let retry = 15000;
let retryTimer;
let working = false;

class SignInRequired extends Error {}

function show(message) {
  notice.textContent = message;
}

function indicator() {
  find("connection").textContent = syncing ? "Synchronising…" : navigator.onLine ? "Online" : "Offline";
  find("sync").disabled = syncing || !navigator.onLine;
}

async function getWorkspace() {
  const response = await fetch("/api/offline/workspace", {
    credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(8000),
  });
  if (response.status === 401 || response.status === 403) throw new SignInRequired("Sign in to your original farm account to use online sync.");
  if (!response.ok) throw new Error("Could not check the online workspace.");
  return response.json();
}

function sameScope(a, b) {
  return a.farmId === b.farmId && a.userId === b.userId;
}

async function saveProfile(active) {
  const latest = await seal(active.key, "workspace", active.profile);
  const sealed = { version: 1, salt: vault.salt, latest };
  await storage("vault", "put", sealed, "workspace");
  vault = sealed;
}

async function list(active) {
  const records = await storage("outbox", "getAll");
  const rows = await Promise.all(records.map(async ({ id, value }) => ({
    id, entry: await open(active.key, id, value),
  })));
  return rows.sort((a, b) => a.entry.createdAt - b.entry.createdAt);
}

async function render(active) {
  const rows = await list(active);
  if (current !== active) return;
  find("farm").textContent = active.profile.farm;
  find("last-sync").textContent = active.profile.lastSync
    ? "Last synced " + new Date(active.profile.lastSync).toLocaleString()
    : "No farm records have synced from this device yet.";
  const allowExpenses = active.profile.canRecordExpenses === true;
  const allowSales = active.profile.canRecordSales === true;
  find("sale-option").hidden = !allowSales;
  find("sale-option").disabled = !allowSales;
  const allowTreatments = active.profile.canRecordTreatments === true;
  find("treatment-option").hidden = !allowTreatments;
  find("treatment-option").disabled = !allowTreatments;
  find("expense-option").hidden = !allowExpenses;
  find("expense-option").disabled = !allowExpenses;
  find("expense-currency").textContent = active.profile.currency || "";
  if ((!allowSales && find("record-kind").value === "sale") || (!allowExpenses && find("record-kind").value === "expense") || (!allowTreatments && find("record-kind").value === "treatment")) {
    find("record-kind").value = "mortality";
    updateRecordFields();
  }
  const select = find("flock");
  const selected = select.value;
  const prompt = new Option("Select a flock", "");
  const flocks = active.profile.flocks.filter(row => find("record-kind").value !== "eggs" || row.layer);
  select.replaceChildren(prompt, ...flocks.map(row => new Option(row.name, row.id)));
  if (flocks.some(row => row.id === selected)) select.value = selected;
  const sale = find("sale-lot");
  const selectedLot = sale.value;
  const lots = allowSales ? active.profile.saleLots ?? [] : [];
  sale.replaceChildren(new Option("Select a stock lot", ""), ...lots.map(lot => new Option(
    lot.product.name + (lot.lotCode ? " · " + lot.lotCode : "") + " · " + lot.quantity + " " + lot.product.unit, lot.id,
  )));
  if (lots.some(lot => lot.id === selectedLot)) sale.value = selectedLot;
  find("sale-currency").textContent = active.profile.currency || "";
  const kind = find("record-kind").value;
  find("save").disabled = kind === "expense" ? !allowExpenses : kind === "sale" ? !lots.length : !flocks.length;
  const entries = find("entries");
  entries.replaceChildren();
  for (const { id, entry } of rows) {
    const li = document.createElement("li");
    const detail = entry.kind === "sale" ? "Sale draft · " + entry.sale.label + " · " + entry.sale.quantity
      + " × " + (entry.sale.unitPriceMinor / 100).toFixed(2) + " " + entry.sale.currency
      + " · Paid " + (entry.sale.amountPaidMinor / 100).toFixed(2)
      : entry.kind === "expense" ? "Expense · " + (entry.expense.amountMinor / 100).toFixed(2) + " " + (entry.expense.currency || "")
      : entry.kind === "treatment" ? "Treatment · " + entry.treatment.productName
      : entry.kind === "inspection" ? "Flock inspection" + (entry.inspection.photo ? " · Photo attached" : "")
      : entry.kind === "eggs" ? entry.collection.totalEggs + " eggs · Egg collection"
      : entry.kind === "feed" ? entry.feedKg + " kg · Feed consumption"
      : entry.quantity + " birds · " + (entry.kind === "weight" ? "Live weight, " + entry.avgWeightKg + " kg average" : "Mortality");
    li.textContent = entry.flock + " · " + entry.date + " · " + detail + " · "
      + (entry.review ? "Needs review — " + entry.review
        : entry.kind === "sale" && !entry.approved ? "Awaiting online confirmation" : "Waiting to sync");
    if (entry.review || (entry.kind === "sale" && !entry.approved)) {
      const retryEntry = document.createElement("button");
      retryEntry.type = "button";
      retryEntry.textContent = entry.kind === "sale" ? "Review and confirm sale" : "Retry this entry";
      retryEntry.addEventListener("click", async () => {
        if (current !== active || syncing || !navigator.onLine) {
          show("Reconnect and wait for the current sync before retrying.");
          return;
        }
        if (entry.kind === "sale" && !window.confirm("Confirm these sale details? Flockence will check live stock and withdrawal holds.")) return;
        retryEntry.disabled = true;
        try {
          if (entry.kind === "sale" && (await list(active)).some(row => row.entry.kind === "treatment")) {
            show("Sync saved treatment records before confirming a sale.");
            retryEntry.disabled = false;
            return;
          }
          const draft = { ...entry };
          delete draft.review;
          if (draft.kind === "sale") draft.approved = true;
          await storage("outbox", "put", { id, value: await seal(active.key, id, draft) }, id);
          void sync();
        } catch {
          show("Could not update this draft. Its saved copy remains on this device.");
          retryEntry.disabled = false;
        }
      });
      li.append(" ", retryEntry);
    }
    entries.append(li);
  }
  if (!rows.length) {
    const li = document.createElement("li");
    li.textContent = "No entries waiting to sync.";
    entries.append(li);
  }
  indicator();
}

function lock(message) {
  current = null;
  clearTimeout(retryTimer);
  find("workspace").hidden = true;
  find("farm").textContent = "";
  find("last-sync").textContent = "";
  find("entries").replaceChildren();
  find("flock").replaceChildren();
  form.reset();
  updateRecordFields();
  form.elements.date.value = "";
  unlockForm.reset();
  unlockForm.hidden = false;
  if (message) show(message);
}

function retryLater() {
  clearTimeout(retryTimer);
  if (current && navigator.onLine) {
    retryTimer = setTimeout(() => { void sync(); }, retry);
    retry = Math.min(retry * 2, 300000);
  }
}

async function sync() {
  const active = current;
  if (!active || syncing || !navigator.onLine) return;
  clearTimeout(retryTimer);
  syncing = true;
  indicator();
  try {
    const syncedProfile = await getWorkspace();
    if (!sameScope(active.profile.scope, syncedProfile.scope)) throw new SignInRequired("Switch back to the original farm account to sync these entries.");
    if (current !== active) return;
    active.profile = {
      ...syncedProfile, verifiedAt: Date.now(), lastSync: active.profile.lastSync ?? null,
    };
    await saveProfile(active);
    let count = 0;
    for (const { id, entry } of await list(active)) {
      if (current !== active) return;
      if (entry.review || (entry.kind === "sale" && !entry.approved)) continue;
      if (entry.kind === "sale" && (await list(active)).some(row => row.entry.kind === "treatment")) {
        entry.approved = false;
        await storage("outbox", "put", { id, value: await seal(active.key, id, entry) }, id);
        continue;
      }
      if ((entry.kind === "expense" && !syncedProfile.canRecordExpenses)
        || (entry.kind === "treatment" && !syncedProfile.canRecordTreatments)
        || (entry.kind === "sale" && !syncedProfile.canRecordSales)) {
        entry.review = "Your current role cannot sync this record. The draft remains saved.";
        await storage("outbox", "put", { id, value: await seal(active.key, id, entry) }, id);
        continue;
      }
      const weight = entry.kind === "weight";
      const eggs = entry.kind === "eggs";
      const feed = entry.kind === "feed";
      const expense = entry.kind === "expense";
      const inspection = entry.kind === "inspection";
      const treatment = entry.kind === "treatment";
      const sale = entry.kind === "sale";
      const endpoint = sale ? "/api/sales" : treatment ? "/api/health/treatments" : inspection ? "/api/offline/inspections" : expense ? "/api/expenses" : feed ? "/api/daily-flock-check" : eggs ? "/api/egg-collections" : weight ? "/api/weights" : "/api/mortality";
      const values = sale ? {
        items: [{ inventoryItemId: entry.sale.lotId, quantity: entry.sale.quantity, unitPriceMinor: entry.sale.unitPriceMinor }],
        currency: entry.sale.currency, amountPaidMinor: entry.sale.amountPaidMinor, customerName: entry.sale.customerName,
      } : treatment ? entry.treatment : inspection ? entry.inspection : expense ? { category: entry.expense.category, description: entry.expense.description, amountMinor: entry.expense.amountMinor, currency: entry.expense.currency }
        : feed ? { feedKg: entry.feedKg } : eggs ? entry.collection : weight ? { quantity: entry.quantity, avgWeightKg: entry.avgWeightKg }
        : { quantity: entry.quantity, reason: entry.reason, notes: entry.notes };
      const response = await fetch(endpoint, {
        method: "POST", credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(12000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...((expense || sale) ? {} : { batchId: entry.batchId }), ...(treatment ? { startedAt: entry.date } : { date: entry.date }), ...values,
          offline: { id, ...active.profile.scope },
        }),
      });
      if (response.ok) {
        const saved = await response.json();
        if (typeof saved?.id !== "string" || !saved.id.startsWith("offline-")) throw new Error("Missing receipt.");
        // If the app closes before this deletion, the same id can be sent again without adding another event.
        await storage("outbox", "delete", id);
        active.profile.lastSync = Date.now();
        await saveProfile(active);
        count += 1;
      } else if (response.status === 401 || response.status === 403) {
        throw new SignInRequired("Sign in to your original farm account to sync these entries.");
      } else if ([400, 404, 409].includes(response.status)) {
        const body = await response.json().catch(() => null);
        entry.review = typeof body?.error === "string" ? body.error.slice(0, 200) : "Review this entry in Flockence.";
        await storage("outbox", "put", { id, value: await seal(active.key, id, entry) }, id);
      } else {
        throw new Error("Sync is temporarily unavailable.");
      }
    }
    retry = 15000;
    if (current === active) show(count ? `Successfully synced ${count} ${count === 1 ? "entry" : "entries"}.` : "Online. Any entries needing attention are listed below.");
  } catch (error) {
    if (current !== active) return;
    if (error instanceof SignInRequired) lock(error.message);
    else {
      show("Sync failed. Unsynced entries remain saved on this device and will retry.");
      retryLater();
    }
  } finally {
    syncing = false;
    indicator();
    if (current === active) await render(active).catch(() => show("Could not read the local sync queue."));
  }
}

unlockForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (working) return;
  working = true;
  find("unlock-button").disabled = true;
  const passphrase = find("passphrase").value;
  find("passphrase").value = "";
  try {
    if (vault) {
      const key = await keyFrom(passphrase, vault.salt);
      const profile = await open(key, "workspace", vault.latest);
      let authorized = null;
      if (navigator.onLine) {
        try { authorized = await getWorkspace(); }
        catch (error) { if (error instanceof SignInRequired) throw error; }
      }
      if (authorized && !sameScope(profile.scope, authorized.scope)) {
        throw new SignInRequired("Switch back to the original farm account to unlock this workspace online.");
      }
      if (!authorized && (!Number.isFinite(profile.verifiedAt) || Date.now() - profile.verifiedAt >= lease || Date.now() < profile.verifiedAt)) {
        throw new SignInRequired("The offline access period has ended. Sign in online to unlock your saved entries.");
      }
      current = { key, profile: authorized ? { ...authorized, verifiedAt: Date.now(), lastSync: profile.lastSync } : profile };
      if (authorized) await saveProfile(current);
    } else {
      if (passphrase.trim().length < 12) throw new SignInRequired("Choose a device passphrase of at least 12 characters.");
      const profile = await getWorkspace();
      const salt = Array.from(crypto.getRandomValues(new Uint8Array(16)));
      const key = await keyFrom(passphrase, salt);
      current = { key, profile: { ...profile, verifiedAt: Date.now(), lastSync: null } };
      const latest = await seal(key, "workspace", current.profile);
      vault = { version: 1, salt, latest };
      // A second browser tab cannot overwrite the first workspace during setup.
      await storage("vault", "add", vault, "workspace");
      find("backup").hidden = false;
    }
    if (document.hidden) { lock("Workspace locked while this page was hidden."); return; }
    unlockForm.hidden = true;
    find("workspace").hidden = false;
    find("date").value = current.profile.today ?? "";
    show("Workspace unlocked.");
    await render(current);
    void sync();
  } catch (error) {
    lock(error instanceof SignInRequired ? error.message : "Could not unlock or prepare this workspace. Check your passphrase or connection.");
    vault = await storage("vault", "get", "workspace").catch(() => null);
  } finally {
    working = false;
    find("unlock-button").disabled = false;
  }
});

function updateRecordFields() {
  const sale = find("record-kind").value === "sale";
  const treatment = find("record-kind").value === "treatment";
  find("sale-fields").hidden = !sale;
  find("sale-fields").disabled = !sale;
  const inspection = find("record-kind").value === "inspection";
  find("entry-date-label").textContent = treatment ? "Treatment start date" : "Date";
  find("treatment-fields").hidden = !treatment;
  find("treatment-fields").disabled = !treatment;
  const weight = find("record-kind").value === "weight";
  const eggs = find("record-kind").value === "eggs";
  const feed = find("record-kind").value === "feed";
  const expense = find("record-kind").value === "expense";
  find("flock-label").hidden = expense || sale;
  find("flock").hidden = expense || sale;
  find("flock").disabled = expense || sale;
  find("inspection-fields").hidden = !inspection;
  find("inspection-fields").disabled = !inspection;
  find("expense-fields").hidden = !expense;
  find("expense-fields").disabled = !expense;
  find("quantity-label").textContent = weight ? "Birds weighed" : "Birds lost";
  find("mortality-fields").hidden = weight || eggs || feed || expense || inspection || treatment || sale;
  find("bird-fields").hidden = eggs || feed || expense || inspection || treatment || sale;
  find("quantity").disabled = eggs || feed || expense || inspection || treatment || sale;
  find("feed-fields").hidden = !feed;
  find("feed-weight").disabled = !feed;
  find("feed-weight").required = feed;
  find("egg-fields").hidden = !eggs;
  find("egg-fields").disabled = !eggs;
  find("weight-fields").hidden = !weight;
  find("average-weight").disabled = !weight;
  find("average-weight").required = weight;
}

async function inspectionPhoto(file) {
  if (!file || file.size === 0) return null;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 12 * 1024 * 1024) {
    throw new Error("Choose a JPEG, PNG or WebP photo no larger than 12 MB.");
  }
  const bitmap = await createImageBitmap(file);
  try {
    const ratio = Math.min(1, 960 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Could not prepare this photo.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.78, 0.58, 0.4]) {
      const jpeg = canvas.toDataURL("image/jpeg", quality).split(",")[1];
      if (jpeg && (jpeg.length / 4) * 3 <= 256 * 1024) return jpeg;
    }
    throw new Error("This photo is too large after resizing. Choose another photo.");
  } finally {
    bitmap.close();
  }
}

function amountInMinor(value) {
  const raw = String(value || "").trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return NaN;
  const [whole, cents = ""] = raw.split(".");
  return Number(whole) * 100 + Number(cents.padEnd(2, "0"));
}

find("sale-lot").addEventListener("change", () => {
  const lot = current?.profile.saleLots?.find(row => row.id === find("sale-lot").value);
  find("sale-price").value = typeof lot?.sellingPriceMinor === "number" ? (lot.sellingPriceMinor / 100).toFixed(2) : "";
});

find("record-kind").addEventListener("change", () => {
  updateRecordFields();
  if (current) void render(current).catch(() => show("Could not refresh the local flock list."));
});
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const active = current;
  if (!active || working) return;
  const data = new FormData(form);
  const flock = active.profile.flocks.find(({ id }) => id === data.get("batchId"));
  const quantity = Number(data.get("quantity"));
  const date = String(data.get("date") ?? "");
  const kind = String(data.get("kind"));
  if ((!flock && kind !== "expense" && kind !== "sale") || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  let sale;
  if (kind === "sale") {
    if (!active.profile.canRecordSales) return;
    const lot = active.profile.saleLots?.find(row => row.id === data.get("saleLot"));
    const quantity = Number(data.get("saleQuantity"));
    const unitPriceMinor = amountInMinor(data.get("salePrice"));
    const amountPaidMinor = amountInMinor(data.get("salePaid"));
    const total = Math.round(quantity * unitPriceMinor);
    if (!lot || !Number.isFinite(quantity) || quantity <= 0 || !Number.isSafeInteger(unitPriceMinor) ||
      !Number.isSafeInteger(total) || total > 2147483647 || !Number.isSafeInteger(amountPaidMinor) || amountPaidMinor > total) {
      show("Check the stock lot, sale amount and amount received.");
      return;
    }
    sale = { lotId: lot.id, label: lot.product.name, currency: active.profile.currency, quantity, unitPriceMinor,
      amountPaidMinor, customerName: String(data.get("saleCustomer") || "").trim() };
  }
  let expense;
  if (kind === "expense") {
    if (!active.profile.canRecordExpenses) return;
    const raw = String(data.get("amount") || "").trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return;
    const [whole, cents = ""] = raw.split(".");
    const amountMinor = Number(whole) * 100 + Number(cents.padEnd(2, "0"));
    const category = String(data.get("category") || "").trim();
    const description = String(data.get("description") || "").trim();
    if (!Number.isSafeInteger(amountMinor) || amountMinor < 1 || amountMinor > 2147483647 || !category || !description) {
      show("Enter a valid expense category, description and amount.");
      return;
    }
    expense = { category, description, amountMinor, currency: active.profile.currency };
  }
  if ((kind === "mortality" || kind === "weight") && (!Number.isSafeInteger(quantity) || quantity < 1)) return;
  const feedKg = Number(data.get("feedKg"));
  if (kind === "feed" && (!Number.isFinite(feedKg) || feedKg < 0 || feedKg > 999999999)) return;
  let collection;
  if (kind === "eggs") {
    if (!flock.layer) { show("Choose a layer flock for this collection."); return; }
    const outcomes = ["saleableEggs", "dirtyEggs", "crackedEggs", "floorEggs", "rejectedEggs"];
    const counts = Object.fromEntries(outcomes.map(field => [field, Number(data.get(field))]));
    const totalEggs = Object.values(counts).reduce((sum, value) => sum + value, 0);
    const liveHens = Number(data.get("liveHens"));
    if (!Number.isSafeInteger(liveHens) || liveHens < 1 || totalEggs > 2147483647
      || Object.values(counts).some(value => !Number.isSafeInteger(value) || value < 0)) {
      show("Enter valid whole numbers for the egg collection.");
      return;
    }
    collection = { liveHens, totalEggs, ...counts, grades: [{ grade: "UNGRADED", quantity: counts.saleableEggs }] };
  }
  const avgWeightKg = Number(data.get("avgWeightKg"));
  if (kind === "weight" && (!Number.isFinite(avgWeightKg) || avgWeightKg < 0.001 || avgWeightKg > 100)) return;
  working = true;
  find("save").disabled = true;
  try {
    let treatment;
    if (kind === "treatment") {
      if (!active.profile.canRecordTreatments) return;
      const productName = String(data.get("treatmentProduct") || "").trim();
      const endedAt = data.get("treatmentEnd") || null;
      const clearsOn = data.get("treatmentClearance") || null;
      if (!productName || (endedAt && endedAt < date) || (clearsOn && (!endedAt || clearsOn < endedAt))) {
        show("Check the product name, treatment dates and recorded clearance date.");
        return;
      }
      treatment = { productName, endedAt, clearsOn, notes: String(data.get("treatmentNotes") || "").trim() };
    }
    let inspection;
    if (kind === "inspection") {
      const numberOrNull = key => data.get(key) === "" ? null : Number(data.get(key));
      inspection = {
        notes: String(data.get("inspectionNotes") || "").trim(),
        temperatureC: numberOrNull("temperatureC"), humidityPercent: numberOrNull("humidityPercent"),
        beddingIssue: data.has("beddingIssue"), ventilationIssue: data.has("ventilationIssue"),
        waterChange: data.has("waterChange"), feedChange: data.has("feedChange"),
        photo: await inspectionPhoto(data.get("inspectionPhoto")),
      };
      if (!inspection.notes && inspection.temperatureC === null && inspection.humidityPercent === null
        && !inspection.beddingIssue && !inspection.ventilationIssue && !inspection.waterChange && !inspection.feedChange && !inspection.photo) {
        show("Enter an observation, reading or photo.");
        return;
      }
    }
    if (current !== active) return;
    const id = crypto.randomUUID();
    const entry = {
      kind, flock: flock?.name ?? "Farm-wide", batchId: flock?.id, date, quantity,
      ...(kind === "sale" ? { sale, approved: false } : kind === "treatment" ? { treatment } : kind === "inspection" ? { inspection } : kind === "expense" ? { expense } : kind === "feed" ? { feedKg } : kind === "eggs" ? { collection } : kind === "weight" ? { avgWeightKg } : { reason: String(data.get("reason") ?? ""), notes: String(data.get("notes") ?? "") }),
      createdAt: Date.now(),
    };
    await storage("outbox", "add", { id, value: await seal(active.key, id, entry) }, id);
    if (current !== active) return;
    form.reset();
    find("record-kind").value = kind;
    updateRecordFields();
    find("date").value = date;
    show(kind === "sale" ? "Sale draft saved on this device. Confirm it online." : "Saved on this device. Waiting to sync.");
    await render(active);
    void sync();
  } catch (error) {
    if (current === active) show(error instanceof Error ? error.message : "Could not save this entry on the device. Please try again.");
  } finally {
    working = false;
    if (current === active) find("save").disabled = false;
  }
});

find("lock").addEventListener("click", () => lock("Workspace locked."));
find("sync").addEventListener("click", () => { void sync(); });
find("backup").addEventListener("click", async () => {
  try {
    const backup = {
      format: "flockence.offline.v1", vault: await storage("vault", "get", "workspace"),
      outbox: await storage("outbox", "getAll"),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "flockence-offline-encrypted.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch { show("Could not create the encrypted backup."); }
});
window.addEventListener("online", () => { indicator(); void sync(); });
window.addEventListener("offline", indicator);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && current) lock("Workspace locked while this page was hidden.");
});

async function start() {
  indicator();
  try {
    vault = await storage("vault", "get", "workspace");
    if (vault) {
      find("instructions").textContent = "Use the passphrase set when this device was prepared.";
      find("backup").hidden = false;
    } else {
      find("instructions").textContent = "While signed in, choose a separate device passphrase to prepare offline capture.";
      find("unlock-button").textContent = "Prepare this device";
    }
    unlockForm.hidden = false;
    show("");
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  } catch {
    show("This browser did not allow device storage. Offline capture is unavailable.");
  }
}

void start();
