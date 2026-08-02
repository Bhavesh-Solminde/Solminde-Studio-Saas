import { API, authHeaders } from './sync';

/**
 * Authenticated JSON fetch for the owner-facing admin surfaces (Reports, Setup,
 * Site). These read and write server-side data, so — unlike the billing path —
 * they legitimately talk to the API; this is the one place that boilerplate
 * lives. Throws on a non-2xx with the server's message so callers can surface it.
 */
export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}/api${path}`, { ...init, headers: authHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}
