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
    : "No mortality entries have synced from this device yet.";
  const select = find("flock");
  const selected = select.value;
  const prompt = new Option("Select a flock", "");
  select.replaceChildren(prompt, ...active.profile.flocks.map((row) => new Option(row.name, row.id)));
  if (active.profile.flocks.some((row) => row.id === selected)) select.value = selected;
  find("save").disabled = !active.profile.flocks.length;
  const entries = find("entries");
  entries.replaceChildren();
  for (const { entry } of rows) {
    const li = document.createElement("li");
    li.textContent = entry.flock + " · " + entry.date + " · " + entry.quantity + " birds · "
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
      const response = await fetch("/api/mortality", {
        method: "POST", credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(12000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batchId: entry.batchId, date: entry.date, quantity: entry.quantity, reason: entry.reason, notes: entry.notes,
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

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const active = current;
  if (!active || working) return;
  const data = new FormData(form);
  const flock = active.profile.flocks.find(({ id }) => id === data.get("batchId"));
  const quantity = Number(data.get("quantity"));
  const date = String(data.get("date") ?? "");
  if (!flock || !Number.isSafeInteger(quantity) || quantity < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  working = true;
  find("save").disabled = true;
  try {
    const id = crypto.randomUUID();
    const entry = {
      flock: flock.name, batchId: flock.id, date, quantity,
      reason: String(data.get("reason") ?? ""), notes: String(data.get("notes") ?? ""), createdAt: Date.now(),
    };
    await storage("outbox", "add", { id, value: await seal(active.key, id, entry) }, id);
    if (current !== active) return;
    form.reset();
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
