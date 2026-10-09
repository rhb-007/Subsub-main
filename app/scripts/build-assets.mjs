// Build the launch assets in marketing/: the SubSub Verified badge in three
// colourways, the print files for a 6 in truck decal and a 3 in sticker, and
// the supply-house flyer.
//
//   npm run assets            (uses the committed glyph outlines)
//   npm run assets -- --url https://subsub.work/p/...   (a per-sub decal)
//
// EVERY PRINT FILE IS VECTOR WITH NO LIVE TEXT. The lettering comes out of
// marketing/build/glyphs.json -- Bricolage Grotesque and Inter outlined by
// glyphs.py -- so a print shop opening the SVG or the PDF sees shapes, never a
// font it has to substitute. The flyer is the exception that proves it: it is
// set in the brand faces and rendered to PDF by Chromium, which embeds the
// fonts it used, and that is what a PDF for print is supposed to do.
//
// A PRINTED BADGE CANNOT EXPIRE, AND THAT DECIDED THE DECAL. "SubSub Verified"
// on a screen is drawn only while the license checks out and the insurance is
// current; on a truck door it says so for the life of the vinyl. So the decal
// does not stand on the claim alone: its centre is a QR code to a LIVE check
// (subsub.work/check by default, or the sub's own page via --url), under
// "SCAN TO CHECK". A customer who wants to know can know today, which is the
// only honest way to put the word on a vehicle. The 3 in sticker has no room
// for a code that scans from a car park, so it is the seal alone and the
// README says to hand it only to subs whose badge is live.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { qrPath } from "../src/lib/qr.js";
import { launch } from "./lib/stub-stack.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const MK = join(root, "marketing");
const G = JSON.parse(readFileSync(join(MK, "build/glyphs.json"), "utf8"));
const argUrl = (() => { const i = process.argv.indexOf("--url"); return i > 0 ? process.argv[i + 1] : null; })();
export const DECAL_URL = argUrl || "https://subsub.work/check/";
export const FLYER_URL = "https://subsub.work/subs?utm_source=supply-house&utm_medium=flyer";

export const BRAND = { forest: "#103528", gold: "#E39B32", bone: "#F4F6F4", ink: "#0C1C16", white: "#FFFFFF" };
// The mark, as on every page of subsub.work (favicon.svg), viewBox 32 58 104 120.
const MARK = [
  "M124.35,80.05l-78,36.53c-1.99,0.93-4.27-0.52-4.27-2.72V98.92c0-2.66,1.54-5.07,3.94-6.2L98.82,68c2.61-1.22,5.6-1.31,8.28-0.25l17.09,6.78C126.63,75.51,126.73,78.93,124.35,80.05z",
  "M43.81,156.95l78-36.53c1.99-0.93,4.27,0.52,4.27,2.72v14.93c0,2.66-1.54,5.07-3.94,6.2L69.34,169c-2.61,1.22-5.6,1.31-8.28,0.25l-17.09-6.78C41.53,161.49,41.43,158.07,43.81,156.95z",
  "M124.51,111.55l-57.06,26.43c-2.31,1.09-4.76,0.85-7.27-0.19l-16.4-6.7c-2.37-0.98-2.45-4.42-0.13-5.52l57.16-26.43c2.7-1.15,4.5-1.1,7.52-0.06l16.05,6.94C126.75,107.01,126.83,110.45,124.51,111.55z",
];
const mark = (cx, cy, h, fill) => {
  const s = h / 120;
  return `<g transform="translate(${cx - 84 * s} ${cy - 118 * s}) scale(${s})" fill="${fill}">${MARK.map((d) => `<path d="${d}"/>`).join("")}</g>`;
};

const f2 = (n) => Math.round(n * 100) / 100;
function measure(font, str, size, spacing = 0) {
  const F = G[font], s = size / F.upm;
  return [...str].reduce((w, ch) => w + (F.glyphs[ch]?.adv || F.upm * 0.3) * s + spacing, 0) - spacing;
}
// A straight line of outlined text. anchor: start | middle | end.
export function line(font, str, size, x, y, fill, { spacing = 0, anchor = "start" } = {}) {
  const F = G[font], s = size / F.upm;
  let cx = anchor === "middle" ? x - measure(font, str, size, spacing) / 2
    : anchor === "end" ? x - measure(font, str, size, spacing) : x;
  const out = [];
  for (const ch of str) {
    const g = F.glyphs[ch];
    if (g?.d) out.push(`<path transform="translate(${f2(cx)} ${f2(y)}) scale(${f2(s * 1000) / 1000} ${-f2(s * 1000) / 1000})" d="${g.d}"/>`);
    cx += (g?.adv || F.upm * 0.3) * s + spacing;
  }
  return `<g fill="${fill}">${out.join("")}</g>`;
}
// Text round a circle. `top` reads clockwise over the top with the letters
// standing outward; the bottom reads left to right with them standing inward,
// so both read upright. Both bands sit between the same two radii.
export function arc(font, str, size, cx, cy, r, fill, { top = true, spacing = 0 } = {}) {
  const F = G[font], s = size / F.upm;
  const cap = (F.cap / F.upm) * size;
  const rb = top ? r : r + cap;            // baseline radius
  const total = measure(font, str, size, spacing);
  const span = total / rb;                 // radians
  let pos = 0;
  const out = [];
  for (const ch of str) {
    const g = F.glyphs[ch];
    const adv = (g?.adv || F.upm * 0.3) * s;
    const mid = pos + adv / 2;
    const theta = top ? (-Math.PI / 2 - span / 2 + mid / rb) : (Math.PI / 2 + span / 2 - mid / rb);
    const px = cx + rb * Math.cos(theta), py = cy + rb * Math.sin(theta);
    const rot = (theta * 180) / Math.PI + (top ? 90 : -90);
    if (g?.d) out.push(`<path transform="translate(${f2(px)} ${f2(py)}) rotate(${f2(rot)}) translate(${f2(-adv / 2)} 0) scale(${f2(s * 1000) / 1000} ${-f2(s * 1000) / 1000})" d="${g.d}"/>`);
    pos += adv + spacing;
  }
  return `<g fill="${fill}">${out.join("")}</g>`;
}

// THE SEAL. 600 units across; the outer circle at r 300 is the cut line on the
// print files, so nothing that matters sits outside r 275.
function seal({ mode = "color", center = "mark", bottom = "LICENSE · INSURANCE", bleed = 0 } = {}) {
  const C = 300;
  const solid = mode === "color";
  const ink = mode === "reversed" ? BRAND.white : mode === "one" ? BRAND.forest : BRAND.bone;
  const accent = mode === "color" ? BRAND.gold : ink;
  const parts = [];
  if (solid) parts.push(`<circle cx="${C}" cy="${C}" r="${300 + bleed}" fill="${BRAND.forest}"/>`);
  else parts.push(`<circle cx="${C}" cy="${C}" r="292" fill="none" stroke="${ink}" stroke-width="12"/>`);
  parts.push(`<circle cx="${C}" cy="${C}" r="268" fill="none" stroke="${accent}" stroke-width="6"/>`);
  // The inner ring frames the mark; around a QR code its corners would all but
  // touch it, so the code stands on its own.
  if (center === "mark") parts.push(`<circle cx="${C}" cy="${C}" r="186" fill="none" stroke="${accent}" stroke-width="3"/>`);
  parts.push(arc("brico800", "SUBSUB VERIFIED", 50, C, C, 212, ink, { top: true, spacing: 5 }));
  parts.push(arc("inter800", bottom, 30, C, C, 214, ink, { top: false, spacing: 3.5 }));
  for (const x of [C - 228, C + 228]) parts.push(`<circle cx="${x}" cy="${C}" r="7" fill="${accent}"/>`);
  if (center === "mark") {
    parts.push(mark(C, C - 6, 210, accent));
  } else {
    const q = qrPath(center);
    const side = 236, x0 = C - side / 2, y0 = C - side / 2;
    parts.push(`<rect x="${x0 - 6}" y="${y0 - 6}" width="${side + 12}" height="${side + 12}" rx="18" fill="${BRAND.white}"/>`);
    parts.push(`<svg x="${x0}" y="${y0}" width="${side}" height="${side}" viewBox="0 0 ${q.size} ${q.size}" shape-rendering="crispEdges"><path d="${q.path}" fill="${BRAND.ink}"/></svg>`);
  }
  return parts.join("\n");
}

const svgDoc = (inner, { w = 600, h = 600, vb = "0 0 600 600", title = "SubSub Verified" } = {}) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${vb}" role="img" aria-label="${title}">\n<title>${title}</title>\n${inner}\n</svg>\n`;

// Print geometry: a die-cut circle, 1/8 in of bleed beyond it, everything in
// units where 600 = the finished diameter.
function printArt({ inches, bleedIn = 0.125, center, bottom }) {
  const u = 600 / inches;                     // units per inch
  const b = bleedIn * u;
  const vb = `${-b} ${-b} ${600 + 2 * b} ${600 + 2 * b}`;
  const size = `${inches + 2 * bleedIn}in`;
  const art = svgDoc(seal({ mode: "color", center, bottom, bleed: b }), { w: size, h: size, vb,
    title: `SubSub Verified, ${inches} in round, with ${bleedIn} in bleed` });
  const cut = svgDoc(`<circle cx="300" cy="300" r="300" fill="none" stroke="#FF00FF" stroke-width="1" vector-effect="non-scaling-stroke"/>`,
    { w: size, h: size, vb, title: `Cut line, ${inches} in circle` });
  return { art, cut, size };
}

// ---- the flyer -------------------------------------------------------------

function flyerHtml() {
  const q = qrPath(FLYER_URL);
  const font = (name, file, weight) => `@font-face{font-family:'${name}';font-weight:${weight};src:url('${pathToFileURL(join(MK, "build/fonts", file)).href}')}`;
  const markSvg = (fill, h) => `<svg viewBox="32 58 104 120" height="${h}" aria-hidden="true">${MARK.map((d) => `<path fill="${fill}" d="${d}"/>`).join("")}</svg>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
${font("Brico", "Bricolage_Grotesque_wght_800.ttf", 800)}
${font("Brico", "Bricolage_Grotesque_wght_700.ttf", 700)}
${font("Inter", "Inter_wght_600.ttf", 600)}
${font("Inter", "Inter_wght_800.ttf", 800)}
@page{size:8.5in 11in;margin:0}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{width:8.5in;height:11in;font-family:Inter;color:${BRAND.ink};background:${BRAND.bone};position:relative;overflow:hidden}
.top{background:${BRAND.forest};color:#fff;padding:.48in .6in .4in;position:relative}
.brand{display:flex;align-items:center;gap:.14in;font:800 30pt Brico;letter-spacing:-.01em}
.eyebrow{display:inline-block;margin-top:.32in;background:${BRAND.gold};color:#20160A;font:800 12pt Inter;letter-spacing:.08em;text-transform:uppercase;padding:.07in .16in;border-radius:99px}
h1{font:800 56pt/0.98 Brico;margin:.14in 0 .1in;letter-spacing:-.02em}
.sub{font:600 15pt/1.38 Inter;color:#D6E3DC;margin:0;max-width:6.6in}
.body{padding:.3in .6in 0;display:grid;grid-template-columns:1fr 2.75in;gap:.4in;align-items:start}
ul{list-style:none;margin:0;padding:0}
li{display:grid;grid-template-columns:.42in 1fr;gap:.12in;margin:0 0 .18in;font:600 13pt/1.34 Inter}
li b{display:block;font:800 17pt/1.2 Brico;margin-bottom:.04in}
.n{width:.42in;height:.42in;border-radius:50%;background:${BRAND.forest};color:${BRAND.gold};font:800 15pt Brico;display:flex;align-items:center;justify-content:center}
.qr{background:#fff;border:3px solid ${BRAND.forest};border-radius:.18in;padding:.18in;text-align:center}
.qr svg{width:2.3in;height:2.3in;display:block;margin:0 auto}
.qr p{margin:.1in 0 0;font:800 13.5pt/1.2 Brico}
.qr small{display:block;margin-top:.05in;font:600 10.5pt Inter;color:#3c4b44}
.free{margin:.06in .6in 0;background:#fff;border-left:.09in solid ${BRAND.gold};padding:.2in .26in;font:600 14pt/1.4 Inter}
.free b{font:800 18pt Brico}
.foot{position:absolute;left:.6in;right:.6in;bottom:.4in;display:flex;justify-content:space-between;align-items:center;font:600 11pt Inter;color:#3c4b44;border-top:1px solid #c9d3ce;padding-top:.14in}
.foot b{color:${BRAND.forest};font:800 13pt Brico}
</style></head><body>
<section class="top">
<div class="brand">${markSvg(BRAND.gold, 46)}<span>SubSub</span></div>
<span class="eyebrow">For subcontractors · Free forever</span>
<h1>One profile.<br>Every GC.</h1>
<p class="sub">Your license, insurance and W-9 in one live profile. Hand it to any general contractor in seconds, and never email a certificate again.</p>
</section>
<section class="body">
<ul>
<li><span class="n">1</span><span><b>Send it once, it stays current.</b>One link carries your certificate of insurance, bond and license with the live expiry date. No stale PDFs in somebody's inbox.</span></li>
<li><span class="n">2</span><span><b>Renew once, everyone gets it.</b>Upload next year's certificate and every GC you've sent your pack to gets the new one automatically.</span></li>
<li><span class="n">3</span><span><b>Every job in one place.</b>Work orders, times and job requests from every GC you work for, on your phone, in one list.</span></li>
</ul>
<div class="qr">
<svg viewBox="0 0 ${q.size} ${q.size}" shape-rendering="crispEdges"><rect width="${q.size}" height="${q.size}" fill="#fff"/><path d="${q.path}" fill="${BRAND.ink}"/></svg>
<p>Scan to make your free profile</p>
<small>subsub.work/subs</small>
</div>
</section>
<div class="free"><b>Free forever for subcontractors.</b> No card, no trial, no catch: a sub never pays for SubSub.</div>
<div class="foot"><span>Read more at <b>subsub.work/subs</b></span><span>${markSvg(BRAND.forest, 22)}</span></div>
</body></html>`;
}

// ---- the build ---------------------------------------------------------------

export async function build({ quiet = false } = {}) {
  mkdirSync(join(MK, "badge"), { recursive: true });
  mkdirSync(join(MK, "print"), { recursive: true });
  const files = {};
  files["badge/subsub-verified-color.svg"] = svgDoc(seal({ mode: "color" }));
  files["badge/subsub-verified-one-color.svg"] = svgDoc(seal({ mode: "one" }));
  files["badge/subsub-verified-reversed.svg"] = svgDoc(seal({ mode: "reversed" }));
  const decal = printArt({ inches: 6, center: DECAL_URL, bottom: "SCAN TO CHECK" });
  const sticker = printArt({ inches: 3, center: "mark", bottom: "LICENSE · INSURANCE" });
  files["print/decal-6in-art.svg"] = decal.art;
  files["print/decal-6in-cutline.svg"] = decal.cut;
  files["print/sticker-3in-art.svg"] = sticker.art;
  files["print/sticker-3in-cutline.svg"] = sticker.cut;
  for (const [p, body] of Object.entries(files)) writeFileSync(join(MK, p), body);

  // PDFs: the SVG art at its exact physical size, and the flyer. Chromium
  // writes vector PDF and embeds the fonts it used.
  const browser = await launch();
  try {
    const pdf = async (html, out, width, height) => {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "load" });
      await page.evaluate(() => document.fonts?.ready);
      await page.pdf({ path: join(MK, out), width, height, printBackground: true, pageRanges: "1" });
      await page.close();
    };
    const wrap = (svg, size) => `<!DOCTYPE html><html><head><style>@page{size:${size} ${size};margin:0}html,body{margin:0;padding:0}svg{display:block}</style></head><body>${svg}</body></html>`;
    await pdf(wrap(decal.art, decal.size), "print/decal-6in.pdf", decal.size, decal.size);
    await pdf(wrap(sticker.art, sticker.size), "print/sticker-3in.pdf", sticker.size, sticker.size);
    // The flyer is read with the fonts; the HTML is loaded from disk so the
    // @font-face file URLs resolve.
    const flyerPath = join(MK, "build/flyer.html");
    writeFileSync(flyerPath, flyerHtml());
    const page = await browser.newPage();
    await page.goto(pathToFileURL(flyerPath).href, { waitUntil: "load" });
    await page.evaluate(() => document.fonts?.ready);
    // On one page, and the free-forever band clear of the footer -- the
    // first version overlapped them by 30px, which no page-count check sees.
    const fit = await page.evaluate(() => {
      const free = document.querySelector(".free").getBoundingClientRect();
      const foot = document.querySelector(".foot").getBoundingClientRect();
      return document.body.scrollHeight <= document.body.clientHeight + 1 && free.bottom + 8 <= foot.top;
    });
    if (!fit) throw new Error("the flyer runs past one letter page, or into its own footer");
    await page.pdf({ path: join(MK, "print/flyer-letter.pdf"), width: "8.5in", height: "11in", printBackground: true, pageRanges: "1" });
    await page.close();
  } finally {
    await browser.close();
  }
  if (!quiet) {
    console.log("Wrote", Object.keys(files).length, "SVGs and 3 PDFs into marketing/");
    console.log("Decal QR points at", DECAL_URL);
    console.log("Flyer QR points at", FLYER_URL);
  }
  return files;
}

if (import.meta.url === `file://${process.argv[1]}`) await build();
