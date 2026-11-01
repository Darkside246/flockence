"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Nav } from "@/components/nav";
import { calculateHenDayProduction, calendarDateInTimeZone } from "@/lib/poultry-metrics.mjs";

type Batch = {
  id: string;
  name: string;
  startDate: string;
  productionType?: string | null;
  species?: string;
  layerStage?: string | null;
  layerStageEvents?: { id: string; fromStage: string | null; toStage: string; date: string; createdAt?: string; reason?: string | null; notes?: string | null }[];
  initialChicks: number;
  status: string;
  birdCounts?: { liveCount: number; date: string }[];
  mortalityEvents?: { quantity: number }[];
};
type Grade = "SMALL" | "MEDIUM" | "LARGE" | "EXTRA_LARGE" | "JUMBO" | "UNGRADED";
type GradeRow = { grade: Grade; quantity: number; inventoryItem?: { id: string; quantity: number | string; status: string; product?: { name: string } } | null };
type EggCollection = {
  id: string;
  batchId: string;
  date: string;
  totalEggs: number;
  liveHens?: number;
  updatedAt?: string;
  saleableEggs: number;
  dirtyEggs: number;
  crackedEggs: number;
  floorEggs: number;
  rejectedEggs: number;
  averageEggWeightG?: number | string | null;
  notes?: string | null;
  withdrawalBlocked?: boolean;
  withdrawalNotes?: string | null;
  batch: { name: string };
  grades: GradeRow[];
};
type GradeCounts = Record<Grade, string>;
type LayerStageEvent = { id: string; fromStage: string | null; toStage: string; date: string; createdAt?: string; reason?: string | null; notes?: string | null };

const gradeLabels: Record<Grade, string> = {
  SMALL: "Small",
  MEDIUM: "Medium",
  LARGE: "Large",
  EXTRA_LARGE: "Extra large",
  JUMBO: "Jumbo",
  UNGRADED: "Ungraded",
};
const gradeOrder: Grade[] = ["SMALL", "MEDIUM", "LARGE", "EXTRA_LARGE", "JUMBO", "UNGRADED"];
const localToday = () => calendarDateInTimeZone(new Date()) ?? new Date().toISOString().slice(0, 10);
const number = (value: unknown) => Number(value ?? 0);
async function readJson(response: Response) {
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.error || "The request could not be completed.");
  return data;
}

function isLayer(batch: Batch) {
  return batch.productionType === "LAYER" || String(batch.species || "").toUpperCase() === "LAYER";
}
function liveHens(batch: Batch) {
  if (batch.birdCounts?.[0]) return Math.max(0, number(batch.birdCounts[0].liveCount));
  const losses = (batch.mortalityEvents || []).reduce((sum, row) => sum + number(row.quantity), 0);
  return Math.max(0, number(batch.initialChicks) - losses);
}

function layerStageOnDate(batch: Batch, date: string) {
  if (batch.startDate.slice(0, 10) > date) return null;
  const history = batch.layerStageEvents || [];
  const previous = history
    .filter((row) => row.date.slice(0, 10) <= date)
    .sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0];
  if (previous) return previous.toStage;

  // A backfilled collection before the first recorded transition belongs to
  // the stage the next transition moved from, not an unknown stage.
  const next = history
    .filter((row) => row.date.slice(0, 10) > date)
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.createdAt || "").localeCompare(String(b.createdAt || "")))[0];
  if (next) return next.fromStage;
  if (history.length > 0) return null;
  return batch.layerStage || null;
}

export default function LayersPage() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [collections, setCollections] = useState<EggCollection[]>([]);
  const [batchId, setBatchId] = useState("");
  const [date, setDate] = useState(localToday());
  const [liveHensOnDate, setLiveHensOnDate] = useState("");
  const [saleableEggs, setSaleableEggs] = useState("0");
  const [dirtyEggs, setDirtyEggs] = useState("0");
  const [crackedEggs, setCrackedEggs] = useState("0");
  const [floorEggs, setFloorEggs] = useState("0");
  const [rejectedEggs, setRejectedEggs] = useState("0");
  const [averageEggWeightG, setAverageEggWeightG] = useState("");
  const [notes, setNotes] = useState("");
  const [grades, setGrades] = useState<GradeCounts>({
    SMALL: "0", MEDIUM: "0", LARGE: "0", EXTRA_LARGE: "0", JUMBO: "0", UNGRADED: "0",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [stageSaving, setStageSaving] = useState(false);
  const [stageMessage, setStageMessage] = useState("");
  const [stageError, setStageError] = useState("");
  const [nextStage, setNextStage] = useState("CHICK");
  const [stageReason, setStageReason] = useState("");
  const [stageNotes, setStageNotes] = useState("");
  const [stageHistory, setStageHistory] = useState<LayerStageEvent[]>([]);

  async function loadData() {
    setLoading(true);
    try {
      const [batchRows, eggRows] = await Promise.all([
        fetch("/api/batches", { cache: "no-store" }).then(readJson),
        fetch("/api/egg-collections", { cache: "no-store" }).then(readJson),
      ]);
      setBatches(Array.isArray(batchRows) ? batchRows : []);
      setCollections(Array.isArray(eggRows) ? eggRows : []);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load egg production.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadData(); }, []);

  const allLayerBatches = useMemo(() => batches.filter(isLayer), [batches]);
  const layerBatches = allLayerBatches;
  const activeLayerBatches = useMemo(() => layerBatches.filter((batch) => batch.status === "ACTIVE"), [layerBatches]);
  const selectedBatch = layerBatches.find((batch) => batch.id === batchId);
  const selectedCollection = collections.find((row) => row.batchId === batchId && row.date.slice(0, 10) === date);

  useEffect(() => {
    if (!batchId) {
      setLiveHensOnDate("");
      setSaleableEggs("0"); setDirtyEggs("0"); setCrackedEggs("0");
      setFloorEggs("0"); setRejectedEggs("0"); setAverageEggWeightG(""); setNotes("");
      setGrades({ SMALL: "0", MEDIUM: "0", LARGE: "0", EXTRA_LARGE: "0", JUMBO: "0", UNGRADED: "0" });
      return;
    }

    if (selectedCollection) {
      setLiveHensOnDate(String(selectedCollection.liveHens ?? ""));
      setSaleableEggs(String(selectedCollection.saleableEggs));
      setDirtyEggs(String(selectedCollection.dirtyEggs));
      setCrackedEggs(String(selectedCollection.crackedEggs));
      setFloorEggs(String(selectedCollection.floorEggs));
      setRejectedEggs(String(selectedCollection.rejectedEggs));
      setAverageEggWeightG(selectedCollection.averageEggWeightG == null ? "" : String(selectedCollection.averageEggWeightG));
      setNotes(selectedCollection.notes || "");
      const savedGrades = Object.fromEntries(selectedCollection.grades.map((row) => [row.grade, String(row.quantity)])) as Partial<GradeCounts>;
      setGrades({
        SMALL: savedGrades.SMALL || "0", MEDIUM: savedGrades.MEDIUM || "0",
        LARGE: savedGrades.LARGE || "0", EXTRA_LARGE: savedGrades.EXTRA_LARGE || "0",
        JUMBO: savedGrades.JUMBO || "0", UNGRADED: savedGrades.UNGRADED || "0",
      });
      return;
    }

    const batch = layerBatches.find((row) => row.id === batchId);
    setLiveHensOnDate(date === localToday() && batch ? String(liveHens(batch)) : "");
    setSaleableEggs("0"); setDirtyEggs("0"); setCrackedEggs("0");
    setFloorEggs("0"); setRejectedEggs("0"); setAverageEggWeightG(""); setNotes("");
    setGrades({ SMALL: "0", MEDIUM: "0", LARGE: "0", EXTRA_LARGE: "0", JUMBO: "0", UNGRADED: "0" });
  }, [batchId, date, selectedCollection?.id, selectedCollection?.updatedAt, collections.length, batches.length]);

  useEffect(() => {
    if (!selectedBatch) { setStageHistory([]); return; }
    fetch("/api/layer-stage?batchId=" + encodeURIComponent(selectedBatch.id), { cache: "no-store" })
      .then(readJson)
      .then((data) => setStageHistory(Array.isArray(data?.history) ? data.history : []))
      .catch(() => setStageHistory(selectedBatch.layerStageEvents || []));
  }, [selectedBatch?.id]);

  const layingBatchesOnDate = allLayerBatches.filter((batch) => layerStageOnDate(batch, date) === "LAYING");
  const totalHens = activeLayerBatches.reduce((sum, batch) => sum + liveHens(batch), 0);
  const layingBatchIdsOnDate = new Set(layingBatchesOnDate.map((batch) => batch.id));
  const selectedDayRows = collections.filter((row) => row.date.slice(0, 10) === date && layingBatchIdsOnDate.has(row.batchId));
  const selectedDayEggs = selectedDayRows.reduce((sum, row) => sum + number(row.totalEggs), 0);
  const recordedBatchIds = new Set(selectedDayRows.map((row) => row.batchId));
  const missingLayerCollections = layingBatchesOnDate.filter((batch) => !recordedBatchIds.has(batch.id)).length;
  const layingHens = selectedDayRows.reduce((sum, row) => sum + number(row.liveHens), 0);
  const currentTotal = number(saleableEggs) + number(dirtyEggs) + number(crackedEggs) + number(floorEggs) + number(rejectedEggs);
  const gradeTotal = gradeOrder.reduce((sum, grade) => sum + number(grades[grade]), 0);
  const allCountsValid = [saleableEggs, dirtyEggs, crackedEggs, floorEggs, rejectedEggs, ...gradeOrder.map((grade) => grades[grade])]
    .every((value) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)));
  const henDayRate = missingLayerCollections === 0 && layingBatchesOnDate.length > 0 ? calculateHenDayProduction(selectedDayEggs, layingHens) : null;
  const selectedDaySaleable = selectedDayRows.reduce((sum, row) => sum + (row.withdrawalBlocked ? 0 : number(row.saleableEggs)), 0);
  const selectedDayWithdrawalCondemned = selectedDayRows.reduce((sum, row) => sum + (row.withdrawalBlocked ? number(row.totalEggs) : 0), 0);
  const selectedDayNonSaleable = selectedDayRows.reduce((sum, row) => sum + (row.withdrawalBlocked
    ? number(row.totalEggs)
    : number(row.dirtyEggs) + number(row.crackedEggs) + number(row.floorEggs) + number(row.rejectedEggs)), 0);
  const selectedDaySaleableRate = layingBatchesOnDate.length > 0 && missingLayerCollections === 0 && selectedDayEggs > 0
    ? (selectedDaySaleable / selectedDayEggs) * 100
    : null;

  const trendEnd = new Date(date + "T00:00:00.000Z");
  const trendDays = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(trendEnd);
    day.setUTCDate(day.getUTCDate() - (6 - index));
    const dayKey = day.toISOString().slice(0, 10);
    const layingForDay = allLayerBatches.filter((batch) => layerStageOnDate(batch, dayKey) === "LAYING");
    const layingIds = new Set(layingForDay.map((batch) => batch.id));
    const rows = collections.filter((row) => row.date.slice(0, 10) === dayKey && layingIds.has(row.batchId));
    const missing = Math.max(0, layingForDay.length - rows.length);
    const eggs = rows.reduce((sum, row) => sum + number(row.totalEggs), 0);
    const hens = rows.reduce((sum, row) => sum + number(row.liveHens), 0);
    const saleable = rows.reduce((sum, row) => sum + number(row.saleableEggs), 0);
    return {
      date: dayKey,
      eggs,
      hens,
      layingFlocks: layingForDay.length,
      missing,
      henDayRate: layingForDay.length > 0 && missing === 0 ? calculateHenDayProduction(eggs, hens) : null,
      saleableRate: layingForDay.length > 0 && missing === 0 && eggs > 0 ? (saleable / eggs) * 100 : null,
    };
  });
  const trendMaxEggs = Math.max(1, ...trendDays.map((day) => day.eggs));
  const trendTotalEggs = trendDays.reduce((sum, day) => sum + day.eggs, 0);
  const stageOnCollectionDate = selectedBatch ? layerStageOnDate(selectedBatch, date) : null;
  const canSave = Boolean(batchId) && stageOnCollectionDate === "LAYING" && !saving && allCountsValid && gradeTotal === number(saleableEggs);

  const allowedLayerTransitions: Record<string, string[]> = {
    CHICK: ["GROWER"], GROWER: ["PULLET"], PULLET: ["PRE_LAY"], PRE_LAY: ["LAYING"],
    LAYING: ["MOLT", "SPENT"], MOLT: ["LAYING", "SPENT"], SPENT: ["CLOSED"], CLOSED: [],
  };
  const allowedNextStages = selectedBatch?.layerStage
    ? (allowedLayerTransitions[selectedBatch.layerStage] || [])
    : ["CHICK", "GROWER", "PULLET", "PRE_LAY", "LAYING", "MOLT", "SPENT", "CLOSED"];

  function selectLayerBatch(nextId: string) {
    setBatchId(nextId);
    const batch = layerBatches.find((row) => row.id === nextId);
    setLiveHensOnDate(date === localToday() && batch ? String(liveHens(batch)) : "");
    const options = batch?.layerStage
      ? (allowedLayerTransitions[batch.layerStage] || [])
      : ["CHICK", "GROWER", "PULLET", "PRE_LAY", "LAYING", "MOLT", "SPENT", "CLOSED"];
    setNextStage(options[0] || "");
    setStageError("");
    setStageMessage("");
  }

  async function changeStage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedBatch) return;
    setStageSaving(true);
    setStageError("");
    setStageMessage("");
    try {
      const saved = await readJson(await fetch("/api/layer-stage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId: selectedBatch.id, toStage: nextStage, reason: stageReason, notes: stageNotes }),
      }));
      setBatches((current) => current.map((batch) => batch.id === selectedBatch.id
        ? { ...batch, layerStage: saved.batch.layerStage, status: saved.batch.status }
        : batch));
      setStageHistory((current) => [saved.event as LayerStageEvent, ...current.filter((row) => row.id !== saved.event.id)]);
      setStageMessage("Flock stage updated and recorded in its lifecycle history.");
      setStageReason("");
      setStageNotes("");
      await loadData();
    } catch (e) {
      setStageError(e instanceof Error ? e.message : "Could not update layer stage.");
    } finally {
      setStageSaving(false);
    }
  }

  function updateSaleable(value: string) {
    setSaleableEggs(value);
    const target = Math.max(0, number(value));
    setGrades((current) => {
      const gradedWithoutUngraded = gradeOrder.filter((grade) => grade !== "UNGRADED").reduce((sum, grade) => sum + number(current[grade]), 0);
      return { ...current, UNGRADED: String(Math.max(0, target - gradedWithoutUngraded)) };
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!selectedBatch) {
      setError("Choose a layer flock before recording a collection.");
      return;
    }
    if (layerStageOnDate(selectedBatch, date) !== "LAYING") {
      setError("This flock was not in its Laying stage on the selected collection date.");
      return;
    }
    if (!allCountsValid) {
      setError("Egg counts and grades must be non-negative whole numbers.");
      return;
    }
    if (!/^\d+$/.test(liveHensOnDate) || !Number.isSafeInteger(number(liveHensOnDate)) || number(liveHensOnDate) < 1) {
      setError("Enter the live hen count for this collection date as a positive whole number.");
      return;
    }
    if (gradeTotal !== number(saleableEggs)) {
      setError("Graded quantities must match saleable eggs. Use Ungraded for eggs that have not been sized yet.");
      return;
    }
    setSaving(true);
    try {
      const savedCollection = await readJson(await fetch("/api/egg-collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batchId, date, liveHens: number(liveHensOnDate), totalEggs: currentTotal,
          saleableEggs: number(saleableEggs), dirtyEggs: number(dirtyEggs),
          crackedEggs: number(crackedEggs), floorEggs: number(floorEggs),
          rejectedEggs: number(rejectedEggs),
          averageEggWeightG: averageEggWeightG ? number(averageEggWeightG) : null,
          notes,
          grades: gradeOrder.map((grade) => ({ grade, quantity: number(grades[grade]) })),
        }),
      }));
      setMessage(savedCollection.withdrawalBlocked
        ? "Collection recorded, but the eggs are not saleable. All graded lots from this collection were condemned because the flock was inside a medication withdrawal period. Any cartons using these eggs were also condemned."
        : "Collection saved. Graded egg lots have been added to inventory and recorded in the stock ledger.");
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save egg collection.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="shell">
    <header className="topbar"><div className="brand"><div><h1>Egg production</h1><p>Daily collection, grading and traceable egg stock.</p></div><span className="badge">LAYER WORKSPACE</span></div></header>
    <Nav/>
    <main className="main">
      <section className="dashboard-head">
        <div><div className="hero-kicker">Layer operations</div><h2>Today's egg round</h2><p>Record each flock once. Reconciled grades become traceable inventory automatically.</p></div>
        <div className="header-actions"><a className="button" href="/batches">Manage flocks</a><a className="button button-primary" href="/inventory">View egg inventory</a></div>
      </section>

      {error && <section className="section card" role="alert"><strong>Could not complete that action</strong><p>{error}</p></section>}
      {message && <section className="section card" role="status"><strong>{message}</strong><p>Product cost basis is not automatically estimated. Configure prices and complete layer feed/overhead allocation before using margin reports.</p></section>}

      <section className="section dashboard-grid">
        <div className="card metric-card"><div className="metric-label">Active layer flocks</div><div className="metric-value">{activeLayerBatches.length}</div><div className="metric-foot">flocks currently laying or being managed</div></div>
        <div className="card metric-card"><div className="metric-label">Live layer birds</div><div className="metric-value">{totalHens.toLocaleString()}</div><div className="metric-foot">latest recorded count across active layer flocks</div></div>
        <div className="card metric-card"><div className="metric-label">Eggs collected</div><div className="metric-value">{selectedDayEggs.toLocaleString()}</div><div className="metric-foot">{date} · all layer flocks</div></div>
        <div className="card metric-card"><div className="metric-label">Hen-day production</div><div className="metric-value">{henDayRate == null ? "—" : henDayRate.toFixed(1) + "%"}</div><div className="metric-foot">{henDayRate == null ? (layingHens === 0 ? "No flocks at laying stage" : `Collection missing for ${missingLayerCollections} laying flock(s)`) : "total eggs divided by live hens in laying-stage flocks"}</div></div>
        <div className="card metric-card"><div className="metric-label">Saleable rate</div><div className="metric-value">{selectedDaySaleableRate == null ? "—" : selectedDaySaleableRate.toFixed(1) + "%"}</div><div className="metric-foot">{selectedDaySaleable.toLocaleString()} saleable of {selectedDayEggs.toLocaleString()} eggs</div></div>
        <div className="card metric-card"><div className="metric-label">Non-saleable eggs</div><div className="metric-value">{selectedDayRows.length && missingLayerCollections === 0 ? selectedDayNonSaleable.toLocaleString() : "—"}</div><div className="metric-foot">{missingLayerCollections > 0 ? `${missingLayerCollections} laying flock collection(s) missing` : selectedDayWithdrawalCondemned > 0 ? `${selectedDayWithdrawalCondemned.toLocaleString()} condemned under withdrawal` : "Dirty, cracked, floor and rejected"}</div></div>
      </section>

      <section className="section card">
        <div className="section-head">
          <div><div className="hero-kicker">Production insight</div><h3>Seven-day egg production</h3><p>Window ending {date}. Rates use only complete, reconciled collections and their recorded live-hen counts.</p></div>
          <div><strong>{trendTotalEggs.toLocaleString()} eggs</strong><p className="muted">total recorded in window</p></div>
        </div>
        <div className="layer-trend" role="group" aria-label="Daily egg collection for the seven days ending on the selected date">
          {trendDays.map((day) => {
            const height = day.eggs > 0 ? Math.max(5, (day.eggs / trendMaxEggs) * 100) : 0;
            const label = new Date(Number(day.date.slice(0,4)), Number(day.date.slice(5,7))-1, Number(day.date.slice(8,10))).toLocaleDateString(undefined, { weekday: "short" });
            return <div className="layer-trend-day" key={day.date} aria-label={`${day.date}: ${day.eggs} eggs`}>
              <strong className="layer-trend-count">{day.eggs > 0 ? day.eggs.toLocaleString() : "—"}</strong>
              <div className="layer-trend-track"><div className="layer-trend-bar" style={{ height: `${height}%` }}/></div>
              <span className="layer-trend-label">{label}</span>
            </div>;
          })}
        </div>
        <div className="layer-trend-table">
          <div className="layer-trend-table-head"><span>Day</span><span>Hen-day</span><span>Saleable</span><span>Coverage</span></div>
          {trendDays.map((day) => <div className="layer-trend-table-row" key={day.date}>
            <strong>{day.date}</strong>
            <span>{day.henDayRate == null ? "—" : day.henDayRate.toFixed(1) + "%"}</span>
            <span>{day.saleableRate == null ? "—" : day.saleableRate.toFixed(1) + "%"}</span>
            <span>{day.layingFlocks === 0 ? "No lay flocks" : day.missing > 0 ? `${day.missing} missing` : `${day.layingFlocks}/${day.layingFlocks} flocks`}</span>
          </div>)}
        </div>
        <p className="muted">A dash means no complete denominator or no production record. The app does not replace missing flock counts or collections with estimates.</p>
      </section>

      <section className="section card">
        <div className="section-head"><div><div className="hero-kicker">Fast capture</div><h3>{selectedCollection ? "Edit daily collection" : "Record a flock collection"}</h3><p>Enter the egg outcomes, then split saleable eggs by size. A saved flock/date opens with its recorded values so you can make a controlled correction.</p></div><span className="badge">ONE ENTRY</span></div>
        {loading ? <div className="empty">Loading layer flocks and collections…</div> : layerBatches.length === 0 ? <div className="empty"><strong>No layer flocks yet</strong><span>Create a flock and set its production type to Layer. Broiler flocks stay in the meat-production workflow.</span><p><a href="/batches" className="button button-primary">Create a layer flock</a></p></div> : <div className="form">
          <div className="card form">
            <div className="section-head"><div><h3>Flock lifecycle stage</h3><p>Egg collection is enabled only when the flock is in the Laying stage.</p></div><span className="badge">{selectedBatch?.layerStage ? selectedBatch.layerStage.replaceAll("_", " ") : "STAGE NOT SET"}</span></div>
            <label>Layer flock
              <select value={batchId} onChange={(event) => selectLayerBatch(event.target.value)} required>
                <option value="">Select a layer flock</option>
                {layerBatches.map((batch) => <option key={batch.id} value={batch.id}>{batch.name} · {batch.layerStage ? batch.layerStage.replaceAll("_", " ").toLowerCase() : "stage not set"} · {liveHens(batch).toLocaleString()} birds</option>)}
              </select>
            </label>
            {!selectedBatch ? <p className="muted">Select a flock to manage its lifecycle stage.</p> : <form className="form grid2" onSubmit={changeStage}>
              <label>Next stage<select value={nextStage} onChange={(event) => setNextStage(event.target.value)} required>
                {allowedNextStages.map((stage) => <option key={stage} value={stage}>{stage.replaceAll("_", " ")}</option>)}
              </select></label>
              <label>Reason<input value={stageReason} onChange={(event) => setStageReason(event.target.value)} placeholder="Optional transition reason"/></label>
              <label style={{gridColumn:"1 / -1"}}>Notes<input value={stageNotes} onChange={(event) => setStageNotes(event.target.value)} placeholder="Optional stage notes"/></label>
              <button className="button" type="submit" disabled={stageSaving || allowedNextStages.length === 0}>{stageSaving ? "Saving stage…" : "Update flock stage"}</button>
            </form>}
            {stageError && <p className="notice" role="alert">{stageError}</p>}
            {stageMessage && <p className="notice" role="status">{stageMessage}</p>}
            {stageHistory.length > 0 && <div className="section">
              <h4>Stage history</h4>
              <div className="list">
                {stageHistory.slice(0, 6).map((event) => <div className="row" key={event.id}>
                  <div><strong>{event.fromStage ? event.fromStage.replaceAll("_", " ") + " → " : "Started at "}{event.toStage.replaceAll("_", " ")}</strong><span>{new Date(event.date).toLocaleDateString()}{event.reason ? " · " + event.reason : ""}</span>{event.notes && <span>{event.notes}</span>}</div>
                </div>)}
              </div>
            </div>}
          </div>
          {stageOnCollectionDate !== "LAYING" && <div className="card"><strong>Egg collection is locked for this flock and date.</strong><p className="muted">The selected date must fall within the flock's Laying stage. Historical collections can still be corrected when the flock has since moved to Spent or Closed.</p></div>}
          <form className="form" onSubmit={submit}>
          <div className="grid2">
            <label>Collection date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} required/></label>
            <label>Live hens on this date<input type="number" min="1" step="1" value={liveHensOnDate} onChange={(event) => setLiveHensOnDate(event.target.value)} required/><span className="muted">{date === localToday() ? "Today's latest flock count is prefilled. Confirm it before saving." : "Historical dates start blank so today's bird count is not accidentally used for an earlier date. Enter the actual live hens for that day."}</span></label>
          </div>
          <div className="section-head"><div><h3>Egg outcome</h3><p>Use exclusive categories so every egg is counted once.</p></div><strong>{currentTotal.toLocaleString()} total eggs</strong></div>
          <div className="grid">
            <label>Saleable eggs<input type="number" min="0" step="1" value={saleableEggs} onChange={(event) => updateSaleable(event.target.value)}/></label>
            <label>Dirty eggs<input type="number" min="0" step="1" value={dirtyEggs} onChange={(event) => setDirtyEggs(event.target.value)}/></label>
            <label>Cracked / broken<input type="number" min="0" step="1" value={crackedEggs} onChange={(event) => setCrackedEggs(event.target.value)}/></label>
            <label>Floor eggs<input type="number" min="0" step="1" value={floorEggs} onChange={(event) => setFloorEggs(event.target.value)}/></label>
          </div>
          <div className="grid2">
            <label>Other rejected eggs<input type="number" min="0" step="1" value={rejectedEggs} onChange={(event) => setRejectedEggs(event.target.value)}/></label>
            <label>Average egg weight (g), optional<input type="number" min="0.1" step="0.1" value={averageEggWeightG} onChange={(event) => setAverageEggWeightG(event.target.value)} placeholder="Sample average"/></label>
          </div>
          <div className="section-head"><div><h3>Saleable egg grades</h3><p>Ungraded is used until eggs are sized. Grade totals must equal saleable eggs.</p></div><strong>{gradeTotal.toLocaleString()} / {number(saleableEggs).toLocaleString()}</strong></div>
          <div className="grid">
            {gradeOrder.map((grade) => <label key={grade}>{gradeLabels[grade]}
              <input type="number" min="0" step="1" value={grades[grade]} onChange={(event) => setGrades((current) => ({ ...current, [grade]: event.target.value }))}/>
            </label>)}
          </div>
          {gradeTotal !== number(saleableEggs) && <p className="notice" role="status">Grade totals are {Math.abs(gradeTotal - number(saleableEggs))} eggs {gradeTotal > number(saleableEggs) ? "over" : "short"}. Correct the grades before saving.</p>}
          <label>Notes, optional<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} placeholder="Collection rounds, nest issues, unusual eggs or observations"/></label>
          <button className="button button-primary" type="submit" disabled={!canSave}>{saving ? "Saving collection…" : selectedCollection ? "Update collection and stock" : "Save collection and update stock"}</button>
          </form>
        </div>}
      </section>

      <section className="section">
        <div className="section-head"><div><div className="hero-kicker">Traceable production</div><h3>Recent egg collections</h3><p>Each grade links to an inventory lot. Sales and stock changes remain in the shared inventory ledger.</p></div><span className="badge">{collections.length} RECORDS</span></div>
        {loading ? <div className="card empty">Loading collections…</div> : collections.length === 0 ? <div className="card empty"><strong>No egg collections recorded</strong><span>Your first saved collection will appear here.</span></div> : <div className="list">{collections.map((row) => <article className="card" key={row.id}>
          <div className="section-head"><div><strong>{row.batch.name}</strong><p>{new Date(Number(row.date.slice(0,4)), Number(row.date.slice(5,7))-1, Number(row.date.slice(8,10))).toLocaleDateString()} · {number(row.totalEggs).toLocaleString()} eggs · {number(row.liveHens).toLocaleString()} live hens</p></div><span className={row.withdrawalBlocked ? "badge badge-danger" : "badge"}>{row.withdrawalBlocked ? "WITHDRAWAL HOLD · NOT FOR SALE" : number(row.saleableEggs).toLocaleString() + " SALEABLE"}</span></div>
          <div className="stats">
            <div><span>Dirty</span><strong>{number(row.dirtyEggs).toLocaleString()}</strong></div>
            <div><span>Cracked</span><strong>{number(row.crackedEggs).toLocaleString()}</strong></div>
            <div><span>Floor</span><strong>{number(row.floorEggs).toLocaleString()}</strong></div>
            <div><span>Rejected</span><strong>{number(row.rejectedEggs).toLocaleString()}</strong></div>
          </div>
          <div className="flow" style={{ marginTop: 14 }}>
            {row.grades.filter((grade) => grade.quantity > 0).map((grade) => <span key={grade.grade}>{gradeLabels[grade.grade]}: {grade.quantity.toLocaleString()}</span>)}
          </div>
          {row.withdrawalBlocked && <p className="notice notice-danger" role="alert">These eggs were collected during a recorded medicine withdrawal period and are permanently marked non-saleable. {row.withdrawalNotes || ""}</p>}
          {row.notes && <p className="muted">{row.notes}</p>}
        </article>)}</div>}
      </section>
    </main>
  </div>;
}
