"use client";

import { useEffect, useState } from "react";

type Camera = { name: string; source: "blink" | "rtsp"; liveSampling?: boolean; pen?: { id: string; name: string } | null };
type CameraPlan = { everyHours: number; mode: "video" | "still"; category: string };
type Schedule = { enabled: boolean; cameras: Record<string, CameraPlan>; dailyCap: number; keepDays: number; quietStart: string; quietEnd: string; recordings?: boolean };
type CameraState = {
  lastRunAt?: string; lastResult?: "ok" | "failed"; lastMessage?: string; failures?: number; needsAttention?: boolean;
  birdsVisible?: number | null; questions?: string[]; lastSeverity?: string | null;
  oriya?: { sent: boolean; reason?: string; alerts?: number; birdsVisible?: number | null; whatsapp?: boolean } | null;
};
type Limits = { automatic: boolean; maxCameras: number; minIntervalHours: number; dailyCap: number; manualPerMonth: number; monthlyBudgetUsd: number };
type Data = {
  plan: { name: string; label: string; limits: Limits };
  usage: { month: string; manual: number; automatic: number; costUsd: number; unpricedCalls: number };
  model: { provider: string | null; name: string };
  schedule: Schedule; perDay: number; options: { intervals: number[] };
  state: { runsToday: number; lastRoundAt: string | null; cameras: Record<string, CameraState> };
  ready: { vision: boolean; cameras: boolean; liveVideo: boolean; timer: boolean };
  recordings?: { missing?: Record<string, string[]>; checkedAt?: string } | null;
};

const when = (iso?: string | null) => iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
const DEFAULT_PLAN = (camera: Camera, minHours = 2): CameraPlan => ({ everyHours: Math.max(2, minHours), mode: camera.liveSampling ? "video" : "still", category: "PEN" });

/**
 * Automatic inspections: one switch, the cameras to include, how often. Sensible defaults (every 2 hours, live video
 * when available, quiet 19:00-05:30, 24 a day, pictures kept 30 days); everything else is folded away.
 */
export function VisionSchedule({ cameras }: { cameras: Camera[] }) {
  const [data, setData] = useState<Data | null>(null);
  const [draft, setDraft] = useState<Schedule | null>(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const load = () => fetch("/api/vision/schedule", { cache: "no-store" }).then(r => r.ok ? r.json() : null).then((d: Data | null) => {
    if (!d) return;
    setData(d);
    setDraft(d.schedule.enabled || Object.keys(d.schedule.cameras).length ? d.schedule : { ...d.schedule, quietStart: "19:00", quietEnd: "05:30" });
  }).catch(() => {});
  useEffect(() => { void load(); }, []);
  if (!data || !draft) return null;

  const included = (name: string) => Boolean(draft.cameras[name]);
  const setCamera = (camera: Camera, plan: CameraPlan | null) => {
    const next = { ...draft.cameras };
    if (plan) next[camera.name] = plan; else delete next[camera.name];
    setDraft({ ...draft, cameras: next });
  };
  async function save(next: Schedule) {
    setSaving(true); setMessage("");
    try {
      const r = await fetch("/api/vision/schedule", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Could not save.");
      setMessage(next.enabled ? "Saved. The cameras will be checked automatically." : "Saved. Automatic checks are off; past results stay.");
      await load();
    } catch (e) { setMessage(e instanceof Error ? e.message : "Could not save."); }
    finally { setSaving(false); }
  }
  function toggle(on: boolean) {
    if (!draft) return;
    let next: Schedule = { ...draft, enabled: on };
    // Switching on with nothing chosen: include every camera that has a pen, with the defaults.
    if (on && !Object.keys(next.cameras).length) {
      const withPen = cameras.filter(c => c.pen).slice(0, data?.plan.limits.maxCameras ?? 1);
      next = { ...next, cameras: Object.fromEntries(withPen.map(c => [c.name, DEFAULT_PLAN(c, data?.plan.limits.minIntervalHours)])) };
    }
    setDraft(next);
    if (!on || Object.keys(next.cameras).length) void save(next);
  }

  const blockers = [
    !data.ready.vision && "The server has no vision key yet (OPENROUTER_API_KEY, ANTHROPIC_API_KEY or OPENAI_API_KEY), so pictures cannot be analysed.",
    !data.ready.cameras && "Camera inspections are switched off on the server (FLOCKENCE_CAMERA_VISION).",
    draft.enabled && data.state.lastRoundAt === null && "Waiting for the first automatic round. If nothing happens within 15 minutes, the server timer is not installed yet (ops/systemd/enable-vision-rounds.sh).",
    draft.enabled && data.state.lastRoundAt !== null && !data.ready.timer && "No automatic round in the last 30 minutes: the server timer may have stopped.",
  ].filter(Boolean) as string[];

  return <section className="section card vision-auto" aria-labelledby="vision-auto-title">
    <div className="section-head">
      <div><div className="hero-kicker">Hands-free</div><h3 id="vision-auto-title">Automatic inspections</h3>
        <p>Flockence checks your cameras on a timer, uses your flock records (age, live birds, deaths, the daily check), counts the birds it can see, and puts the result on the dashboard. When the farm is linked to Oriya, the result is also sent there for the WhatsApp message.</p></div>
      <label className="vision-auto-switch"><input type="checkbox" checked={draft.enabled} disabled={saving || !data.plan.limits.automatic} onChange={e => toggle(e.target.checked)} /> <strong>{draft.enabled ? "On" : "Off"}</strong></label>
    </div>
    <p className="vision-auto-plan-line">
      <strong>{data.plan.label} plan:</strong>{" "}
      {data.plan.limits.automatic
        ? `up to ${data.plan.limits.maxCameras} camera${data.plan.limits.maxCameras === 1 ? "" : "s"}, each at most every ${data.plan.limits.minIntervalHours} hour${data.plan.limits.minIntervalHours === 1 ? "" : "s"}, ${data.plan.limits.dailyCap} automatic check${data.plan.limits.dailyCap === 1 ? "" : "s"} a day`
        : "automatic checks are not included"}
      {" · "}{data.usage.manual} of {data.plan.limits.manualPerMonth} hand-started inspections used this month
      {data.plan.name !== "PREMIUM" && <> · <a href="/settings/plan">More with Premium</a></>}
    </p>
    {blockers.map(b => <p key={b} className="notice" role="status">{b}</p>)}

    <ul className="vision-auto-cameras">{cameras.map(camera => {
      const plan = draft.cameras[camera.name];
      const st = data.state.cameras[camera.name];
      return <li key={camera.name} className="vision-auto-camera">
        <label className="vision-auto-include"><input type="checkbox" checked={included(camera.name)} disabled={!camera.pen}
          onChange={e => setCamera(camera, e.target.checked ? DEFAULT_PLAN(camera, data.plan.limits.minIntervalHours) : null)} />
          <span><strong>{camera.name}</strong><small>{camera.pen ? `Pen: ${camera.pen.name}` : "Assign a pen above first"}</small></span></label>
        {plan && <span className="vision-auto-plan">
          <select aria-label={`How often for ${camera.name}`} value={plan.everyHours} onChange={e => setCamera(camera, { ...plan, everyHours: Number(e.target.value) })}>
            {data.options.intervals.map(h => <option key={h} value={h}>{h === 1 ? "Every hour" : h === 24 ? "Once a day" : `Every ${h} hours`}</option>)}
          </select>
          {camera.liveSampling && <select aria-label={`Type for ${camera.name}`} value={plan.mode} onChange={e => setCamera(camera, { ...plan, mode: e.target.value as "video" | "still" })}>
            <option value="video">Short live video (best)</option><option value="still">Single picture (less battery)</option>
          </select>}
        </span>}
        {st?.lastRunAt && <span className={"vision-auto-status" + (st.needsAttention ? " is-warn" : "")}>
          {st.needsAttention ? `Needs attention: ${st.lastMessage}` : st.lastResult === "ok"
            ? `Last check ${when(st.lastRunAt)}: ${st.lastMessage || "done"}${(st.birdsVisible ?? st.oriya?.birdsVisible) != null ? ` · about ${st.birdsVisible ?? st.oriya?.birdsVisible} birds in view` : ""}${st.oriya?.sent ? ` · sent to Oriya${st.oriya.whatsapp ? " (WhatsApp sent)" : ""}` : ""}`
            : `Last try ${when(st.lastRunAt)} failed: ${st.lastMessage}`}
          {st.questions?.length ? <em> Question: {st.questions[0]}</em> : null}
        </span>}
      </li>;
    })}</ul>

    <label className="vision-auto-recordings"><input type="checkbox" checked={Boolean(draft.recordings)} onChange={e => setDraft({ ...draft, recordings: e.target.checked })} />
      {" "}Also check saved recordings across the day (night, morning, midday, afternoon, evening), within the same daily limit</label>
    {draft.recordings && data.recordings?.missing && Object.entries(data.recordings.missing).some(([, parts]) => parts.length > 0) && <p className="muted">
      No recording in the last 24 hours for: {Object.entries(data.recordings.missing).filter(([, parts]) => parts.length).map(([cam, parts]) => `${cam} (${parts.join(", ")})`).join("; ")}. Those parts of the day could not be checked.
    </p>}

    <details className="vision-auto-more"><summary>More options</summary>
      <div className="grid2">
        <label>Quiet from<input type="time" value={draft.quietStart} onChange={e => setDraft({ ...draft, quietStart: e.target.value })} /></label>
        <label>Quiet until<input type="time" value={draft.quietEnd} onChange={e => setDraft({ ...draft, quietEnd: e.target.value })} /></label>
        <label>Most checks a day (all cameras)<input type="number" min={1} max={96} value={draft.dailyCap} onChange={e => setDraft({ ...draft, dailyCap: Number(e.target.value) })} /></label>
        <label>Keep automatic pictures (days)<input type="number" min={1} max={365} value={draft.keepDays} onChange={e => setDraft({ ...draft, keepDays: Number(e.target.value) })} /></label>
      </div>
      <p className="muted">No checks run in quiet hours (leave both empty to check around the clock). Each check is one paid analysis and wakes a Blink camera, which uses its battery. Old automatic pictures are deleted; their written results stay.</p>
    </details>

    <div className="actions">
      <button type="button" className="button button-primary" disabled={saving} onClick={() => void save(draft)}>{saving ? "Saving…" : "Save"}</button>
      {draft.enabled && <span className="muted">About {data.perDay} check{data.perDay === 1 ? "" : "s"} a day · {data.state.runsToday} so far today · {data.usage.automatic} this month</span>}
      {message && <span role="status">{message}</span>}
    </div>
  </section>;
}
