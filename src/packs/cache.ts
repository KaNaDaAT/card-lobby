/**
 * Custom packs cached in IndexedDB by hash, so a pack is downloaded once and an uploaded pack
 * stays in the host's gallery. Each `?as=` slot has its own cache, like a separate device.
 * Storage can be blocked (private mode): then every call quietly does nothing.
 */
import { slotName } from '../identity';

const STORE = 'packs';
/** Older packs are dropped beyond this many. */
const KEEP = 12;

export interface CachedPack {
  hash: string;
  name: string;
  bytes: Uint8Array;
  savedAt: number;
}

let db: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  db ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(slotName('db'), 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'hash' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((err: unknown) => {
    db = null;
    throw err;
  });
  return db;
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(d.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function cachedPack(hash: string): Promise<CachedPack | null> {
  try {
    return ((await run('readonly', (s) => s.get(hash))) as CachedPack | undefined) ?? null;
  } catch {
    return null;
  }
}

/** Every cached pack, newest first. */
export async function cachedPacks(): Promise<CachedPack[]> {
  try {
    const all = (await run('readonly', (s) => s.getAll())) as CachedPack[];
    return all.sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

export async function cachePack(hash: string, name: string, bytes: Uint8Array): Promise<void> {
  try {
    await run('readwrite', (s) => s.put({ hash, name, bytes, savedAt: Date.now() } satisfies CachedPack));
    const old = (await cachedPacks()).slice(KEEP);
    for (const p of old) await forgetPack(p.hash);
  } catch {
    // No cache: the pack is downloaded again next time.
  }
}

export async function forgetPack(hash: string): Promise<void> {
  try {
    await run('readwrite', (s) => s.delete(hash));
  } catch {
    // Nothing to forget.
  }
}
