// A profile picture is positioned before it is saved, and replacing one shows
// the new one. Reported from a tenant's My account: "not letting me replace"
// and "not letting me place the picture better ... it just loads it and can't
// customize".
//
// REPLACE had saved fine the whole time. Every circle on the page keyed its
// fetch on who the person is and whether they have a picture -- both
// unchanged by a replace -- so the old face stayed up; and the avatar route's
// five-minute private max-age meant a re-fetch was answered from the
// browser's own cache anyway. Only a SECOND upload over a first one can show
// either, so the suite does exactly that and reads the drawn circle back.
//
// THE CROP is measured on what leaves the page: a 512px square JPEG whose
// edges come from the part of the photo the person moved into the circle. The
// fixture is three vertical bands -- red, green, blue -- so the colour at the
// left and right edges of the upload says which part was chosen. A crop that
// ignored the drag or the zoom would upload the default centre, which has a
// red left edge.
//
//   node --no-warnings scripts/avatar-crop-ui-test.mjs

import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-avatarcrop-test");
const FIX = join(OUT, "..", "dist-avatarcrop-fixtures");
const WEB = 5403, API = 9103;
const t = tally();

mkdirSync(FIX, { recursive: true });
// 1200x800: red 0-400, green 400-800, blue 800-1200.
const bands = Buffer.alloc(1200 * 800 * 3);
for (let y = 0; y < 800; y++) for (let x = 0; x < 1200; x++) {
  const i = (y * 1200 + x) * 3;
  if (x < 400) bands[i] = 230; else if (x < 800) bands[i + 1] = 200; else bands[i + 2] = 230;
}
const PHOTO = join(FIX, "bands.png");
await sharp(bands, { raw: { width: 1200, height: 800, channels: 3 } }).png().toFile(PHOTO);
// What the avatar route serves back: a different solid colour per version, so
// the drawn circle says which picture it is showing.
const solid = (r, g, b) => sharp({ create: { width: 8, height: 8, channels: 3, background: { r, g, b } } }).png().toBuffer();
const SERVED = [await solid(240, 120, 0), await solid(0, 120, 240)];

const acct = {
  id: "acc_x", name: "Sound Property Management", subdomain: "x", kind: "property_manager",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: ["plumbing"],
  logoKey: null, subscriptionStatus: "active", hostnameStatus: "active",
};
let HAS = false, VERSION = -1, KEYS = 0;
const tenant = () => ({ id: "usr_t", name: "John Smith", email: "js@x.test", phone: null, role: "tenant",
  subId: null, propertyIds: ["prop_1"], unit: "53", hasLogin: true, inviteSentAt: null, hasAvatar: HAS });
const sets = [];

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path.startsWith("/api/account-by-subdomain/") || path === "/api/account") return [200, acct];
  if (path === "/api/account-users") return [200, [tenant()]];
  if (path.startsWith("/api/uploads/avatar/") && method === "PUT") return [200, { key: `acc_x/avatar/k${++KEYS}-avatar.jpg`, size: 1, type: "image/jpeg" }];
  if (path === "/api/me/avatar" && method === "PATCH") {
    sets.push(body?.avatarKey); HAS = !!body?.avatarKey; VERSION += 1; return [200, { ok: true, hasAvatar: HAS }];
  }
  if (path === "/api/account-users/usr_t/avatar") {
    return HAS ? [200, null, { raw: SERVED[Math.min(VERSION, 1)], type: "image/png" }] : [404, { error: "not_found" }];
  }
  if (path === "/api/properties") return [200, [{ id: "prop_1", accountId: "acc_x", name: "North Highland LLC",
    address: "5101 N Pearl St", city: "Ruston", state: "WA", zip: "98407", units: 60, notes: "" }]];
  if (path === "/api/me/contact") return [200, {}];
  if (path === "/api/notices") return [200, { notices: [] }];
  if (path === "/api/weather") return [200, {}];
  if (path === "/api/payouts/status") return [200, { status: "none", ready: false, requirements: [], configured: false }];
  if (path === "/api/jobs" || path === "/api/visits" || path === "/api/tenants") return [200, []];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

// What leaves the page, read in the page: the stub reads bodies as text.
const watch = () => {
  window.__puts = [];
  window.__avatarGets = [];
  const real = window.fetch;
  window.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (/\/account-users\/[^/]+\/avatar$/.test(u)) window.__avatarGets.push(opts.cache || "default");
    if (u.includes("/uploads/avatar/") && opts.method === "PUT") {
      const b = opts.body;
      const rec = { type: b?.type, w: 0, h: 0, left: null, right: null };
      try {
        const bm = await createImageBitmap(b);
        rec.w = bm.width; rec.h = bm.height;
        const cv = new OffscreenCanvas(bm.width, bm.height);
        const g = cv.getContext("2d"); g.drawImage(bm, 0, 0);
        const px = (x) => { const d = g.getImageData(x, bm.height >> 1, 1, 1).data; return [d[0], d[1], d[2]]; };
        rec.left = px(4); rec.right = px(bm.width - 5);
      } catch { /* not decodable */ }
      window.__puts.push(rec);
    }
    return real(url, opts);
  };
};
const colour = ([r, g, b] = []) => (r > 150 && g < 80 && b < 80 ? "red" : g > 140 && r < 80 && b < 80 ? "green"
  : b > 150 && r < 80 && g < 80 ? "blue" : `?${r},${g},${b}`);
// The drawn circle on My account: the colour of its picture, if it has one.
const circle = (page) => page.evaluate(async () => {
  const img = document.querySelector(".ua-pick .user-avatar img");
  if (!img) return null;
  await new Promise((ok) => (img.complete ? ok() : img.addEventListener("load", ok, { once: true })));
  const cv = document.createElement("canvas"); cv.width = 4; cv.height = 4;
  const g = cv.getContext("2d"); g.drawImage(img, 0, 0, 4, 4);
  const d = g.getImageData(2, 2, 1, 1).data;
  return [d[0], d[1], d[2]];
});
const tone = (c) => (!c ? null : c[0] > 200 && c[2] < 60 ? "orange" : c[2] > 200 && c[0] < 60 ? "skyblue" : `?${c}`);

try {
  const { ctx, page, crashes } = await visitApp(browser, { host: "x", webPort: WEB,
    seat: { userId: "usr_t", accountId: "acc_x" }, viewport: { width: 1100, height: 1300 }, onNewDocument: watch });
  await wait(2600);
  await page.evaluate(() => [...document.querySelectorAll("button")]
    .find((b) => /My account$/.test((b.innerText || "").trim()))?.click());
  await wait(900);
  t.ck("the tenant's My account has the picture control",
    await page.evaluate(() => /Add a picture/.test(document.querySelector(".ua-pick")?.innerText || "")));

  console.log("\n-- choosing a photo opens the crop, and nothing uploads yet --");
  const input = await page.$(".ua-pick input[type=file]");
  await input.uploadFile(PHOTO);
  await wait(900);
  const opened = await page.evaluate(() => ({
    crop: !!document.querySelector(".ua-crop"),
    preview: !!document.querySelector(".ua-crop-prev img"),
    slider: !!document.querySelector(".ua-crop-zoom input[type=range]"),
  }));
  t.ck("the crop step opens", opened.crop, JSON.stringify(opened));
  t.ck("with a live round preview and a zoom slider", opened.preview && opened.slider, JSON.stringify(opened));
  t.ck("and nothing has been uploaded yet", (await page.evaluate(() => window.__puts.length)) === 0);

  console.log("\n-- drag it, then use it --");
  const box = await page.evaluate(() => { const r = document.querySelector(".ua-crop-view").getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x - i * 12, box.y);
  await page.mouse.up();
  await wait(200);
  await page.evaluate(() => [...document.querySelectorAll(".ua-crop-acts button")].find((b) => /Use this picture/.test(b.innerText))?.click());
  await wait(1500);
  let puts = await page.evaluate(() => window.__puts);
  const first = puts[0];
  t.ck("one picture went up", puts.length === 1, JSON.stringify(puts));
  t.ck("a 512px square JPEG, not the original photo", first?.type === "image/jpeg" && first?.w === 512 && first?.h === 512,
    JSON.stringify(first));
  t.ck("its left edge is the part dragged into the circle (green), not the default centre (red)",
    colour(first?.left) === "green", JSON.stringify(first?.left));
  t.ck("and its right edge is blue", colour(first?.right) === "blue", JSON.stringify(first?.right));
  t.ck("it was saved to the tenant's own row", sets.length === 1 && /^acc_x\/avatar\//.test(sets[0] || ""), JSON.stringify(sets));
  t.ck("the crop step closes", !(await page.evaluate(() => !!document.querySelector(".ua-crop"))));
  t.ck("and the circle shows the new picture", tone(await circle(page)) === "orange", String(await circle(page)));

  console.log("\n-- replacing it --");
  await page.evaluate(() => [...document.querySelectorAll(".ua-pick button")].find((b) => /Change picture/.test(b.innerText))?.click());
  const input2 = await page.$(".ua-pick input[type=file]");
  await input2.uploadFile(PHOTO);
  await wait(900);
  // Zoom to 2 with the slider and do not drag: the middle 400px is all green.
  await page.evaluate(() => {
    const r = document.querySelector(".ua-crop-zoom input[type=range]");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(r, "2");
    r.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await wait(200);
  await page.evaluate(() => [...document.querySelectorAll(".ua-crop-acts button")].find((b) => /Use this picture/.test(b.innerText))?.click());
  await wait(1500);
  puts = await page.evaluate(() => window.__puts);
  const second = puts[1];
  t.ck("a second picture went up", puts.length === 2, String(puts.length));
  t.ck("zoomed in: both edges are inside the middle band",
    colour(second?.left) === "green" && colour(second?.right) === "green", JSON.stringify(second));
  t.ck("saved again", sets.length === 2, JSON.stringify(sets));
  t.ck("THE CIRCLE SHOWS THE REPLACEMENT, not the first picture", tone(await circle(page)) === "skyblue",
    String(await circle(page)));
  const gets = await page.evaluate(() => window.__avatarGets);
  t.ck("and every avatar read skips the browser cache", gets.length >= 2 && gets.every((g) => g === "no-store"),
    JSON.stringify(gets));

  console.log("\n-- cancelling uploads nothing --");
  await page.evaluate(() => [...document.querySelectorAll(".ua-pick button")].find((b) => /Change picture/.test(b.innerText))?.click());
  const input3 = await page.$(".ua-pick input[type=file]");
  await input3.uploadFile(PHOTO);
  await wait(700);
  await page.evaluate(() => [...document.querySelectorAll(".ua-crop-acts button")].find((b) => /^Cancel$/.test(b.innerText.trim()))?.click());
  await wait(500);
  t.ck("cancel closes it", !(await page.evaluate(() => !!document.querySelector(".ua-crop"))));
  t.ck("and nothing went up", (await page.evaluate(() => window.__puts.length)) === 2 && sets.length === 2);

  console.log("\n-- on a phone --");
  await page.setViewport({ width: 390, height: 1200 });
  await page.evaluate(() => [...document.querySelectorAll(".ua-pick button")].find((b) => /Change picture/.test(b.innerText))?.click());
  const input4 = await page.$(".ua-pick input[type=file]");
  await input4.uploadFile(PHOTO);
  await wait(700);
  const w = await page.evaluate(() => document.documentElement.scrollWidth);
  t.ck("nothing runs off the side", w <= 390, String(w));
  t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
  await ctx.close();
} catch (e) {
  t.ck("the suite ran without throwing", false, e?.stack || String(e));
} finally {
  await browser.close();
  web.close(); api.close();
}
t.done();
