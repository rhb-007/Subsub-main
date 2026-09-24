// The hero crew: that it is actually there, that it is transparent, and that
// it does not push the page sideways on anything.
//
// This used to test a second, wider crew that was shown on desktop and
// tablet landscape only. That image has been withdrawn and the hero is back
// to the one picture at every size, so the size-switching assertions are
// gone with it. What is kept is the part that is about any hero image and
// will matter again for the next one.
//
// Chief among those: the supplied wide image had no alpha channel at all.
// What looked like transparency was a picture OF a transparency
// checkerboard, baked in, which on the dark forest hero would have been a
// pale chequered rectangle. Nothing in the build would have said a word.
// So the corner of every served hero file is checked for real transparency.
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
for (const f of ["hero-crew.png", "hero-crew@2x.png", "hero-crew.webp", "hero-crew@2x.webp"]) {
  const m = await sharp(`${ROOT}/${f}`).metadata();
  ck(`${f} has an alpha channel`, m.hasAlpha === true, `alpha ${m.hasAlpha}`);
}
{
  // The corner is the tell. If a checkerboard were baked in this would be an
  // opaque pale grey rather than nothing at all.
  const { data, info } = await sharp(`${ROOT}/hero-crew@2x.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const a = (x, y) => data[(y * info.width + x) * info.channels + 3];
  ck("its corners are transparent, not chequered",
    a(2, 2) === 0 && a(info.width - 3, 2) === 0 && a(2, info.height - 3) === 0,
    `${a(2, 2)} / ${a(info.width - 3, 2)} / ${a(2, info.height - 3)}`);
  // Corners alone would pass an image that was cut out only at the edges, so
  // count the whole thing: a real cutout has a substantial clear background
  // AND a substantial solid crew. A baked-in checkerboard has neither.
  // "Solid" is >= 250 rather than exactly 255 because this image's own crew
  // sits at 253 -- a near-opaque puppet is a puppet.
  let clear = 0, solid = 0;
  for (let i = 3; i < data.length; i += info.channels) {
    if (data[i] === 0) clear++; else if (data[i] >= 250) solid++;
  }
  const total = info.width * info.height;
  const pc = (n) => `${(100 * n / total).toFixed(1)}%`;
  ck("a real share of it is transparent background", clear / total > 0.1, pc(clear));
  ck("and a real share of it is solid crew", solid / total > 0.4, pc(solid));
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
      nw: img.naturalWidth, nh: img.naturalHeight,
      loaded: img.complete && img.naturalWidth > 0,
      pageScrollsSideways: document.documentElement.scrollWidth > window.innerWidth + 2,
    };
  });
  await ctx.close();
  return out;
}

const SIZES = [
  [1440, 900, "desktop"], [1280, 800, "laptop"], [1024, 768, "tablet landscape"],
  [768, 1024, "tablet portrait"], [834, 1112, "10.9\" tablet portrait"],
  [1024, 1366, "12.9\" tablet portrait"], [390, 844, "phone"],
  [844, 390, "phone, turned sideways"],
];

try {
  console.log("\n-- the hero, at the sizes real devices are --");
  for (const [w, h, name] of SIZES) {
    const r = await heroAt(w, h);
    ck(`${name} (${w}x${h}) draws the crew`, !!r && r.loaded, r ? `${r.chose} ${r.nw}x${r.nh}` : "no hero image at all");
    ck(`${name}: it is the one hero image`, !!r && /^hero-crew(@2x)?\.(png|webp)$/.test(r.chose), r?.chose);
    ck(`${name}: nothing spills off the page`, !!r && r.pageScrollsSideways === false);
  }

  console.log("\n-- and it is drawn at a sensible size --");
  const d = await heroAt(1440, 900);
  ck("the crew takes a real share of the hero", d.w > 400 && d.w < 1100, `${d.w}px wide`);
  // Read the aspect off the file the browser chose rather than pinning a
  // number, so a replacement image is held to its own shape, not this one's.
  ck("with the aspect of the file it chose",
    Math.abs(d.w / d.h - d.nw / d.nh) < 0.06, `drawn ${d.w}x${d.h}, file ${d.nw}x${d.nh}`);
} finally {
  await browser.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
