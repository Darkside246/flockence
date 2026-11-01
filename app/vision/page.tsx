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

type Batch = { id: string; name: string };
type VisionResult = { summary?: string; confidence?: string; severity?: string; observations?: { title?: string; detail?: string; confidence?: string }[]; concerns?: { title?: string; whyItMatters?: string }[]; checks?: string[]; escalate?: boolean; escalationReason?: string; medicalDisclaimer?: string };
type HistoryRow = { id: string; observedAt: string; imageUrl?: string; notes?: string; category?: string; severity?: string; batchId?: string };

export default function VisionPage() {
  const [category, setCategory] = useState("PEN");
  const [batchId, setBatchId] = useState("");
  const [notes, setNotes] = useState("");
  const [batches, setBatches] = useState<Batch[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [result, setResult] = useState<VisionResult | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadHistory() {
    const r = await fetch("/api/vision", { cache: "no-store" });
    if (r.ok) setHistory(await r.json());
  }

  useEffect(() => {
    fetch("/api/batches", { cache: "no-store" }).then(r => r.json()).then(setBatches).catch(() => setBatches([]));
    loadHistory().catch(() => undefined);
  }, []);

  function pickFile(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.files?.[0] ?? null;
    setFile(next);
    setResult(null);
    setMessage("");
    if (next) setPreview(URL.createObjectURL(next));
    else setPreview("");
  }

  async function analyze(event: FormEvent) {
    event.preventDefault();
    if (!file) { setMessage("Add a photo first."); return; }
    setBusy(true);
    setMessage("");
    setResult(null);
    const form = new FormData();
    form.append("image", file);
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

      <section className="section"><div className="section-head"><div><h3>Vision history</h3><p>Compare what Flockence has seen over time.</p></div></div>{history.length === 0 ? <div className="card empty">No Farm Vision inspections recorded.</div> : <div className="vision-history">{history.map(item => <article className="card vision-history-item" key={item.id}>{item.imageUrl && <img src={item.imageUrl} alt="Farm Vision inspection" />}<div><span className="badge">{String(item.category || "VISION").replace("VISION:", "")}</span><strong>{new Date(item.observedAt).toLocaleString()}</strong><span>{item.notes?.slice(0, 280) || "No notes recorded."}</span></div></article>)}</div>}</section>
    </main>
  </div>;
}
