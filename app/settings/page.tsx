"use client";

import Link from "next/link";
import { FormEvent, Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Nav } from "@/components/nav";
import { SectionTabs } from "@/components/section-tabs";
import { useSession } from "@/components/auth-gate";
import { useTheme } from "@/components/theme-provider";

type ThemeName = "crystal" | "aero" | "heritage" | "workhorse" | "sol" | "terra";
const themes: { id: ThemeName; name: string; desc: string; bg: string; accent: string }[] = [
  { id: "crystal", name: "Cyber Crystal", desc: "Obsidian glass with cyber-teal light", bg: "linear-gradient(135deg,#050a12,#10283a)", accent: "#35e0d0" },
  { id: "aero", name: "Aero Glass", desc: "Dark glass with cyan highlights", bg: "linear-gradient(135deg,#070b12,#0f172a)", accent: "#00f2fe" },
  { id: "heritage", name: "Heritage Sovereign", desc: "Deep green with brass accents", bg: "linear-gradient(135deg,#0e1210,#1c2821)", accent: "#e5c378" },
  { id: "workhorse", name: "Field Workhorse", desc: "High-contrast industrial amber", bg: "linear-gradient(135deg,#141618,#303438)", accent: "#ffb703" },
  { id: "sol", name: "Sol Tactical", desc: "Maximum-contrast black and yellow", bg: "linear-gradient(135deg,#000000,#1a1a1a)", accent: "#ffe500" },
  { id: "terra", name: "Terra Flora", desc: "Warm earth with soft green", bg: "linear-gradient(135deg,#171412,#2c2723)", accent: "#86efac" },
];

// Every setting has one home. Farm-wide sections need an owner or manager; Appearance is personal to this device.
const SECTIONS = [
  { id: "farm", label: "Farm profile", farm: true },
  { id: "production", label: "Production", farm: true },
  { id: "housing", label: "Housing & equipment", farm: true },
  { id: "health", label: "Health & biosecurity", farm: true },
  { id: "inventory", label: "Inventory & storage", farm: true },
  { id: "finance", label: "Sales & finance", farm: true },
  { id: "devices", label: "Devices & integrations", farm: true },
  { id: "appearance", label: "Appearance & accessibility", farm: false },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];
type Status = { oriya: boolean; cameras: boolean; thermometers: boolean; weather: boolean };

function LinkRow({ href, title, text }: { href: string; title: string; text: string }) {
  return <Link className="settings-link" href={href}><span><strong>{title}</strong><small>{text}</small></span><span aria-hidden="true">→</span></Link>;
}
function StatusBadge({ on }: { on: boolean | undefined }) {
  return <span className="badge">{on === undefined ? "CHECKING" : on ? "CONNECTED" : "NOT SET UP"}</span>;
}

function SettingsCentre() {
  const session = useSession();
  const canManage = session?.role === "OWNER" || session?.role === "MANAGER";
  const visible = SECTIONS.filter(section => canManage || !section.farm);
  const params = useSearchParams();
  const asked = params.get("section");
  const current: SectionId = visible.find(section => section.id === asked)?.id ?? visible[0].id;
  const { theme, density, radius, setTheme, setDensity, setRadius } = useTheme();

  const [farmName, setFarmName] = useState("");
  const [feedPrice, setFeedPrice] = useState("");
  const [chickCost, setChickCost] = useState("");
  const [slaughter, setSlaughter] = useState("");
  const [weatherName, setWeatherName] = useState("");
  const [weatherLat, setWeatherLat] = useState("");
  const [weatherLon, setWeatherLon] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<Status | undefined>();
  const [message, setMessage] = useState<{ section: string; text: string; ok: boolean } | null>(null);

  useEffect(() => {
    if (!canManage) return;
    fetch("/api/settings").then(r => r.ok ? r.json() : Promise.reject()).then(d => {
      const map = Object.fromEntries((d.settings || []).map((x: { key: string; value: string }) => [x.key, x.value]));
      setFarmName(d.farm?.name || "");
      setFeedPrice(map.default_feed_bag_price ?? "56");
      setChickCost(map.default_chick_cost ?? "2.90");
      setSlaughter(map.default_slaughter_cost ?? "2.00");
      setWeatherName(map.weather_location_name ?? "");
      setWeatherLat(map.weather_latitude ?? "");
      setWeatherLon(map.weather_longitude ?? "");
      setLoaded(true);
    }).catch(() => setMessage({ section: "farm", text: "Settings could not be loaded.", ok: false }));
    fetch("/api/settings/integrations").then(r => r.ok ? r.json() : undefined).then(setStatus).catch(() => undefined);
  }, [canManage]);

  async function save(event: FormEvent, section: string, settings: { key: string; value: string }[], withName = false) {
    event.preventDefault();
    setMessage(null);
    const body: Record<string, unknown> = { settings };
    if (withName) body.farmName = farmName;
    const response = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setMessage({ section, ok: response.ok, text: response.ok ? "Saved." : "Could not save. Check the values and try again." });
  }
  const note = (section: string) => message?.section === section && <span className="notice" role="status">{message.text}</span>;
  const tabs = visible.map(section => ({ id: section.id, label: section.label, href: `/settings?section=${section.id}` }));

  return <div className="shell"><header className="topbar"><div className="brand"><div><h1>Settings</h1><p>Every setting has one home. Daily choices, such as which flock to check, stay in the work itself.</p></div></div></header><Nav /><main className="main">
    <SectionTabs tabs={tabs} current={current} label="Settings categories" />

    {current === "farm" && <form className="section card form grid2" onSubmit={e => save(e, "farm", [
      { key: "weather_location_name", value: weatherName }, { key: "weather_latitude", value: weatherLat }, { key: "weather_longitude", value: weatherLon },
    ], true)}>
      <div className="section-head" style={{ gridColumn: "1/-1" }}><div><h3>Farm profile</h3><p>Who you are and where the farm is. The location drives live weather and heat watches.</p></div></div>
      <label>Farm name<input value={farmName} onChange={e => setFarmName(e.target.value)} disabled={!loaded} required /></label>
      <label>Business type<input value="Farmer" readOnly /></label>
      <label>Currency<input value="BBD" readOnly /></label>
      <label>Location name<input value={weatherName} onChange={e => setWeatherName(e.target.value)} placeholder="Farm / community" /></label>
      <label>Latitude<input value={weatherLat} onChange={e => setWeatherLat(e.target.value)} type="number" step="0.000001" placeholder="13.000000" /></label>
      <label>Longitude<input value={weatherLon} onChange={e => setWeatherLon(e.target.value)} type="number" step="0.000001" placeholder="-59.000000" /></label>
      <p className="muted" style={{ gridColumn: "1/-1" }}>Weather comes from a server-side provider. Its key is never stored in farm settings or sent to the browser.</p>
      <div className="form-actions" style={{ gridColumn: "1/-1" }}><button type="submit" disabled={!loaded}>Save farm profile</button>{note("farm")}</div>
    </form>}

    {current === "production" && <section className="section card">
      <div className="section-head"><div><h3>Production</h3><p>Broiler and layer settings stay with the flock they describe, so one flock cannot change another.</p></div></div>
      <div className="settings-links">
        <LinkRow href="/batches" title="Start or edit a flock" text="Production type, layer stage, placement and chick details." />
        <LinkRow href="/planning" title="Lifecycle targets" text="Target age and weight, harvest windows and planning." />
        <LinkRow href="/layers" title="Layer defaults" text="Layer stage and egg collection set-up." />
      </div>
      <p className="muted">Default chick and slaughter costs are under Sales &amp; finance.</p>
    </section>}

    {current === "housing" && <section className="section card">
      <div className="section-head"><div><h3>Housing &amp; equipment</h3><p>House layout, pen profiles, feeders, drinkers and ventilation are configured where the capacity checks run.</p></div></div>
      <div className="settings-links">
        <LinkRow href="/pens" title="Pen profiles" text="Pen size, housing mode, feeder pans, water points and stocking limits." />
        <LinkRow href="/house" title="House designer" text="Floor area, density and equipment checks for a house." />
      </div>
    </section>}

    {current === "health" && <section className="section card">
      <div className="section-head"><div><h3>Health &amp; biosecurity</h3><p>Case categories, treatments and the food-safety checklist are managed in Flock Health and Food Safety.</p></div></div>
      <div className="settings-links">
        <LinkRow href="/health" title="Flock health" text="Cases, diagnostic tests, treatments and withdrawal periods." />
        <LinkRow href="/food-safety" title="Food safety checklist" text="Biosecurity and food-safety routine." />
      </div>
    </section>}

    {current === "inventory" && <section className="section card">
      <div className="section-head"><div><h3>Inventory &amp; storage</h3><p>Products, storage locations and cold-chain checks are managed on the Inventory page.</p></div></div>
      <div className="settings-links">
        <LinkRow href="/inventory" title="Stock and storage locations" text="Add a chiller, freezer or store room and record its temperature." />
        <LinkRow href="/finances" title="Suppliers and procurement" text="Who you buy feed, chicks and supplies from." />
      </div>
    </section>}

    {current === "finance" && <form className="section card form grid2" onSubmit={e => save(e, "finance", [
      { key: "default_feed_bag_price", value: feedPrice }, { key: "default_chick_cost", value: chickCost }, { key: "default_slaughter_cost", value: slaughter },
    ])}>
      <div className="section-head" style={{ gridColumn: "1/-1" }}><div><h3>Sales &amp; finance</h3><p>Default costs pre-fill forms. You can always change a value on the record itself.</p></div></div>
      <label>Default feed bag price (BBD)<input type="number" min="0" step="0.01" value={feedPrice} onChange={e => setFeedPrice(e.target.value)} disabled={!loaded} /></label>
      <label>Default chick cost (BBD)<input type="number" min="0" step="0.01" value={chickCost} onChange={e => setChickCost(e.target.value)} disabled={!loaded} /></label>
      <label>Default slaughter cost per bird (BBD)<input type="number" min="0" step="0.01" value={slaughter} onChange={e => setSlaughter(e.target.value)} disabled={!loaded} /></label>
      <div className="form-actions" style={{ gridColumn: "1/-1" }}><button type="submit" disabled={!loaded}>Save defaults</button>{note("finance")}</div>
    </form>}

    {current === "devices" && <section className="section card">
      <div className="section-head"><div><h3>Devices &amp; integrations</h3><p>Connection status only. Keys and addresses live in the server settings and are never shown here.</p></div></div>
      <div className="settings-links">
        <div className="settings-link static"><span><strong>Cameras</strong><small>Blink and other cameras: choose which to show, live view and recordings.</small></span><StatusBadge on={status?.cameras} /></div>
        <LinkRow href="/cameras" title="Open Cameras" text="Manage camera feeds, stills and recordings." />
        <div className="settings-link static"><span><strong>Thermometers</strong><small>House temperature and humidity readings.</small></span><StatusBadge on={status?.thermometers} /></div>
        <div className="settings-link static"><span><strong>Oriya connection</strong><small>Sends farm numbers and camera pictures to Oriya and shows its alerts.</small></span><StatusBadge on={status?.oriya} /></div>
        <div className="settings-link static"><span><strong>Weather</strong><small>Live weather for heat watches (location is in Farm profile).</small></span><StatusBadge on={status?.weather} /></div>
      </div>
    </section>}

    {current === "appearance" && <>
      <section className="section card"><div className="section-head"><div><h3>Visual style</h3><p>Applies on this device. Cyber Crystal is the default.</p></div></div><div className="theme-grid">{themes.map(t => <button type="button" key={t.id} className={`theme-option ${theme === t.id ? "selected" : ""}`} onClick={() => setTheme(t.id)} aria-pressed={theme === t.id}><div className="theme-swatch" style={{ background: t.bg }}><div style={{ width: 20, height: 20, borderRadius: 7, background: t.accent, margin: 12 }} /></div><span className="theme-name">{t.name}</span><span className="theme-desc">{t.desc}</span></button>)}</div></section>
      <section className="section card"><div className="section-head"><div><h3>Interface feel</h3><p>Density and card shape for this device.</p></div></div><div className="grid2"><div><label>Information density</label><div className="segmented"><button className={density === "comfortable" ? "selected" : ""} type="button" onClick={() => setDensity("comfortable")}>Comfortable</button><button className={density === "compact" ? "selected" : ""} type="button" onClick={() => setDensity("compact")}>Compact</button></div></div><div><label>Card shape</label><div className="segmented"><button className={radius === "soft" ? "selected" : ""} type="button" onClick={() => setRadius("soft")}>Soft</button><button className={radius === "sharp" ? "selected" : ""} type="button" onClick={() => setRadius("sharp")}>Sharp</button></div></div></div></section>
    </>}
  </main></div>;
}

export default function SettingsPage() { return <Suspense fallback={null}><SettingsCentre /></Suspense>; }
