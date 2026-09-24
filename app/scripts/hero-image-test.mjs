// Which crew shows up, and at what size.
//
// Two hero images: the wider eight-strong crew where there is room to stand
// them beside the words, and the original five where there is not. "Desktop
// and tablet landscape" is not a width -- a 12.9" tablet held upright is
// 1024 across, wider than a laptop in a small window, and a phone turned
// sideways is wider still than it is tall. So the rule is width AND
// orientation, and this checks it at the sizes real devices actually are.
//
// It also checks the thing that nearly shipped: the supplied image had no
// alpha channel at all. What looked like transparency was a picture OF a
// transparency checkerboard, baked in, which on the dark forest hero would
// have been a pale chequered rectangle. The assertion here is that the
// corner of the served file is actually transparent.
//
//   node scripts/hero-image-test.mjs

import puppeteer from "puppeteer-core";
import sharp from "sharp";

const PORT = process.env.SITE_PORT || "5193";
const ROOT = "/home/user/Subsub-main";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("\n-- the files themselves --");
for (const f of ["hero-crew-wide.png", "hero-crew-wide@2x.png", "hero-crew-wide.webp", "hero-crew-wide@2x.webp"]) {
  const m = await sharp(`${ROOT}/${f}`).metadata();
  ck(`${f} has an alpha channel`, m.hasAlpha === true, `alpha ${m.hasAlpha}`);
}
{
  // The corner is the tell. If the checkerboard were still baked in this
  // would be an opaque pale grey rather than nothing at all.
  const { data, info } = await sharp(`${ROOT}/hero-crew-wide@2x.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const a = (x, y) => data[(y * info.width + x) * info.channels + 3];
  ck("its corners are transparent, not chequered",
    a(2, 2) === 0 && a(info.width - 3, 2) === 0 && a(2, info.height - 3) === 0,
    `${a(2, 2)} / ${a(info.width - 3, 2)} / ${a(2, info.height - 3)}`);
  // And the middle of a puppet is not.
  ck("and the crew is still solid", a(Math.round(info.width / 2), Math.round(info.height * 0.85)) === 255);
}

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu"],
});

async function heroAt(width, height) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "domcontentloaded" });
  await wait(1800);
  const out = await page.evaluate(() => {
    const img = document.querySelector(".hero-crew img");
    if (!img) return null;
    const r = img.getBoundingClientRect();
    return {
      // currentSrc is what the browser actually chose out of the picture.
      chose: (img.currentSrc || img.src).split("/").pop(),
      w: Math.round(r.width), h: Math.round(r.height),
      natural: `${img.naturalWidth}x${img.naturalHeight}`,
      overflowsRight: Math.round(r.right) > window.innerWidth + 2,
      pageScrollsSideways: document.documentElement.scrollWidth > window.innerWidth + 2,
    };
  });
  await ctx.close();
  return out;
}

try {
  console.log("\n-- where the wide crew belongs --");
  for (const [w, h, name] of [[1440, 900, "desktop"], [1280, 800, "laptop"], [1024, 768, "tablet landscape"]]) {
    const r = await heroAt(w, h);
    ck(`${name} (${w}x${h}) gets the wide crew`, /hero-crew-wide/.test(r.chose), r.chose);
    ck(`${name}: nothing spills off the page`, r.pageScrollsSideways === false);
  }

  console.log("\n-- and where it does not --");
  for (const [w, h, name] of [[768, 1024, "tablet portrait"], [834, 1112, "10.9\" tablet portrait"],
                              [1024, 1366, "12.9\" tablet portrait"], [390, 844, "phone"],
                              [844, 390, "phone, turned sideways"]]) {
    const r = await heroAt(w, h);
    ck(`${name} (${w}x${h}) keeps the original`, !/hero-crew-wide/.test(r.chose), r.chose);
    ck(`${name}: nothing spills off the page`, r.pageScrollsSideways === false);
  }

  // The 12.9" portrait case is the whole reason the rule is not just a
  // width: it is 1024 across, wider than the laptop above.
  console.log("\n-- the case a width alone would get wrong --");
  const tall = await heroAt(1024, 1366);
  const lap = await heroAt(1024, 768);
  ck("same width, different answer, because one is upright",
    !/wide/.test(tall.chose) && /wide/.test(lap.chose), `${tall.chose} vs ${lap.chose}`);

  console.log("\n-- and it is drawn at a sensible size --");
  const d = await heroAt(1440, 900);
  ck("the crew takes a real share of the hero", d.w > 500 && d.w < 1100, `${d.w}px wide`);
  ck("with the aspect of the file it chose", Math.abs(d.w / d.h - 1.5) < 0.06, `${d.w}x${d.h}`);
} finally {
  await browser.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
