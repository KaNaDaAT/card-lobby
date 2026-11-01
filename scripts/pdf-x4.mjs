/**
 * A minimal PDF/X-4 writer for print files where each page is one full-page RGB image. The
 * images keep an sRGB profile, the print shop's CMYK profile is the output intent, and every
 * page gets trim and bleed boxes. Node only, no dependencies.
 */
import { createHash, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';

/** Decodes an 8-bit, non-interlaced RGB or RGBA PNG into a compressed RGB image for the PDF. */
export function pdfImage(png) {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const [depth, type, , , interlace] = png.subarray(24, 29);
  if (depth !== 8 || (type !== 2 && type !== 6) || interlace !== 0) {
    throw new Error(`Unsupported PNG: bit depth ${depth}, color type ${type}, interlace ${interlace}`);
  }
  const channels = type === 6 ? 4 : 3;
  const parts = [];
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    if (png.toString('latin1', at + 4, at + 8) === 'IDAT') parts.push(png.subarray(at + 8, at + 8 + length));
    at += length + 12;
  }
  const raw = inflateSync(Buffer.concat(parts));
  const stride = width * channels;
  const rgb = Buffer.alloc(width * height * 3);
  let prev = Buffer.alloc(stride);
  let line = Buffer.alloc(stride);
  let out = 0;
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1) + 1;
    const filter = raw[start - 1];
    for (let i = 0; i < stride; i++) {
      const a = i < channels ? 0 : line[i - channels];
      const b = prev[i];
      let p = 0;
      if (filter === 1) p = a;
      else if (filter === 2) p = b;
      else if (filter === 3) p = (a + b) >> 1;
      else if (filter === 4) {
        const c = i < channels ? 0 : prev[i - channels];
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = (raw[start + i] + p) & 255;
    }
    for (let x = 0; x < stride; x += channels) {
      rgb[out++] = line[x];
      rgb[out++] = line[x + 1];
      rgb[out++] = line[x + 2];
    }
    [prev, line] = [line, prev];
  }
  return { width, height, data: deflateSync(rgb) };
}

const pt = (mm) => +((mm * 72) / 25.4).toFixed(3);
const text = (s) => `(${s.replace(/[\\()]/g, '\\$&')})`;
const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/**
 * Writes `pages` (from pdfImage, the same image may repeat) as a PDF/X-4 file. Pages are `size`
 * mm, and `bleed` mm on every side is cut off. `condition` names the CMYK profile's printing
 * condition, like { id: 'FOGRA39', name: 'ISO Coated v2 300% (ECI)' }.
 */
export function writePdfX4(file, pages, { title, size, bleed, rgbProfile, cmykProfile, condition }) {
  const objects = [];
  const add = (body) => objects.push(body);
  const ref = (id) => `${id} 0 R`;
  const stream = (dict, data) =>
    Buffer.concat([Buffer.from(`<< ${dict} /Length ${data.length} >>\nstream\n`), data, Buffer.from('\nendstream')]);

  const stamp = new Date().toISOString().slice(0, 19);
  const pdfDate = `D:${stamp.replace(/[-:T]/g, '')}+00'00'`;
  const xmpDate = `${stamp}+00:00`;

  const catalog = add(null);
  const tree = add(null);
  const cmyk = add(stream('/N 4 /Filter /FlateDecode', deflateSync(cmykProfile)));
  const srgb = add(stream('/N 3 /Filter /FlateDecode', deflateSync(rgbProfile)));
  const intent = add(
    `<< /Type /OutputIntent /S /GTS_PDFX /OutputConditionIdentifier ${text(condition.id)} /OutputCondition ${text(condition.name)} ` +
      `/RegistryName (http://www.color.org) /Info ${text(condition.name)} /DestOutputProfile ${ref(cmyk)} >>`,
  );

  const w = pt(size.w);
  const h = pt(size.h);
  const draw = add(stream('', Buffer.from(`q ${w} 0 0 ${h} 0 0 cm /Im Do Q`)));
  const xobjects = new Map();
  const kids = pages.map((image) => {
    if (!xobjects.has(image)) {
      const dict = `/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace [/ICCBased ${ref(srgb)}] /BitsPerComponent 8 /Filter /FlateDecode`;
      xobjects.set(image, add(stream(dict, image.data)));
    }
    const trim = `${pt(bleed)} ${pt(bleed)} ${pt(size.w - bleed)} ${pt(size.h - bleed)}`;
    return add(
      `<< /Type /Page /Parent ${ref(tree)} /MediaBox [0 0 ${w} ${h}] /BleedBox [0 0 ${w} ${h}] /TrimBox [${trim}] ` +
        `/Resources << /XObject << /Im ${ref(xobjects.get(image))} >> >> /Contents ${ref(draw)} >>`,
    );
  });
  objects[tree - 1] = `<< /Type /Pages /Kids [${kids.map(ref).join(' ')}] /Count ${kids.length} >>`;

  const xmp = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about=""
 xmlns:dc="http://purl.org/dc/elements/1.1/"
 xmlns:xmp="http://ns.adobe.com/xap/1.0/"
 xmlns:pdf="http://ns.adobe.com/pdf/1.3/"
 xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/"
 xmlns:pdfxid="http://www.npes.org/pdfx/ns/id/">
<dc:format>application/pdf</dc:format>
<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xml(title)}</rdf:li></rdf:Alt></dc:title>
<xmp:CreateDate>${xmpDate}</xmp:CreateDate>
<xmp:ModifyDate>${xmpDate}</xmp:ModifyDate>
<xmp:MetadataDate>${xmpDate}</xmp:MetadataDate>
<xmp:CreatorTool>card-lobby print-cards</xmp:CreatorTool>
<pdf:Producer>card-lobby print-cards</pdf:Producer>
<pdf:Trapped>False</pdf:Trapped>
<xmpMM:DocumentID>uuid:${randomUUID()}</xmpMM:DocumentID>
<xmpMM:InstanceID>uuid:${randomUUID()}</xmpMM:InstanceID>
<xmpMM:VersionID>1</xmpMM:VersionID>
<xmpMM:RenditionClass>default</xmpMM:RenditionClass>
<pdfxid:GTS_PDFXVersion>PDF/X-4</pdfxid:GTS_PDFXVersion>
</rdf:Description>
</rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
  const metadata = add(stream('/Type /Metadata /Subtype /XML', Buffer.from(xmp, 'utf8')));
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${ref(tree)} /Metadata ${ref(metadata)} /OutputIntents [${ref(intent)}] >>`;
  const info = add(
    `<< /Title ${text(title)} /Creator (card-lobby print-cards) /Producer (card-lobby print-cards) ` +
      `/CreationDate (${pdfDate}) /ModDate (${pdfDate}) /Trapped /False /GTS_PDFXVersion (PDF/X-4) >>`,
  );

  const chunks = [Buffer.from('%PDF-1.6\n'), Buffer.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])];
  let offset = chunks[0].length + chunks[1].length;
  const offsets = objects.map((body, i) => {
    const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), Buffer.from(body), Buffer.from('\nendobj\n')]);
    chunks.push(chunk);
    offset += chunk.length;
    return offset - chunk.length;
  });
  const id = createHash('md5').update(Buffer.concat(chunks)).digest('hex');
  chunks.push(
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
        offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') +
        `trailer\n<< /Size ${objects.length + 1} /Root ${ref(catalog)} /Info ${ref(info)} /ID [<${id}> <${id}>] >>\n` +
        `startxref\n${offset}\n%%EOF\n`,
    ),
  );
  writeFileSync(file, Buffer.concat(chunks));
}
