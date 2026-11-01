#!/usr/bin/env node
/**
 * Lays out Power Hungry Pets with all three addons as print files for 70 x 120 mm cards (the
 * meinspiel.de format: 3 mm bleed, 5 mm round corners). `npm run print-cards`
 * writes print/preview.html (each design once, with the cut line) and print/cards/*.png at
 * 898 x 1488 pixels (300 dpi), one file per printed card, plus print/back.png.
 *
 * With the shop's ISO Coated v2 300% (ECI) profile in print-profile/ (or --profile <icc>), it
 * also writes print/fronts.pdf and print/back.pdf as PDF/X-4 at 600 dpi. The card images use
 * the system's sRGB profile (or --rgb-profile <icc>).
 *
 * Every card has a thin white rim, so card edges do not tell cards apart. The print run is 80
 * cards, a deck size the shop offers: Big Litter counts plus one spare of each base card (two of
 * the three most played), Off the Scale doubled, one spare of each Second Litter card, and two
 * copies each of the two rules cards that replace the rulebook.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { pdfImage, writePdfX4 } from './pdf-x4.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACK = join(ROOT, 'public/packs/power-hungry-pets');
const OUT = join(ROOT, 'print');

const option = (name) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
};

/** The CMYK profile for the PDF's output intent and the sRGB profile of the card images. */
function loadProfiles() {
  const cmyk = option('--profile') ?? join(ROOT, 'print-profile', 'ISOcoated_v2_300_eci.icc');
  const rgb =
    option('--rgb-profile') ??
    (process.platform === 'win32'
      ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'spool', 'drivers', 'color', 'sRGB Color Space Profile.icm')
      : '/System/Library/ColorSync/Profiles/sRGB Profile.icc');
  const missing = [cmyk, rgb].filter((path) => !existsSync(path));
  if (missing.length) {
    console.log(`No PDF, profile not found: ${missing.join(', ')}`);
    return null;
  }
  return { cmykProfile: readFileSync(cmyk), rgbProfile: readFileSync(rgb) };
}

/** The shop's file size. Sizes below are in mm, measured from the cut card's top left. */
const PIXELS = { w: 898, h: 1488 };
const CUT = { w: 70, h: 120 };
const PAGE = { w: (PIXELS.w / 300) * 25.4, h: (PIXELS.h / 300) * 25.4 };
const BLEED = { x: (PAGE.w - CUT.w) / 2, y: (PAGE.h - CUT.h) / 2 };
/** Screenshots clip to whole CSS pixels, so a card is zoomed to exactly PIXELS / DPR of them. */
const DPR = 2;
const ZOOM = PIXELS.w / DPR / ((PAGE.w * 96) / 25.4);

/**
 * The framed area inside the white rim: a header band on top, the art, and a text band at
 * the bottom. Header and text band are measured from the panel's top.
 */
const PANEL = { x: 2, y: 2, w: CUT.w - 4, h: CUT.h - 4, r: 3 };
const HEAD = 17;
const BAND = PANEL.h - 28;

/** Where a pet lands (mm) and how big (mm per art pixel). Every art draws its pet at 250, 260. */
const PET = { px: 250, py: 260, x: CUT.w / 2, y: PANEL.y + (HEAD + BAND) / 2, scale: 0.18 };
const EMBLEM = { px: 250, py: 350, x: CUT.w / 2, y: CUT.h / 2, scale: 0.19 };

const read = (path) => readFileSync(join(PACK, path), 'utf8');
const json = (path) => JSON.parse(read(path));
const game = json('pack.json');
const big = json('addons/big-litter.json');
const offScale = json('addons/off-the-scale.json');
const litter = json('addons/second-litter.json');

const addonCards = (addon, spares) =>
  addon.cards.add.map((c) => ({ ...c, icon: addon.icon, small: c.count, large: c.count, print: c.count + spares(c) }));

const PRINT_RUN = 80;
const MOST_PLAYED = ['crystal-bowl', 'mouse-trapper', 'battle-bunny'];
const RULES_COPIES = 2;

/** `small` and `large` are the copies in play for 2 to 6 and 7 to 10 players. */
const cards = [
  ...game.cards.map((c) => {
    const large = big.cards.modify[c.id]?.count ?? c.count;
    return { ...c, icon: game.art.icon, small: c.count, large, print: large + (MOST_PLAYED.includes(c.id) ? 2 : 1) };
  }),
  ...addonCards(offScale, (c) => c.count),
  ...addonCards(litter, () => 1),
].sort((a, b) => a.value - b.value);

const printed = cards.reduce((sum, c) => sum + c.print, 2 * RULES_COPIES);
if (printed !== PRINT_RUN) throw new Error(`The print run is ${printed} cards, not ${PRINT_RUN}. Adjust the spares.`);

const label = (c) => c.valueLabel ?? String(c.value);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const svgUrl = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

/**
 * Re-frames a 500 x 700 art for the panel: the view moves so the art point (px, py) lands at
 * (x, y), and the background fills the whole panel instead of stopping at the art's own edges.
 */
function reframe(svg, { px, py, x, y, scale }) {
  const w = PANEL.w / scale;
  const h = PANEL.h / scale;
  const left = px - (x - PANEL.x) / scale;
  const top = py - (y - PANEL.y) / scale;
  return svg
    .replace('viewBox="0 0 500 700" width="500" height="700"', `viewBox="${left} ${top} ${w} ${h}" preserveAspectRatio="none"`)
    .replace(
      /<radialGradient id="glow" cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)">/,
      (_, cx, cy, r) =>
        `<radialGradient id="glow" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="translate(${500 * cx} ${700 * cy}) scale(${500 * r} ${700 * r})">`,
    )
    .replace(/<rect width="500" height="700" rx="36" (fill="url\(#(?:bg|glow)\)")\/>/g, `<rect x="${left}" y="${top}" width="${w}" height="${h}" $1/>`);
}

const RULES = [
  ['Setup', 'Shuffle. Put 1 card aside face down, unseen (with 2 players, also 2 face up). Deal everyone 1 card. A random player starts.'],
  ['Your turn', 'Draw a card, then play one of your two face up in front of you and do what it says. Played cards stay there for the round.'],
  ['Protected', 'Players protected by a Shell Shield cannot be chosen. If nobody can be chosen, the card does nothing.'],
  ['Knocked out', 'Lay your card face up and sit out the rest of the round.'],
  ['Showdown', 'If the draw pile is empty when a turn starts, everyone still in shows their card and the highest wins. On a tie, the highest card played decides. Still tied: they all win.'],
  ['Winning', 'The round winner takes a token and starts the next round. First to 3 tokens wins, or 2 tokens with 4 or more players. If several get there at once, they play one more round among themselves.'],
];

const front = (c) => `
<section class="card" data-name="${c.id}" data-copies="${c.print}">
  <div class="panel">
    <img class="art" src="${svgUrl(reframe(read(c.image), PET))}" alt="">
    <div class="head">
      <div class="value${c.valueLabel ? ' symbol' : label(c).length > 1 ? ' long' : ''}">${esc(label(c))}</div>
      <div class="name">${esc(c.name)}</div>
    </div>
    <p class="text">${esc(c.text)}</p>
    <div class="set"><img src="${svgUrl(read(c.icon))}" alt=""></div>
  </div>
</section>`;

const rulesCard = (name, title, body) => `
<section class="card rules" data-name="${name}" data-copies="${RULES_COPIES}">
  <div class="panel">
    <div class="head">
      <img class="logo" src="${svgUrl(read(game.art.icon))}" alt="">
      <div class="name">${esc(title)}</div>
    </div>
    <div class="body">
      ${body}
    </div>
  </div>
</section>`;

const howToPlay = rulesCard(
  'rules-how-to-play',
  'How to play',
  RULES.map(([head, text]) => `<p><b>${esc(head)}.</b> ${esc(text)}</p>`).join('\n      '),
);

const deck = rulesCard(
  'rules-the-deck',
  'The deck',
  `<p>Copies to play with, by number of players. The rest are spares.</p>
      <table>
        <tr><th></th><th>Card</th><th>2-6</th><th>7-10</th></tr>
        ${cards.map((c) => `<tr><td>${esc(label(c))}</td><td>${esc(c.name)}</td><td>${c.small}</td><td>${c.large}</td></tr>`).join('\n        ')}
      </table>`,
);

const backSvg = read(game.art.back).replace(/<rect x="22" y="22"[^>]*\/>/, '');
const back = `
<section class="card" data-name="back" data-copies="0">
  <div class="panel"><img class="art" src="${svgUrl(reframe(backSvg, EMBLEM))}" alt=""></div>
</section>`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Power Hungry Pets print sheet</title>
<style>
  :root {
    --ink: #1d1530;
    --paper: #fff6e6;
  }
  * { box-sizing: border-box; margin: 0; }
  body {
    display: flex;
    flex-wrap: wrap;
    gap: 6mm;
    padding: 6mm;
    background: #8a8494;
    color: var(--ink);
    font-family: 'Segoe UI', system-ui, sans-serif;
  }
  .card {
    position: relative;
    flex: none;
    width: ${PAGE.w}mm;
    height: ${PAGE.h}mm;
    overflow: hidden;
    zoom: ${ZOOM};
    background: #fff;
  }
  .card::after {
    content: attr(data-copies) ' x';
    position: absolute;
    top: 0;
    right: 0;
    padding: 0.5mm 1.5mm;
    background: #000;
    color: #fff;
    font-size: 3mm;
  }
  .guides .card::before {
    content: '';
    position: absolute;
    inset: ${BLEED.y}mm ${BLEED.x}mm;
    z-index: 1;
    border: 0.25mm dashed #e00;
    border-radius: 5mm;
  }
  .render { display: block; padding: 0; background: #fff; }
  .render .card { display: none; }
  .render .card.on { display: block; }
  .render .card::after { content: none; }

  .panel {
    position: absolute;
    top: ${BLEED.y + PANEL.y}mm;
    left: ${BLEED.x + PANEL.x}mm;
    width: ${PANEL.w}mm;
    height: ${PANEL.h}mm;
    overflow: hidden;
    border-radius: ${PANEL.r}mm;
    background: var(--paper);
  }
  .art {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .head ~ .art, .art:has(~ .head) { clip-path: inset(${HEAD}mm 0 ${PANEL.h - BAND}mm 0); }
  .head {
    position: absolute;
    top: 0;
    right: 0;
    left: 0;
    display: flex;
    gap: 2.6mm;
    align-items: center;
    height: ${HEAD}mm;
    padding: 0 3mm 0 2.5mm;
    background: var(--ink);
    color: var(--paper);
  }
  .value {
    display: grid;
    flex: none;
    place-items: center;
    width: 12mm;
    height: 12mm;
    border-radius: 50%;
    background: var(--paper);
    color: var(--ink);
    font-size: 7mm;
    font-weight: 900;
    line-height: 1;
  }
  .value.long { font-size: 5.2mm; letter-spacing: -0.2mm; }
  .value.symbol { font-size: 10mm; }
  .name {
    overflow: hidden;
    font-size: 4mm;
    font-weight: 800;
    line-height: 1.1;
    white-space: nowrap;
  }
  .text {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    height: ${PANEL.h - BAND}mm;
    padding: 4.5mm 4mm 3.5mm;
    border-top: 0.7mm solid var(--ink);
    background: var(--paper);
    font-size: 3.8mm;
    line-height: 1.3;
    text-align: center;
  }
  .set {
    position: absolute;
    top: ${BAND - 9.5}mm;
    right: 3mm;
    display: grid;
    place-items: center;
    width: 13mm;
    height: 13mm;
    border: 0.7mm solid var(--ink);
    border-radius: 50%;
    background: var(--paper);
  }
  .set img { width: 9mm; height: 9mm; }

  .rules .logo { width: 11mm; height: 11mm; }
  .rules .name { font-size: 5.2mm; }
  .rules .body {
    position: absolute;
    top: ${HEAD}mm;
    right: 0;
    left: 0;
    padding: 3.5mm;
    font-size: 2.75mm;
    line-height: 1.3;
  }
  .rules p + p { margin-top: 1.6mm; }
  .rules table { width: 100%; margin-top: 1.6mm; border-collapse: collapse; font-size: 2.6mm; line-height: 1.12; }
  .rules th { font-weight: 800; text-align: left; }
  .rules td:first-child { width: 6mm; font-weight: 800; }
  .rules th:nth-child(n + 3), .rules td:nth-child(n + 3) { width: 9mm; text-align: center; }
  .rules tr:nth-child(even) td { background: rgb(29 21 48 / 0.07); }
</style>
</head>
<body class="guides">
${cards.map(front).join('')}
${howToPlay}
${deck}
${back}
</body>
</html>
`;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'cards'), { recursive: true });
const preview = join(OUT, 'preview.html');
writeFileSync(preview, html);

const profiles = loadProfiles();
const browser = await chromium.launch();

/** Opens the sheet in render mode, where only the card marked `on` shows. */
async function sheet(scale) {
  const page = await browser.newPage({ deviceScaleFactor: scale, viewport: { width: 600, height: 900 } });
  await page.goto(pathToFileURL(preview).href);
  await page.evaluate(() => document.body.classList.replace('guides', 'render'));
  return page;
}

/** Screenshots design `i`, as a PNG buffer and optionally into `path`. */
async function shoot(page, i, path) {
  await page.evaluate((i) => document.querySelectorAll('.card').forEach((el, j) => el.classList.toggle('on', i === j)), i);
  return page.screenshot({ path, clip: { x: 0, y: 0, width: PIXELS.w / DPR, height: PIXELS.h / DPR } });
}

const png = await sheet(DPR);
const hires = profiles && (await sheet(DPR * 2));
const designs = await png.$$eval('.card', (els) => els.map((el) => ({ name: el.dataset.name, copies: Number(el.dataset.copies) })));
const fronts = [];
let backImage;
let n = 0;
for (const [i, { name, copies }] of designs.entries()) {
  const first = name === 'back' ? join(OUT, 'back.png') : join(OUT, 'cards', `${String(n + 1).padStart(3, '0')}-${name}.png`);
  await shoot(png, i, first);
  for (let copy = 1; copy <= copies; copy++) {
    n++;
    if (copy > 1) copyFileSync(first, join(OUT, 'cards', `${String(n).padStart(3, '0')}-${name}.png`));
  }
  if (hires) {
    const image = pdfImage(await shoot(hires, i));
    if (name === 'back') backImage = image;
    else fronts.push(...Array(copies).fill(image));
  }
}
await browser.close();
console.log(`${n} cards and a back in ${OUT}`);

if (profiles) {
  const pdf = { size: { w: CUT.w + 6, h: CUT.h + 6 }, bleed: 3, condition: { id: 'FOGRA39', name: 'ISO Coated v2 300% (ECI)' }, ...profiles };
  writePdfX4(join(OUT, 'fronts.pdf'), fronts, { ...pdf, title: 'Power Hungry Pets, fronts' });
  writePdfX4(join(OUT, 'back.pdf'), [backImage], { ...pdf, title: 'Power Hungry Pets, back' });
  console.log(`PDF/X-4: fronts.pdf (${fronts.length} pages) and back.pdf`);
}
