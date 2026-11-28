"use client";

import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { Nav } from "@/components/nav";
import { VisionSchedule } from "@/components/vision-schedule";
import { VisionReport } from "@/components/vision-report";
import { VisionFindings } from "@/components/vision-findings";
import { VisionIntelligence } from "@/components/vision-intelligence";
import { PenLayout } from "@/components/pen-layout";
import { VisionKnown } from "@/components/vision-known";
import { useSession } from "@/components/auth-gate";
import { formatBytes } from "@/lib/storage-quota-rules.mjs";
import { shrinkPhoto, sizeLabel } from "@/lib/photo-shrink";
import { OfflineError, queueAvailable, queueCheck, queuedChecks, sendInspection, sendQueued, uploadId } from "@/lib/vision-send";

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
type VisionCamera = { name: string; source: "blink" | "rtsp"; liveSampling?: boolean; pen?: { id: string; name: string } | null };
type Batch = { id: string; name: string };
type VisionResult = { summary?: string; confidence?: string; severity?: string; observations?: { title?: string; detail?: string; confidence?: string }[]; concerns?: { title?: string; whyItMatters?: string }[]; checks?: string[]; escalate?: boolean; escalationReason?: string; medicalDisclaimer?: string };
type Assessment = { capture?: { mode: "VIDEO_SAMPLE"; frames: 3 }; source: { kind: "UPLOAD" | "CAMERA"; name?: string }; status: string; pen?: { id: string; name: string } };
type Comparison = { earlier: { at: string; status: string }; later: { at: string; status: string }; changes: { category: string; before: string; after: string; earlierEvidence: string; laterEvidence: string }[] };
const describe = (value: string) => value.toLowerCase().replaceAll("_", " ");
type HistoryRow = { visionAssessment?: Assessment | null; id: string; observedAt: string; imageUrl?: string; notes?: string; category?: string; severity?: string; batchId?: string };

export default function VisionPage() {
  const [category, setCategory] = useState("PEN");
  const [batchId, setBatchId] = useState("");
  const [penId, setPenId] = useState("");
  const [pens, setPens] = useState<{ id: string; name: string }[]>([]);
  const session = useSession();
  const [notes, setNotes] = useState("");
  const [batches, setBatches] = useState<Batch[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [research, setResearch] = useState<{ report: ResearchReport | null } | null>(null);
  const [cameras, setCameras] = useState<VisionCamera[]>([]);
  const [cameraName, setCameraName] = useState("");
  const [savingAssignment, setSavingAssignment] = useState(false);
  const [assignmentMessage, setAssignmentMessage] = useState("");
  const selectedCamera = cameras.find(camera => camera.name === cameraName);
  const [captureVideo, setCaptureVideo] = useState(false);
  const [shareCamera, setShareCamera] = useState(false);
  const [result, setResult] = useState<VisionResult | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [sizeNote, setSizeNote] = useState("");
  const [queued, setQueued] = useState(0);
  const [usage, setUsage] = useState<{ label: string; manualPerMonth: number; left: number; cameras: boolean; storage?: { used: number; limit: number; percent: number; level: "ok" | "warn" | "full" } } | null>(null);
  const loadUsage = () => fetch("/api/vision/usage", { cache: "no-store" }).then((r) => r.ok ? r.json() : null).then(setUsage).catch(() => undefined);
  const [sendingQueued, setSendingQueued] = useState(false);
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
    loadUsage();
    fetch("/api/vision/pens", { cache: "no-store" }).then((r) => r.ok ? r.json() : [])
      .then(setPens).catch(() => setPens([]));
    fetch("/api/vision/cameras", { cache: "no-store" }).then((r) => r.ok ? r.json() : [])
      .then(setCameras).catch(() => setCameras([]));
    fetch("/api/vision/research", { cache: "no-store" }).then((r) => r.ok ? r.json() : null)
      .then(setResearch).catch(() => setResearch(null));
  }, []);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  // Photos taken with no signal wait on this phone and are sent when it is back online (or when this page opens).
  async function flushQueue() {
    if (!session || sendingQueued || (typeof navigator !== "undefined" && navigator.onLine === false)) return;
    const waiting = await queuedChecks(session.id, session.farmId).catch(() => []);
    setQueued(waiting.length);
    if (!waiting.length) return;
    setSendingQueued(true);
    try {
      const done = await sendQueued(session.id, session.farmId, () => setMessage(`Sending ${waiting.length} saved photo${waiting.length === 1 ? "" : "s"}…`));
      setQueued(done.left);
      if (done.sent || done.failed) {
        setMessage(`${done.sent} saved photo${done.sent === 1 ? "" : "s"} checked and added to the history.${done.failed ? ` ${done.failed} could not be checked.` : ""}${done.left ? ` ${done.left} still waiting.` : ""}`);
        await loadHistory();
      }
    } catch {
      setMessage("Saved photos could not be sent yet; they will be tried again.");
    } finally {
      setSendingQueued(false);
    }
  }

  useEffect(() => {
    if (!session) return;
    flushQueue().catch(() => undefined);
    const online = () => { flushQueue().catch(() => undefined); };
    window.addEventListener("online", online);
    // The service worker sends saved photos in the background (public/sw.js) and says when it has.
    const fromWorker = (event: MessageEvent) => {
      if (event.data?.type !== "vision-queue-sent") return;
      queuedChecks(session.id, session.farmId).then((left) => setQueued(left.length)).catch(() => undefined);
      if (event.data.sent) { setMessage(`${event.data.sent} saved photo${event.data.sent === 1 ? " was" : "s were"} sent and ${event.data.sent === 1 ? "is" : "are"} being checked.`); loadHistory().catch(() => undefined); }
    };
    navigator.serviceWorker?.addEventListener("message", fromWorker);
    return () => { window.removeEventListener("online", online); navigator.serviceWorker?.removeEventListener("message", fromWorker); };
  }, [session?.id]);

  async function pickFile(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0] ?? null;
    setSizeNote("");
    let next = picked;
    if (picked) {
      // Shrink to what the vision model can see (2576 px on the long side): same detail for the model, faster upload.
      setPreparing(true);
      const shrunk = await shrinkPhoto(picked);
      setPreparing(false);
      next = shrunk.file;
      if (shrunk.shrunk) setSizeNote(`Made smaller for upload: ${sizeLabel(shrunk.from)} to ${sizeLabel(shrunk.to)}, full detail for the model.`);
    }
    setFile(next);
    setCameraName("");
    if (cameraName) setPenId("");
    setAssignmentMessage("");
    setShareCamera(false);
    setCaptureVideo(false);
    setResult(null);
    setMessage("");
    if (next) setPreview(URL.createObjectURL(next));
    else setPreview("");
  }

  async function saveAssignment(nextPen: string | null) {
    if (!cameraName || savingAssignment) return;
    setSavingAssignment(true);
    setAssignmentMessage("");
    try {
      const response = await fetch("/api/vision/cameras", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ camera: cameraName, penId: nextPen }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save the camera assignment.");
      setCameras(previous => previous.map(camera => camera.name === cameraName ? { ...camera, pen: data.pen } : camera));
      setAssignmentMessage(data.pen ? "Camera assigned to " + data.pen.name + "." : "Camera assignment removed.");
      if (!data.pen) { setPenId(""); setCaptureVideo(false); }
    } catch (error) {
      setAssignmentMessage(error instanceof Error ? error.message : "Could not save the camera assignment.");
    } finally {
      setSavingAssignment(false);
    }
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
      if (captureVideo) form.append("captureMode", "video-sample");
    } else if (file) form.append("image", file);
    form.append("category", category);
    form.append("batchId", batchId);
    if (penId) form.append("penId", penId);
    form.append("notes", notes);
    // One id for this check, used for every retry, so it is analysed and charged once.
    const id = uploadId();
    // A photo (not a live camera) taken with no signal is kept on this phone and sent later.
    const keepForLater = async () => {
      if (!(file && session && queueAvailable())) return false;
      const fields: Record<string, string> = { category, batchId, notes };
      if (penId) fields.penId = penId;
      await queueCheck({ id, userId: session.id, farmId: session.farmId, createdAt: Date.now(), fields, image: file, imageName: file.name });
      setQueued((n) => n + 1);
      setMessage("No signal. The photo is saved on this phone and will be sent when the signal is back, even if you close Flockence (on iPhone, when you next open it).");
      return true;
    };
    try {
      if (!cameraName && typeof navigator !== "undefined" && navigator.onLine === false && await keepForLater()) return;
      const sent = await sendInspection(form, id, setMessage);
      const data = sent.body as { error?: string; analysis?: VisionResult; repeated?: boolean; pending?: boolean };
      if (data.pending) { setMessage("Still checking this photo. The result will appear in the history below."); return; }
      if (sent.httpStatus >= 300) throw new Error(data.error || "Could not analyze photo.");
      setResult(data.analysis ?? null);
      setMessage(data.repeated ? "The connection dropped, but the inspection was already saved. It was not charged twice." : captureVideo ? "Live video sample analyzed and saved to the farm history." : "Photo analyzed and saved to the farm history.");
      await loadHistory();
      loadUsage();
    } catch (error) {
      if (error instanceof OfflineError && !cameraName && await keepForLater().catch(() => false)) return;
      setMessage(error instanceof OfflineError ? "No connection. Check the signal and try again; the photo will not be charged twice."
        : error instanceof Error ? error.message : "Could not analyze photo.");
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
    <header className="topbar"><div className="brand"><div><h1>Farm Vision</h1><p>See the flock. Find what needs checking. Photograph the pen, birds, feed, water or equipment for visible conditions and practical checks; it does not confirm disease.</p></div><span className="badge">AI VISION</span></div></header>
    <Nav />
    <main id="main" tabIndex={-1} className="main">
      <form className="card vision-check" onSubmit={analyze}>
        <div className="vision-check-main">
        <div className="section-head"><div><h3>1. What are you photographing?</h3><p>Choose the closest match so the inspection knows what to focus on.</p></div></div>
        <div className="vision-category-grid">{categories.map(([value, title, desc]) => <button type="button" key={value} className={`vision-category ${category === value ? "selected" : ""}`} onClick={() => setCategory(value)}><span className="vision-icon">{value === "PEN" ? "⌂" : value === "BIRD" || value === "FLOCK" ? "◉" : value === "WATER" ? "≈" : value === "FEED" ? "≋" : value === "EQUIPMENT" ? "⚙" : value === "DROPPINGS" ? "•" : value === "DEAD_BIRD" ? "†" : "＋"}</span><strong>{title}</strong><small>{desc}</small></button>)}</div>

        <div className="section-head"><div><h3>2. Add the photo</h3><p>On a phone, this can open the camera. Maximum image size: 8 MB.</p></div></div>
        <label className="upload-zone"><input type="file" accept="image/*" capture="environment" onChange={pickFile} /><span className="upload-icon">+</span><strong>{preparing ? "Preparing photo…" : file ? file.name : "Take photo or choose image"}</strong><small>{preparing ? "Making it ready to send" : file ? (sizeNote || "Ready for inspection") : "Use a clear photo with good lighting"}</small></label>
        {preview && <div className="vision-preview"><img src={preview} alt="Selected poultry inspection" /></div>}
        </div>
        <div className="vision-check-side">
        <h3 className="vision-check-title">3. Details</h3>
        {cameras.length > 0 && <div className="vision-check-camera">
          <label>Farm camera<select value={cameraName} disabled={savingAssignment} onChange={(event) => {
            setCameraName(event.target.value);
            setPenId(cameras.find(camera => camera.name === event.target.value)?.pen?.id ?? "");
            setAssignmentMessage("");
            setShareCamera(false);
            setCaptureVideo(false);
            setResult(null);
            setMessage("");
            if (event.target.value) { setFile(null); setPreview(""); }
          }}>
            <option value="">Choose a connected camera</option>
            {cameras.map((camera) => <option key={camera.name} value={camera.name}>
              {camera.name} ({camera.source === "blink" ? "Blink" : "Network camera"})
            </option>)}
          </select></label>
          {selectedCamera?.liveSampling && selectedCamera.pen && <label>Camera inspection type
            <select value={captureVideo ? "video" : "still"} onChange={event => {
              setCaptureVideo(event.target.value === "video");
              setShareCamera(false);
            }}>
              <option value="still">Fresh snapshot</option>
              <option value="video">Short live video sample</option>
            </select>
          </label>}
          {cameraName && <label><input type="checkbox" checked={shareCamera} onChange={(event) => setShareCamera(event.target.checked)} />
            {captureVideo ? "Wake this camera if needed and send three ordered video frames for analysis."
              : "Send one new camera image to the vision provider for this inspection and save it in farm history."}
          </label>}
        </div>}

        <div className="vision-check-fields"><label>Batch<select value={batchId} onChange={e => setBatchId(e.target.value)}><option value="">Farm-wide</option>{batches.map(batch => <option key={batch.id} value={batch.id}>{batch.name}</option>)}</select></label><label>Anything the records do not show?<input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Example: birds went off feed this morning; new litter yesterday" maxLength={2000} /></label></div>
        <VisionKnown category={category} batchId={batchId} penId={penId} />

        {pens.length > 0 && <label>Pen<select value={penId} disabled={savingAssignment} onChange={(event) => setPenId(event.target.value)}>
          <option value="">No pen assigned</option>
          {pens.map((pen) => <option key={pen.id} value={pen.id}>{pen.name}</option>)}
        </select></label>}
        {selectedCamera && <div className="actions vision-assign">
          <button className="button" type="button" disabled={savingAssignment || busy || !penId || selectedCamera.pen?.id === penId} onClick={() => void saveAssignment(penId)}>Save camera assignment</button>
          {selectedCamera.pen && <button className="button" type="button" disabled={savingAssignment || busy} onClick={() => void saveAssignment(null)}>Remove camera assignment</button>}
          {selectedCamera.pen && <span>Assigned to {selectedCamera.pen.name}</span>}
          {assignmentMessage && <span role="status">{assignmentMessage}</span>}
        </div>}
        <div className="vision-submit"><button className="button button-primary" type="submit" disabled={busy || preparing || savingAssignment || Boolean(selectedCamera?.pen && selectedCamera.pen.id !== penId)}>{busy ? (captureVideo ? "Capturing and analyzing…" : "Analyzing photo…") : "Check my flock"}</button>{message && <span className="notice">{moneyish(message)}</span>}</div>
        {usage && <p className="muted vision-usage">{usage.label} plan: {usage.left} of {usage.manualPerMonth} photo checks left this month.{!usage.cameras ? " Camera and automatic checks come with Premium." : ""}{usage.storage ? ` Picture storage: ${formatBytes(usage.storage.used)} of ${formatBytes(usage.storage.limit)}.` : ""}</p>}
        {usage?.storage && usage.storage.level !== "ok" && <p className="notice" role="status">{usage.storage.level === "full" ? "Picture storage is full." : `Picture storage is ${usage.storage.percent}% full.`} Pictures older than 90 days are removed first when it fills up. <a href="/settings/plan">See plans</a></p>}
        {queued > 0 && <p className="notice" role="status">
          {queued} photo{queued === 1 ? "" : "s"} saved on this phone, waiting for a signal.{" "}
          <button type="button" className="button" disabled={sendingQueued} onClick={() => { flushQueue().catch(() => undefined); }}>{sendingQueued ? "Sending…" : "Send now"}</button>
        </p>}
        </div>
      </form>
      {cameras.length > 0 && <VisionSchedule cameras={cameras} />}
      <VisionFindings pens={pens} canReview={session?.role === "OWNER" || session?.role === "MANAGER" || session?.role === "WORKER"} />
      <section className="section" id="reports"><div className="section-head"><div><h3>Reports</h3><p>What Vision found for the whole farm, a pen, a batch{cameras.length ? " or a camera" : ""}, built from the checks already saved. Opening a report costs nothing.</p></div></div>
        <VisionIntelligence cameras={cameras} onVisionPage />
      </section>
      <section className="section" id="layout"><div className="section-head"><div><h3>Pen layout</h3><p>Space, feeders, drinkers and heat for each pen: your records, what the cameras saw, and what to change.</p></div></div>
        <PenLayout pens={pens} />
      </section>

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
        <div className="section-head"><div><h3>Compare camera inspections</h3><p>Choose two inspections from the same camera, pen, batch and inspection category.</p></div></div>
        <form onSubmit={compare}>
          <div className="grid2">{[[earlier, setEarlier, "First inspection"], [later, setLater, "Second inspection"]].map((field) => {
            const [value, setter, title] = field as [string, (id: string) => void, string];
            return <label key={title}>{title}<select required value={value} onChange={(event) => {
              setter(event.target.value); setComparison(null); setComparisonError("");
            }}><option value="">Choose a camera inspection</option>{comparableHistory.map((item) =>
              <option key={item.id} value={item.id}>{item.visionAssessment?.source.name}{item.visionAssessment?.capture ? " · Video sample" : " · Still"} · {new Date(item.observedAt).toLocaleString()}</option>
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
      <section className="section"><div className="section-head"><div><h3>Vision history</h3><p>Compare what Flockence has seen over time.</p></div></div>{history.length === 0 ? <div className="card empty">No Farm Vision inspections recorded.</div> : <div className="vision-history">{history.map(item => <article className="card vision-history-item" key={item.id}>{item.imageUrl && <img src={item.imageUrl} alt="Farm Vision inspection" />}<div><span className="badge">{String(item.category || "VISION").replace("VISION:", "")}</span><strong>{new Date(item.observedAt).toLocaleString()}</strong>{item.visionAssessment && <span>{item.visionAssessment.pen?.name ? item.visionAssessment.pen.name + " · " : ""}{describe(item.visionAssessment.status)}{item.visionAssessment.capture ? " · Video sample (3 frames)" : ""}</span>}{item.notes ? <details className="vision-history-full"><summary>{item.notes.split("\n").find(line => line.startsWith("Summary:"))?.slice(8).trim() || item.notes.slice(0, 160)} <span className="vision-read-more">Read the full report</span></summary>{item.imageUrl && <a href={item.imageUrl} target="_blank" rel="noreferrer" className="vision-full-photo">Open the photo full size</a>}<VisionReport text={item.notes} /></details> : <span>No notes recorded.</span>}</div></article>)}</div>}</section>
    </main>
  </div>;
}
