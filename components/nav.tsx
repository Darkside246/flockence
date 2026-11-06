"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSession } from "@/components/auth-gate";
import { NAV, canSee, locate, pathOf, type NavIcon, type NavLeaf } from "@/lib/nav-config";

function NavGlyph({ name }: { name: NavIcon }) {
  const paths: Record<NavIcon, React.ReactNode> = {
    home: <path d="m3 7 5-4 5 4v6H9v-4H7v4H3z" />,
    users: <><circle cx="6" cy="5" r="2" /><path d="M2.5 13v-1.2A3.5 3.5 0 0 1 6 8.3a3.5 3.5 0 0 1 3.5 3.5V13z" /><path d="M10 3.5a2 2 0 0 1 0 3.8M11 8.5a3.2 3.2 0 0 1 2.5 3.1V13" /></>,
    eggs: <><path d="M8 2.2c-2.2 0-4.6 3.8-4.6 7.1A4.6 4.6 0 0 0 8 13.8a4.6 4.6 0 0 0 4.6-4.5C12.6 6 10.2 2.2 8 2.2Z" /><path d="M6.2 9.5c.1 1.1.7 1.7 1.8 2" /></>,
    package: <><path d="m8 2 5 2.8v6.4L8 14l-5-2.8V4.8z" /><path d="m3 4.8 5 2.9 5-2.9M8 7.7V14" /></>,
    flock: <><path d="M4 11c0-3 1.8-5 4.5-5S13 8 13 11" /><path d="M5 11v3M11 11v3M3 14h10" /><circle cx="8.5" cy="4" r="1.4" /></>,
    operations: <><path d="M4 3v10M8 3v10M12 3v10" /><path d="M2.5 5.5h3M6.5 9h3M10.5 6.5h3" /></>,
    house: <><path d="m2.5 7 5.5-4 5.5 4v6H2.5z" /><path d="M6 13V9h4v4" /></>,
    pens: <><rect x="3" y="3" width="4" height="4" rx="1" /><rect x="9" y="3" width="4" height="4" rx="1" /><rect x="3" y="9" width="4" height="4" rx="1" /><rect x="9" y="9" width="4" height="4" rx="1" /></>,
    health: <><path d="M8 13s-5-2.8-5-6.3A2.7 2.7 0 0 1 8 5a2.7 2.7 0 0 1 5 1.7C13 10.2 8 13 8 13Z" /><path d="M8 6.2v3.2M6.4 7.8h3.2" /></>,
    trace: <><circle cx="8" cy="8" r="5" /><circle cx="8" cy="8" r="2" /><path d="M8 1v2M8 13v2M1 8h2M13 8h2" /></>,
    inventory: <><path d="M3 5h10v8H3z" /><path d="M5 3h6v2H5zM5 8h6" /></>,
    money: <><rect x="2.5" y="3.5" width="11" height="9" rx="1.5" /><circle cx="8" cy="8" r="2" /></>,
    production: <><path d="M3 13V7l5-4 5 4v6" /><path d="M6 13V9h4v4" /></>,
    performance: <><path d="M3 12V8M6 12V5M9 12V3M12 12V6" /><path d="M2 13h11" /></>,
    camera: <><rect x="2" y="4.5" width="8" height="7" rx="1.5" /><path d="m10 7.5 4-2v5l-4-2z" /></>,
    reports: <><path d="M4 2.5h7l2 2V13H4z" /><path d="M8 7h3M6 9h5M6 11h4" /></>,
    settings: <><circle cx="8" cy="8" r="2.2" /><path d="m8 2 .7 1.4 1.6.4 1.2-1 1.7 1.7-1 1.2.4 1.6L14 8l-1.4.7-.4 1.6 1 1.2-1.7 1.7-1.2-1-1.6.4L8 14l-.7-1.4-1.6-.4-1.2 1-1.7-1.7 1-1.2-.4-1.6L2 8l1.4-.7.4-1.6-1-1.2L5.5 4.8l1.2 1 1.6-.4z" /></>,
    tasks: <><path d="M3 4.5 4.2 5.7 6.2 3.5M3 9.5l1.2 1.2 2-2.2M3 13.5h.01" /><path d="M8.5 4.5H13M8.5 9H13M8.5 13.5H13" /></>,
    harvest: <><path d="M3 12.5c1.5-3 3-4 5-4s3.500 1 5 4" /><path d="M8 8.5V3M6 5l2-2 2 2" /></>,
    truck: <><path d="M2 4.5h7.500v6H2zM9.500 7H12l2 2v1.500H9.500" /><circle cx="5" cy="11.500" r="1.200" /><circle cx="11.500" cy="11.500" r="1.200" /></>,
    shield: <><path d="M8 2 3 4v4c0 3 2.200 5 5 6 2.800-1 5-3 5-6V4z" /><path d="m6 8 1.500 1.500L10.500 6.500" /></>,
    vision: <><path d="M1.500 8S4 3.500 8 3.500 14.500 8 14.500 8 12 12.500 8 12.500 1.500 8 1.500 8Z" /><circle cx="8" cy="8" r="1.800" /></>,
    cart: <><path d="M2 3h2l1.500 7h6.500l1.500-5H5" /><circle cx="6" cy="12.500" r=".9" /><circle cx="11" cy="12.500" r=".9" /></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

/** Reads ?tab= without making the whole page wait for the browser (needs its own Suspense boundary). */
function SearchSync({ onChange }: { onChange: (search: string) => void }) {
  const params = useSearchParams();
  const text = params.toString();
  useEffect(() => onChange(text), [text, onChange]);
  return null;
}

export function Nav() {
  const pathname = usePathname();
  const session = useSession();
  const role = session?.role ?? null;
  const [search, setSearch] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [command, setCommand] = useState(false);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");

  const categories = useMemo(
    () => NAV.map(category => ({ ...category, items: category.items.filter(item => canSee(item, role)) })).filter(category => category.items.length > 0),
    [role],
  );
  const everything = useMemo(() => categories.flatMap(category => category.items.map(item => ({ category, item }))), [categories]);
  const here = locate(pathname);

  const isActive = (item: NavLeaf) => {
    const [base, query] = item.href.split("?");
    const onPath = base === "/" ? pathname === "/" : pathname === base || pathname.startsWith(base + "/");
    if (!onPath) return false;
    const wanted = new URLSearchParams(query ?? "").get("tab");
    const current = new URLSearchParams(search).get("tab");
    if (wanted) return current === wanted;
    // A plain page entry is not active while a sibling entry points at one of its tabs.
    const hasTabSibling = categories.some(category => category.items.some(other => other !== item && pathOf(other.href) === base && other.href.includes("?tab=")));
    return !(hasTabSibling && current);
  };

  // Remember which groups the person opened; the group holding the current page is always open.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("flockence-nav-open") || "{}");
      if (saved && typeof saved === "object") setOpen(saved);
    } catch { /* storage unavailable: groups simply start collapsed */ }
  }, []);
  const toggle = (id: string) => setOpen(prev => {
    const next = { ...prev, [id]: !(prev[id] ?? false) };
    try { localStorage.setItem("flockence-nav-open", JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });
  const expanded = (id: string) => here?.category.id === id || Boolean(open[id]);

  useEffect(() => { setCommand(false); setQuery(""); setDrawer(false); }, [pathname]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setCommand(value => !value); }
      if (event.key === "Escape") { setCommand(false); setDrawer(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function signOut() {
    setSigningOut(true);
    setSignOutError("");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("Sign-out was not confirmed.");
      window.location.assign("/login");
    } catch {
      setSignOutError("Could not sign out. Check your connection and try again.");
      setSigningOut(false);
    }
  }

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? everything.filter(({ category, item }) => (item.label + " " + category.label + " " + item.description).toLowerCase().includes(q)) : everything;
  }, [query, everything]);

  const link = (item: NavLeaf) => (
    <Link key={item.href} href={item.href} className={isActive(item) ? "active" : ""} aria-current={isActive(item) ? "page" : undefined}>
      <span aria-hidden="true" className="nav-glyph"><NavGlyph name={item.icon} /></span><span>{item.label}</span>
    </Link>
  );

  const groupList = (mobile: boolean) => categories.map(category => {
    const isOpen = expanded(category.id);
    return (
      <div className={`nav-group${isOpen ? " open" : ""}`} key={category.id}>
        <button type="button" className="nav-group-toggle" aria-expanded={isOpen} aria-controls={`${mobile ? "m" : "d"}-grp-${category.id}`} onClick={() => toggle(category.id)}>
          <span aria-hidden="true" className="nav-glyph"><NavGlyph name={category.icon} /></span>
          <span className="nav-group-name">{category.label}</span>
          <svg aria-hidden="true" className="nav-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="m4 6 4 4 4-4" /></svg>
        </button>
        {isOpen && <div className="nav-group-items" id={`${mobile ? "m" : "d"}-grp-${category.id}`}>{category.items.map(link)}</div>}
      </div>
    );
  });

  const signOutButton = process.env.NODE_ENV !== "development" && (
    <>
      <button className="nav-signout" type="button" onClick={() => void signOut()} disabled={signingOut}>{signingOut ? "Signing out…" : "Sign out"}</button>
      {signOutError && <p className="nav-signout-error" role="alert">{signOutError}</p>}
    </>
  );

  return <>
    <Suspense fallback={null}><SearchSync onChange={setSearch} /></Suspense>

    <nav className="nav" aria-label="Main navigation">
      <div className="nav-brand-block"><div className="nav-brand-mark">F</div><div><strong>Flockence</strong><span>Intelligent poultry management</span></div></div>
      <div className="nav-groups">{groupList(false)}</div>
      <div className="nav-bottom"><div className="nav-footer-status"><i /> Farm workspace</div>{signOutButton}</div>
    </nav>

    <header className="page-context">
      <button className="mobile-nav-toggle" type="button" aria-label="Open menu" aria-expanded={drawer} onClick={() => setDrawer(true)}>
        <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M2.500 4.500h11M2.500 8h11M2.500 11.500h11" /></svg>
      </button>
      <ol className="breadcrumbs" aria-label="You are here">
        <li><Link href="/">Flockence</Link></li>
        {here && here.item.href !== "/" && <li>{here.category.label}</li>}
        {here && here.item.href !== "/" && <li aria-current="page">{here.item.label}</li>}
        {here && here.item.href === "/" && <li aria-current="page">Overview</li>}
        {!here && <li aria-current="page">Page</li>}
      </ol>
      <button type="button" className="context-search" onClick={() => setCommand(true)} aria-label="Search Flockence"><span aria-hidden="true">⌕</span><span className="context-search-text">Find anything</span><kbd>Ctrl K</kbd></button>
      {here && here.category.items.filter(item => canSee(item, role)).length > 1 && (
        <nav className="page-tabs" aria-label={`${here.category.label} pages`}>
          {categories.find(category => category.id === here.category.id)?.items.map(item => (
            <Link key={item.href} href={item.href} className={isActive(item) ? "active" : ""} aria-current={isActive(item) ? "page" : undefined}>{item.label}</Link>
          ))}
        </nav>
      )}
    </header>

    <nav className="bottom-nav" aria-label="Quick navigation">
      {[NAV[0].items[0], NAV[0].items[1], NAV[1].items[0], NAV[2].items[4]].map(item => (
        <Link key={item.href} href={item.href} className={isActive(item) ? "active" : ""} aria-current={isActive(item) ? "page" : undefined}>
          <NavGlyph name={item.icon} /><span>{item.label.replace("Daily Round", "Round")}</span>
        </Link>
      ))}
      <button type="button" onClick={() => setDrawer(true)} aria-label="All destinations" aria-expanded={drawer}>
        <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round"><circle cx="3.500" cy="8" r=".6" /><circle cx="8" cy="8" r=".6" /><circle cx="12.500" cy="8" r=".6" /></svg><span>More</span>
      </button>
    </nav>

    {drawer && <div className="drawer-backdrop" onClick={() => setDrawer(false)} aria-hidden="true" />}
    <aside className={`mobile-drawer${drawer ? " open" : ""}`} aria-label="Navigation menu" aria-hidden={!drawer}>
      <div className="drawer-head"><div className="brand-main"><div className="brand-mark">F</div><div><strong>Flockence</strong><p>Intelligent poultry management</p></div></div><button className="icon-button" type="button" aria-label="Close menu" onClick={() => setDrawer(false)}>×</button></div>
      <button className="drawer-search" type="button" onClick={() => { setDrawer(false); setCommand(true); }}><span aria-hidden="true">⌕</span> Find anything</button>
      <div className="nav-groups">{groupList(true)}</div>
      <div className="drawer-footer">{signOutButton}</div>
    </aside>

    {command && <div className="command-backdrop" role="presentation" onMouseDown={() => setCommand(false)}>
      <div className="command-palette" role="dialog" aria-modal="true" aria-label="Flockence search" onMouseDown={event => event.stopPropagation()}>
        <div className="command-input-wrap"><span aria-hidden="true">⌕</span><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Search pages, for example health, eggs, transport…" aria-label="Search Flockence" /><kbd>ESC</kbd></div>
        <div className="command-section-label">{query ? "Results" : "Jump to"}</div>
        <div className="command-results">
          {results.length ? results.map(({ category, item }) =>
            <Link key={item.href} href={item.href} className={isActive(item) ? "current" : ""} onClick={() => setCommand(false)}>
              <span className="command-icon"><NavGlyph name={item.icon} /></span><span><strong>{item.label}</strong><small>{category.label} · {item.description}</small></span><span className="command-arrow">↵</span>
            </Link>
          ) : <div className="command-empty">No matching Flockence page.</div>}
        </div>
        <div className="command-footer"><span>↑↓ Navigate</span><span>↵ Open</span><span>ESC Close</span></div>
      </div>
    </div>}
  </>;
}
