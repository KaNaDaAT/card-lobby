/** Where a client gets custom packs: its cache first, then a checked download. */
import { cachedPack, cachedPacks, cachePack, forgetPack } from './cache';
import { importPackZip } from './custom';
import type { LoadedPack } from './types';

export interface PackLoader {
  /** A pack this page cached before, or null. */
  cached(hash: string): Promise<LoadedPack | null>;
  /** Checks, loads and caches a downloaded pack. Throws PackImportError with readable problems. */
  load(bytes: Uint8Array, hash: string): Promise<LoadedPack>;
}

export const browserPackLoader: PackLoader = {
  async cached(hash) {
    const hit = await cachedPack(hash);
    if (!hit) return null;
    try {
      return await importPackZip(hit.bytes, { expectHash: hash });
    } catch {
      // A cached pack that no longer loads (a newer engine, say) is dropped and downloaded again.
      await forgetPack(hash);
      return null;
    }
  },
  async load(bytes, hash) {
    const lp = await importPackZip(bytes, { expectHash: hash });
    await cachePack(hash, lp.pack.name, bytes);
    return lp;
  },
};

/** Every cached pack that still loads, newest first. Ones that do not are dropped. */
export async function loadCachedPacks(): Promise<LoadedPack[]> {
  const out: LoadedPack[] = [];
  for (const hit of await cachedPacks()) {
    try {
      out.push(await importPackZip(hit.bytes, { expectHash: hit.hash }));
    } catch {
      await forgetPack(hit.hash);
    }
  }
  return out;
}
