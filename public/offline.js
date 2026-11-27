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
  find("expense-option").hidden = !allowExpenses;
  find("expense-option").disabled = !allowExpenses;
  find("expense-currency").textContent = active.profile.currency || "";
  if (!allowExpenses && find("record-kind").value === "expense") {
    find("record-kind").value = "mortality";
    updateRecordFields();
  }
  const select = find("flock");
  const selected = select.value;
  const prompt = new Option("Select a flock", "");
  const flocks = active.profile.flocks.filter(row => find("record-kind").value !== "eggs" || row.layer);
  select.replaceChildren(prompt, ...flocks.map(row => new Option(row.name, row.id)));
  if (flocks.some(row => row.id === selected)) select.value = selected;
  find("save").disabled = find("record-kind").value === "expense" ? !allowExpenses : !flocks.length;
  const entries = find("entries");
  entries.replaceChildren();
  for (const { entry } of rows) {
    const li = document.createElement("li");
    const detail = entry.kind === "expense" ? "Expense · " + (entry.expense.amountMinor / 100).toFixed(2) + " " + (entry.expense.currency || "")
      : entry.kind === "eggs" ? entry.collection.totalEggs + " eggs · Egg collection"
      : entry.kind === "feed" ? entry.feedKg + " kg · Feed consumption"
      : entry.quantity + " birds · " + (entry.kind === "weight" ? "Live weight, " + entry.avgWeightKg + " kg average" : "Mortality");
    li.textContent = entry.flock + " · " + entry.date + " · " + detail + " · "
      + (entry.review ? "Needs review — " + entry.review : "Waiting to sync");
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
      if (entry.review) continue;
      if (entry.kind === "expense" && !syncedProfile.canRecordExpenses) {
        entry.review = "Your current role cannot sync expenses. The draft remains saved.";
        await storage("outbox", "put", { id, value: await seal(active.key, id, entry) }, id);
        continue;
      }
      const weight = entry.kind === "weight";
      const eggs = entry.kind === "eggs";
      const feed = entry.kind === "feed";
      const expense = entry.kind === "expense";
      const endpoint = expense ? "/api/expenses" : feed ? "/api/daily-flock-check" : eggs ? "/api/egg-collections" : weight ? "/api/weights" : "/api/mortality";
      const values = expense ? { category: entry.expense.category, description: entry.expense.description, amountMinor: entry.expense.amountMinor, currency: entry.expense.currency }
        : feed ? { feedKg: entry.feedKg } : eggs ? entry.collection : weight ? { quantity: entry.quantity, avgWeightKg: entry.avgWeightKg }
        : { quantity: entry.quantity, reason: entry.reason, notes: entry.notes };
      const response = await fetch(endpoint, {
        method: "POST", credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(12000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(expense ? {} : { batchId: entry.batchId }), date: entry.date, ...values,
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
  const weight = find("record-kind").value === "weight";
  const eggs = find("record-kind").value === "eggs";
  const feed = find("record-kind").value === "feed";
  const expense = find("record-kind").value === "expense";
  find("flock-label").hidden = expense;
  find("flock").hidden = expense;
  find("flock").disabled = expense;
  find("expense-fields").hidden = !expense;
  find("expense-fields").disabled = !expense;
  find("quantity-label").textContent = weight ? "Birds weighed" : "Birds lost";
  find("mortality-fields").hidden = weight || eggs || feed || expense;
  find("bird-fields").hidden = eggs || feed || expense;
  find("quantity").disabled = eggs || feed || expense;
  find("feed-fields").hidden = !feed;
  find("feed-weight").disabled = !feed;
  find("feed-weight").required = feed;
  find("egg-fields").hidden = !eggs;
  find("egg-fields").disabled = !eggs;
  find("weight-fields").hidden = !weight;
  find("average-weight").disabled = !weight;
  find("average-weight").required = weight;
}

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
  if ((!flock && kind !== "expense") || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
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
    const id = crypto.randomUUID();
    const entry = {
      kind, flock: flock?.name ?? "Farm-wide", batchId: flock?.id, date, quantity,
      ...(kind === "expense" ? { expense } : kind === "feed" ? { feedKg } : kind === "eggs" ? { collection } : kind === "weight" ? { avgWeightKg } : { reason: String(data.get("reason") ?? ""), notes: String(data.get("notes") ?? "") }),
      createdAt: Date.now(),
    };
    await storage("outbox", "add", { id, value: await seal(active.key, id, entry) }, id);
    if (current !== active) return;
    form.reset();
    find("record-kind").value = kind;
    updateRecordFields();
    find("date").value = date;
    show("Saved on this device. Waiting to sync.");
    await render(active);
    void sync();
  } catch {
    if (current === active) show("Could not save this entry on the device. Please try again.");
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
