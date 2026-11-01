"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Nav } from "@/components/nav";
import { calendarDateInTimeZone } from "@/lib/poultry-metrics.mjs";

type EggGrade = "SMALL" | "MEDIUM" | "LARGE" | "EXTRA_LARGE" | "JUMBO" | "UNGRADED";
type Batch = { id: string; name: string; status: string; productionType?: string | null; species?: string };
type StorageLocation = { id: string; name: string; type: string; active: boolean };
type EggLot = {
  id: string;
  lotCode: string | null;
  product: string;
  grade: EggGrade;
  batchId: string;
  batchName: string;
  collectionDate: string;
  availableEggs: number;
};
type PackInput = { quantityEggs: number; inventoryItem: { lotCode?: string | null; product: { name: string }; batch?: { name: string } | null } };
type PackRun = {
  id: string;
  date: string;
  grade: EggGrade;
  packSize: number;
  packCount: number;
  totalEggs: number;
  packCode: string;
  bestBeforeDate?: string | null;
  batch?: { name: string } | null;
  outputInventoryItem?: { quantity: number | string; status: string; lotCode?: string | null; product: { name: string }; storageLocation?: { name: string } | null } | null;
  inputs: PackInput[];
};
const gradeLabels: Record<EggGrade, string> = {
  SMALL: "Small", MEDIUM: "Medium", LARGE: "Large", EXTRA_LARGE: "Extra large", JUMBO: "Jumbo", UNGRADED: "Ungraded",
};
const gradeOrder: EggGrade[] = ["SMALL", "MEDIUM", "LARGE", "EXTRA_LARGE", "JUMBO", "UNGRADED"];
const localToday = () => calendarDateInTimeZone(new Date()) ?? new Date().toISOString().slice(0, 10);
const whole = (value: string) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value));
const fmtDate = (value: string) => new Date(Number(value.slice(0,4)), Number(value.slice(5,7))-1, Number(value.slice(8,10))).toLocaleDateString();
async function readJson(response: Response) {
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.error || "The request could not be completed.");
  return data;
}

export default function EggPackingPage() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [locations, setLocations] = useState<StorageLocation[]>([]);
  const [lots, setLots] = useState<EggLot[]>([]);
  const [packRuns, setPackRuns] = useState<PackRun[]>([]);
  const [batchId, setBatchId] = useState("");
  const [grade, setGrade] = useState<EggGrade>("LARGE");
  const [date, setDate] = useState(localToday());
  const [packSize, setPackSize] = useState("12");
  const [packCount, setPackCount] = useState("1");
  const [sellingPrice, setSellingPrice] = useState("");
  const [useByDate, setUseByDate] = useState("");
  const [storageLocationId, setStorageLocationId] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [printRun, setPrintRun] = useState<PackRun | null>(null);

  const layerBatches = useMemo(() => batches.filter((batch) =>
    batch.productionType === "LAYER" || String(batch.species || "").toUpperCase() === "LAYER"
  ), [batches]);
  const selectedPackSize = Number(packSize);
  const selectedPackCount = Number(packCount);
  const requiredEggs = selectedPackSize * selectedPackCount;
  const availableEggs = lots.filter((lot) => lot.grade === grade).reduce((sum, lot) => sum + lot.availableEggs, 0);
  const validQuantity = whole(packSize) && selectedPackSize >= 1 && selectedPackSize <= 60
    && whole(packCount) && selectedPackCount >= 1 && selectedPackCount <= 10000;
  const priceMinor = sellingPrice === "" ? null : Math.round(Number(sellingPrice) * 100);
  const validPrice = priceMinor === null || (Number.isSafeInteger(priceMinor) && priceMinor >= 0);
  const canPack = !loading && !saving && validQuantity && validPrice && requiredEggs <= availableEggs && requiredEggs > 0;

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (batchId) params.set("batchId", batchId);
      const [stock, batchRows, locationRows] = await Promise.all([
        fetch("/api/egg-packs" + (params.size ? "?" + params.toString() : ""), { cache: "no-store" }).then(readJson),
        fetch("/api/batches", { cache: "no-store" }).then(readJson),
        fetch("/api/storage-locations", { cache: "no-store" }).then(readJson),
      ]);
      setLots(Array.isArray(stock.lots) ? stock.lots : []);
      setPackRuns(Array.isArray(stock.packRuns) ? stock.packRuns : []);
      setBatches(Array.isArray(batchRows) ? batchRows : []);
      setLocations(Array.isArray(locationRows) ? locationRows.filter((row: StorageLocation) => row.active) : []);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load egg stock.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [batchId]);

  useEffect(() => {
    if (!printRun) return;
    const clearPrintRun = () => setPrintRun(null);
    window.addEventListener("afterprint", clearPrintRun, { once: true });
    window.print();
    return () => window.removeEventListener("afterprint", clearPrintRun);
  }, [printRun]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!canPack) {
      setError(requiredEggs > availableEggs
        ? `Not enough ${gradeLabels[grade].toLowerCase()} eggs. You need ${requiredEggs}, but only ${availableEggs} are available.`
        : "Check pack size, pack count, selling price and available stock.");
      return;
    }
    setSaving(true);
    try {
      const result = await readJson(await fetch("/api/egg-packs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batchId: batchId || null,
          grade,
          date,
          packSize: selectedPackSize,
          packCount: selectedPackCount,
          sellingPriceMinor: priceMinor,
          useByDate: useByDate || null,
          storageLocationId: storageLocationId || null,
          notes,
        }),
      }));
      setMessage(`${result.packCount} cartons recorded. ${result.totalEggs} ${gradeLabels[grade].toLowerCase()} eggs moved into lot ${result.packCode}.`);
      setPackCount("1");
      setNotes("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not pack eggs.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="shell">
    <header className="topbar"><div className="brand"><div><h1>Pack eggs</h1><p>Turn graded eggs into traceable carton inventory.</p></div><span className="badge">LAYER WORKSPACE</span></div></header>
    <Nav/>
    <main className="main">
      <section className="dashboard-head">
        <div><div className="hero-kicker">Layer dispatch preparation</div><h2>Pack and label cartons</h2><p>Flockence consumes the oldest available graded egg lots first and keeps the source lots attached to each carton batch.</p></div>
        <div className="header-actions"><a className="button" href="/layers">Daily egg round</a><a className="button button-primary" href="/inventory">Egg inventory</a></div>
      </section>

      {error && <section className="section card" role="alert"><strong>Could not complete packing</strong><p>{error}</p></section>}
      {message && <section className="section card" role="status"><strong>{message}</strong><p>Carton stock is now available in inventory. Egg input stock and the carton output both have ledger movements.</p></section>}

      <section className="section dashboard-grid">
        <div className="card metric-card"><div className="metric-label">Available grade</div><div className="metric-value">{gradeLabels[grade]}</div><div className="metric-foot">selected egg grade</div></div>
        <div className="card metric-card"><div className="metric-label">Eggs available</div><div className="metric-value">{availableEggs.toLocaleString()}</div><div className="metric-foot">{batchId ? "selected flock only" : "all layer flocks"}</div></div>
        <div className="card metric-card"><div className="metric-label">Eggs needed</div><div className="metric-value">{validQuantity ? requiredEggs.toLocaleString() : "—"}</div><div className="metric-foot">{whole(packCount) ? packCount + " carton(s)" : "enter a valid carton count"}</div></div>
        <div className="card metric-card"><div className="metric-label">Cartons after packing</div><div className="metric-value">{validQuantity ? selectedPackCount.toLocaleString() : "—"}</div><div className="metric-foot">of {whole(packSize) ? selectedPackSize + " eggs each" : "valid pack size required"}</div></div>
      </section>

      <section className="section card">
        <div className="section-head"><div><div className="hero-kicker">Packing run</div><h3>Create a carton lot</h3><p>Choose a grade, carton size and quantity. The pack operation will not oversell available egg stock.</p></div><span className="badge">FIFO LOT PICKING</span></div>
        {loading ? <div className="empty">Loading egg lots and storage locations…</div> : <form className="form" onSubmit={submit}>
          <div className="grid2">
            <label>Source flock
              <select value={batchId} onChange={(event) => setBatchId(event.target.value)}>
                <option value="">Any layer flock (oldest lots first)</option>
                {layerBatches.map((batch) => <option key={batch.id} value={batch.id}>{batch.name} · {batch.status.toLowerCase()}</option>)}
              </select>
            </label>
            <label>Egg grade
              <select value={grade} onChange={(event) => setGrade(event.target.value as EggGrade)}>
                {gradeOrder.map((item) => <option key={item} value={item}>{gradeLabels[item]}</option>)}
              </select>
            </label>
            <label>Packing date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} required/></label>
            <label>Carton size
              <select value={packSize} onChange={(event) => setPackSize(event.target.value)}>
                {[6, 12, 18, 30].map((size) => <option key={size} value={size}>{size} eggs</option>)}
              </select>
            </label>
            <label>Number of cartons<input type="number" min="1" max="10000" step="1" value={packCount} onChange={(event) => setPackCount(event.target.value)} required/></label>
            <label>Selling price per carton (BBD), optional<input type="number" min="0" step="0.01" value={sellingPrice} onChange={(event) => setSellingPrice(event.target.value)} placeholder="Set later in products or now"/></label>
            <label>Storage location<select value={storageLocationId} onChange={(event) => setStorageLocationId(event.target.value)}><option value="">Not assigned</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name} · {location.type}</option>)}</select></label>
            <label>Best-before / review date, optional<input type="date" min={date} value={useByDate} onChange={(event) => setUseByDate(event.target.value)}/></label>
          </div>
          {requiredEggs > availableEggs && validQuantity && <p className="notice" role="status">You are short by {(requiredEggs - availableEggs).toLocaleString()} eggs for this pack run.</p>}
          <label>Notes, optional<textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Packaging batch, quality check, operator or other traceability notes"/></label>
          <button className="button button-primary" type="submit" disabled={!canPack}>{saving ? "Packing cartons…" : "Pack eggs and create inventory lot"}</button>
          <p className="muted">Egg cost allocation and packaging-material consumption are not calculated yet. The carton lot will show an unallocated cost basis instead of inventing a margin.</p>
        </form>}
      </section>

      <section className="section">
        <div className="section-head"><div><div className="hero-kicker">Stock history</div><h3>Recent packing runs</h3><p>Each run records the source egg lots used and the new carton lot produced.</p></div><span className="badge">{packRuns.length} RUNS</span></div>
        {loading ? <div className="card empty">Loading packing history…</div> : packRuns.length === 0 ? <div className="card empty"><strong>No carton runs yet</strong><span>Once you pack eggs, the completed lots will appear here.</span></div> : <div className="list">
          {packRuns.map((run) => <article className="card" key={run.id}>
            <div className="section-head"><div><strong>{run.packCode}</strong><p>{fmtDate(run.date)} · {run.batch?.name || "Mixed / multiple flocks"} · {gradeLabels[run.grade]}</p></div><div className="row" style={{gridTemplateColumns:"auto auto",gap:8,alignItems:"center"}}><span className={run.outputInventoryItem?.status === "CONDEMNED" ? "badge badge-danger" : "badge"}>{run.outputInventoryItem?.status === "CONDEMNED" ? "CONDEMNED · NOT FOR SALE" : run.packCount + " CARTONS"}</span><button className="button" type="button" disabled={run.outputInventoryItem?.status === "CONDEMNED"} onClick={() => setPrintRun(run)}>Print label</button></div></div>
            <div className="stats">
              <div><span>Pack size</span><strong>{run.packSize} eggs</strong></div>
              <div><span>Total eggs</span><strong>{run.totalEggs.toLocaleString()}</strong></div>
              <div><span>Available cartons</span><strong>{Number(run.outputInventoryItem?.quantity ?? 0).toLocaleString()}</strong></div>
              <div><span>Storage</span><strong>{run.outputInventoryItem?.storageLocation?.name || "Not assigned"}</strong></div>
            </div>
            <div className="section">
              <strong>Source lots used</strong>
              <div className="list">
                {run.inputs.map((input) => <div className="row" key={input.inventoryItem.lotCode || input.inventoryItem.product.name}>
                  <div><strong>{input.inventoryItem.lotCode || input.inventoryItem.product.name}</strong><span>{input.inventoryItem.batch?.name || "Batch not assigned"}</span></div>
                  <div><strong>{input.quantityEggs.toLocaleString()} eggs</strong><span>consumed from source lot</span></div>
                </div>)}
              </div>
            </div>
            {run.bestBeforeDate && <p className="muted">Best-before / review date: {fmtDate(run.bestBeforeDate)}</p>}
          </article>)}
        </div>}
      </section>
    </main>
    {printRun && <div className="egg-pack-print-root" aria-label="Carton label">
      <section className="egg-pack-label">
        <div className="egg-pack-label-header"><strong>ALCHEMY FARMS</strong><span>TABLE EGGS</span></div>
        <h1>{printRun.outputInventoryItem?.product.name || "Egg Carton"}</h1>
        <div className="egg-pack-label-meta"><span><strong>Grade</strong>{gradeLabels[printRun.grade]}</span><span><strong>Pack size</strong>{printRun.packSize} eggs</span><span><strong>Cartons</strong>{printRun.packCount}</span></div>
        <div className="egg-pack-label-code">{printRun.packCode}</div>
        <div className="egg-pack-label-footer">
          <span>Packed: {fmtDate(printRun.date)}</span>
          <span>{printRun.bestBeforeDate ? "Best-before / review: " + fmtDate(printRun.bestBeforeDate) : "No best-before date recorded"}</span>
        </div>
        <p>Keep stored under the farm's approved egg-handling conditions.</p>
      </section>
    </div>}
  </div>;
}
