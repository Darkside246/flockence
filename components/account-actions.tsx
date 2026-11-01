"use client";

import { useState } from "react";

export function AccountActions() {
  const [loading, setLoading] = useState(false);
  async function signOut() {
    setLoading(true);
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }
  return <button className="button button-primary" onClick={signOut} disabled={loading}>{loading ? "Signing out…" : "Sign out of Flockence"}</button>;
}
