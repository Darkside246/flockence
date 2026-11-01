"use client";

import { FormEvent, useEffect, useState } from "react";
import { Nav } from "@/components/nav";

export default function TreatmentsPage() {
  const [batches, setBatches] = useState<any[]>([]);
  const [msg, setMsg] = useState("");
  const [productName, setProductName] = useState("");
  const [batchId, setBatchId] = useState("");
  const [startedAt, setStartedAt] = useState(new Date().toISOString().slice(0, 10));
  const [withdrawalDays, setWithdrawalDays] = useState("");
  const [reason, setReason] = useState("");
  const [veterinarian, setVeterinarian] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    void fetch("/api/batches")
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load batches.");
        return response.json();
      })
      .then(setBatches)
      .catch((error) => setMsg(error instanceof Error ? error.message : "Unable to load batches."));
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setMsg("");

    try {
      const response = await fetch("/api/health/treatments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productName,
          batchId,
          startedAt,
          withdrawalDays: withdrawalDays ? Number(withdrawalDays) : null,
          reason,
          veterinarian,
          notes,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMsg(data.error || "Could not save treatment.");
        return;
      }

      const clearDate = data.withdrawalClearsAt
        ? new Date(data.withdrawalClearsAt).toLocaleDateString()
        : null;
      setMsg(clearDate ? `Treatment recorded. Food withdrawal clears ${clearDate}.` : "Treatment recorded.");
      setProductName("");
      setWithdrawalDays("");
      setReason("");
      setVeterinarian("");
      setNotes("");
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "Could not save treatment.");
    }
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <div>
            <h1>Record treatment</h1>
            <p>Keep flock care and food-safety timing traceable.</p>
          </div>
          <span className="badge">HEALTH</span>
        </div>
      </header>
      <Nav />
      <main className="main">
        <section className="hero">
          <div className="hero-kicker">Flock care</div>
          <h2>New treatment record.</h2>
          <p>
            Enter the product and instructions you are actually using. Do not use this screen to invent a dose or substitute for veterinary or product-label guidance.
          </p>
        </section>

        <form className="section card form" onSubmit={save}>
          <div className="grid2">
            <label>
              Product / treatment
              <input required value={productName} onChange={(event) => setProductName(event.target.value)} placeholder="Product name" />
            </label>
            <label>
              Batch
              <select value={batchId} onChange={(event) => setBatchId(event.target.value)}>
                <option value="">Farm-wide / not selected</option>
                {batches.map((batch) => (
                  <option key={batch.id} value={batch.id}>{batch.name}</option>
                ))}
              </select>
            </label>
            <label>
              Start date
              <input type="date" value={startedAt} onChange={(event) => setStartedAt(event.target.value)} />
            </label>
            <label>
              Food withdrawal days
              <input type="number" min="0" value={withdrawalDays} onChange={(event) => setWithdrawalDays(event.target.value)} placeholder="From label / veterinarian" />
            </label>
            <label>
              Reason
              <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why the treatment was used" />
            </label>
            <label>
              Veterinarian
              <input value={veterinarian} onChange={(event) => setVeterinarian(event.target.value)} placeholder="Name, if applicable" />
            </label>
          </div>

          <label>
            Notes
            <textarea rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Instructions, response, or follow-up" />
          </label>

          <div>
            <button className="button button-primary" type="submit">Save treatment</button>
            {msg && <span className="notice">{msg}</span>}
          </div>
        </form>
      </main>
    </div>
  );
}
