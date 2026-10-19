/**
 * Custom packs: a zip with pack.json (a game) or addon.json (an addon for a game the lobby
 * has) at its root, or inside one top folder, plus images. See docs/DESIGN.md, "Custom packs".
 * A pack is data only. It is unzipped within limits, validated like a built-in pack, and its
 * images are served only as blob: URLs in <img>, where an SVG cannot run scripts.
 */
import type { Addon, LoadedAddon, LoadedPack, Pack, PackOffer } from './types';
import { validateAddon, validatePack, validateSelection } from './validate';
import { readZip, ZipError } from './zip';

export const MAX_PACK_BYTES = 25 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_FILES = 500;
const MAX_TOTAL_BYTES = 80 * 1024 * 1024;

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

/** Files that zip tools add on their own. They are skipped, not rejected. */
const JUNK = /(^|\/)(__MACOSX\/.*|\.DS_Store|Thumbs\.db|desktop\.ini)$/;

const extOf = (path: string) => path.slice(path.lastIndexOf('.') + 1).toLowerCase();

export class PackImportError extends Error {
  constructor(readonly problems: string[]) {
    super(problems[0]);
  }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const customKey = (hash: string) => `custom:${hash}`;
export const customAddonKey = (hash: string) => `custom-addon:${hash}`;

export interface ImportOptions {
  /** Makes a URL for an image. Defaults to URL.createObjectURL. */
  url?: (blob: Blob) => string;
  /** The SHA-256 the zip must have, when it came from someone else. */
  expectHash?: string;
}

/** What a zip turned out to be. */
export type Imported = { kind: 'game'; pack: LoadedPack } | { kind: 'addon'; addon: LoadedAddon };

/** Unzips and checks a custom zip: a game or an addon. Throws PackImportError with readable problems. */
export async function importZip(bytes: Uint8Array, opts: ImportOptions = {}): Promise<Imported> {
  const { hash, files } = await unzip(bytes, opts);
  const hasPack = files.has('pack.json');
  const hasAddon = files.has('addon.json');
  if (hasPack && hasAddon) throw new PackImportError(['The zip has both pack.json and addon.json. A zip is either a game or an addon.']);
  if (hasAddon) return { kind: 'addon', addon: loadAddon(bytes, hash, files, opts) };
  if (hasPack) return { kind: 'game', pack: loadGame(bytes, hash, files, opts) };
  throw new PackImportError(['The zip has no pack.json (for a game) or addon.json (for an addon).']);
}

/** Like importZip, for a zip that must be a game. */
export async function importPackZip(bytes: Uint8Array, opts: ImportOptions = {}): Promise<LoadedPack> {
  const result = await importZip(bytes, opts);
  if (result.kind !== 'game') throw new PackImportError(['This zip is an addon, not a game.']);
  return result.pack;
}

async function unzip(bytes: Uint8Array, opts: ImportOptions): Promise<{ hash: string; files: Map<string, Uint8Array> }> {
  if (bytes.length > MAX_PACK_BYTES) {
    throw new PackImportError([`The pack is bigger than the ${mb(MAX_PACK_BYTES)} limit.`]);
  }
  const hash = await sha256Hex(bytes);
  if (opts.expectHash && opts.expectHash !== hash) throw new PackImportError(['The pack arrived damaged (its checksum does not match).']);

  let entries: Map<string, Uint8Array>;
  try {
    entries = await readZip(bytes, {
      maxEntries: MAX_FILES,
      maxTotalBytes: MAX_TOTAL_BYTES,
      maxEntryBytes: (path) => (extOf(path) === 'json' ? MAX_JSON_BYTES : MAX_IMAGE_BYTES),
    });
  } catch (err) {
    throw new PackImportError([err instanceof ZipError ? `Zip problem: ${err.message}.` : String(err)]);
  }

  const files = rootFiles(entries);
  const problems: string[] = [];
  for (const path of files.keys()) {
    const ext = extOf(path);
    if (ext !== 'json' && !IMAGE_MIME[ext]) problems.push(`${path}: only .json files and png, jpg, webp or svg images may be in a pack`);
  }
  if (problems.length) throw new PackImportError(problems);
  return { hash, files };
}

/** URLs for a zip's images, made the first time each one is shown. */
function imageUrls(files: Map<string, Uint8Array>, opts: ImportOptions): { images: Set<string>; asset(path: string): string } {
  const images = new Set([...files.keys()].filter((path) => IMAGE_MIME[extOf(path)]));
  const urls = new Map<string, string>();
  const makeUrl = opts.url ?? ((blob: Blob) => URL.createObjectURL(blob));
  return {
    images,
    asset: (path) => {
      let url = urls.get(path);
      if (!url && images.has(path)) {
        url = makeUrl(new Blob([files.get(path)! as Uint8Array<ArrayBuffer>], { type: IMAGE_MIME[extOf(path)] }));
        urls.set(path, url);
      }
      return url ?? '';
    },
  };
}

function loadGame(bytes: Uint8Array, hash: string, files: Map<string, Uint8Array>, opts: ImportOptions): LoadedPack {
  const problems: string[] = [];
  const pack = parseJson<Pack>(files, 'pack.json', problems);
  if (problems.length || !pack) throw new PackImportError(problems);

  const addonPaths = Array.isArray(pack.addons) ? pack.addons.filter((p): p is string => typeof p === 'string') : [];
  const addons = addonPaths.map((path) => parseJson<Addon>(files, path, problems)).filter((a): a is Addon => Boolean(a));
  if (problems.length) throw new PackImportError(problems);

  const { images, asset } = imageUrls(files, opts);
  const lp: LoadedPack = {
    key: customKey(hash),
    pack,
    addons,
    asset,
    custom: { bytes, offer: offerOf(hash, 'game', pack.name, pack.author, bytes, images.size) },
  };

  // The base pack, then each addon with what it requires.
  const errors = new Set(validatePack(pack, { files: images }));
  if (!errors.size) {
    for (const addon of addons) {
      const enabled = [addon.id, ...(Array.isArray(addon.requires) ? addon.requires : [])];
      for (const e of validateSelection(lp, enabled, images)) errors.add(e);
    }
  }
  if (errors.size) throw new PackImportError([...errors]);
  return lp;
}

/**
 * An addon zip. Its shape and images are checked here; how it fits its game is checked when the
 * host puts the two together (see withUploads and the host session).
 */
function loadAddon(bytes: Uint8Array, hash: string, files: Map<string, Uint8Array>, opts: ImportOptions): LoadedAddon {
  const problems: string[] = [];
  const raw = parseJson<Addon>(files, 'addon.json', problems);
  if (problems.length || !raw) throw new PackImportError(problems);
  const { images, asset } = imageUrls(files, opts);

  const errors = validateAddon(raw, 'addon.json', images);
  if (typeof raw.extends !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw.extends)) {
    errors.push('addon.json: extends: the id of the game this addon is for, like "power-hungry-pets"');
  }
  if (raw.author !== undefined && typeof raw.author !== 'string') errors.push('addon.json: author: expected text');
  // Card images are only checked against the game's files once merged, so check them here.
  const cardImages = [...(Array.isArray(raw.cards?.add) ? raw.cards!.add : []), ...Object.values(raw.cards?.modify ?? {})]
    .map((c) => (c && typeof c === 'object' ? (c as { image?: unknown }).image : undefined))
    .filter((p): p is string => typeof p === 'string');
  for (const path of cardImages) if (!images.has(path)) errors.push(`addon.json: image "${path}" is missing from the zip`);
  if (errors.length) throw new PackImportError(errors);

  // Image paths move under a folder of their own, out of the way of the game's files.
  const prefix = `uploads/${hash.slice(0, 16)}/`;
  const addon = structuredClone(raw);
  if (addon.image) addon.image = prefix + addon.image;
  if (addon.icon) addon.icon = prefix + addon.icon;
  for (const card of addon.cards?.add ?? []) if (card.image) card.image = prefix + card.image;
  for (const patch of Object.values(addon.cards?.modify ?? {})) if (patch.image) patch.image = prefix + patch.image;

  return {
    key: customAddonKey(hash),
    gameId: raw.extends!,
    addon,
    prefix,
    asset: (path) => (path.startsWith(prefix) ? asset(path.slice(prefix.length)) : ''),
    custom: { bytes, offer: { ...offerOf(hash, 'addon', raw.name, raw.author, bytes, images.size), extends: raw.extends! } },
  };
}

function offerOf(hash: string, kind: PackOffer['kind'], name: unknown, author: unknown, bytes: Uint8Array, images: number): PackOffer {
  return { hash, kind, name: String(name), ...(typeof author === 'string' ? { author } : {}), bytes: bytes.length, images };
}

/**
 * A game with addons from their own zips added after its own. Their images resolve through the
 * addon they came with. Errors about them name their zip.
 */
export function withUploads(base: LoadedPack, uploads: readonly LoadedAddon[]): LoadedPack {
  if (!uploads.length) return base;
  return {
    ...base,
    pack: { ...base.pack, addons: [...(base.pack.addons ?? []).slice(0, base.addons.length), ...uploads.map((u) => `${u.custom.offer.name}/addon.json`)] },
    addons: [...base.addons, ...uploads.map((u) => u.addon)],
    asset: (path) => uploads.find((u) => path.startsWith(u.prefix))?.asset(path) ?? base.asset(path),
    uploads: [...uploads],
  };
}

/** Why an uploaded addon cannot go with this game, or an empty list. */
export function uploadProblems(base: LoadedPack, upload: LoadedAddon, others: readonly LoadedAddon[]): string[] {
  const addon = upload.addon;
  if ([...base.addons, ...others.map((o) => o.addon)].some((a) => a.id === addon.id)) {
    return [`${base.pack.name} already has an addon with the id "${addon.id}".`];
  }
  const lp = withUploads(base, [...others, upload]);
  const enabled = [addon.id, ...(addon.requires ?? [])];
  return validateSelection(lp, enabled);
}

/** Files relative to the folder that holds pack.json or addon.json: the zip root, or its single top folder. */
function rootFiles(entries: Map<string, Uint8Array>): Map<string, Uint8Array> {
  const kept = [...entries].filter(([path]) => !JUNK.test(path));
  const isRoot = (path: string) => path === 'pack.json' || path === 'addon.json';
  if (kept.some(([path]) => isRoot(path))) return new Map(kept);
  const tops = new Set(kept.map(([path]) => path.split('/')[0]));
  const [top] = tops;
  if (tops.size === 1 && kept.some(([path]) => isRoot(path.slice(top!.length + 1)))) {
    return new Map(kept.map(([path, data]) => [path.slice(top!.length + 1), data]));
  }
  return new Map(kept);
}

function parseJson<T>(files: Map<string, Uint8Array>, path: string, problems: string[]): T | null {
  const data = files.get(path);
  if (!data) {
    problems.push(`${path}: missing from the zip`);
    return null;
  }
  try {
    return JSON.parse(new TextDecoder().decode(data)) as T;
  } catch (err) {
    problems.push(`${path}: not valid JSON (${err instanceof Error ? err.message : String(err)})`);
    return null;
  }
}

export function mb(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
