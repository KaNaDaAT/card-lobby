/**
 * A minimal zip reader for custom packs: stored and deflate entries, inflated with the
 * browser's DecompressionStream. No zip64, no encryption. Limits are enforced while inflating,
 * so an entry that lies about its size (a zip bomb) is stopped early.
 *
 * `writeZip` makes small zips for tests.
 */

export class ZipError extends Error {}

export interface ZipLimits {
  maxEntries: number;
  /** Largest allowed size for one file, after inflating. */
  maxEntryBytes(path: string): number;
  /** Largest allowed size of all files together, after inflating. */
  maxTotalBytes: number;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** Reads every file of a zip. Directory entries are skipped. Paths must be plain relative paths. */
export async function readZip(bytes: Uint8Array, limits: ZipLimits): Promise<Map<string, Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(view);
  const count = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new ZipError('zip64 files are not supported');
  if (count > limits.maxEntries) throw new ZipError(`the zip has ${count} entries, at most ${limits.maxEntries} are allowed`);
  if (cdOffset + cdSize > eocd) throw new ZipError('the zip is damaged (central directory)');

  const names = new TextDecoder('utf-8');
  const files = new Map<string, Uint8Array>();
  let total = 0;
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== CENTRAL) throw new ZipError('the zip is damaged (entry header)');
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const crc = view.getUint32(p + 16, true);
    const compressed = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const path = names.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;

    if (path.endsWith('/')) continue;
    checkPath(path);
    if (files.has(path)) throw new ZipError(`"${path}" appears twice`);
    if (flags & 1) throw new ZipError(`"${path}" is encrypted`);
    if (method !== 0 && method !== 8) throw new ZipError(`"${path}" uses an unsupported compression method`);
    const max = limits.maxEntryBytes(path);
    if (size > max) throw new ZipError(`"${path}" is ${size} bytes, at most ${max} are allowed`);
    if (total + size > limits.maxTotalBytes) throw new ZipError(`the files add up to more than ${limits.maxTotalBytes} bytes`);

    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== LOCAL) throw new ZipError(`"${path}" is damaged`);
    const start = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    if (start + compressed > bytes.length) throw new ZipError(`"${path}" is cut off`);
    const raw = bytes.subarray(start, start + compressed);
    // The declared size already passed the limits. Inflating past it means the entry lies.
    const data = method === 0 ? raw.slice() : await inflate(raw, size, path);
    if (data.length !== size) throw new ZipError(`"${path}" has the wrong size`);
    if (crc32(data) !== crc) throw new ZipError(`"${path}" is damaged (checksum)`);
    total += data.length;
    files.set(path, data);
  }
  return files;
}

function findEocd(view: DataView): number {
  const stop = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let i = view.byteLength - 22; i >= stop; i--) {
    if (view.getUint32(i, true) === EOCD) return i;
  }
  throw new ZipError('this is not a zip file');
}

function checkPath(path: string): void {
  const parts = path.split('/');
  if (!path || path.startsWith('/') || path.includes('\\') || path.includes(':') || parts.some((s) => s === '..' || s === '.' || s === '')) {
    throw new ZipError(`"${path}" is not an allowed file path`);
  }
}

async function inflate(data: Uint8Array, max: number, path: string): Promise<Uint8Array> {
  const reader = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > max) {
        await reader.cancel();
        throw new ZipError(`"${path}" inflates to more than its declared ${max} bytes`);
      }
      chunks.push(value);
    }
  } catch (err) {
    if (err instanceof ZipError) throw err;
    throw new ZipError(`"${path}" could not be inflated`);
  }
  return concat(chunks, total);
}

function concat(chunks: Uint8Array[], total = chunks.reduce((n, c) => n + c.length, 0)): Uint8Array {
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Writes a zip. Files are deflated unless `store` is set. Meant for tests and small exports. */
export async function writeZip(files: Record<string, Uint8Array | string>, opts: { store?: boolean } = {}): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [path, content] of Object.entries(files)) {
    const data = typeof content === 'string' ? enc.encode(content) : content;
    const packed = opts.store ? data : await deflate(data);
    const name = enc.encode(path);
    const crc = crc32(data);
    const method = opts.store ? 0 : 8;

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, LOCAL, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, method, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, packed.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, CENTRAL, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, method, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, packed.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);

    locals.push(local, packed);
    centrals.push(central);
    offset += local.length + packed.length;
  }
  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, EOCD, true);
  ev.setUint16(8, centrals.length, true);
  ev.setUint16(10, centrals.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  return concat([...locals, ...centrals, end]);
}
