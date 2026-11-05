"use client";
import { useState } from "react";
import { useSession } from "./auth-gate";
import { operationKey, operationLabels, type FarmOperation } from "@/lib/farm-operation";

export function FarmOperationForm() {
  const user = useSession();
  const [choice, setChoice] = useState<FarmOperation | "">(user?.operation ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!user || !["OWNER","MANAGER"].includes(user.role)) return null;
  return <form id="farm-operation" className="section card" onSubmit={async event => {
    event.preventDefault();
    if (!choice || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/settings", {method:"PUT", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({settings:[{key:operationKey,value:choice}]})});
      if (!response.ok) throw new Error();
      window.location.reload();
    } catch { setBusy(false); setError("Farm operation could not be saved. Try again."); }
  }}>
    <fieldset disabled={busy} className="operation-picker"><legend>What type of poultry operation do you manage?</legend>
      {Object.entries(operationLabels).map(([value,label]) => <label key={value}>
        <input type="radio" name="operation" value={value} checked={choice===value} required onChange={()=>setChoice(value as FarmOperation)}/>{label}
      </label>)}
    </fieldset>
    <button className="button button-primary" disabled={busy || !choice || choice===user.operation}>{busy ? "Saving..." : "Save operation"}</button>
    {error && <p role="alert">{error}</p>}
  </form>;
}
