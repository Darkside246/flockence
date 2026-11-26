"use client";

import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { Nav } from "@/components/nav";

const categories = [
  ["PEN", "Pen / housing", "Look for bedding, space, airflow, heat and sanitation issues."],
  ["BIRD", "One bird", "Visible posture, injury, swelling, feather or leg concerns."],
  ["FLOCK", "Whole flock", "Bird distribution, crowding and unusual flock behavior."],
  ["DROPPINGS", "Droppings", "Visible color, consistency or unusual material."],
  ["FEED", "Feed", "Spillage, wet feed, availability and visible condition."],
  ["WATER", "Water", "Availability, cleanliness, leaks and drinker setup."],
  ["EQUIPMENT", "Equipment", "Drinkers, feeders, heat, fans and visible hazards."],
  ["DEAD_BIRD", "Dead bird", "Visible external findings for the mortality record."],
  ["OTHER", "Other", "Anything else you want the inspection to review."],
] as const;

const moneyish = (value: unknown) => String(value ?? "");

type ResearchReport = {
  createdAt: string;
  archives: { archive: string; imageFiles: number; videoFiles: number; annotationFiles: number }[];
  detection?: { averagePrecision: number; images: number };
  segmentation?: { averagePrecision: number; images: number };
  behavior?: { clips: number; accuracy: number; macroF1: number };
};
const score = (ratio: number) => (ratio * 100).toFixed(1) + "%";
type VisionCamera = { name: string; source: "blink" | "rtsp" };
type Batch = { id: string; name: string };
type VisionResult = { summary?: string; confidence?: string; severity?: string; observations?: { title?: string; detail?: string; confidence?: string }[]; concerns?: { title?: string; whyItMatters?: string }[]; checks?: string[]; escalate?: boolean; escalationReason?: string; medicalDisclaimer?: string };
type Assessment = { source: { kind: "UPLOAD" | "CAMERA"; name?: string }; status: string };
type Comparison = { earlier: { at: string; status: string }; later: { at: string; status: string }; changes: { category: string; before: string; after: string; earlierEvidence: string; laterEvidence: string }[] };
const describe = (value: string) => value.toLowerCase().replaceAll("_", " ");
type HistoryRow = { visionAssessment?: Assessment | null; id: string; observedAt: string; imageUrl?: string; notes?: string; category?: string; severity?: string; batchId?: string };

export default function VisionPage() {
  const [category, setCategory] = useState("PEN");
  const [batchId, setBatchId] = useState("");
  const [notes, setNotes] = useState("");
  const [batches, setBatches] = useState<Batch[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [research, setResearch] = useState<{ report: ResearchReport | null } | null>(null);
  const [cameras, setCameras] = useState<VisionCamera[]>([]);
  const [cameraName, setCameraName] = useState("");
  const [shareCamera, setShareCamera] = useState(false);
  const [result, setResult] = useState<VisionResult | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [earlier, setEarlier] = useState("");
  const [later, setLater] = useState("");
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [comparisonError, setComparisonError] = useState("");
  const [comparing, setComparing] = useState(false);
  const comparableHistory = history.filter((item) => item.visionAssessment?.source.kind === "CAMERA");

  async function loadHistory() {
    const r = await fetch("/api/vision", { cache: "no-store" });
    if (r.ok) setHistory(await r.json());
  }

  useEffect(() => {
    fetch("/api/batches", { cache: "no-store" }).then(r => r.json()).then(setBatches).catch(() => setBatches([]));
    loadHistory().catch(() => undefined);
    fetch("/api/vision/cameras", { cache: "no-store" }).then((r) => r.ok ? r.json() : [])
      .then(setCameras).catch(() => setCameras([]));
    fetch("/api/vision/research", { cache: "no-store" }).then((r) => r.ok ? r.json() : null)
      .then(setResearch).catch(() => setResearch(null));
  }, []);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  function pickFile(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.files?.[0] ?? null;
    setFile(next);
    setCameraName("");
    setShareCamera(false);
    setResult(null);
    setMessage("");
    if (next) setPreview(URL.createObjectURL(next));
    else setPreview("");
  }

  async function analyze(event: FormEvent) {
    event.preventDefault();
    if (!file && !cameraName) { setMessage("Add a photo or choose a camera first."); return; }
    if (cameraName && !shareCamera) { setMessage("Confirm that the camera image can be shared for analysis."); return; }
    setBusy(true);
    setMessage("");
    setResult(null);
    const form = new FormData();
    if (cameraName) {
      form.append("camera", cameraName);
      form.append("shareCameraImage", "yes");
    } else if (file) form.append("image", file);
    form.append("category", category);
    form.append("batchId", batchId);
    form.append("notes", notes);
    try {
      const response = await fetch("/api/vision", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not analyze photo.");
      setResult(data.analysis);
      setMessage("Photo analyzed and saved to the farm history.");
      await loadHistory();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not analyze photo.");
    } finally {
      setBusy(false);
    }
  }

  async function compare(event: FormEvent) {
    event.preventDefault();
    setComparison(null);
    setComparisonError("");
    setComparing(true);
    try {
      const query = new URLSearchParams({ earlier, later });
      const response = await fetch("/api/vision/compare?" + query, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not compare inspections.");
      setComparison(data);
    } catch (error) {
      setComparisonError(error instanceof Error ? error.message : "Could not compare inspections.");
    } finally {
      setComparing(false);
    }
  }

  return <div className="shell">
    <header className="topbar"><div className="brand"><div className="brand-main"><div className="brand-mark">F</div><div><h1>Farm Vision</h1><p>See the flock. Find what needs checking.</p></div></div><span className="badge">AI VISION</span></div></header>
    <Nav />
    <main className="main">
      <section className="hero"><div className="hero-kicker">Visual inspection</div><h2>Show Flockence what you see.</h2><p>Take a photo of the pen, birds, feed, water or equipment. Farm Vision looks for visible conditions and gives you practical checks. It does not confirm disease.</p></section>

      <form className="section card" onSubmit={analyze}>
        <div className="section-head"><div><h3>1. What are you photographing?</h3><p>Choose the closest match so the inspection knows what to focus on.</p></div></div>
        <div className="vision-category-grid">{categories.map(([value, title, desc]) => <button type="button" key={value} className={`vision-category ${category === value ? "selected" : ""}`} onClick={() => setCategory(value)}><span className="vision-icon">{value === "PEN" ? "⌂" : value === "BIRD" || value === "FLOCK" ? "◉" : value === "WATER" ? "≈" : value === "FEED" ? "≋" : value === "EQUIPMENT" ? "⚙" : value === "DROPPINGS" ? "•" : value === "DEAD_BIRD" ? "†" : "＋"}</span><strong>{title}</strong><small>{desc}</small></button>)}</div>

        <div className="section-head" style={{ marginTop: 24 }}><div><h3>2. Add the photo</h3><p>On a phone, this can open the camera. Maximum image size: 8 MB.</p></div></div>
        <label className="upload-zone"><input type="file" accept="image/*" capture="environment" onChange={pickFile} /><span className="upload-icon">+</span><strong>{file ? file.name : "Take photo or choose image"}</strong><small>{file ? "Ready for inspection" : "Use a clear photo with good lighting"}</small></label>
        {cameras.length > 0 && <div className="grid2" style={{ marginTop: 18 }}>
          <label>Farm camera<select value={cameraName} onChange={(event) => {
            setCameraName(event.target.value);
            setShareCamera(false);
            setResult(null);
            setMessage("");
            if (event.target.value) { setFile(null); setPreview(""); }
          }}>
            <option value="">Choose a connected camera</option>
            {cameras.map((camera) => <option key={camera.name} value={camera.name}>
              {camera.name} ({camera.source === "blink" ? "Blink" : "Network camera"})
            </option>)}
          </select></label>
          {cameraName && <label><input type="checkbox" checked={shareCamera} onChange={(event) => setShareCamera(event.target.checked)} />
            Send one new camera image to the vision provider for this inspection and save it in farm history.
          </label>}
        </div>}
        {preview && <div className="vision-preview"><img src={preview} alt="Selected poultry inspection" /></div>}

        <div className="grid2" style={{ marginTop: 18 }}><label>Batch<select value={batchId} onChange={e => setBatchId(e.target.value)}><option value="">Farm-wide</option>{batches.map(batch => <option key={batch.id} value={batch.id}>{batch.name}</option>)}</select></label><label>What should the AI know?<input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Example: birds are 24 days old and feed intake dropped" /></label></div>

        <div style={{ marginTop: 18 }}><button className="button button-primary" type="submit" disabled={busy}>{busy ? "Analyzing photo…" : "Check my flock"}</button>{message && <span className="notice">{moneyish(message)}</span>}</div>
      </form>

      {result && <section className="section"><div className="section-head"><div><h3>Inspection result</h3><p>Visible findings only. Review the checks before taking action.</p></div><span className={`pill ${String(result.severity || "LOW").toLowerCase()}`}>{result.severity || "LOW"}</span></div>
        <div className="vision-result-grid">
          <article className="card"><span className="metric-label">Summary</span><p className="result-summary">{result.summary || "No summary returned."}</p><span className="metric-label">Confidence: {result.confidence || "UNKNOWN"}</span></article>
          <article className="card"><h3>What I can see</h3>{result.observations?.length ? <div className="finding-list">{result.observations.map((item, i) => <div className="finding" key={i}><strong>{item.title || "Observation"}</strong><span>{item.detail || ""}</span><small>{item.confidence || "UNKNOWN"} confidence</small></div>)}</div> : <p className="muted">No structured observations returned.</p>}</article>
          <article className="card"><h3>Things to check</h3>{result.checks?.length ? <div className="checklist">{result.checks.map((item, i) => <div key={i}>□ {item}</div>)}</div> : <p className="muted">No follow-up checks returned.</p>}</article>
          <article className="card"> <h3>Possible concerns</h3>{result.concerns?.length ? <div className="finding-list">{result.concerns.map((item, i) => <div className="finding" key={i}><strong>{item.title || "Concern"}</strong><span>{item.whyItMatters || ""}</span></div>)}</div> : <p className="muted">No specific concerns were flagged.</p>}{result.escalate && <div className="alert danger" style={{ marginTop: 14 }}><strong>Consider escalation</strong><p>{result.escalationReason || "Review with qualified animal-health personnel."}</p></div>}</article>
        </div>
        <div className="section card notice-card"><strong>{result.medicalDisclaimer || "Image findings are observations only. They do not confirm disease or cause of death."}</strong></div>
      </section>}

      {research && <section className="section card">
        <div className="section-head"><div><h3>ChickenVerse research</h3><p>Benchmark results for detection, segmentation and behavior recognition.</p></div></div>
        {!research.report ? <p>No research report has been installed.</p> : <>
          <p>Release verified {new Date(research.report.createdAt).toLocaleDateString()}</p>
          <ul>{research.report.archives.map((archive) => <li key={archive.archive}>
            {archive.archive} · {archive.imageFiles.toLocaleString()} images · {archive.videoFiles.toLocaleString()} clips
          </li>)}</ul>
          <dl>
            <dt>Detection AP</dt><dd>{research.report.detection ? score(research.report.detection.averagePrecision) : "Awaiting predictions"}</dd>
            <dt>Segmentation AP</dt><dd>{research.report.segmentation ? score(research.report.segmentation.averagePrecision) : "Awaiting predictions"}</dd>
            <dt>Behavior macro-F1</dt><dd>{research.report.behavior ? score(research.report.behavior.macroF1) : "Awaiting predictions"}</dd>
          </dl>
        </>}
        <a className="action" href="https://doi.org/10.5281/zenodo.20672799">ChickenVerse dataset and license</a>
      </section>}
      {comparableHistory.length >= 2 && <section className="section card">
        <div className="section-head"><div><h3>Compare camera inspections</h3><p>Choose two inspections from the same camera, batch and inspection category.</p></div></div>
        <form onSubmit={compare}>
          <div className="grid2">{[[earlier, setEarlier, "First inspection"], [later, setLater, "Second inspection"]].map((field) => {
            const [value, setter, title] = field as [string, (id: string) => void, string];
            return <label key={title}>{title}<select required value={value} onChange={(event) => {
              setter(event.target.value); setComparison(null); setComparisonError("");
            }}><option value="">Choose a camera inspection</option>{comparableHistory.map((item) =>
              <option key={item.id} value={item.id}>{item.visionAssessment?.source.name} · {new Date(item.observedAt).toLocaleString()}</option>
            )}</select></label>;
          })}</div>
          <button className="button button-primary" type="submit" disabled={comparing || !earlier || !later || earlier === later}>Compare inspections</button>
        </form>
        {comparisonError && <p role="alert">{comparisonError}</p>}
        {comparison && <div aria-live="polite">
          <p>{new Date(comparison.earlier.at).toLocaleString()} to {new Date(comparison.later.at).toLocaleString()}</p>
          {comparison.changes.length ? <ul>{comparison.changes.map((item) => <li key={item.category}>
            <strong>{describe(item.category)}</strong> · {describe(item.before)} → {describe(item.after)}
            <p>Earlier: {item.earlierEvidence}<br />Later: {item.laterEvidence}</p>
          </li>)}</ul> : <p>No category had visible evidence in both inspections.</p>}
        </div>}
      </section>}
      <section className="section"><div className="section-head"><div><h3>Vision history</h3><p>Compare what Flockence has seen over time.</p></div></div>{history.length === 0 ? <div className="card empty">No Farm Vision inspections recorded.</div> : <div className="vision-history">{history.map(item => <article className="card vision-history-item" key={item.id}>{item.imageUrl && <img src={item.imageUrl} alt="Farm Vision inspection" />}<div><span className="badge">{String(item.category || "VISION").replace("VISION:", "")}</span><strong>{new Date(item.observedAt).toLocaleString()}</strong>{item.visionAssessment && <span>Assessment · {describe(item.visionAssessment.status)}</span>}<span>{item.notes?.slice(0, 280) || "No notes recorded."}</span></div></article>)}</div>}</section>
    </main>
  </div>;
}
