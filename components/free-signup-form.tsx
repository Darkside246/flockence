"use client";

import Link from "next/link";
import type { CaptchaMode } from "@/lib/signup-captcha";
import { useAccountCaptcha } from "@/components/account-captcha";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

export function FreeSignupForm({ captchaSiteKey, captchaMode }: { captchaSiteKey: string; captchaMode: CaptchaMode }) {
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
  const captcha = useAccountCaptcha(captchaSiteKey, captchaMode, "free_signup");

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
    if (busy || (!token && !captcha.ready)) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/free-signup", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(token ? { action: "finish", token, ownerName, farmName, password } : { action: "send", email, captchaToken: await captcha.responseToken() }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Signup is temporarily unavailable.");
      if (token) router.replace("/farm-setup");
      else {
        captcha.reset();
        captcha.clearWidget();
        setSent(true);
      }
    } catch (failure) {
      if (!token) captcha.reset();
      setError(failure instanceof Error ? failure.message : "Could not complete signup.");
    } finally {
      setBusy(false);
    }
  }

  return <main id="main" tabIndex={-1} className="auth-shell"><section className="auth-card">
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
        {captcha.widget}
      </>}
      {error && <p className="auth-message auth-error" role="alert">{error}</p>}
      <button type="submit" className="button button-primary" disabled={busy || (!token && !captcha.ready)}>{busy ? "Please wait…" : token ? "Create my account" : "Send verification link"}</button>
    </form>}
    <p className="auth-links"><Link href="/login">Sign in</Link>{(token || sent) && <> · <button type="button" onClick={() => { setToken(""); setSent(false); setError(""); setPassword(""); }}>Request another link</button></>}</p>
  </section></main>;
}
