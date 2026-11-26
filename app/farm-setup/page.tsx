"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Nav } from "@/components/nav";
import { useSession } from "@/components/auth-gate";
import { barbadosParishes, operationLabels, housingLabels, setupLayerStages, type FarmSetup, type SetupPen, type SetupFlock } from "@/lib/farm-setup";
import "./setup.css";

const stages = ["Your farm", "Location", "Housing", "Flocks", "Review"];
const initial: FarmSetup = { name: "", operation: "", country: "Barbados", parish: "", community: "", unit: "ft", pens: [], flocks: [] };

export default function FarmSetupPage() {
  const session = useSession();
  const [profile, setProfile] = useState(initial);
  const [existingPens, setExistingPens] = useState<{ id: string; name: string }[]>([]);
  const availablePens = [...existingPens, ...profile.pens.filter((pen) => !existingPens.some(({ id }) => id === pen.id))];
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [finished, setFinished] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const request = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/farm-setup", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const data = await response.json();
        setProfile(data.draft ?? data.profile);
        setExistingPens(data.existingPens ?? []);
      })
      .catch(() => { if (!controller.signal.aborted) setLoadError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [retry]);

  useEffect(() => { if (step > 0 || finished) heading.current?.focus(); }, [step, finished]);

  function change<K extends keyof FarmSetup>(key: K, value: FarmSetup[K]) {
    setProfile((current) => ({ ...current, [key]: value }));
    setMessage("");
  }

  async function save(mode: "draft" | "finish", advance = false) {
    if (request.current) return;
    request.current = true;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/farm-setup", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, profile }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "Could not save your setup. Please try again.");
      if (mode === "finish") setFinished(true);
      else if (advance) setStep((value) => value + 1);
      else setMessage("Progress saved. You can return from Settings.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save your setup.");
    } finally {
      request.current = false;
      setSaving(false);
    }
  }

  function updatePen(id: string, values: Partial<SetupPen>) {
    setProfile((current) => ({ ...current, pens: current.pens.map((pen) => pen.id === id ? { ...pen, ...values } : pen) }));
  }

  function addPen(copy?: SetupPen) {
    const id = crypto.randomUUID();
    setProfile((current) => ({ ...current, pens: [...current.pens, copy
      ? { ...copy, id, name: "", occupants: null, status: "EMPTY" }
      : { id, name: "", length: 0, width: 0, unit: current.unit, housingMode: "OPEN_SIDED_HOT", status: "EMPTY", capacity: null, occupants: null, notes: "" }] }));
  }

  function addFlock() {
    const id = crypto.randomUUID();
    setProfile((current) => ({
      ...current,
      flocks: [...current.flocks, {
        id, name: "", birds: 0, productionType: current.operation === "LAYER" ? "LAYER" : "BROILER",
        layerStage: null, breed: "", approximateAgeWeeks: null, placementDate: "", penId: "",
      }],
    }));
  }

  function updateFlock(id: string, fields: Partial<SetupFlock>) {
    setProfile((current) => ({ ...current, flocks: current.flocks.map((flock) => flock.id === id ? { ...flock, ...fields } : flock) }));
  }

  function next(event: FormEvent) {
    event.preventDefault();
    if (step === 0 && (profile.name.trim().length < 2 || !profile.operation)) {
      setError("Enter a farm name and choose a production type.");
      return;
    }
    void save(step === 4 ? "finish" : "draft", step < 4);
  }

  return <div className="shell">
    <Nav />
    <main className="main farm-setup">
      <header className="setup-banner">
        <div><Link href="/settings">Back to Settings</Link><h1>Set up your farm</h1>
          <p>Choose how you raise poultry and how you prefer to measure.</p></div>
        <div className="setup-photo theme-photo theme-photo-housing" aria-hidden="true" />
      </header>
      {loading ? <section className="card setup-panel" aria-busy="true"><p>Loading farm profile…</p></section>
        : loadError ? <section className="card setup-panel"><p role="alert">{session?.role === "OWNER" || session?.role === "MANAGER" ? "We couldn’t load your farm profile." : "A farm owner or manager can set up this farm."}</p><button type="button" className="button" onClick={() => { setLoadError(false); setLoading(true); setRetry(retry + 1); }}>Try again</button></section>
        : finished ? <section className="card setup-panel"><h2 ref={heading} tabIndex={-1}>Your farm profile is saved</h2><p>Your setup records are available in Pens and Flocks.</p><div className="setup-actions"><Link href="/" className="button button-primary">Go to dashboard</Link><Link href="/pens" className="button">Manage pens</Link><Link href="/batches" className="button">Manage flocks</Link></div></section>
        : <form className="card setup-panel" onSubmit={next}>
          <ol className="setup-stages" aria-label="Setup steps">{stages.map((stage, index) => <li key={stage} aria-current={index === step ? "step" : undefined}>{stage}</li>)}</ol>
          <h2 ref={heading} tabIndex={-1}>{["Tell us about your farm", "Where is your farm located?", "Set up your poultry housing", "What birds are you raising?", "Review your farm profile"][step]}</h2>
          <fieldset disabled={saving}>
            {step === 0 && <>
              <label>Farm name<input required maxLength={120} value={profile.name} onChange={(event) => change("name", event.target.value)} /></label>
              <fieldset className="setup-choices"><legend>What type of poultry do you manage?</legend>{Object.entries(operationLabels).map(([value, label]) => <label key={value} className="setup-choice"><input type="radio" name="operation" checked={profile.operation === value} onChange={() => change("operation", value as FarmSetup["operation"])} required />{label}</label>)}</fieldset>
              <label>Preferred measurements<select value={profile.unit} onChange={(event) => change("unit", event.target.value as FarmSetup["unit"])}><option value="ft">Feet</option><option value="m">Metres</option></select></label>
            </>}
            {step === 1 && <>
              <p>Location is optional. You can share just your country or parish, or leave it blank.</p>
              <label>Country<input maxLength={80} value={profile.country} onChange={(event) => setProfile({ ...profile, country: event.target.value, parish: "" })} /></label>
              {profile.country.trim().toLowerCase() === "barbados"
                ? <label>Parish (optional)<select value={profile.parish} onChange={(event) => change("parish", event.target.value)}><option value="">Select a parish</option>{barbadosParishes.map((parish) => <option key={parish}>{parish}</option>)}</select></label>
                : <label>Parish or region (optional)<input maxLength={80} value={profile.parish} onChange={(event) => change("parish", event.target.value)} /></label>}
              <label>District or community (optional)<input maxLength={120} value={profile.community} onChange={(event) => change("community", event.target.value)} /></label>
              <button type="button" className="setup-text-button" onClick={() => setProfile({ ...profile, country: "", parish: "", community: "" })}>Clear location</button>
            </>}
            {step === 2 && <>
              <p>Add any pens you know about. You can leave this step empty and add pens later.</p>
              {profile.pens.map((pen, index) => <fieldset className="setup-pen" key={pen.id}>
                <legend>Pen {index + 1}</legend>
                <label>Pen name<input required maxLength={80} value={pen.name} onChange={(event) => updatePen(pen.id, { name: event.target.value })} /></label>
                <label>Housing type<select value={pen.housingMode} onChange={(event) => updatePen(pen.id, { housingMode: event.target.value as SetupPen["housingMode"] })}>{Object.entries(housingLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
                <div className="setup-pen-grid">
                  <label>Length<input required type="number" min="0.01" max="10000" step="any" value={pen.length || ""} onChange={(event) => updatePen(pen.id, { length: Number(event.target.value) })} /></label>
                  <label>Width<input required type="number" min="0.01" max="10000" step="any" value={pen.width || ""} onChange={(event) => updatePen(pen.id, { width: Number(event.target.value) })} /></label>
                  <label>Units<select value={pen.unit} onChange={(event) => updatePen(pen.id, { unit: event.target.value as SetupPen["unit"] })}><option value="ft">Feet</option><option value="m">Metres</option></select></label>
                </div>
                <output className="setup-area">Floor area: {(pen.length * pen.width).toLocaleString(undefined, { maximumFractionDigits: 2 })} {pen.unit === "ft" ? "sq ft" : "m²"}</output>
                <div className="setup-pen-grid">
                  <label>Status<select value={pen.status} onChange={(event) => updatePen(pen.id, { status: event.target.value as SetupPen["status"] })}><option value="ACTIVE">Active</option><option value="EMPTY">Empty</option><option value="MAINTENANCE">Under maintenance</option><option value="INACTIVE">Inactive</option></select></label>
                  <label>Estimated capacity (optional)<input type="number" min="0" max="1000000" value={pen.capacity ?? ""} onChange={(event) => updatePen(pen.id, { capacity: event.target.value === "" ? null : Number(event.target.value) })} /></label>
                  <label>Current birds (optional)<input type="number" min="0" max="1000000" value={pen.occupants ?? ""} onChange={(event) => updatePen(pen.id, { occupants: event.target.value === "" ? null : Number(event.target.value) })} /></label>
                </div>
                <p>Floor area is a measurement. Enter your own capacity estimate. Bird numbers here describe occupancy only.</p>
                <label>Notes (optional)<textarea maxLength={500} value={pen.notes} onChange={(event) => updatePen(pen.id, { notes: event.target.value })} /></label>
                <div className="setup-actions"><button type="button" className="button" disabled={profile.pens.length >= 30} onClick={() => addPen(pen)}>Duplicate pen</button><button type="button" className="setup-text-button" onClick={() => setProfile((current) => ({ ...current, pens: current.pens.filter((item) => item.id !== pen.id), flocks: current.flocks.map((flock) => flock.penId === pen.id ? { ...flock, penId: "" } : flock) }))}>Remove pen</button></div>
              </fieldset>)}
              <button type="button" className="button" disabled={profile.pens.length >= 30} onClick={() => addPen()}>Add a pen</button>
            </>}
            {step === 3 && <>
              <p>Add one group for each flock. These starting counts will appear on your dashboard. You can skip this step if you have no birds yet.</p>
              {profile.flocks.map((flock, index) => <fieldset key={flock.id} className="setup-pen">
                <legend>Flock {index + 1}</legend>
                <label>Flock name<input required maxLength={80} value={flock.name} onChange={(event) => updateFlock(flock.id, { name: event.target.value })} /></label>
                <div className="setup-pen-grid">
                  <label>Production type<select value={flock.productionType} onChange={(event) => updateFlock(flock.id, { productionType: event.target.value as SetupFlock["productionType"], layerStage: null })}><option value="BROILER">Broilers</option><option value="LAYER">Layers</option></select></label>
                  <label>Starting live birds<input required type="number" min="1" max="1000000" value={flock.birds || ""} onChange={(event) => updateFlock(flock.id, { birds: Number(event.target.value) })} /></label>
                  <label>Initial pen (optional)<select value={flock.penId} onChange={(event) => updateFlock(flock.id, { penId: event.target.value })}><option value="">Unassigned</option>{availablePens.map((pen) => <option key={pen.id} value={pen.id}>{pen.name}</option>)}{flock.penId && !availablePens.some((pen) => pen.id === flock.penId) && <option value={flock.penId}>Pen no longer available</option>}</select></label>
                </div>
                {flock.productionType === "LAYER" && <label>Current laying stage<select required value={flock.layerStage ?? ""} onChange={(event) => updateFlock(flock.id, { layerStage: (event.target.value || null) as SetupFlock["layerStage"] })}><option value="">Choose a stage</option>{Object.entries(setupLayerStages).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
                <div className="setup-pen-grid">
                  <label>Breed (optional)<input maxLength={80} value={flock.breed} onChange={(event) => updateFlock(flock.id, { breed: event.target.value })} /></label>
                  <label>Approximate age in weeks (optional)<input type="number" min="0" max="520" value={flock.approximateAgeWeeks ?? ""} onChange={(event) => updateFlock(flock.id, { approximateAgeWeeks: event.target.value === "" ? null : Number(event.target.value) })} /></label>
                  <label>Placement date (optional)<input type="date" value={flock.placementDate} onChange={(event) => updateFlock(flock.id, { placementDate: event.target.value })} /></label>
                </div>
                <button type="button" className="setup-text-button" onClick={() => setProfile((current) => ({ ...current, flocks: current.flocks.filter((item) => item.id !== flock.id) }))}>Remove flock</button>
              </fieldset>)}
              <button type="button" className="button" disabled={profile.flocks.length >= 30} onClick={addFlock}>Add a flock</button>
            </>}
            {step === 4 && <dl className="setup-summary">
              <div><dt>Farm name</dt><dd>{profile.name}</dd></div>
              <div><dt>Production</dt><dd>{profile.operation ? operationLabels[profile.operation] : "Not selected"}</dd></div>
              <div><dt>Location</dt><dd>{[profile.community, profile.parish, profile.country].filter(Boolean).join(", ") || "Not shared"}</dd></div>
              <div><dt>Pens to add</dt><dd>{profile.pens.length ? profile.pens.map((pen) => pen.name + " · " + pen.length + " × " + pen.width + " " + pen.unit).join("; ") : "None"}</dd></div>
              <div><dt>Flocks to add</dt><dd>{profile.flocks.length ? profile.flocks.map((flock) => flock.name + " · " + flock.birds + " birds").join("; ") : "None"}</dd></div>
              <div><dt>Starting birds</dt><dd>{profile.flocks.reduce((total, flock) => total + flock.birds, 0).toLocaleString()}</dd></div>
              <div><dt>Measurements</dt><dd>{profile.unit === "ft" ? "Feet" : "Metres"}</dd></div>
            </dl>}
          </fieldset>
          {error && <p role="alert" className="setup-error">{error}</p>}
          {message && <p role="status">{message}</p>}
          <div className="setup-actions">
            {step > 0 && <button type="button" className="button" disabled={saving} onClick={() => { setStep(step - 1); setError(""); }}>Back</button>}
            <button type="button" className="setup-text-button" disabled={saving} onClick={() => void save("draft")}>Save and continue later</button>
            <button type="submit" className="button button-primary" disabled={saving}>{saving ? "Saving…" : step === 4 ? "Finish setting up my farm" : "Continue"}</button>
          </div>
        </form>}
    </main>
  </div>;
}
