"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Nav } from "@/components/nav";
import { useSession } from "@/components/auth-gate";
import { barbadosParishes, operationLabels, type FarmSetup } from "@/lib/farm-setup";
import "./setup.css";

const stages = ["Your farm", "Location", "Review"];
const initial: FarmSetup = { name: "", operation: "", country: "Barbados", parish: "", community: "", unit: "ft" };

export default function FarmSetupPage() {
  const session = useSession();
  const [profile, setProfile] = useState(initial);
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

  function next(event: FormEvent) {
    event.preventDefault();
    if (step === 0 && (profile.name.trim().length < 2 || !profile.operation)) {
      setError("Enter a farm name and choose a production type.");
      return;
    }
    void save(step === 2 ? "finish" : "draft", step < 2);
  }

  return <div className="shell">
    <Nav />
    <main className="main farm-setup">
      <header className="setup-banner">
        <div><Link href="/settings">Back to Settings</Link><h1>Set up your farm</h1>
          <p>Choose how you raise poultry and how you prefer to measure.</p></div>
        <div className="setup-photo" aria-hidden="true" />
      </header>
      {loading ? <section className="card setup-panel" aria-busy="true"><p>Loading farm profile…</p></section>
        : loadError ? <section className="card setup-panel"><p role="alert">{session?.role === "OWNER" || session?.role === "MANAGER" ? "We couldn’t load your farm profile." : "A farm owner or manager can set up this farm."}</p><button type="button" className="button" onClick={() => { setLoadError(false); setLoading(true); setRetry(retry + 1); }}>Try again</button></section>
        : finished ? <section className="card setup-panel"><h2 ref={heading} tabIndex={-1}>Your farm profile is saved</h2><p>Add pens and flocks when you’re ready.</p><div className="setup-actions"><Link href="/" className="button button-primary">Go to dashboard</Link><Link href="/pens" className="button">Manage pens</Link><Link href="/batches" className="button">Manage flocks</Link></div></section>
        : <form className="card setup-panel" onSubmit={next}>
          <ol className="setup-stages" aria-label="Setup steps">{stages.map((stage, index) => <li key={stage} aria-current={index === step ? "step" : undefined}>{stage}</li>)}</ol>
          <h2 ref={heading} tabIndex={-1}>{["Tell us about your farm", "Where is your farm located?", "Review your farm profile"][step]}</h2>
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
            {step === 2 && <dl className="setup-summary">
              <div><dt>Farm name</dt><dd>{profile.name}</dd></div>
              <div><dt>Production</dt><dd>{profile.operation ? operationLabels[profile.operation] : "Not selected"}</dd></div>
              <div><dt>Location</dt><dd>{[profile.community, profile.parish, profile.country].filter(Boolean).join(", ") || "Not shared"}</dd></div>
              <div><dt>Measurements</dt><dd>{profile.unit === "ft" ? "Feet" : "Metres"}</dd></div>
            </dl>}
          </fieldset>
          {error && <p role="alert" className="setup-error">{error}</p>}
          {message && <p role="status">{message}</p>}
          <div className="setup-actions">
            {step > 0 && <button type="button" className="button" disabled={saving} onClick={() => { setStep(step - 1); setError(""); }}>Back</button>}
            <button type="button" className="setup-text-button" disabled={saving} onClick={() => void save("draft")}>Save and continue later</button>
            <button type="submit" className="button button-primary" disabled={saving}>{saving ? "Saving…" : step === 2 ? "Save farm profile" : "Continue"}</button>
          </div>
        </form>}
    </main>
  </div>;
}
