// The single source of truth for how Flockence is organised: the sidebar, the mobile drawer,
// the search palette, breadcrumbs and the secondary tabs inside a category all read from here.
// A page belongs to exactly one category. `aliases` are old addresses that now redirect (see next.config.mjs).

export type NavIcon =
  | "home" | "users" | "eggs" | "package" | "flock" | "operations" | "house" | "pens" | "health" | "trace"
  | "inventory" | "money" | "production" | "performance" | "camera" | "reports" | "settings" | "tasks"
  | "harvest" | "truck" | "shield" | "vision" | "cart";

export type NavLeaf = {
  label: string;
  href: string;
  icon: NavIcon;
  /** Role needed to see it. Everyone signed in sees an item with no `roles`. */
  roles?: readonly ("OWNER" | "MANAGER")[];
  /** One line shown under the page title. */
  description: string;
};

export type NavCategory = {
  id: string;
  label: string;
  icon: NavIcon;
  items: NavLeaf[];
};

export const NAV: NavCategory[] = [
  {
    id: "workspace", label: "Workspace", icon: "home",
    items: [
      { label: "Overview", href: "/", icon: "home", description: "Farm-wide summary, alerts and shortcuts." },
      { label: "Daily Round", href: "/daily-round", icon: "operations", description: "Today's flock checks, counts, weights and welfare." },
      { label: "Tasks", href: "/daily-round?tab=tasks", icon: "tasks", description: "What still needs doing today." },
    ],
  },
  {
    id: "production", label: "Production", icon: "flock",
    items: [
      { label: "Flocks", href: "/batches", icon: "flock", description: "Start and manage broiler and layer flocks." },
      { label: "Layer Production", href: "/layers", icon: "eggs", description: "Egg collection and layer stage." },
      { label: "Egg Packing", href: "/layers/packing", icon: "package", description: "Grade eggs and pack cartons." },
      { label: "Layer Performance", href: "/layers/performance", icon: "performance", description: "Lay rate and egg output over time." },
      { label: "Production Planning", href: "/planning", icon: "production", description: "Lifecycle targets and harvest planning." },
      { label: "Harvest & Processing", href: "/harvest", icon: "harvest", description: "Slaughter events, processing outputs and by-products." },
    ],
  },
  {
    id: "farm", label: "Farm Management", icon: "house",
    items: [
      { label: "Housing", href: "/house", icon: "house", description: "House layout and capacity checks." },
      { label: "Pens", href: "/pens", icon: "pens", description: "Pen profiles and stocking limits." },
      { label: "Flock Health", href: "/health", icon: "health", description: "Cases, diagnostic tests and treatments." },
      { label: "Food Safety", href: "/food-safety", icon: "shield", description: "Biosecurity and food-safety checklist." },
      { label: "Cameras", href: "/cameras", icon: "camera", description: "Live view, stills and recordings." },
      { label: "Farm Vision", href: "/vision", icon: "vision", description: "Photo and video checks of the flock." },
    ],
  },
  {
    id: "business", label: "Business", icon: "money",
    items: [
      { label: "Inventory", href: "/inventory", icon: "inventory", description: "Stock, storage and cold chain." },
      { label: "Finance", href: "/finances", icon: "money", description: "Purchases, expenses, sales and orders." },
      { label: "Transport", href: "/transport", icon: "truck", description: "Journeys and cold-chain records." },
    ],
  },
  {
    id: "insights", label: "Insights", icon: "performance",
    items: [
      { label: "Performance", href: "/performance", icon: "performance", description: "Compare flocks and periods." },
      { label: "Traceability", href: "/trace", icon: "trace", description: "Follow a product back to its flock." },
      { label: "Reports", href: "/reports", icon: "reports", description: "Export and review farm reports." },
    ],
  },
  {
    id: "admin", label: "Administration", icon: "settings",
    items: [
      { label: "Team", href: "/team", icon: "users", roles: ["OWNER", "MANAGER"], description: "People and what they can do." },
      { label: "Settings", href: "/settings", icon: "settings", description: "Farm profile, defaults, devices and appearance." },
    ],
  },
];

/** Old addresses that still work: they redirect to the new home (wired in next.config.mjs). */
export const ALIASES: Record<string, string> = {
  "/operations": "/daily-round",
};

export const pathOf = (href: string) => href.split("?")[0];

export function canSee(item: NavLeaf, role?: string | null) {
  return !item.roles || (role !== undefined && role !== null && (item.roles as readonly string[]).includes(role));
}

/** The category and item for a pathname; the longest matching address wins so /layers/packing beats /layers. */
export function locate(pathname: string) {
  let best: { category: NavCategory; item: NavLeaf } | null = null;
  for (const category of NAV) {
    for (const item of category.items) {
      const base = pathOf(item.href);
      const hit = base === "/" ? pathname === "/" : pathname === base || pathname.startsWith(base + "/");
      if (hit && (!best || base.length > pathOf(best.item.href).length)) best = { category, item };
    }
  }
  return best;
}

/** Items that share a page's category, for the tab row. Query-only items (Tasks) are tabs of the page they point at. */
export function siblings(pathname: string, role?: string | null) {
  const found = locate(pathname);
  if (!found) return [];
  return found.category.items.filter(item => canSee(item, role));
}
