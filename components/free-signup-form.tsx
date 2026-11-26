"use client";

import Link from "next/link";
import Script from "next/script";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

type Recaptcha = {
  ready?: (callback: () => void) => void;
  render: (element: HTMLElement, options: {
    sitekey: string;
    size: "compact";
    callback: (token: string) => void;
    "expired-callback": () => void;
    "error-callback": () => void;
  }) => number;
  reset: (id: number) => void;
};

function recaptcha() {
  return (window as Window & { grecaptcha?: Recaptcha }).grecaptcha;
}

export function FreeSignupForm({ captchaSiteKey }: { captchaSiteKey: string }) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [farmName, setFarmName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaError, setCaptchaError] = useState("");
  const captchaElement = useRef<HTMLDivElement>(null);
  const captchaWidget = useRef<number | null>(null);

  function captchaUnavailable() {
    setCaptchaToken("");
    setCaptchaError("The security check could not load. Check your connection and refresh this page.");
  }

  function renderCaptcha() {
    const widget = recaptcha();
    if (!captchaElement.current || captchaWidget.current !== null) return;
    if (!widget || typeof widget.render !== "function") {
      captchaUnavailable();
      return;
    }
    try {
      captchaWidget.current = widget.render(captchaElement.current, {
        sitekey: captchaSiteKey,
        size: "compact",
        callback: (response) => { setCaptchaToken(response); setCaptchaError(""); },
        "expired-callback": () => setCaptchaToken(""),
        "error-callback": captchaUnavailable,
      });
    } catch {
      captchaUnavailable();
    }
  }

  function waitForCaptcha() {
    const widget = recaptcha();
    if (typeof widget?.render === "function") renderCaptcha();
    else if (typeof widget?.ready === "function") widget.ready(renderCaptcha);
    else captchaUnavailable();
  }

  function resetCaptcha() {
    if (captchaWidget.current !== null) recaptcha()?.reset(captchaWidget.current);
    setCaptchaToken("");
  }

  useEffect(() => {
    const proof = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
    if (/^[A-Za-z0-9_-]{43}$/.test(proof)) {
      setToken(proof);
      window.history.replaceState(null, "", window.location.pathname);
    }
    setReady(true);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || (!token && !captchaToken)) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/free-signup", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(token ? { action: "finish", token, ownerName, farmName, password } : { action: "send", email, captchaToken }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Signup is temporarily unavailable.");
      if (token) router.replace("/farm-setup");
      else {
        resetCaptcha();
        captchaWidget.current = null;
        setSent(true);
      }
    } catch (failure) {
      if (!token) resetCaptcha();
      setError(failure instanceof Error ? failure.message : "Could not complete signup.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="auth-shell"><section className="auth-card">
    <div className="auth-brand"><div className="brand-mark">F</div><div><strong>Flockence</strong><span>Intelligent poultry management</span></div></div>
    <div className="auth-heading">
      <h1>{token ? "Create your farm account" : sent ? "Check your inbox" : "Start your Free farm"}</h1>
      <p>{token ? "Add your name and choose a password." : sent ? "Open the verification link within 30 minutes." : "Enter your email address to receive a verification link."}</p>
    </div>
    {ready && !sent && <form className="form" onSubmit={submit}>
      {token ? <>
        <label>Your name<input autoComplete="name" required minLength={2} maxLength={120} value={ownerName} onChange={(event) => setOwnerName(event.target.value)} /></label>
        <label>Farm name (optional)<input autoComplete="organization" maxLength={120} value={farmName} onChange={(event) => setFarmName(event.target.value)} /></label>
        <label>Password<input type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      </> : <>
        <label>Email address<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        {captchaSiteKey && <>
          <div ref={captchaElement} />
          <Script src="https://www.google.com/recaptcha/api.js?render=explicit" onReady={waitForCaptcha} onError={captchaUnavailable} />
        </>}
        {(!captchaSiteKey || captchaError) && <p className="auth-message auth-error" role="alert">{captchaError || "Public signup is temporarily unavailable."}</p>}
      </>}
      {error && <p className="auth-message auth-error" role="alert">{error}</p>}
      <button type="submit" className="button button-primary" disabled={busy || (!token && !captchaToken)}>{busy ? "Please wait…" : token ? "Create my account" : "Send verification link"}</button>
    </form>}
    <p className="auth-links"><Link href="/login">Sign in</Link>{(token || sent) && <> · <button type="button" onClick={() => { setToken(""); setSent(false); setError(""); setPassword(""); }}>Request another link</button></>}</p>
  </section></main>;
}
