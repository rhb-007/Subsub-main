// Photographs are shrunk before they go up, and go up several at a time.
//
// Reported as inspections taking "a very long time to load or import". A phone
// photograph is several megabytes at 4032x3024 and every one travelled that
// size up, back down for its thumbnail, and through a full-size decode when
// its note was drafted. Driven in a browser because the whole of this is what
// leaves the page -- a static check that `shrinkPhoto` exists passes with it
// never called.
//
//   node --no-warnings scripts/photo-shrink-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";
import { PHOTO_LONG_EDGE, SHRINK_ABOVE_BYTES } from "../src/lib/photoshrink.js";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-photo-shrink-test");
const WEB = 5391, API = 9091;
const t = tally();

const acct = {
  id: "acc_x", name: "Sound Property Management", subdomain: "soundpm", kind: "property_manager",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: ["plumbing"],
  logoKey: null, subscriptionStatus: "active", hostnameStatus: "active",
  user: { id: "usr_r", name: "Christopher Lane", email: "chris@x.test", role: "admin" },
};
let DETAIL = {
  id: "insp_1", propertyId: "prop_1", unit: "3B", kind: "move_out",
  tenantName: "Tess Nguyen", inspectedOn: "2026-10-02", status: "draft",
  finishedAt: null, jobId: null, createdAt: "2026-10-02 00:00:00", aiDrafts: false,
  recipients: [], sends: [],
  rooms: [{ id: "r1", name: "Kitchen", status: "follow_up", note: "", position: 0, photos: [] }],
};
const attached = [];
let n = 0;
const api = serveApi({ port: API, delay: 120, routes: (path, method, body) => {
  if (path === "/api/inspections" && method === "GET") return [200, [{ id: "insp_1", propertyId: "prop_1",
    unit: "3B", kind: "move_out", status: "draft", rooms: 1, flagged: 1, unchecked: 0, createdAt: "2026-10-02" }]];
  if (path === "/api/inspections/insp_1" && method === "GET") return [200, DETAIL];
  if (path.startsWith("/api/uploads/report-photo/") && method === "PUT") {
    return [200, { key: `acc_x/report-photo/k${++n}`, size: 1, type: "image/jpeg" }];
  }
  if (path === "/api/inspections/insp_1/rooms/r1/photos" && method === "POST") {
    attached.push(body);
    DETAIL = { ...DETAIL, rooms: [{ ...DETAIL.rooms[0], photos: [...DETAIL.rooms[0].photos,
      ...(body.photos || []).map((p, i) => ({ id: `ph${DETAIL.rooms[0].photos.length + i}`, name: p.name }))] }] };
    return [200, { ok: true, rooms: DETAIL.rooms }];
  }
  if (/^\/api\/inspections\/insp_1\/photos\//.test(path)) return [200, null, { raw: Buffer.alloc(0), type: "image/jpeg" }];
  if (path.startsWith("/api/account-by-subdomain/") || path === "/api/account") return [200, acct];
  if (path === "/api/account-users") return [200, [{ id: "usr_r", name: "Christopher Lane",
    email: "chris@x.test", role: "admin", propertyIds: [], hasLogin: true }]];
  if (path === "/api/properties") return [200, [{ id: "prop_1", accountId: "acc_x", name: "Press Apartments",
    address: "1620 Belmont Ave", city: "Seattle", state: "WA", zip: "98122", units: 141, notes: "" }]];
  if (path === "/api/payouts/status") return [200, { status: "none", ready: false, requirements: [], configured: false }];
  return undefined;
} });
const web = serveApp({ dir: OUT, port: WEB });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

// What leaves the page, measured in the page: the type, the size and the
// pixel dimensions of every photograph PUT, and how many were in flight at
// once. The stub reads bodies as text, which mangles bytes, so this is the
// one place their real size and shape can be read.
const watch = () => {
  window.__puts = [];
  window.__inflight = 0;
  window.__maxInflight = 0;
  const real = window.fetch;
  window.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (!u.includes("/uploads/report-photo/") || opts.method !== "PUT") return real(url, opts);
    window.__inflight++;
    window.__maxInflight = Math.max(window.__maxInflight, window.__inflight);
    const b = opts.body;
    let w = 0, h = 0;
    try { const bm = await createImageBitmap(b); w = bm.width; h = bm.height; } catch { /* not decodable */ }
    window.__puts.push({ name: decodeURIComponent(u.split("/").pop()), type: b?.type, size: b?.size, w, h,
      ctype: opts.headers?.["Content-Type"] });
    try { return await real(url, opts); } finally { window.__inflight--; }
  };
};

try {
  const { ctx, page } = await visitApp(browser, { host: "soundpm", webPort: WEB,
    seat: { userId: "usr_r", accountId: "acc_x" }, viewport: { width: 1200, height: 1300 },
    onNewDocument: watch });
  await wait(2600);
  await page.evaluate(() => [...document.querySelectorAll("nav button")]
    .find((b) => /^inspections/i.test((b.innerText || "").trim()))?.click());
  await wait(900);
  await page.evaluate(() => document.querySelector(".insp-row")?.click());
  await wait(1200);
  t.ck("the inspection opened onto its room", await page.evaluate(() => !!document.querySelector(".insp-room .ph-add input")));

  console.log("\n-- a large photograph goes up shrunk, and several go up at once --");
  // Three phone-sized photographs and one small one, chosen together. Noise
  // over a gradient, because a flat canvas compresses to nothing and would
  // never cross the threshold that decides whether shrinking is worth it.
  const made = await page.evaluate(async (threshold) => {
    const big = async (w, h, seed) => {
      const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
      const g = cv.getContext("2d");
      const im = g.createImageData(w, h);
      for (let i = 0; i < im.data.length; i += 4) {
        im.data[i] = ((i / 4) + seed) % 256;
        im.data[i + 1] = (Math.random() * 256) | 0;
        im.data[i + 2] = (Math.random() * 256) | 0;
        im.data[i + 3] = 255;
      }
      g.putImageData(im, 0, 0);
      return new Promise((ok) => cv.toBlob(ok, "image/png"));
    };
    const files = [];
    for (let i = 0; i < 3; i++) files.push(new File([await big(3000, 2000, i + 7)], `wall-${i}.png`, { type: "image/png" }));
    const tiny = await big(60, 40, 3);
    files.push(new File([tiny], "small.png", { type: "image/png" }));
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    const input = document.querySelector(".insp-room .ph-add input");
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return { sizes: files.map((f) => f.size), threshold };
  }, SHRINK_ABOVE_BYTES);
  t.ck("the fixture's large photographs are over the threshold",
    made.sizes.slice(0, 3).every((s) => s > SHRINK_ABOVE_BYTES), JSON.stringify(made.sizes));
  t.ck("and the small one is under it", made.sizes[3] < SHRINK_ABOVE_BYTES, String(made.sizes[3]));
  await wait(6000);

  const puts = await page.evaluate(() => window.__puts);
  const byName = Object.fromEntries(puts.map((p) => [p.name.replace(/\.(jpg|png)$/, ""), p]));
  t.ck("every photograph was uploaded", puts.length === 4, JSON.stringify(puts));
  const large = ["wall-0", "wall-1", "wall-2"].map((k) => byName[k]);
  t.ck("each large one went up as a JPEG", large.every((p) => p?.type === "image/jpeg" && /\.jpg$/.test(p.name)),
    JSON.stringify(large));
  t.ck(`no wider than ${PHOTO_LONG_EDGE}px on its long edge`,
    large.every((p) => p && Math.max(p.w, p.h) === PHOTO_LONG_EDGE), JSON.stringify(large.map((p) => p && [p.w, p.h])));
  t.ck("with its proportions kept", large.every((p) => p && Math.abs(p.w / p.h - 1.5) < 0.01));
  t.ck("and smaller than it was taken",
    large.every((p, i) => p && p.size < made.sizes[i]), JSON.stringify(large.map((p) => p?.size)));
  // THE SMALL ONE IS LEFT ALONE: shrinking a file that is already small buys
  // nothing, and re-encoding it is a chance to make it worse.
  t.ck("the small one went up exactly as it was",
    byName.small?.type === "image/png" && byName.small?.size === made.sizes[3], JSON.stringify(byName.small));
  // SEVERAL AT ONCE, and not all of them. One after another was most of the
  // wait on a room of twelve; all at once on one bar of signal finishes none.
  const max = await page.evaluate(() => window.__maxInflight);
  t.ck("more than one went up at a time", max >= 2, String(max));
  t.ck("but no more than three", max <= 3, String(max));

  console.log("\n-- the room is told what was stored --");
  const sent = attached.at(-1)?.photos || [];
  t.ck("all four were attached in one call", attached.length === 1 && sent.length === 4, JSON.stringify(attached));
  t.ck("in the order they were chosen", sent.map((p) => p.name).join() === "wall-0.png,wall-1.png,wall-2.png,small.png",
    JSON.stringify(sent.map((p) => p.name)));
  t.ck("the room draws all four", await page.evaluate(() => document.querySelectorAll(".insp-room .insp-shot").length) === 4);
  await ctx.close().catch(() => {});
} catch (e) {
  t.ck("the suite ran without throwing", false, e?.stack || String(e));
} finally {
  await browser.close().catch(() => {});
  web.close(); api.close();
}
t.done();
