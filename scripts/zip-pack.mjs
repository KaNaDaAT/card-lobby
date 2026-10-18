#!/usr/bin/env node
/**
 * Zips a pack folder for the Custom pack tile in the lobby: `npm run zip-pack -- <folder>`
 * writes <folder>.zip next to the folder, with pack.json at the zip's root. Node only, no
 * dependencies. Files are sorted and dated 1980-01-01, so the same folder always gives the same
 * zip (and the same hash, which players' caches go by).
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { deflateRawSync } from 'node:zlib';

const JUNK = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|__MACOSX)(\/|$)/;

const folder = process.argv[2];
if (!folder) {
  console.error('Usage: npm run zip-pack -- <pack folder>');
  process.exit(1);
}
const root = resolve(folder);
try {
  statSync(join(root, 'pack.json'));
} catch {
  console.error(`${folder} has no pack.json`);
  process.exit(1);
}

function list(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    return e.isDirectory() ? list(path) : [path];
  });
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01
const files = list(root)
  .map((path) => relative(root, path).split(sep).join('/'))
  .filter((name) => !JUNK.test(name))
  .sort();

const locals = [];
const central = [];
let offset = 0;
for (const name of files) {
  const data = readFileSync(join(root, name));
  const packed = deflateRawSync(data, { level: 9 });
  const store = packed.length >= data.length;
  const body = store ? data : packed;
  const nameBytes = Buffer.from(name, 'utf8');
  const crc = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0x0800, 6); // UTF-8 names
  local.writeUInt16LE(store ? 0 : 8, 8);
  local.writeUInt16LE(0, 10); // time
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  local.writeUInt16LE(0, 28);
  locals.push(local, nameBytes, body);

  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0);
  entry.writeUInt16LE(20, 4); // made by
  entry.writeUInt16LE(20, 6);
  entry.writeUInt16LE(0x0800, 8);
  entry.writeUInt16LE(store ? 0 : 8, 10);
  entry.writeUInt16LE(0, 12);
  entry.writeUInt16LE(DOS_DATE, 14);
  entry.writeUInt32LE(crc, 16);
  entry.writeUInt32LE(body.length, 20);
  entry.writeUInt32LE(data.length, 24);
  entry.writeUInt16LE(nameBytes.length, 28);
  entry.writeUInt32LE(offset, 42);
  central.push(entry, nameBytes);
  offset += local.length + nameBytes.length + body.length;
}

const centralSize = central.reduce((n, b) => n + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(offset, 16);

const out = join(dirname(root), `${basename(root)}.zip`);
const zip = Buffer.concat([...locals, ...central, end]);
writeFileSync(out, zip);
console.log(`${relative(process.cwd(), out)}: ${files.length} files, ${(zip.length / 1024).toFixed(0)} KB`);
