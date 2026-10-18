/** Where a client gets custom packs and addons: its cache first, then a checked download. */
import { cachedPack, cachedPacks, cachePack, forgetPack } from './cache';
import { importZip, type Imported } from './custom';

export interface PackLoader {
  /** A game or addon this page cached before, or null. */
  cached(hash: string): Promise<Imported | null>;
  /** Checks, loads and caches a downloaded zip. Throws PackImportError with readable problems. */
  load(bytes: Uint8Array, hash: string): Promise<Imported>;
}

const nameOf = (item: Imported) => (item.kind === 'game' ? item.pack.pack.name : item.addon.addon.name);

export const browserPackLoader: PackLoader = {
  async cached(hash) {
    const hit = await cachedPack(hash);
    if (!hit) return null;
    try {
      return await importZip(hit.bytes, { expectHash: hash });
    } catch {
      // A cached zip that no longer loads (a newer engine, say) is dropped and downloaded again.
      await forgetPack(hash);
      return null;
    }
  },
  async load(bytes, hash) {
    const item = await importZip(bytes, { expectHash: hash });
    await cachePack(hash, nameOf(item), bytes);
    return item;
  },
};

/** Every cached game and addon that still loads, newest first. Ones that do not are dropped. */
export async function loadCachedPacks(): Promise<Imported[]> {
  const out: Imported[] = [];
  for (const hit of await cachedPacks()) {
    try {
      out.push(await importZip(hit.bytes, { expectHash: hit.hash }));
    } catch {
      await forgetPack(hit.hash);
    }
  }
  return out;
}
