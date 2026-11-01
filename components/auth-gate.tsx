"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

const PUBLIC_PATHS = new Set(["/login", "/signup", "/forgot-password", "/reset-password"]);

export type SessionUser = { id: string; farmId: string; name: string; email: string; role: "OWNER" | "MANAGER" | "WORKER" | "READ_ONLY" };
const LOCAL_DEV_BYPASS = process.env.NODE_ENV === "development";
const LOCAL_DEV_USER: SessionUser = { id: "local-development-owner", farmId: "default-farm", name: "Local Development Owner", email: "dev@flockence.local", role: "OWNER" };
const SessionContext = createContext<SessionUser | null>(null);
export function useSession() { return useContext(SessionContext); }

export function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [state, setState] = useState<"checking" | "ready" | "error">("checking");
  const [user, setUser] = useState<SessionUser | null>(null);
  const isPublicPath = PUBLIC_PATHS.has(pathname);

  useEffect(() => {
    if (LOCAL_DEV_BYPASS) {
      setUser(LOCAL_DEV_USER);
      setState("ready");
      if (isPublicPath) router.replace("/");
      return;
    }

    if (isPublicPath) {
      setUser(null);
      setState("ready");
      return;
    }

    let active = true;
    setState("checking");
    fetch("/api/auth/me", { cache: "no-store" })
      .then(async (response) => {
        if (response.ok) {
          const data = await response.json();
          if (active) {
            setUser(data.user as SessionUser);
            setState("ready");
          }
          return;
        }
        if (response.status === 401 || response.status === 403) {
          const next = pathname && pathname !== "/" ? "?next=" + encodeURIComponent(pathname) : "";
          router.replace("/login" + next);
          return;
        }
        throw new Error("Unable to verify your sign-in. Check your connection and try again.");
      })
      .catch(() => {
        if (active) setState("error");
      });

    return () => { active = false; };
  }, [isPublicPath, pathname, router]);

  if (LOCAL_DEV_BYPASS) {
    if (isPublicPath) return null;
    return <SessionContext.Provider value={LOCAL_DEV_USER}>{children}</SessionContext.Provider>;
  }

  if (isPublicPath) return <>{children}</>;
  if (state === "ready") return <SessionContext.Provider value={user}>{children}</SessionContext.Provider>;

  return <main className="auth-shell">
    <section className="auth-card" aria-live="polite">
      <div className="auth-brand"><div className="brand-mark">F</div><div><strong>Flockence</strong><span>Intelligent poultry management</span></div></div>
      {state === "checking" ? <>
        <div className="auth-heading"><h1>Checking your session</h1><p>Securing your farm workspace.</p></div>
        <div className="loading-line" />
      </> : <>
        <div className="auth-heading"><h1>Connection issue</h1><p>Flockence could not verify your account.</p></div>
        <p className="auth-message auth-error">Your farm data has not been loaded. Check your connection and try again.</p>
        <button className="button button-primary" type="button" onClick={() => window.location.reload()}>Try again</button>
        <p className="auth-links"><a href="/login">Go to sign in</a></p>
      </>}
    </section>
  </main>;
}
