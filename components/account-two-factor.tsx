"use client";

import { FormEvent, useEffect, useState } from "react";

type Status = { enabled: boolean; recoveryLeft: number; available: boolean };

/** Account page: switch two-factor sign-in on or off, and get new recovery codes. */
export function AccountTwoFactor() {
  const [status, setStatus] = useState<Status | null>(null);
  const [step, setStep] = useState<"idle" | "password" | "scan" | "codes" | "disable" | "recovery">("idle");
  const [password, setPassword] = useState(""); const [code, setCode] = useState("");
  const [setup, setSetup] = useState<{ secret: string; url: string } | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);

  const load = () => fetch("/api/account/two-factor", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then(setStatus).catch(() => setStatus(null));
  useEffect(() => { void load(); }, []);

  async function post(body: Record<string, string>) {
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/account/two-factor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await r.json().catch(() => null);
      if (!r.ok) throw new Error(data?.error || "That did not work. Try again.");
      return data;
    } catch (e) { setError(e instanceof Error ? e.message : "That did not work."); return null; } finally { setBusy(false); }
  }
  const reset = () => { setPassword(""); setCode(""); setError(""); };

  if (!status || !status.available) return null;

  const begin = async (e: FormEvent) => { e.preventDefault(); const d = await post({ action: "start", password }); if (d) { setSetup(d); reset(); setStep("scan"); } };
  const confirm = async (e: FormEvent) => { e.preventDefault(); const d = await post({ action: "confirm", code }); if (d) { setCodes(d.recovery); reset(); setStep("codes"); void load(); } };
  const disable = async (e: FormEvent) => { e.preventDefault(); const d = await post({ action: "disable", password, code }); if (d) { reset(); setStep("idle"); void load(); } };
  const regenerate = async (e: FormEvent) => { e.preventDefault(); const d = await post({ action: "recovery", password, code }); if (d) { setCodes(d.recovery); reset(); setStep("codes"); void load(); } };
  const pwd = <label>Your password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>;
  const codeField = (label: string) => <label>{label}<input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" inputMode="numeric" maxLength={32} required /></label>;

  return <section className="section card two-factor">
    <div className="section-head"><div><h3>Two-factor sign-in</h3><p>After your password, Flockence also asks for a code from an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, 1Password and others).</p></div>
      <span className={`ds-chip ${status.enabled ? "ok" : "plain"}`}>{status.enabled ? "On" : "Off"}</span></div>

    {step === "idle" && !status.enabled && <button type="button" className="button button-primary" onClick={() => setStep("password")}>Turn on two-factor sign-in</button>}
    {step === "idle" && status.enabled && <>
      <p className="muted">{status.recoveryLeft} recovery code{status.recoveryLeft === 1 ? "" : "s"} left.</p>
      <div className="ds-actions"><button type="button" className="button" onClick={() => setStep("recovery")}>New recovery codes</button><button type="button" className="button" onClick={() => setStep("disable")}>Turn off</button></div>
    </>}

    {step === "password" && <form className="form" onSubmit={begin}>{pwd}<div className="ds-actions"><button className="button button-primary" disabled={busy}>Continue</button><button type="button" className="button" onClick={() => { reset(); setStep("idle"); }}>Cancel</button></div></form>}

    {step === "scan" && setup && <form className="form" onSubmit={confirm}>
      <p>On your phone, <a href={setup.url}>tap here to add Flockence to the app</a>, or in the app choose &quot;enter a setup key&quot; and type this key:</p>
      <p><code className="two-factor-key">{setup.secret.match(/.{1,4}/g)?.join(" ")}</code></p>
      {codeField("Then type the 6-digit code the app shows")}
      <div className="ds-actions"><button className="button button-primary" disabled={busy}>Turn on</button><button type="button" className="button" onClick={() => { reset(); setStep("idle"); }}>Cancel</button></div>
    </form>}

    {step === "codes" && <div className="form">
      <p><strong>Recovery codes.</strong> Each works once if you lose your phone. Write them down or keep them somewhere safe; they will not be shown again.</p>
      <ul className="two-factor-codes">{codes.map((c) => <li key={c}><code>{c}</code></li>)}</ul>
      <div className="ds-actions"><button type="button" className="button button-primary" onClick={() => { setCodes([]); setStep("idle"); }}>I have saved them</button></div>
    </div>}

    {(step === "disable" || step === "recovery") && <form className="form" onSubmit={step === "disable" ? disable : regenerate}>
      {pwd}{codeField("A code from the app, or a recovery code")}
      <div className="ds-actions"><button className="button button-primary" disabled={busy}>{step === "disable" ? "Turn off two-factor sign-in" : "Make new recovery codes"}</button><button type="button" className="button" onClick={() => { reset(); setStep("idle"); }}>Cancel</button></div>
    </form>}
    {error && <p className="notice notice-danger" role="alert">{error}</p>}
  </section>;
}
