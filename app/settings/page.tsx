"use client";

import { FormEvent, useEffect, useState } from "react";
import { FeedSettings } from "@/components/feed-settings";
import { DashboardSettings } from "@/components/dashboard-settings";
import Link from "next/link";
import { Nav } from "@/components/nav";
import { SettingsCameraProviders } from "@/components/settings-camera-providers";
import { useSession } from "@/components/auth-gate";
import { farmRoleLabels, type FarmRole } from "@/lib/farm-roles";
import { useTheme } from "@/components/theme-provider";
import { themes } from "@/lib/theme-registry";

const sections = [
  ["account", "Account & security"],
  ["farm", "Farm profile"],
  ["operations", "Farm operations"],
  ["team", "Team & permissions"],
  ["devices", "Devices & plan"],
  ["cameras", "Camera connections"],
  ["appearance", "Appearance"],
  ["storage", "Storage & sync"],
] as const;

type Section = typeof sections[number][0];
const defaults = {
  default_feed_bag_price: "56", default_chick_cost: "2.90", default_slaughter_cost: "2.00",
  weather_location_name: "", weather_latitude: "", weather_longitude: "",
  default_bag_kg: "", feed_record_method: "BAG", feed_low_days: "7", default_breed: "",
};
type Preferences = typeof defaults;
type PreferenceKey = keyof Preferences;
type Notice = { message: string; error?: boolean };

const costFields: { key: PreferenceKey; label: string }[] = [
  { key: "default_feed_bag_price", label: "Default feed bag price" },
  { key: "default_chick_cost", label: "Default chick cost" },
  { key: "default_slaughter_cost", label: "Default slaughter cost" },
];

function selectedSection(): Section {
  const hash = window.location.hash.slice(1);
  return sections.find(([key]) => key === hash)?.[0] ?? "account";
}

export default function SettingsPage() {
  const user = useSession();
  // Farm-wide settings are the owner's only (lib/farm-roles.ts). Others see their own account, appearance, team and storage.
  const editable = user?.role === "OWNER";
  const visibleSections = sections.filter(([key]) => editable || ["account", "appearance", "team", "storage"].includes(key));
  const [chosen, setSection] = useState<Section>("account");
  const section: Section = visibleSections.some(([key]) => key === chosen) ? chosen : "account";
  const [farm, setFarm] = useState<{ name: string; currency: string } | null>(null);
  const [loaded, setLoaded] = useState<Partial<Preferences> | null>(null);
  const [preferences, setPreferences] = useState<Preferences>(defaults);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [saving, setSaving] = useState(false);
  const { theme, freeAppearance, density, radius, setTheme, setDensity, setRadius } = useTheme();

  useEffect(() => {
    const change = () => setSection(selectedSection());
    change();
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);

  async function loadSettings() {
    const response = await fetch("/api/settings", { cache: "no-store" });
    if (!response.ok) throw new Error("Settings could not be loaded.");
    const data = await response.json() as { farm: { name: string; currency: string }; settings: { key: string; value: string }[] };
    const values = Object.fromEntries(data.settings.map(({ key, value }) => [key, value]));
    setLoaded(values);
    setPreferences({ ...defaults, ...values });
    setFarm(data.farm);
  }

  useEffect(() => {
    loadSettings().catch(() => setNotice({ message: "Farm settings could not be loaded.", error: true }));
  }, []);

  const update = (key: PreferenceKey, value: string) =>
    setPreferences((previous) => ({ ...previous, [key]: value }));

  async function save(event: FormEvent<HTMLFormElement>, keys: PreferenceKey[]) {
    event.preventDefault();
    if (!editable || !loaded || saving) return;
    const changed = keys.filter((key) => preferences[key] !== (loaded[key] ?? defaults[key]));
    if (!changed.length) {
      setNotice({ message: "Your settings are already up to date." });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: changed.map((key) => ({ key, value: preferences[key], previous: loaded[key] ?? null })),
        }),
      });
      if (response.status === 409) {
        setNotice({ message: "These settings changed elsewhere. Reload them before saving again.", error: true });
        return;
      }
      if (!response.ok) throw new Error("Could not save settings.");
      setLoaded({ ...loaded, ...Object.fromEntries(changed.map((key) => [key, preferences[key]])) });
      setNotice({ message: "Settings saved." });
    } catch {
      setNotice({ message: "Could not save settings. Check the values and try again.", error: true });
    } finally {
      setSaving(false);
    }
  }

  return <div className="shell">
    <header className="topbar"><div className="brand"><div><h1>Settings</h1><p>Manage your account and farm preferences.</p></div></div></header>
    <Nav />
    <main className="main">
      <div className="settings-layout">
      <nav aria-label="Settings categories" className="settings-nav">
        {visibleSections.map(([key, label]) => <a key={key} href={"#" + key}
          onClick={() => { setSection(key); setNotice(null); }} aria-current={section === key ? "location" : undefined}>{label}</a>)}
      </nav>
      <div className="settings-content">

      {section === "account" && <section className="section card">
        <h2>Account &amp; security</h2>
        {user && <p>{user.name} · {user.role.toLowerCase().replaceAll("_", " ")}</p>}
        <Link href="/account" className="button">Account and active sessions</Link>
        {user?.role === "OWNER" && <p><Link href="/reports" className="action">Farm data exports</Link></p>}
      </section>}

      {section === "farm" && <>
        <section className="section card">
          <h2>Farm profile</h2>
          {farm && <p>{farm.name} · {farm.currency}</p>}
          {editable && <Link href="/farm-setup" className="button button-primary">Edit farm profile</Link>}
        </section>
        <form className="section card form" onSubmit={(event) => save(event, ["weather_location_name", "weather_latitude", "weather_longitude"])}>
          <h2>Weather location</h2>
          <fieldset className="grid2" disabled={!editable || saving || !loaded}>
            <label>Location name<input value={preferences.weather_location_name} maxLength={120} onChange={(e) => update("weather_location_name", e.target.value)} /></label>
            <label>Latitude<input type="number" min="-90" max="90" step="any" value={preferences.weather_latitude} onChange={(e) => update("weather_latitude", e.target.value)} /></label>
            <label>Longitude<input type="number" min="-180" max="180" step="any" value={preferences.weather_longitude} onChange={(e) => update("weather_longitude", e.target.value)} /></label>
          </fieldset>
          {editable && <button className="button button-primary" type="submit" disabled={saving || !loaded}>{saving ? "Saving…" : "Save location"}</button>}
        </form>
      </>}

      {section === "operations" && <><form className="section card form" onSubmit={(event) => save(event, costFields.map(({ key }) => key))}>
        <h2>Default operating costs</h2>
        <fieldset className="grid2" disabled={!editable || saving || !loaded}>
          {costFields.map(({ key, label }) => <label key={key}>{label} {farm?.currency ?? "BBD"}
            <input type="number" min="0" max="9999999" step="0.01" value={preferences[key]} onChange={(e) => update(key, e.target.value)} required />
          </label>)}
        </fieldset>
        {editable && <button className="button button-primary" type="submit" disabled={saving || !loaded}>{saving ? "Saving…" : "Save operating costs"}</button>}
        <p><Link className="action" href="/pens">Pen records and configuration</Link></p>
      </form>
      <form className="section card form" onSubmit={(event) => save(event, ["default_bag_kg", "feed_record_method", "feed_low_days", "default_breed"])}>
        <h2>Feed defaults</h2>
        <fieldset className="grid2" disabled={!editable || saving || !loaded}>
          <label>Usual feed bag size kg<input type="number" min="0" max="1000" step="0.1" value={preferences.default_bag_kg} onChange={(e) => update("default_bag_kg", e.target.value)} placeholder="e.g. 30" /></label>
          <label>How you usually count feed out<select value={preferences.feed_record_method} onChange={(e) => update("feed_record_method", e.target.value)}><option value="BAG">By the bag</option><option value="KG">Kilograms</option><option value="LB">Pounds</option><option value="MEASURE">Scoop, pan or feeder fill</option></select></label>
          <label>Warn when feed in store is below (days)<input type="number" min="1" max="60" step="1" value={preferences.feed_low_days} onChange={(e) => update("feed_low_days", e.target.value)} /></label>
          <label>Usual breed<input value={preferences.default_breed} maxLength={80} onChange={(e) => update("default_breed", e.target.value)} placeholder="e.g. Cobb 500" /></label>
        </fieldset>
        {editable && <button className="button button-primary" type="submit" disabled={saving || !loaded}>{saving ? "Saving…" : "Save feed defaults"}</button>}
      </form>
      <FeedSettings />
      <DashboardSettings /></>}

      {section === "team" && <section className="section card">
        <h2>Team &amp; permissions</h2>
        <p>Your farm role is {user ? farmRoleLabels[user.role as FarmRole] ?? user.role : "loading"}.</p>
        <ul>
          <li><strong>Owner:</strong> everything, including farm-wide settings, camera and device connections, keys, schedules, catalogues and all team roles.</li>
          <li><strong>Supervisor:</strong> pens, flocks, records, sales and expenses, and inviting or changing Farm Hands and Read Only members. No farm-wide settings.</li>
          <li><strong>Farm Hand:</strong> day-to-day records only (deaths, feed, eggs, weights, daily checks, health notes, tasks, Vision photo checks).</li>
          <li><strong>Read Only:</strong> can look, not change.</li>
        </ul>
        <p className="muted">Everyone can change their own name and password and sign themselves out.</p>
        {(user?.role === "OWNER" || user?.role === "MANAGER") && <Link href="/team" className="button">{user.role === "OWNER" ? "Manage members and invitations" : "Invite or manage Farm Hands and Read Only members"}</Link>}
      </section>}

      {section === "devices" && <section className="section card">
        <h2>Devices &amp; plan</h2>
        <p>Farm records, basic reports and offline mortality capture are included.</p>
        <div className="quick"><Link href="/settings/plan" className="button">View plan and devices</Link><a href="#cameras" className="button">Set up cameras</a></div>
      </section>}

      {section === "cameras" && <SettingsCameraProviders />}

      {section === "appearance" && <>
        <section className="section card">
          <h2>Visual style</h2>
          <div className="theme-grid">{themes.map((entry) => <button type="button" key={entry.id} disabled={freeAppearance && entry.premium}
            className={`theme-option ${theme === entry.id ? "selected" : ""}`} aria-pressed={theme === entry.id} onClick={() => setTheme(entry.id)}>
            <span className="theme-preview" data-theme={entry.id} aria-hidden="true"><span className="theme-preview-rail" /><span className="theme-preview-content" /></span>
            <span className="theme-name">{entry.name}</span><span className="theme-desc">{entry.description}</span>
            {entry.premium && <span className="theme-tier">{freeAppearance ? "Upgrade required" : "Premium"}</span>}
          </button>)}</div>
        </section>
        <section className="section card">
          <h2>Display preferences</h2>
          <div className="grid2">
            <fieldset><legend>Information density</legend><div className="segmented">
              {(["comfortable", "compact"] as const).map((choice) => <button type="button" key={choice} aria-pressed={density === choice} className={density === choice ? "selected" : ""} onClick={() => setDensity(choice)}>{choice}</button>)}
            </div></fieldset>
            <fieldset><legend>Card shape</legend><div className="segmented">
              {(["soft", "sharp"] as const).map((choice) => <button type="button" key={choice} aria-pressed={radius === choice} className={radius === choice ? "selected" : ""} onClick={() => setRadius(choice)}>{choice}</button>)}
            </div></fieldset>
          </div>
        </section>
      </>}

      {section === "storage" && <section className="section card">
        <h2>Storage &amp; sync</h2>
        <p>Prepare this device while signed in to record mortality later without a connection.</p>
        <a href="/offline.html" className="button">Open offline mortality workspace</a>
        {user?.role === "OWNER" && <p><Link href="/reports" className="action">Export farm records</Link></p>}
      </section>}

      {notice && <div className="notice" role={notice.error ? "alert" : "status"}>
        {notice.message} {notice.error && <button type="button" className="button" onClick={() => {
          setNotice(null);
          loadSettings().catch(() => setNotice({ message: "Settings could not be loaded.", error: true }));
        }}>Reload settings</button>}
      </div>}
      </div>
      </div>
    </main>
  </div>;
}
