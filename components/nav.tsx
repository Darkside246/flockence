"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useSession } from "@/components/auth-gate";

type NavItem = readonly [string, string, string];

const groups: { label: string; items: NavItem[] }[] = [
  { label: "Operate", items: [["Overview", "/", "home"], ["Flocks", "/batches", "flock"], ["Daily Rounds", "/operations", "operations"], ["Egg production", "/layers", "eggs"], ["Layer performance", "/layers/performance", "performance"], ["Pack eggs", "/layers/packing", "package"], ["House", "/house", "house"], ["Pens", "/pens", "pens"], ["Health", "/health", "health"]] },
  { label: "Control", items: [["Trace", "/trace", "trace"], ["Cameras", "/cameras", "camera"], ["Inventory", "/inventory", "inventory"], ["Finances", "/finances", "money"], ["Production", "/planning", "production"]] },
  { label: "Understand", items: [["Performance", "/performance", "performance"], ["Reports", "/reports", "reports"]] }
];
const teamGroup = { label: "Manage", items: [["Team", "/team", "users"]] as NavItem[] };
const settings: NavItem = ["Settings", "/settings", "settings"];

function NavIcon({name}:{name:string}) {
  const paths:Record<string,React.ReactNode>={
    home:<><path d="m3 7 5-4 5 4v6H9v-4H7v4H3z"/></>,
    users:<><circle cx="6" cy="5" r="2"/><path d="M2.5 13v-1.2A3.5 3.5 0 0 1 6 8.3a3.5 3.5 0 0 1 3.5 3.5V13z"/><path d="M10 3.5a2 2 0 0 1 0 3.8M11 8.5a3.2 3.2 0 0 1 2.5 3.1V13"/></>,
    eggs:<><path d="M8 2.2c-2.2 0-4.6 3.8-4.6 7.1A4.6 4.6 0 0 0 8 13.8a4.6 4.6 0 0 0 4.6-4.5C12.6 6 10.2 2.2 8 2.2Z"/><path d="M6.2 9.5c.1 1.1.7 1.7 1.8 2"/></>,
    package:<><path d="m8 2 5 2.8v6.4L8 14l-5-2.8V4.8z"/><path d="m3 4.8 5 2.9 5-2.9M8 7.7V14"/></>,
    flock:<><path d="M4 11c0-3 1.8-5 4.5-5S13 8 13 11"/><path d="M5 11v3M11 11v3M3 14h10"/><circle cx="8.5" cy="4" r="1.4"/></>,
    operations:<><path d="M4 3v10M8 3v10M12 3v10"/><path d="M2.5 5.5h3M6.5 9h3M10.5 6.5h3"/></>,
    house:<><path d="m2.5 7 5.5-4 5.5 4v6H2.5z"/><path d="M6 13V9h4v4"/></>,
    pens:<><rect x="3" y="3" width="4" height="4" rx="1"/><rect x="9" y="3" width="4" height="4" rx="1"/><rect x="3" y="9" width="4" height="4" rx="1"/><rect x="9" y="9" width="4" height="4" rx="1"/></>,
    health:<><path d="M8 13s-5-2.8-5-6.3A2.7 2.7 0 0 1 8 5a2.7 2.7 0 0 1 5 1.7C13 10.2 8 13 8 13Z"/><path d="M8 6.2v3.2M6.4 7.8h3.2"/></>,
    trace:<><circle cx="8" cy="8" r="5"/><circle cx="8" cy="8" r="2"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2"/></>,
    inventory:<><path d="M3 5h10v8H3z"/><path d="M5 3h6v2H5zM5 8h6"/></>,
    money:<><rect x="2.5" y="3.5" width="11" height="9" rx="1.5"/><circle cx="8" cy="8" r="2"/></>,
    production:<><path d="M3 13V7l5-4 5 4v6"/><path d="M6 13V9h4v4"/></>,
    performance:<><path d="M3 12V8M6 12V5M9 12V3M12 12V6"/><path d="M2 13h11"/></>,
    camera:<><rect x="2" y="4.5" width="8" height="7" rx="1.5"/><path d="m10 7.5 4-2v5l-4-2z"/></>,
    reports:<><path d="M4 2.5h7l2 2V13H4z"/><path d="M8 7h3M6 9h5M6 11h4"/></>,
    settings:<><circle cx="8" cy="8" r="2.2"/><path d="m8 2 .7 1.4 1.6.4 1.2-1 1.7 1.7-1 1.2.4 1.6L14 8l-1.4.7-.4 1.6 1 1.2-1.7 1.7-1.2-1-1.6.4L8 14l-.7-1.4-1.6-.4-1.2 1-1.7-1.7 1-1.2-.4-1.6L2 8l1.4-.7.4-1.6-1-1.2L5.5 4.8l1.2 1 1.6-.4z"/></>
  };
  return <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

export function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [inlineSearch,setInlineSearch]=useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [query, setQuery] = useState("");
  const session = useSession();
  const canManage = session?.role === "OWNER" || session?.role === "MANAGER";
  const visibleGroups = useMemo(() => canManage ? [...groups, teamGroup] : groups, [canManage]);
  const visibleItems = useMemo(() => visibleGroups.flatMap(group => group.items), [visibleGroups]);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
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
  const isActive = (href: string) => href === "/" ? pathname === "/" : pathname.startsWith(href);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? visibleItems.filter(([label, href]) => (label + " " + href).toLowerCase().includes(q)) : visibleItems;
  }, [query, visibleItems]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(value => !value);
      }
      if (event.key === "Escape") { setCommandOpen(false); setOpen(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    setCommandOpen(false); setInlineSearch(false); setQuery("");
    const links=JSON.parse(sessionStorage.getItem("flockence.navTrail") || "[]") as string[];
    if(links[links.length-1]!==pathname){
      if(links[links.length-2]===pathname)links.pop();else links.push(pathname);
      sessionStorage.setItem("flockence.navTrail",JSON.stringify(links.slice(-30)));
    }
  }, [pathname]);

  const links = (items: NavItem[], mobile = false) => items.map(([label, href, icon]) =>
    <Link key={href} href={href} onClick={() => mobile && setOpen(false)} className={isActive(href) ? "active" : ""} title={label}>
      <span aria-hidden="true" className="nav-glyph"><NavIcon name={icon}/></span><span>{label}</span>
    </Link>
  );

  return <>
    <div className="farm-page-tools" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setInlineSearch(false);}}>
      {pathname!=="/" && <button type="button" className="button" onClick={()=>{const trail=JSON.parse(sessionStorage.getItem("flockence.navTrail")||"[]") as string[];const back=trail.at(-2);window.location.assign(back?.startsWith("/") && !back.startsWith("//")?back:"/");}}>← Back</button>}
      <label><svg aria-hidden="true" width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="8" cy="8" r="5"/><path d="m12 12 5 5"/></svg>
      <input aria-label="Search Flockence" placeholder="Search" value={commandOpen?"":query} onFocus={()=>setInlineSearch(true)} onKeyDown={e=>{if(e.key==="Escape"){setInlineSearch(false);e.currentTarget.blur();}}} onChange={e=>{setQuery(e.target.value);setInlineSearch(true);}}/></label>
      {inlineSearch && !commandOpen && <div className="farm-search-results">{results.length?results.map(([name,href])=><Link key={href} href={href} onClick={()=>setInlineSearch(false)}>{name}</Link>):<span>No matches</span>}</div>}
    </div>
    <nav className="nav" aria-label="Main navigation">
      <div className="nav-brand-block"><div className="nav-brand-mark">F</div><div><strong>Flockence</strong><span>Intelligent poultry management</span></div></div>
      {visibleGroups.map(group => <div className="nav-group" key={group.label}><div className="nav-group-label">{group.label}</div>{links(group.items)}</div>)}
      <div className="nav-bottom">{links([settings])}<div className="nav-footer-status"><i /> Farm workspace</div>{process.env.NODE_ENV !== "development" && <><button className="nav-signout" type="button" onClick={() => void signOut()} disabled={signingOut}>{signingOut ? "Signing out…" : "Sign out"}</button>{signOutError && <p className="nav-signout-error" role="alert">{signOutError}</p>}</>}</div>
    </nav>

    <nav className="bottom-nav" aria-label="Quick navigation">
      {([["Dash", "/", "home"], ["Cameras", "/cameras", "camera"], ["Flocks", "/batches", "flock"], ["Houses", "/house", "house"]] as NavItem[]).map(([label, href, icon]) =>
        <Link key={href} href={href} className={isActive(href) ? "active" : ""} aria-current={isActive(href) ? "page" : undefined}><NavIcon name={icon}/><span>{label}</span></Link>
      )}
      <button type="button" onClick={() => setOpen(true)} aria-label="More destinations" aria-expanded={open}>
        <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round"><circle cx="3.5" cy="8" r=".6"/><circle cx="8" cy="8" r=".6"/><circle cx="12.5" cy="8" r=".6"/></svg><span>More</span>
      </button>
    </nav>

    <button className="mobile-nav-toggle" aria-label="Open menu" onClick={() => setOpen(true)}>☰</button>
    {open && <div className="drawer-backdrop" onClick={() => setOpen(false)} aria-hidden="true"/>}
    <aside className={`mobile-drawer${open ? " open" : ""}`} aria-label="Navigation menu">
      <div className="drawer-head"><div className="brand-main"><div className="brand-mark">F</div><div><strong>Flockence</strong><p>Farmer operating system</p></div></div><button className="icon-button" aria-label="Close menu" onClick={() => setOpen(false)}>×</button></div>
      <button className="drawer-search" type="button" onClick={() => { setOpen(false); setCommandOpen(true); }}><span>⌕</span> Find anything <kbd>⌘K</kbd></button>
      {visibleGroups.map(group => <div className="drawer-group" key={group.label}><div className="drawer-group-label">{group.label}</div><div className="drawer-links">{links(group.items, true)}</div></div>)}
      <div className="drawer-group"><div className="drawer-group-label">Workspace</div><div className="drawer-links">{links([settings], true)}</div>{process.env.NODE_ENV !== "development" && <><button className="nav-signout" type="button" onClick={() => { setOpen(false); void signOut(); }} disabled={signingOut}>{signingOut ? "Signing out…" : "Sign out"}</button>{signOutError && <p className="nav-signout-error" role="alert">{signOutError}</p>}</>}</div>
    </aside>

    {commandOpen && <div className="command-backdrop" role="presentation" onMouseDown={() => setCommandOpen(false)}>
      <div className="command-palette" role="dialog" aria-modal="true" aria-label="Flockence search" onMouseDown={event => event.stopPropagation()}>
        <div className="command-input-wrap"><span>⌕</span><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Search batches, operations, inventory, reports…" aria-label="Search Flockence" /><kbd>ESC</kbd></div>
        <div className="command-section-label">{query ? "Results" : "Jump to"}</div>
        <div className="command-results">
          {results.length ? results.map(([label, href, icon]) =>
            <Link key={href} href={href} className={isActive(href) ? "current" : ""} onClick={() => setCommandOpen(false)}>
              <span className="command-icon"><NavIcon name={icon}/></span><span><strong>{label}</strong><small>{href === "/" ? "Farm overview" : href.slice(1).replaceAll("/", " / ")}</small></span><span className="command-arrow">↵</span>
            </Link>
          ) : <div className="command-empty">No matching Flockence destination.</div>}
        </div>
        <div className="command-footer"><span>Navigate</span><span>↵ Open</span><span>ESC Close</span></div>
      </div>
    </div>}
  </>;
}
