import type { Addon, LoadedPack, Pack, PackIndex } from './types';

const PACKS_URL = `${import.meta.env.BASE_URL}packs/`;

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

/** Loads every built-in pack listed in public/packs/index.json, with its addons. */
export async function loadBuiltInPacks(): Promise<LoadedPack[]> {
  const index = await fetchJson<PackIndex>(`${PACKS_URL}index.json`);
  return Promise.all(index.packs.map(loadBuiltInPack));
}

export async function loadBuiltInPack(id: string): Promise<LoadedPack> {
  const base = `${PACKS_URL}${id}/`;
  const pack = await fetchJson<Pack>(`${base}pack.json`);
  const addons = await Promise.all((pack.addons ?? []).map((p) => fetchJson<Addon>(base + p)));
  return { key: pack.id, pack, addons, asset: (path) => base + path };
}
