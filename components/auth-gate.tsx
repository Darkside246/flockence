"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { ThemeProvider } from "@/components/theme-provider";

const PUBLIC_PATHS = new Set(["/login", "/signup", "/signup/free", "/signup/invited", "/signup/team", "/forgot-password", "/reset-password"]);

export type SessionUser = { id: string; farmId: string; freeAppearance?: boolean; dashboardHidden?: string[]; name: string; email: string; role: "OWNER" | "MANAGER" | "WORKER" | "READ_ONLY" };
const LOCAL_DEV_BYPASS = process.env.NODE_ENV === "development";
const LOCAL_DEV_USER: SessionUser = { id: "local-development-owner", farmId: "default-farm", name: "Local Development Owner", email: "dev@flockence.local", role: "OWNER" };
const SessionContext = createContext<SessionUser | null>(null);
export function useSession() { return useContext(SessionContext); }

/**
 * Session for the signed-in pages. Pages render straight away, like any website: there is no full-screen
 * "Checking your session" step on first load or when moving between pages (owner, 28 Nov 2026). The session is
 * confirmed in the background; a signed-out visitor is sent to sign in, and every API still refuses data without a
 * valid session, so nothing is shown that the server would not give. Only a real connection failure before the
 * first confirmation shows the error card.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const [locked, setLocked] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  const isPublicPath = PUBLIC_PATHS.has(pathname);

  useEffect(() => {
    if (LOCAL_DEV_BYPASS) {
      setUser(LOCAL_DEV_USER);
      if (isPublicPath) router.replace("/");
      return;
    }
    if (isPublicPath) {
      setUser(null);
      return;
    }

    let active = true;
    fetch("/api/auth/me", { cache: "no-store" })
      .then(async (response) => {
        if (response.ok) {
          const data = await response.json();
          if (active) { setUser(data.user as SessionUser); setFailed(false); }
          return;
        }
        if (response.status === 423) { if (active) setLocked(true); return; }
        if (response.status === 401 || response.status === 403) {
          const next = pathname && pathname !== "/" ? "?next=" + encodeURIComponent(pathname) : "";
          router.replace("/login" + next);
          return;
        }
        throw new Error("Unable to verify your sign-in. Check your connection and try again.");
      })
      // A failed re-check while already signed in keeps the page; only a first check that fails shows the card.
      .catch(() => { if (active) setFailed(true); });

    return () => { active = false; };
  }, [isPublicPath, pathname, router]);

  if (LOCAL_DEV_BYPASS) {
    if (isPublicPath) return null;
    return <SessionContext.Provider value={LOCAL_DEV_USER}><ThemeProvider>{children}</ThemeProvider></SessionContext.Provider>;
  }

  if (isPublicPath) return <ThemeProvider>{children}</ThemeProvider>;
  if (locked) return <main id="main" tabIndex={-1} className="auth-shell">
    <section className="auth-card" aria-live="polite">
      <div className="auth-brand"><div className="brand-mark">F</div><div><strong>Flockence</strong><span>Intelligent poultry management</span></div></div>
      <div className="auth-heading"><h1>Farm closing</h1><p>This farm is scheduled for deletion.</p></div>
      <p className="auth-message">Only the farm owner can sign in now. Ask the owner if you think this is a mistake.</p>
      <p className="auth-links"><a href="/login">Sign in with another account</a></p>
    </section>
  </main>;
  if (failed && !user) return <main id="main" tabIndex={-1} className="auth-shell">
    <section className="auth-card" aria-live="polite">
      <div className="auth-brand"><div className="brand-mark">F</div><div><strong>Flockence</strong><span>Intelligent poultry management</span></div></div>
      <div className="auth-heading"><h1>Connection issue</h1><p>Flockence could not verify your account.</p></div>
      <p className="auth-message auth-error">Your farm data has not been loaded. Check your connection and try again.</p>
      <button className="button button-primary" type="button" onClick={() => window.location.reload()}>Try again</button>
      <p className="auth-links"><a href="/login">Go to sign in</a></p>
    </section>
  </main>;
  // No key on the provider: when the session arrives the page keeps its state; the theme reloads that account's choice.
  return <SessionContext.Provider value={user}><ThemeProvider accountId={user?.id} freeAppearance={user?.freeAppearance}>{children}</ThemeProvider></SessionContext.Provider>;
}
