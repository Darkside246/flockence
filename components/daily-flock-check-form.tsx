"use client";

import { useEffect, useMemo, useState } from "react";
import { calendarDateInTimeZone } from "@/lib/poultry-metrics.mjs";

type Batch = { id: string; name: string; initialChicks: number; status: string; productionType?: string | null; species?: string; liveBirdCount?: number | null };

type DailyCheckPayload = {
  batchId: string;
  date: string;
  /** null: worked out from the starting birds, deaths and birds sent to slaughter. */
  liveCount: number | null;
  feedKg: number | null;
  waterLiters: number | null;
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
  const [feedKg, setFeedKg] = useState("");
  const [waterLiters, setWaterLiters] = useState("");
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

  const [sensor, setSensor] = useState<{sensor:string;readAt:string;temperatureC:string;humidityPercent:string|null}|null>(null);
  useEffect(() => {
    setSensor(null);
    if (!batchId || date !== today()) return;
    const controller = new AbortController();
    fetch("/api/check-sensor?batchId="+encodeURIComponent(batchId),{cache:"no-store",signal:controller.signal})
      .then(r=>r.ok?r.json():null).then(row=>{if(!controller.signal.aborted) setSensor(row);}).catch(()=>{});
    return ()=>controller.abort();
  }, [batchId,date]);
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
    if (!batchId || !date || (counted && (!Number.isSafeInteger(Number(liveCount)) || Number(liveCount) < 0))) {
      setMessage("Choose the batch and date. A counted live bird number must be a whole number.");
      return;
    }

    const payload: DailyCheckPayload = {
      batchId,
      date,
      liveCount: counted ? Number(liveCount) : null,
      feedKg: numberOrNull(feedKg),
      waterLiters: numberOrNull(waterLiters),
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
        setMessage("No connection. This flock check is saved on this device for automatic sync.");
      } catch {
        setMessage("No connection, and the device could not save the offline record. Do not leave the page until the connection returns.");
      }
      return;
    }

    try {
      await send(payload);
      setMessage("Today's flock check saved.");
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
      <label>Live birds (only if you counted them)<input value={liveCount} onChange={event => setLiveCount(event.target.value)} type="number" min="0" max={selectedBatch?.initialChicks ?? undefined} step="1" placeholder={selectedBatch?.liveBirdCount != null ? String(selectedBatch.liveBirdCount) : "Worked out for you"} aria-describedby="live-birds-hint"/>
        <small id="live-birds-hint" className="muted">{selectedBatch?.liveBirdCount != null ? `Worked out from your records: ${selectedBatch.liveBirdCount} (starting birds minus deaths and birds sent). ` : "Worked out from your records. "}Leave blank unless you did a head count; just record deaths as they happen.</small></label>
      <label>Feed used kg<input value={feedKg} onChange={event => setFeedKg(event.target.value)} type="number" min="0" step="0.001"/></label>
      <label>Water used litres<input value={waterLiters} onChange={event => setWaterLiters(event.target.value)} type="number" min="0" step="0.1"/></label>
      <label>Average weight kg<input value={avgWeightKg} onChange={event => setAvgWeightKg(event.target.value)} type="number" min="0" step="0.001"/></label>
      <label>Birds weighed<input value={weightSampleQuantity} onChange={event => setWeightSampleQuantity(event.target.value)} type="number" min="1" step="1"/></label>
      {sensor && <button type="button" className="button" onClick={()=>{
        if (date !== today() || Date.now()-Date.parse(sensor.readAt)>15*60000) {setSensor(null);setMessage("Reading expired. Re-select the flock for a current reading.");return;}
        setTemperatureC(String(sensor.temperatureC));setHumidityPercent(sensor.humidityPercent == null ? "" : String(sensor.humidityPercent));
        const source = "Govee "+sensor.sensor+" polled "+sensor.readAt;
        setNotes(n=>n.includes(source)?n:[n,source].filter(Boolean).join("\n"));
      }}>Use {sensor.sensor} reading · {new Date(sensor.readAt).toLocaleTimeString()}</button>}
      <label>House temperature °C<input value={temperatureC} onChange={event => setTemperatureC(event.target.value)} type="number" step="0.1"/></label>
      <label>House humidity %<input value={humidityPercent} onChange={event => setHumidityPercent(event.target.value)} type="number" min="0" max="100" step="0.1"/></label>
      <label>Ammonia ppm<input value={ammoniaPpm} onChange={event => setAmmoniaPpm(event.target.value)} type="number" min="0" step="0.1"/></label>
      <label>Litter condition<select value={litterCondition} onChange={event => setLitterCondition(event.target.value)}><option value="">Not recorded</option><option>DRY</option><option>ACCEPTABLE</option><option>WET</option><option>VERY_WET</option></select></label>
      <label><input checked={pantingObserved} onChange={event => setPantingObserved(event.target.checked)} type="checkbox"/> Panting observed</label>
      <label><input checked={wingSpreadingObserved} onChange={event => setWingSpreadingObserved(event.target.checked)} type="checkbox"/> Wing spreading observed</label>
      <label style={{ gridColumn: "1/-1" }}>Notes<textarea value={notes} onChange={event => setNotes(event.target.value)} placeholder="Anything unusual in the house today"/></label>
      <button className="button button-primary" type="submit">Save today's flock check</button>
    </form>
    <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>Offline mode is a capture aid. A queued record is not authoritative until Flockence accepts it and the server returns success.</p>
  </div>;
}
