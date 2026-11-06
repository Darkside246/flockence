"use client";

import { useEffect, useMemo, useState } from "react";
import { calendarDateInTimeZone } from "@/lib/poultry-metrics.mjs";
import { FlockInsightsPanel, LiveBirdsPanel, useFlockLedger } from "@/components/flock-numbers";

type Batch = { id: string; name: string; initialChicks: number; status: string; productionType?: string | null; species?: string; liveBirdCount?: number | null };

type DailyCheckPayload = {
  batchId: string;
  date: string;
  /** null: worked out from the starting birds, deaths and birds sent to slaughter. */
  liveCount: number | null;
  /** Birds found dead at this check; saved as a mortality record for the same day. */
  diedCount: number | null;
  diedReason: string;
  culledCount: number | null;
  /** One id per press of Save, so a retry after a dropped connection never counts the same deaths twice. */
  submissionId: string;
  feedKg: number | null;
  leftoverKg: number | null;
  spillageKg: number | null;
  returnedKg: number | null;
  waterLiters: number | null;
  waterReadingL: number | null;
  waterSource: string;
  waterKind: "METER" | "TANK";
  waterAddedL: number | null;
  disposal: string;
  avgWeightKg: number | null;
  weightSampleQuantity: number | null;
  temperatureC: number | null;
  humidityPercent: number | null;
  ammoniaPpm: number | null;
  litterCondition: string;
  pantingObserved: boolean;
  wingSpreadingObserved: boolean;
  notes: string;
};

type QueueItem = {
  id: string;
  payload: DailyCheckPayload;
  queuedAt: string;
  attempts: number;
  lastError?: string;
};

const queueKey = "chicken-op.daily-flock-check-queue";

const numberOrNull = (value: string) => value === "" ? null : Number(value);
const today = () => calendarDateInTimeZone(new Date()) ?? new Date().toISOString().slice(0, 10);

function readQueue(): QueueItem[] {
  try {
    const value = window.localStorage.getItem(queueKey);
    if (!value) return [];
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(items: QueueItem[]) {
  window.localStorage.setItem(queueKey, JSON.stringify(items));
}

async function send(payload: DailyCheckPayload) {
  const response = await fetch("/api/daily-flock-check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Could not save daily flock check.");
  return data;
}

export function DailyFlockCheckForm({ batches }: { batches: Batch[] }) {
  const [batchId, setBatchId] = useState("");
  const [date, setDate] = useState(today());
  const [liveCount, setLiveCount] = useState("");
  const [diedCount, setDiedCount] = useState("");
  const [diedReason, setDiedReason] = useState("");
  const [culledCount, setCulledCount] = useState("");
  const [feedKg, setFeedKg] = useState("");
  const [leftoverKg, setLeftoverKg] = useState(""), [spillageKg, setSpillageKg] = useState(""), [returnedKg, setReturnedKg] = useState("");
  const [waterLiters, setWaterLiters] = useState("");
  const [waterReadingL, setWaterReadingL] = useState(""), [waterAddedL, setWaterAddedL] = useState("");
  const [waterKind, setWaterKind] = useState<"METER" | "TANK">("METER");
  const [waterSource, setWaterSource] = useState("");
  useEffect(() => { try { const saved = localStorage.getItem("flockence-water-source"); if (saved) setWaterSource(saved); } catch { /* storage blocked */ } }, []);
  const [disposal, setDisposal] = useState("");
  const [avgWeightKg, setAvgWeightKg] = useState("");
  const [weightSampleQuantity, setWeightSampleQuantity] = useState("");
  const [temperatureC, setTemperatureC] = useState("");
  const [humidityPercent, setHumidityPercent] = useState("");
  const [ammoniaPpm, setAmmoniaPpm] = useState("");
  const [litterCondition, setLitterCondition] = useState("");
  const [pantingObserved, setPantingObserved] = useState(false);
  const [wingSpreadingObserved, setWingSpreadingObserved] = useState(false);
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState("");
  const [queueCount, setQueueCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [online, setOnline] = useState(false);

  const [revision, setRevision] = useState(0);
  const ledger = useFlockLedger(batchId, date, revision);
  const selectedBatch = useMemo(() => batches.find(batch => batch.id === batchId), [batches, batchId]);

  const refreshQueueCount = () => setQueueCount(readQueue().length);

  const syncQueue = async () => {
    if (!navigator.onLine) {
      refreshQueueCount();
      return;
    }
    const current = readQueue();
    if (!current.length || syncing) {
      refreshQueueCount();
      return;
    }

    setSyncing(true);
    const remaining: QueueItem[] = [];
    for (const item of current) {
      try {
        await send(item.payload);
      } catch (error) {
        remaining.push({
          ...item,
          attempts: item.attempts + 1,
          lastError: error instanceof Error ? error.message : "Sync failed.",
        });
      }
    }
    writeQueue(remaining);
    setQueueCount(remaining.length);
    setSyncing(false);
    if (remaining.length === 0) setMessage("Offline daily flock checks synced successfully.");
    else setMessage(remaining.length + " offline flock check(s) remain queued. The farm will retry when the connection is available.");
  };

  useEffect(() => {
    setOnline(navigator.onLine);
    refreshQueueCount();
    const onOnline = () => {
      setOnline(true);
      void syncQueue();
    };
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    if (navigator.onLine) void syncQueue();
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  function enqueue(payload: DailyCheckPayload) {
    const current = readQueue().filter(item => !(item.payload.batchId === payload.batchId && item.payload.date === payload.date));
    current.push({
      id: crypto.randomUUID(),
      payload,
      queuedAt: new Date().toISOString(),
      attempts: 0,
    });
    writeQueue(current);
    setQueueCount(current.length);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const counted = liveCount.trim() !== "";
    if ([diedCount, culledCount].some(v => v.trim() !== "" && (!Number.isSafeInteger(Number(v)) || Number(v) < 0))) {
      setMessage("Birds that died must be a whole number of 0 or more.");
      return;
    }
    if (!batchId || !date || (counted && (!Number.isSafeInteger(Number(liveCount)) || Number(liveCount) < 0))) {
      setMessage("Choose the batch and date. A counted live bird number must be a whole number.");
      return;
    }

    const payload: DailyCheckPayload = {
      batchId,
      date,
      liveCount: counted ? Number(liveCount) : null,
      diedCount: diedCount.trim() === "" ? null : Number(diedCount),
      diedReason,
      culledCount: culledCount.trim() === "" ? null : Number(culledCount),
      submissionId: crypto.randomUUID(),
      feedKg: numberOrNull(feedKg),
      leftoverKg: numberOrNull(leftoverKg), spillageKg: numberOrNull(spillageKg), returnedKg: numberOrNull(returnedKg),
      waterLiters: numberOrNull(waterLiters),
      waterReadingL: numberOrNull(waterReadingL), waterSource: waterSource.trim(), waterKind, waterAddedL: numberOrNull(waterAddedL),
      disposal,
      avgWeightKg: numberOrNull(avgWeightKg),
      weightSampleQuantity: numberOrNull(weightSampleQuantity),
      temperatureC: numberOrNull(temperatureC),
      humidityPercent: numberOrNull(humidityPercent),
      ammoniaPpm: numberOrNull(ammoniaPpm),
      litterCondition,
      pantingObserved,
      wingSpreadingObserved,
      notes,
    };

    if (!navigator.onLine) {
      try {
        enqueue(payload);
        setDiedCount("");setDiedReason("");setCulledCount("");setLiveCount("");
        setMessage("No connection. This flock check is saved on this device for automatic sync.");
      } catch {
        setMessage("No connection, and the device could not save the offline record. Do not leave the page until the connection returns.");
      }
      return;
    }

    try {
      const saved = await send(payload);
      try { if (waterSource.trim()) localStorage.setItem("flockence-water-source", waterSource.trim()); } catch { /* storage blocked */ }
      setDiedCount("");setDiedReason("");setCulledCount("");setLiveCount("");setWaterReadingL("");setWaterAddedL("");
      setRevision(v=>v+1);setMessage("Flock check saved for "+date+"."+(saved?.liveBirdsNow!=null?" "+saved.liveBirdsNow+" live birds remaining"+(saved.lossesRecorded?" after "+saved.lossesRecorded+" lost today":"")+".":"")+(saved?.waterBasis?" "+saved.waterBasis:""));
    } catch (error) {
      if (!navigator.onLine) {
        try {
          enqueue(payload);
          setMessage("The connection dropped. This flock check is saved on this device for automatic sync.");
        } catch {
          setMessage("The connection dropped and the device could not save the offline record.");
        }
      } else {
        setMessage(error instanceof Error ? error.message : "Could not save today's flock check.");
      }
    }
  }

  return <div className="section card">
    <div className="section-head">
      <div><h2>Daily flock check</h2><p>One pass records the birds, feed, water, weight, climate and visible heat/welfare signs.</p></div>
      <span className="badge">{queueCount > 0 ? queueCount + " QUEUED" : online ? "ONLINE" : "OFFLINE"}</span>
    </div>
    {queueCount > 0 && <p className="notice" role="status">{syncing ? "Syncing offline flock checks..." : queueCount + " flock check" + (queueCount === 1 ? "" : "s") + " waiting for a connection. They are kept by flock and date on this device."}</p>}
    {message && <p className="notice" role="status">{message}</p>}
    <form className="form grid2" onSubmit={submit}>
      <label>Batch<select value={batchId} onChange={event => setBatchId(event.target.value)} required><option value="">Select batch</option>{batches.filter(batch => batch.status === "ACTIVE").map(batch => <option key={batch.id} value={batch.id}>{batch.name}</option>)}</select></label>
      <label>Date<input value={date} type="date" max={today()} onChange={event => setDate(event.target.value)} required/></label>
      <div className="span-2"><LiveBirdsPanel ledger={ledger} date={date}/></div>
      {batchId && <div className="span-2"><FlockInsightsPanel batchId={batchId} revision={revision}/></div>}
      <label>Birds that died (count these first)<input value={diedCount} onChange={event => setDiedCount(event.target.value)} type="number" min="0" step="1" placeholder="0" aria-describedby="died-birds-hint"/>
        <small id="died-birds-hint" className="muted">Count the dead birds you found today. They are saved as deaths for this day and taken off the flock first. Leave blank if none.</small></label>
      {diedCount.trim() !== "" && Number(diedCount) > 0 && <label>How the dead birds were disposed of<select value={disposal} onChange={e => setDisposal(e.target.value)}><option value="">Not recorded</option><option value="BURIED">Buried</option><option value="BURNED">Burned</option><option value="COMPOSTED">Composted</option><option value="RENDERED">Rendered</option><option value="COLLECTED">Collected by a contractor</option></select></label>}
      <label>Cause, if known<select value={diedReason} onChange={event => setDiedReason(event.target.value)}><option value="">Not known</option><option>Found dead at the round</option><option>Sickness signs</option><option>Heat stress</option><option>Crushed or smothered</option><option>Culled (weak or injured)</option><option>Predator</option></select></label>
      <label>Birds culled (optional)<input value={culledCount} onChange={event => setCulledCount(event.target.value)} type="number" min="0" step="1" placeholder="0"/></label>
      <label>Live birds (only if you counted them)<input value={liveCount} onChange={event => setLiveCount(event.target.value)} type="number" min="0" max={selectedBatch?.initialChicks ?? undefined} step="1" placeholder={selectedBatch?.liveBirdCount != null ? String(selectedBatch.liveBirdCount) : "Worked out for you"} aria-describedby="live-birds-hint"/>
        <small id="live-birds-hint" className="muted">{selectedBatch?.liveBirdCount != null ? `Worked out from your records: ${selectedBatch.liveBirdCount} (starting birds minus deaths and birds sent). ` : "Worked out from your records. "}Leave blank unless you did a head count. If you do count, count after the dead birds are removed; the deaths above are taken off first.</small></label>
      <label>Feed put in the feeders kg<input value={feedKg} onChange={event => setFeedKg(event.target.value)} type="number" min="0" step="0.001"/></label>
      {feedKg !== "" && <>
        <label>Left in the feeders kg (if weighed)<input value={leftoverKg} onChange={event => setLeftoverKg(event.target.value)} type="number" min="0" step="0.001" placeholder="Not weighed"/></label>
        <label>Spilt or spoiled kg<input value={spillageKg} onChange={event => setSpillageKg(event.target.value)} type="number" min="0" step="0.001" placeholder="0"/></label>
        <label>Taken back to the store kg<input value={returnedKg} onChange={event => setReturnedKg(event.target.value)} type="number" min="0" step="0.001" placeholder="0"/></label>
        <small className="muted span-2">How much was eaten is worked out from these. Weigh what is left in the feeders to get it; if you do not, it shows as "put out", not "eaten".</small>
      </>}
      <label>Water meter or tank<input value={waterSource} onChange={event => setWaterSource(event.target.value)} placeholder="For example: House 1 meter" maxLength={80}/></label>
      <label>Reading litres<span className="inline-pair"><select value={waterKind} onChange={event => setWaterKind(event.target.value as "METER" | "TANK")} aria-label="Meter or tank"><option value="METER">Meter dial</option><option value="TANK">Tank level</option></select><input value={waterReadingL} onChange={event => setWaterReadingL(event.target.value)} type="number" min="0" step="0.1" aria-label="Reading in litres"/></span></label>
      {waterKind === "TANK" && waterReadingL !== "" && <label>Refilled since the last reading litres<input value={waterAddedL} onChange={event => setWaterAddedL(event.target.value)} type="number" min="0" step="0.1" placeholder="0"/></label>}
      <label>Water used litres{waterReadingL !== "" ? " (worked out from the reading)" : ""}<input value={waterLiters} onChange={event => setWaterLiters(event.target.value)} type="number" min="0" step="0.1" placeholder={waterReadingL !== "" ? "Leave blank" : ""}/></label>
      <label>Average weight kg<input value={avgWeightKg} onChange={event => setAvgWeightKg(event.target.value)} type="number" min="0" step="0.001"/></label>
      <label>Birds weighed<input value={weightSampleQuantity} onChange={event => setWeightSampleQuantity(event.target.value)} type="number" min="1" step="1"/></label>
      <label>House temperature °C<input value={temperatureC} onChange={event => setTemperatureC(event.target.value)} type="number" step="0.1"/></label>
      <label>House humidity %<input value={humidityPercent} onChange={event => setHumidityPercent(event.target.value)} type="number" min="0" max="100" step="0.1"/></label>
      <label>Ammonia ppm<input value={ammoniaPpm} onChange={event => setAmmoniaPpm(event.target.value)} type="number" min="0" step="0.1"/></label>
      <label>Litter condition<select value={litterCondition} onChange={event => setLitterCondition(event.target.value)}><option value="">Not recorded</option><option>DRY</option><option>ACCEPTABLE</option><option>WET</option><option>VERY_WET</option></select></label>
      <fieldset className="check-pair"><legend>Heat signs seen</legend>
        <label><input checked={pantingObserved} onChange={event => setPantingObserved(event.target.checked)} type="checkbox"/> Panting observed</label>
        <label><input checked={wingSpreadingObserved} onChange={event => setWingSpreadingObserved(event.target.checked)} type="checkbox"/> Wing spreading observed</label>
      </fieldset>
      <label style={{ gridColumn: "1/-1" }}>Notes<textarea value={notes} onChange={event => setNotes(event.target.value)} placeholder="Anything unusual in the house today"/></label>
      <button className="button button-primary" type="submit">Save today's flock check</button>
    </form>
    <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>Offline mode is a capture aid. A queued record is not authoritative until Flockence accepts it and the server returns success.</p>
  </div>;
}
