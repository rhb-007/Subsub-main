// The maps, on screen (085).
//
// A general contractor's Jobs map and a managing agent's Properties and
// Tenants maps. The server suite (test:map) proves the scoping and the
// geocoding; this one proves what only a browser can:
//
//   THE MAP IS ONLY WHERE IT BELONGS. Jobs -> Map for a general contractor
//   and not for a property manager; Properties -> Map and Tenants -> Map for
//   a property manager. Both kinds are driven in the same suite, because a
//   gate checked on one branch is the diagonal coverage this file keeps
//   refusing.
//
//   THE PIN SAYS WHO IS THERE. The company on the job is on the pin, and a
//   job nobody is on says so in red.
//
//   TWO JOBS AT ONE ADDRESS ARE ONE PIN. Drawn as two they sit exactly on top
//   of each other and only the last is ever reachable.
//
//   HOVER SHOWS THE CARD; A TAP KEEPS IT, AND ON A PHONE IT DOCKS. The card
//   is read off the screen, and at 390px it must sit inside the viewport.
//
//   WHAT COULD NOT BE PLACED IS SAID, never a pin quietly missing.
//
//   A DEVICE THAT CANNOT DRAW A MAP GETS THE PLACES AS A LIST.
//
// The tiles are OpenFreeMap's, which this container cannot reach, so the
// style request is answered here with a plain background: the pins, the
// cards and the list do not depend on a tile.
//
//   node --no-warnings scripts/map-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-map-test");
const WEB = 5515, API = 9215;
const t = tally();

const acct = (id, name, sub, kind) => ({
  id, name, subdomain: sub, kind, plan: "scale", billing: "monthly", useDefaultMark: true,
  theme: null, trades: [], logoKey: null, subscriptionStatus: "active", hostnameStatus: "active",
  user: { id: id === "acc_gc" ? "u_gc" : "u_pm", name: "Rae Lane", email: "rae@x.test", role: "admin" },
});
const GC = acct("acc_gc", "Outerhome Builders", "outerhome", "general_contractor");
const PM = acct("acc_pm", "Sound Property Management", "soundpm", "property_manager");

const sub = (id, company, cats, accountId) => ({
  id, company, engagementId: `en_${id}`, accountId, contact: `${company} owner`,
  email: `${id}@test.test`, phone: null, categories: cats, caps: [], crews: [],
  propertyIds: [], zips: [], notify: {}, rating: 0, ratedJobs: 0, bond: true, insurance: true,
  contract: true, w9: true, hasPortal: true, license: "", licenseCheck: null, available: true,
  unavailableDays: [], docReview: {}, coverage: {}, engagedAs: "subcontractor", status: "active",
});
const wo = (id, subId, company, extra = {}) => ({ id, subId, company, wo: `WO-${id}`, status: "accepted",
  auto: false, value: "900", respondBy: null, tradeScope: null, crewName: "Crew A", ...extra });
const job = (id, accountId, title, trades, assignments, extra = {}) => ({
  id, accountId, propertyId: null, title, status: "active", date: "2026-11-02", time: "09:00",
  address: "1620 Belmont Ave", area: "Seattle", zip: "98122", trades, assignments,
  notes: "", createdAt: "2026-10-05", photos: [], severity: null, client: null, sqft: null,
  stories: null, scope: "", measurementDocs: [], materialSource: null, materialsPaidBy: null,
  requestedBy: null, approvedAt: "2026-10-05", declinedAt: null, withdrawnAt: null, completedAt: null,
  access: null, accessEffective: "none", accessUserId: null, reportDetail: null, visit: null, ...extra,
});

const GC_SUBS = [sub("cmp_bay", "Bay Roofing", ["roofing"], "acc_gc"), sub("cmp_ely", "Elysian Electric", ["electrical"], "acc_gc")];
const GC_JOBS = [
  // Two at one address: one pin.
  job("j_a", "acc_gc", "Re-roof the garage", ["roofing"], { roofing: wo("1", "cmp_bay", "Bay Roofing") }),
  job("j_b", "acc_gc", "Gutter run at the back", ["roofing"], { roofing: wo("2", "cmp_bay", "Bay Roofing") }),
  job("j_c", "acc_gc", "Panel upgrade", ["electrical"], { electrical: wo("3", "cmp_ely", "Elysian Electric") },
    { address: "400 Pine St", zip: "98101" }),
  job("j_d", "acc_gc", "Basement drainage", ["roofing"], {}, { address: "88 Lake Ave", zip: "98109" }),
  job("j_e", "acc_gc", "Fence repair", ["roofing"], {}, { address: "", area: "", zip: "" }),
  job("j_f", "acc_gc", "Deck stain", ["roofing"], {}, { address: "12 Elm St", zip: "98103" }),
  // Finished: never on the map.
  job("j_done", "acc_gc", "Old finished job", ["roofing"], {}, { status: "completed", completedAt: "2026-09-01",
    address: "9 Done Rd", zip: "98105" }),
];
let gcAsks = 0;
const gcPoints = () => {
  gcAsks += 1;
  const pts = {
    j_a: { lat: 47.61850, lng: -122.32520, precision: "address" },
    j_b: { lat: 47.61850, lng: -122.32520, precision: "address" },
    j_c: { lat: 47.61160, lng: -122.33590, precision: "address" },
    j_d: { lat: 47.63100, lng: -122.34400, precision: "zip" },
    j_done: { lat: 47.65, lng: -122.30, precision: "address" },
  };
  // j_f arrives on the second ask: the map keeps asking while some are pending.
  if (gcAsks >= 2) pts.j_f = { lat: 47.66, lng: -122.35, precision: "address" };
  return { of: "jobs", points: pts, pending: gcAsks >= 2 ? [] : ["j_f"], noAddress: ["j_e"],
    hq: { lat: 47.59, lng: -122.30, precision: "address" }, hqState: "set" };
};

const PROPS = [
  { id: "p1", accountId: "acc_pm", name: "Ballard Apts", address: "1 Market St", city: "Seattle", state: "WA",
    zip: "98107", units: 12, occupiedUnits: 10, notes: "", vendorIds: [], ownerIds: [], tenantIds: [],
    ownerAccountId: "acc_pm", ownedNotOperated: false, readOnly: false },
  { id: "p2", accountId: "acc_pm", name: "Press Apts", address: "2 Pike St", city: "Seattle", state: "WA",
    zip: "98101", units: 8, occupiedUnits: null, notes: "", vendorIds: [], ownerIds: [], tenantIds: [],
    ownerAccountId: "acc_pm", ownedNotOperated: false, readOnly: false },
  { id: "p3", accountId: "acc_pm", name: "Nowhere Court", address: "77 Unknown Way", city: "Seattle", state: "WA",
    zip: "98199", units: 4, occupiedUnits: 4, notes: "", vendorIds: [], ownerIds: [], tenantIds: [],
    ownerAccountId: "acc_pm", ownedNotOperated: false, readOnly: false },
];
const PM_SUBS = [sub("cmp_pac", "Pacific apartment maintenance", ["plumbing"], "acc_pm")];
const PM_JOBS = [
  job("j_leak", "acc_pm", "Leaking sink in 3B", ["plumbing"], { plumbing: wo("9", "cmp_pac", "Pacific apartment maintenance") },
    { propertyId: "p1", address: "1 Market St", zip: "98107" }),
];
const TENANTS = [
  { userId: "t1", name: "Ricard Bond", email: "r@x.test", phone: null, unit: "3B", propertyId: "p1",
    propertyName: "Ballard Apts", status: "active", lastSentAt: null },
  { userId: "t2", name: "Mia Chen", email: "m@x.test", phone: null, unit: "4A", propertyId: "p1",
    propertyName: "Ballard Apts", status: "active", lastSentAt: null },
];
const pmPoints = () => ({ of: "buildings",
  points: { p1: { lat: 47.6687, lng: -122.3843, precision: "address" }, p2: { lat: 47.6097, lng: -122.3422, precision: "address" }, p3: null },
  pending: [], noAddress: [], hq: null, hqState: "none" });

const membership = (a) => ({ accountId: a.id, accountName: a.name, subdomain: a.subdomain, kind: a.kind,
  role: "admin", companyId: null, plan: "scale", billing: "monthly", theme: null, trades: [],
  logoKey: null, useDefaultMark: true });

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body, headers) => {
  const isGc = (headers?.["x-account-id"] || "") === "acc_gc";
  const A = isGc ? GC : PM;
  if (path === "/api/auth/me") return [200, { user: A.user, memberships: [membership(A)] }];
  if (path.startsWith("/api/account-by-subdomain/")) return [200, path.endsWith("/outerhome") ? GC : PM];
  if (path === "/api/account") return [200, A];
  if (path === "/api/subs") return [200, isGc ? GC_SUBS : PM_SUBS];
  if (path === "/api/account-users") return [200, [{ id: A.user.id, name: "Rae Lane", email: "rae@x.test",
    phone: null, role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }]];
  if (path === "/api/jobs") return [200, isGc ? GC_JOBS : PM_JOBS];
  if (path === "/api/properties") return [200, isGc ? [] : PROPS];
  if (path === "/api/tenants") return [200, isGc ? [] : TENANTS];
  if (path === "/api/map/points") return [200, isGc ? gcPoints() : pmPoints()];
  if (path === "/api/my-work") return [200, { work: [] }];
  if (/^\/api\/jobs\/[^/]+\/trade-scope$/.test(path)) return [200, { scopes: {} }];
  return undefined;
} });

const STYLE = JSON.stringify({ version: 8, sources: {},
  layers: [{ id: "bg", type: "background", paint: { "background-color": "#e8ebe6" } }] });
const fakeTiles = async (page) => {
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    if (r.url().startsWith("https://tiles.openfreemap.org/")) {
      return r.respond({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: STYLE });
    }
    return r.continue();
  });
};

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const nav = (page, re) => page.evaluate((src) => [...document.querySelectorAll("nav button")]
  .find((b) => new RegExp(src, "i").test((b.innerText || "").trim()))?.click(), re);
const tabs = (page) => page.evaluate(() => [...document.querySelectorAll(".jv-seg button")].map((b) => b.innerText.trim()));
const pressView = (page, sel, label) => page.evaluate((s, l) => {
  const b = [...document.querySelectorAll(`${s} button`)].find((x) => x.innerText.trim() === l);
  b?.click(); return !!b;
}, sel, label);
const pins = (page) => page.evaluate(() => [...document.querySelectorAll(".map-pin")].map((p) => ({
  key: p.dataset.pin, label: p.querySelector(".map-pin-label")?.textContent || "", count: p.querySelector(".map-pin-dot")?.textContent || "",
  cls: p.className, box: (({ x, y, width, height }) => ({ x, y, width, height }))(p.getBoundingClientRect()),
})));
const card = (page) => page.evaluate(() => {
  const c = document.querySelector(".map-card");
  if (!c) return null;
  const r = c.getBoundingClientRect();
  return { text: c.innerText, docked: c.classList.contains("docked"), pinned: c.classList.contains("pinned"),
    left: r.left, right: r.right, top: r.top, bottom: r.bottom, vw: innerWidth, vh: innerHeight };
});
const mapChrome = (page) => page.evaluate(() => {
  const w = document.querySelector(".map-wrap"), m = document.querySelector(".map-mark"), b = document.querySelector(".map-box");
  if (!w || !m) return null;
  const wr = w.getBoundingClientRect(), mr = m.getBoundingClientRect(), br = b.getBoundingClientRect();
  return { text: m.innerText.replace(/\s+/g, " ").trim(), logo: !!m.querySelector('svg[aria-label="SubSub"]'),
    dx: mr.left - wr.left, dy: mr.top - wr.top, pe: getComputedStyle(m).pointerEvents,
    wrap: { l: wr.left, t: wr.top, w: wr.width, h: wr.height }, boxH: br.height, vw: innerWidth, vh: innerHeight,
    full: w.classList.contains("full"), maxLabel: document.querySelector(".map-max")?.getAttribute("aria-label") || "",
    hq: [...document.querySelectorAll(".map-hq")].map((h) => h.innerText.replace(/\s+/g, " ").trim()),
    legend: document.querySelector(".map-legend")?.innerText || "" };
});
const hoverPin = async (page, pred) => {
  const all = await pins(page);
  const p = all.find(pred);
  if (!p) return false;
  await page.mouse.move(p.box.x + p.box.width / 2, p.box.y + p.box.height - 8);
  await wait(300);
  return true;
};

try {
  console.log("\n-- a general contractor: Jobs -> Map --");
  {
    const { ctx, page, crashes } = await visitApp(browser, { host: "outerhome", webPort: WEB,
      seat: { userId: "u_gc", accountId: "acc_gc" }, viewport: { width: 1280, height: 1000 } });
    await fakeTiles(page);
    await wait(2600);
    await nav(page, "^Jobs");
    await wait(1000);
    const tb = await tabs(page);
    t.ck("Jobs offers a Map view", tb.includes("Map"), tb.join(","));
    await pressView(page, ".jv-seg", "Map");
    await wait(4500);
    const ps = await pins(page);
    t.ck("the map drew pins", ps.length > 0, JSON.stringify(ps.map((p) => p.label)));
    t.ck("two jobs at one address are one pin, counted",
      ps.some((p) => p.label === "2 jobs" && p.count === "2"), JSON.stringify(ps.map((p) => [p.label, p.count])));
    t.ck("the pin names the company on the job", ps.some((p) => p.label === "Elysian Electric"),
      JSON.stringify(ps.map((p) => p.label)));
    t.ck("a job nobody is on says so, in red",
      ps.some((p) => p.label === "Nobody assigned" && /tone-bad/.test(p.cls)), JSON.stringify(ps.map((p) => [p.label, p.cls])));
    t.ck("a ZIP-placed job is drawn as approximate",
      ps.some((p) => p.label === "Nobody assigned" && /approx/.test(p.cls)), JSON.stringify(ps.map((p) => p.cls)));
    t.ck("a finished job is not on the map", !ps.some((p) => /Old finished/.test(p.label)) && ps.length === 4,
      String(ps.length));
    t.ck("the job still being placed arrived on the second ask", gcAsks >= 2 && ps.some((p) => p.label === "Nobody assigned" && !/approx/.test(p.cls)),
      `${gcAsks} asks`);

    const unplaced = await page.evaluate(() => document.querySelector(".map-unplaced")?.innerText || "");
    t.ck("a job with no address is named as not on the map", /Not on the map/.test(unplaced) && /Fence repair/.test(unplaced)
      && /no address/.test(unplaced), unplaced);

    let mc = await mapChrome(page);
    t.ck("the map carries the SubSub logo and its name, in the upper left",
      !!mc && mc.logo && /\|\s*Job Map/.test(mc.text) && mc.dx >= 0 && mc.dx < 24 && mc.dy >= 0 && mc.dy < 24, JSON.stringify(mc));
    t.ck("and the watermark never takes a press", mc?.pe === "none", mc?.pe);
    t.ck("the account's HQ is on the map, named, and in the key",
      mc?.hq.length === 1 && /HQ/.test(mc.hq[0]) && /Your HQ/.test(mc.legend), JSON.stringify(mc?.hq));
    t.ck("it is not one of the job pins", (await pins(page)).length === 4);
    const small = mc;
    await page.click(".map-max");
    await wait(600);
    mc = await mapChrome(page);
    t.ck("Full screen fills the whole screen", !!mc && mc.full && Math.abs(mc.wrap.l) < 1 && Math.abs(mc.wrap.t) < 1
      && Math.abs(mc.wrap.w - mc.vw) < 1 && Math.abs(mc.wrap.h - mc.vh) < 1, JSON.stringify(mc?.wrap));
    t.ck("and the map itself grows into it", !!mc && mc.boxH > small.boxH + 100 && mc.boxH > mc.vh - 120,
      `${small.boxH} -> ${mc?.boxH}`);
    t.ck("the watermark stays in the upper left", !!mc && mc.dx < 24 && mc.dy < 24, JSON.stringify(mc));
    t.ck("the control now says how to get back", mc?.maxLabel === "Exit full screen", mc?.maxLabel);
    t.ck("the pins are still there", (await pins(page)).length === 4);
    await page.keyboard.press("Escape");
    await wait(500);
    mc = await mapChrome(page);
    t.ck("Escape puts it back in the page", !!mc && !mc.full && Math.abs(mc.boxH - small.boxH) < 2, JSON.stringify(mc?.wrap));

    await hoverPin(page, (p) => p.label === "Elysian Electric");
    let c = await card(page);
    t.ck("hovering a pin shows its card", !!c && /Panel upgrade/.test(c.text), c?.text || "no card");
    t.ck("the card says who is on each trade", !!c && /Electrical/.test(c.text) && /Elysian Electric/.test(c.text) && /on it/.test(c.text), c?.text);
    t.ck("and when", !!c && /Nov/.test(c.text), c?.text);
    await page.mouse.move(5, 5);
    await wait(300);
    t.ck("moving away hides it", !(await card(page)), "still there");

    const stack = (await pins(page)).find((p) => p.label === "2 jobs");
    await page.mouse.click(stack.box.x + stack.box.width / 2, stack.box.y + stack.box.height - 8);
    await wait(400);
    await page.mouse.move(5, 5);
    await wait(300);
    c = await card(page);
    t.ck("a tap keeps the card open", !!c && c.pinned && /Re-roof the garage/.test(c.text) && /Gutter run/.test(c.text), c?.text);
    const opened = await page.evaluate(() => {
      const b = [...document.querySelectorAll(".map-card .mc-title")].find((x) => /Gutter run/.test(x.innerText));
      b?.click(); return !!b;
    });
    await wait(900);
    const modal = await page.evaluate(() => [...document.querySelectorAll(".modal")].map((m) => m.innerText).join(" | "));
    t.ck("the job's name in the card opens the job", opened && /Gutter run at the back/.test(modal), modal.slice(0, 200));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- the same map on a phone: the card docks inside the screen --");
  {
    gcAsks = 5;
    const { ctx, page } = await visitApp(browser, { host: "outerhome", webPort: WEB,
      seat: { userId: "u_gc", accountId: "acc_gc" }, viewport: { width: 390, height: 844, isMobile: true, hasTouch: true } });
    await fakeTiles(page);
    await wait(2600);
    // The saved view is per browser context, so ask for the map again.
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /menu/i.test(b.getAttribute("aria-label") || ""))?.click());
    await wait(300);
    await nav(page, "^Jobs");
    await wait(900);
    await pressView(page, ".jv-seg", "Map");
    await wait(4000);
    const p = (await pins(page)).find((x) => x.label === "Elysian Electric");
    if (p) await page.touchscreen.tap(p.box.x + p.box.width / 2, p.box.y + p.box.height - 8);
    await wait(500);
    const c = await card(page);
    t.ck("a tap opens the card", !!c && /Panel upgrade/.test(c?.text || ""), c?.text || "no card / no pin");
    t.ck("it is docked at the foot of the map", !!c && c.docked, JSON.stringify(c));
    t.ck("and it sits inside the screen", !!c && c.left >= 0 && c.right <= c.vw + 0.5 && c.bottom <= c.vh + 0.5, JSON.stringify(c));
    await ctx.close();
  }

  console.log("\n-- a property manager: Properties -> Map, and no Jobs map --");
  {
    const { ctx, page, crashes } = await visitApp(browser, { host: "soundpm", webPort: WEB,
      seat: { userId: "u_pm", accountId: "acc_pm" }, viewport: { width: 1280, height: 1000 } });
    await fakeTiles(page);
    await wait(2600);
    await nav(page, "^Jobs");
    await wait(900);
    const tb = await tabs(page);
    t.ck("Jobs is on screen for a property manager", tb.includes("List"), tb.join(","));
    t.ck("and it offers no Jobs map", !tb.includes("Map"), tb.join(","));
    await nav(page, "^Properties");
    await wait(900);
    t.ck("Properties offers a Map view", await pressView(page, ".prop-view", "Map"), "no switch");
    await wait(4000);
    const ps = await pins(page);
    t.ck("a pin per placed building, named", ps.length === 2 && ps.some((x) => x.label === "Ballard Apts")
      && ps.some((x) => x.label === "Press Apts"), JSON.stringify(ps.map((x) => x.label)));
    t.ck("a building with open work is marked", ps.some((x) => x.label === "Ballard Apts" && /tone-wait/.test(x.cls))
      && ps.some((x) => x.label === "Press Apts" && /tone-ok/.test(x.cls)), JSON.stringify(ps.map((x) => [x.label, x.cls])));
    const pmc = await mapChrome(page);
    t.ck("the buildings map is named as such", /\|\s*Property Map/.test(pmc?.text || ""), pmc?.text);
    t.ck("an account with no HQ address draws none and guesses none", pmc?.hq.length === 0 && !/Your HQ/.test(pmc.legend),
      JSON.stringify(pmc?.hq));
    await hoverPin(page, (x) => x.label === "Ballard Apts");
    const c = await card(page);
    t.ck("the card says how full the building is", !!c && /12 units/.test(c.text) && /10 occupied/.test(c.text), c?.text);
    t.ck("who lives there, with their units", !!c && /2 tenants/.test(c.text) && /Ricard Bond/.test(c.text) && /unit 3B/.test(c.text), c?.text);
    t.ck("and what is open there, and who is on it", !!c && /1 open job/.test(c.text) && /Leaking sink/.test(c.text)
      && /Pacific apartment maintenance/.test(c.text), c?.text);
    const unplaced = await page.evaluate(() => document.querySelector(".map-unplaced")?.innerText || "");
    t.ck("a building the geocoder could not find is named", /Nowhere Court/.test(unplaced) && /couldn't be found/.test(unplaced), unplaced);

    await nav(page, "^Tenants");
    await wait(1200);
    t.ck("Tenants offers a Map view", await pressView(page, ".tn-view", "Map"), "no switch");
    await wait(4000);
    t.ck("the tenants map is named as such", /\|\s*Tenant Map/.test((await mapChrome(page))?.text || ""));
    await hoverPin(page, (x) => x.label === "Ballard Apts");
    const c2 = await card(page);
    t.ck("the tenants map leads with who lives there",
      !!c2 && c2.text.indexOf("2 tenants") > -1 && c2.text.indexOf("2 tenants") < c2.text.indexOf("1 open job"), c2?.text);
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- a device that cannot draw a map --");
  {
    const noGl = await puppeteer.launch({
      executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
      headless: true, args: ["--no-sandbox", "--disable-gpu", "--disable-webgl", "--disable-3d-apis",
        "--host-resolver-rules=MAP *.subsub.work 127.0.0.1"] });
    const { ctx, page } = await visitApp(noGl, { host: "outerhome", webPort: WEB,
      seat: { userId: "u_gc", accountId: "acc_gc" }, viewport: { width: 1280, height: 1000 } });
    await fakeTiles(page);
    await wait(2600);
    await nav(page, "^Jobs");
    await wait(900);
    await pressView(page, ".jv-seg", "Map");
    await wait(4000);
    const fb = await page.evaluate(() => document.querySelector(".map-fallback")?.innerText || "");
    t.ck("it says so and lists the places instead", /can't draw the map/.test(fb) && /Panel upgrade/.test(fb), fb.slice(0, 300));
    await ctx.close();
    await noGl.close();
  }
} finally {
  await browser.close();
  web.close(); api.close();
}
t.done();
