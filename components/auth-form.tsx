"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import type { CaptchaMode } from "@/lib/signup-captcha";
import { useAccountCaptcha } from "@/components/account-captcha";

/** "Sign in with Oriya" shows only when this server has been linked to Oriya; otherwise it would only lead to an error. */
function OriyaSignIn() {
  const [available, setAvailable] = useState(false);
  useEffect(() => { fetch("/api/auth/oriya/status", { cache: "no-store" }).then(r => r.ok ? r.json() : null).then(d => setAvailable(Boolean(d?.available))).catch(() => {}); }, []);
  return available ? <div className="auth-links"><a className="button" href="/api/auth/oriya/start">Sign in with Oriya</a></div> : null;
}

function Shell({ children, title, subtitle }: { children: React.ReactNode; title: string; subtitle: string }) {
  return <main className="auth-shell"><section className="auth-card"><div className="auth-brand"><div className="brand-mark">F</div><div><strong>Flockence</strong><span>Intelligent poultry management</span></div></div><div className="auth-heading"><h1>{title}</h1><p>{subtitle}</p></div>{children}</section></main>;
}

function Message({ error, success }: { error: string; success: string }) {
  if (error) return <div className="auth-message auth-error">{error}</div>;
  if (success) return <div className="auth-message auth-success">{success}</div>;
  return null;
}

export function LoginForm({ captchaSiteKey, captchaMode }: { captchaSiteKey: string | null; captchaMode: CaptchaMode }) {
  const captcha = useAccountCaptcha(captchaSiteKey, captchaMode, "login");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState(""); const [loading, setLoading] = useState(false);
  async function submit(e: FormEvent) { e.preventDefault(); if (loading || !captcha.ready) return; setError(""); setLoading(true); try { const r = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, captchaToken: await captcha.responseToken() }) }); const data = await r.json(); if (!r.ok) throw new Error(data.error || "Unable to sign in."); const requested = new URLSearchParams(window.location.search).get("next") || "/"; const destination = new URL(requested, window.location.origin); window.location.assign(destination.origin === window.location.origin ? destination.href : "/"); } catch (err) { setError(err instanceof Error ? err.message : "Unable to sign in."); } finally { captcha.reset(); setLoading(false); } }
  return <Shell title="Welcome back" subtitle="Sign in to manage your flock, pens, health and finances."><form className="form" onSubmit={submit}><label>Email<input type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} required/></label><label>Password<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/></label><Message error={error} success=""/>{captcha.widget}<button className="button button-primary" disabled={loading || !captcha.ready}>{loading ? "Signing in…" : "Sign in"}</button><div className="auth-links"><Link href="/forgot-password">Forgot password?</Link><span>·</span><Link href="/signup">Create account</Link></div><OriyaSignIn/></form></Shell>;
}

export function SignupForm({ captchaSiteKey, captchaMode }: { captchaSiteKey: string | null; captchaMode: CaptchaMode }) {
  const captcha = useAccountCaptcha(captchaSiteKey, captchaMode, "signup");
  const [name,setName]=useState(""); const [email,setEmail]=useState(""); const [password,setPassword]=useState(""); const [confirm,setConfirm]=useState(""); const [inviteCode,setInviteCode]=useState(""); const [error,setError]=useState(""); const [loading,setLoading]=useState(false);
  async function submit(e:FormEvent){e.preventDefault(); if (loading || !captcha.ready) return; setError("");if(password!==confirm){setError("Passwords do not match.");return;}setLoading(true);try{const r=await fetch("/api/auth/signup",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ name,email,password,inviteCode, captchaToken: await captcha.responseToken() })});const data=await r.json();if(!r.ok)throw new Error(data.error||"Unable to create account.");window.location.href="/";}catch(err){setError(err instanceof Error?err.message:"Unable to create account.");}finally{captcha.reset();setLoading(false);}}
  return <Shell title="Create your account" subtitle="Your pen configurations and operational records stay tied to your account."><form className="form" onSubmit={submit}><label>Name<input autoComplete="name" value={name} onChange={e=>setName(e.target.value)} required/></label><label>Email<input type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} required/></label><label>Password<input type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} minLength={8} required/><small className="password-rule">At least 8 characters, one uppercase letter, and one special character.</small></label><label>Confirm password<input type="password" autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)} required/></label><label>Farm setup or invitation code<input type="password" autoComplete="one-time-code" value={inviteCode} onChange={e=>setInviteCode(e.target.value)} placeholder="Enter the code provided by your administrator"/><small className="password-rule">In production, the initial owner uses the farm setup code. Additional staff accounts require an invitation code from the owner or administrator.</small></label><Message error={error} success=""/>{captcha.widget}<button className="button button-primary" disabled={loading || !captcha.ready}>{loading?"Creating account…":"Create account"}</button><div className="auth-links"><span>Already have an account?</span><Link href="/login">Sign in</Link></div></form></Shell>;
}

export function ForgotPasswordForm({ captchaSiteKey, captchaMode }: { captchaSiteKey: string | null; captchaMode: CaptchaMode }) {
  const captcha = useAccountCaptcha(captchaSiteKey, captchaMode, "password_reset");
  const [email,setEmail]=useState(""); const [message,setMessage]=useState(""); const [devLink,setDevLink]=useState(""); const [loading,setLoading]=useState(false); const [error,setError]=useState("");
  async function submit(e:FormEvent){e.preventDefault(); if (loading || !captcha.ready) return; setError("");setMessage("");setDevLink("");setLoading(true);try{const r=await fetch("/api/auth/forgot-password",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ email, captchaToken: await captcha.responseToken() })});const data=await r.json();if(!r.ok)throw new Error(data.error||"Unable to request a reset.");setMessage(data.message||"Check your email for a reset link.");if(data.developmentResetUrl)setDevLink(data.developmentResetUrl);}catch(err){setError(err instanceof Error?err.message:"Unable to request a reset.");}finally{captcha.reset();setLoading(false);}}
  return <Shell title="Reset your password" subtitle="Enter your email and we will send a secure reset link."><form className="form" onSubmit={submit}><label>Email<input type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} required/></label><Message error={error} success={message}/>{devLink&&<div className="auth-message auth-dev"><strong>Local development reset link</strong><a href={devLink}>{devLink}</a></div>}{captcha.widget}<button className="button button-primary" disabled={loading || !captcha.ready}>{loading?"Sending…":"Send reset link"}</button><div className="auth-links"><Link href="/login">Back to sign in</Link></div></form></Shell>;
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [password,setPassword]=useState(""); const [confirm,setConfirm]=useState(""); const [error,setError]=useState(""); const [loading,setLoading]=useState(false);
  async function submit(e:FormEvent){e.preventDefault();setError("");if(password!==confirm){setError("Passwords do not match.");return;}setLoading(true);try{const r=await fetch("/api/auth/reset-password",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token,password})});const data=await r.json();if(!r.ok)throw new Error(data.error||"Unable to reset your password.");window.location.href="/login?reset=1";}catch(err){setError(err instanceof Error?err.message:"Unable to reset your password.");}finally{setLoading(false);}}
  return <Shell title="Choose a new password" subtitle="Your reset link expires after 30 minutes."><form className="form" onSubmit={submit}><label>New password<input type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} minLength={8} required/><small className="password-rule">At least 8 characters, one uppercase letter, and one special character.</small></label><label>Confirm new password<input type="password" autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)} required/></label><Message error={error} success=""/><button className="button button-primary" disabled={loading}>{loading?"Saving…":"Set new password"}</button></form></Shell>;
}
