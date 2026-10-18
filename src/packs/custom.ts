/**
 * Custom packs: a zip with pack.json at its root (or inside one top folder), addons and images.
 * See docs/DESIGN.md, "Custom packs". A pack is data only. It is unzipped within limits,
 * validated like a built-in pack, and its images are served only as blob: URLs in <img>, where
 * an SVG cannot run scripts.
 */
import type { Addon, LoadedPack, Pack } from './types';
import { validatePack, validateSelection } from './validate';
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

export interface ImportOptions {
  /** Makes a URL for an image. Defaults to URL.createObjectURL. */
  url?: (blob: Blob) => string;
  /** The SHA-256 the zip must have, when it came from someone else. */
  expectHash?: string;
}

/** Unzips, checks and loads a custom pack. Throws PackImportError with readable problems. */
export async function importPackZip(bytes: Uint8Array, opts: ImportOptions = {}): Promise<LoadedPack> {
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
  const pack = parseJson<Pack>(files, 'pack.json', problems);
  if (problems.length || !pack) throw new PackImportError(problems.length ? problems : ['The zip has no pack.json.']);

  const addonPaths = Array.isArray(pack.addons) ? pack.addons.filter((p): p is string => typeof p === 'string') : [];
  const addons = addonPaths.map((path) => parseJson<Addon>(files, path, problems)).filter((a): a is Addon => Boolean(a));
  if (problems.length) throw new PackImportError(problems);

  const images = new Set([...files.keys()].filter((path) => IMAGE_MIME[extOf(path)]));
  const urls = new Map<string, string>();
  const makeUrl = opts.url ?? ((blob: Blob) => URL.createObjectURL(blob));
  const lp: LoadedPack = {
    key: customKey(hash),
    pack,
    addons,
    asset: (path) => {
      let url = urls.get(path);
      if (!url && images.has(path)) {
        url = makeUrl(new Blob([files.get(path)! as Uint8Array<ArrayBuffer>], { type: IMAGE_MIME[extOf(path)] }));
        urls.set(path, url);
      }
      return url ?? '';
    },
    custom: {
      bytes,
      offer: { hash, name: String(pack.name), ...(typeof pack.author === 'string' ? { author: pack.author } : {}), bytes: bytes.length, images: images.size },
    },
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

/** Files relative to the folder that holds pack.json: the zip root, or its single top folder. */
function rootFiles(entries: Map<string, Uint8Array>): Map<string, Uint8Array> {
  const kept = [...entries].filter(([path]) => !JUNK.test(path));
  if (kept.some(([path]) => path === 'pack.json')) return new Map(kept);
  const tops = new Set(kept.map(([path]) => path.split('/')[0]));
  const [top] = tops;
  if (tops.size === 1 && kept.some(([path]) => path === `${top}/pack.json`)) {
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
