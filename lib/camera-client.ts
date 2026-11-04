export const api = (p: string) => `/api/cameras/${p}`;
export const enc = encodeURIComponent;

export async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || d.detail || `Request failed (${r.status})`);
  return d as T;
}
