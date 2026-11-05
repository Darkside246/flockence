"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import type { FarmOperation } from "@/lib/farm-operation";

const PUBLIC_PATHS = new Set(["/login", "/signup", "/forgot-password", "/reset-password"]);

export type SessionUser = { operation?: FarmOperation | null; id: string; farmId: string; name: string; email: string; role: "OWNER" | "MANAGER" | "WORKER" | "READ_ONLY" };
const SessionContext = createContext<SessionUser | null>(null);
export function useSession() { return useContext(SessionContext); }

export function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [state, setState] = useState<"checking" | "ready" | "error">("checking");
  const [user, setUser] = useState<SessionUser | null>(null);
  const isPublicPath = PUBLIC_PATHS.has(pathname);

  useEffect(() => {
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
            const signedInUser = data.user as SessionUser;
            if (!signedInUser.operation && signedInUser.role === "OWNER" && pathname !== "/settings") {
              router.replace("/settings#farm-operation");
              return;
            }
            setUser(signedInUser);
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
