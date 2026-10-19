// The dark theme, derived from the light stylesheet rather than written beside
// it. App.tsx carries about five hundred literal colors as well as its tokens,
// and a hand-written dark sheet would be a second copy of every one of them
// that the next change to the light sheet leaves behind. So each rule with a
// color in it gets a twin under html[data-theme="dark"], with the color's
// lightness turned over in OKLab and its hue and chroma kept. Contrast
// relations survive by construction: ink on paper stays as readable as it was,
// and amber stays amber.
//
// Three things are not inverted, each on purpose:
//  - translucent darks in backgrounds (modal backdrops): a veil over a dark
//    page is still dark, and a white one reads as a page that failed to load;
//  - translucent colors in shadows: a shadow is a shadow on any surface;
//  - the customer's own theme (wl-, theme-preview): that is a preview of a
//    page the customer's visitors see in the customer's colors.

const SKIP_SELECTOR = /theme-preview|\.wl-|\.tp-/;

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function rgbToOklab([r, g, b]) {
  const [R, G, B] = [r, g, b].map((v) => toLin(v / 255));
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

function oklabToRgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const R = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const G = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const B = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return [R, G, B].map((v) => Math.round(clamp(toSrgb(clamp(v))) * 255));
}

// White lands at DARK_TOP, black at LIGHT_BOTTOM. The page itself (--paper) is
// set a step darker than white lands, so a card or a modal reads as raised.
export const DARK_TOP = 0.215;
const LIGHT_BOTTOM = 0.985;
export const invertL = (L) => LIGHT_BOTTOM - (LIGHT_BOTTOM - DARK_TOP) * clamp(L);

export function invertRgb(rgb) {
  const [L, a, b] = rgbToOklab(rgb);
  // Chroma is kept, but a deep color turned light is pulled in a little so a
  // saturated fill does not go neon on a dark page.
  // A strongly colored mid-tone (amber, red, the brand green) is an accent,
  // and an accent should still look like itself: the more chroma, the less its
  // lightness moves. Near-grays and pale tints turn over fully.
  const C = Math.hypot(a, b);
  const w = clamp(1 - (C - 0.04) / 0.1, 0.35, 1);
  const L2 = L + (invertL(L) - L) * w;
  const k = L2 > L + 0.15 ? 0.85 : 1;
  return oklabToRgb([L2, a * k, b * k]);
}

const hex2 = (n) => n.toString(16).padStart(2, "0");
const NAMED = { white: [255, 255, 255], black: [0, 0, 0] };
const COLOR = /#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+%?)\s*)?\)|\b(white|black)\b/g;

function parse(m) {
  if (m[1]) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join("");
    const n = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { rgb: n, a };
  }
  if (m[6]) return { rgb: NAMED[m[6]], a: 1 };
  const a = m[5] == null ? 1 : m[5].endsWith("%") ? parseFloat(m[5]) / 100 : parseFloat(m[5]);
  return { rgb: [m[2], m[3], m[4]].map(Number), a };
}

const fmt = (rgb, a) => (a >= 1 ? `#${rgb.map(hex2).join("")}` : `rgba(${rgb.join(",")},${+a.toFixed(3)})`);

// One declaration's value in the dark theme, or null when nothing in it moves.
export function darkValue(prop, value) {
  const p = prop.trim().toLowerCase();
  const shadow = p.includes("shadow");
  const bg = p.startsWith("background");
  let changed = false;
  const out = value.replace(COLOR, (...m) => {
    const { rgb, a } = parse(m);
    if (a === 0) return m[0];
    if (shadow && a < 0.5) return m[0];
    const [L] = rgbToOklab(rgb);
    if (bg && a < 1 && L < 0.4) return m[0];
    changed = true;
    return fmt(invertRgb(rgb), a);
  });
  return changed ? out : null;
}

// The dark twin must add NO specificity. It is written straight after the rule
// it shadows, so the cascade between any two rules is exactly what it was in
// the light sheet: a later, equally specific rule (.day.is-next after
// .day.has) still wins in the dark. Prefixed with plain attribute selectors it
// would gain two classes' worth and beat rules it was meant to lose to, which
// is what the first version did.
function prefixSelector(sel) {
  return sel.split(",").map((part) => {
    const s = part.trim();
    if (!s) return s;
    if (s.startsWith(":root")) return s.replace(":root", ':root:where([data-theme="dark"])');
    if (/^html\b/.test(s)) return s.replace(/^html/, 'html:where([data-theme="dark"])');
    return `:where(html[data-theme="dark"]) ${s}`;
  }).join(",");
}

// Split a declaration list on semicolons outside parentheses and quotes.
function decls(body) {
  const out = []; let depth = 0, q = null, cur = "";
  for (const ch of body) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === ";" && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function darkBlock(body) {
  const kept = [];
  for (const d of decls(body)) {
    const i = d.indexOf(":");
    if (i < 0) continue;
    const prop = d.slice(0, i).trim();
    const v = darkValue(prop, d.slice(i + 1));
    if (v != null) kept.push(`${prop}:${v.trim()}`);
  }
  return kept.join(";");
}

// Walk the sheet: a rule is a selector and a brace block; an at-rule that holds
// rules (@media, @supports, @container) is walked inside; keyframes and font
// faces are copied as they are. Every rule is kept, and its dark twin, when it
// has one, follows it immediately.
function walk(css) {
  let out = "", i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open < 0) { out += css.slice(i); break; }
    const head = css.slice(i, open).trim();
    let depth = 1, j = open + 1;
    while (j < css.length && depth) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") depth--;
      j++;
    }
    const inner = css.slice(open + 1, j - 1);
    i = j;
    if (head.startsWith("@")) {
      out += /^@(media|supports|container)\b/.test(head) ? `${head}{${walk(inner)}}\n` : `${head}{${inner}}\n`;
      continue;
    }
    out += `${head}{${inner}}\n`;
    if (SKIP_SELECTOR.test(head)) continue;
    const body = darkBlock(inner);
    if (body) out += `${prefixSelector(head)}{${body}}\n`;
  }
  return out;
}

// The light sheet with a dark twin after every rule that carries a color.
export function withDark(css) {
  return walk(css.replace(/\/\*[\s\S]*?\*\//g, ""));
}

// Only the dark twins, for tests that want to read them on their own.
export function deriveDark(css) {
  return withDark(css).split("\n").filter((l) => l.includes('[data-theme="dark"]')).join("\n");
}
