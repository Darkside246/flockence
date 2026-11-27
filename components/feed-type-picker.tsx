"use client";
import { useEffect, useMemo, useState } from "react";

export type FeedProduct = { id: string; brand: string; name: string; label: string; defaultBagKg: number | null; preferredSupplierId: string | null; active: boolean };

let cache: Promise<FeedProduct[]> | null = null;
/** The farm's feed catalogue (started from the Pinnacle and Super Feeds lists, then the farm's own), loaded once per page. */
export function loadFeedProducts(refresh = false) {
  if (!cache || refresh) cache = fetch("/api/feed-products", { cache: "no-store" }).then(r => (r.ok ? r.json() : [])).catch(() => []);
  return cache;
}

/**
 * Pick a feed from the farm's catalogue, grouped by brand. "Another feed" types a new one, which is added to the
 * catalogue the first time it is used. `value` is the feed's name as written on records ("Brand · Name").
 */
export function FeedTypePicker({ value, onChange, onProduct, required = true }: { value: string; onChange: (value: string) => void; onProduct?: (p: FeedProduct | null) => void; required?: boolean }) {
  const [products, setProducts] = useState<FeedProduct[]>([]);
  const [custom, setCustom] = useState(false);
  useEffect(() => { void loadFeedProducts().then(setProducts); }, []);
  const groups = useMemo(() => {
    const m = new Map<string, FeedProduct[]>();
    for (const p of products) m.set(p.brand || "Your own feeds", [...(m.get(p.brand || "Your own feeds") ?? []), p]);
    return [...m.entries()];
  }, [products]);
  const known = products.some(p => p.label === value);
  return <div>
    <label>Feed<select required={required} value={custom || (value && !known) ? "other" : value} onChange={e => {
      const v = e.target.value;
      setCustom(v === "other");
      const p = products.find(x => x.label === v) ?? null;
      onChange(v === "other" ? "" : v); onProduct?.(p);
    }}>
      <option value="">Choose the feed</option>
      {groups.map(([brand, list]) => <optgroup key={brand} label={brand}>{list.map(p => <option key={p.id} value={p.label}>{p.name}{p.defaultBagKg ? ` (${p.defaultBagKg} kg bag)` : ""}</option>)}</optgroup>)}
      <option value="other">Another feed…</option>
    </select></label>
    {(custom || (value && !known)) && <label>Feed name on the bag<input required maxLength={160} value={value} onChange={e => { onChange(e.target.value); onProduct?.(null); }} placeholder="Brand · feed name" /></label>}
  </div>;
}
