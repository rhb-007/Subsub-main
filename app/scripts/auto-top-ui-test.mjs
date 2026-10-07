// AUTO-SCHEDULE LEADS THE PAGE, on both sides of it.
//
// Reported with the contractor's Job settings on screen: two chip grids --
// twenty-nine trades and every capability -- and the Auto-schedule switch at
// the very foot of them. "Put the auto scheduled settings towards the top of
// the page for contractors subcontractors instead of buried on the bottom."
//
// It is the one setting on that page that decides whether work lands on this
// calendar without anybody being asked, so it now sits above the tabs and is
// on every one of them. The hiring side's card had the same shape one screen
// along -- under the capabilities and the stat cards -- and moves up under
// the trades and Edit.
//
// Position is MEASURED, because source order is not screen order and a static
// check that the JSX moved passes whether or not it lands anywhere near the
// top.
//
//   node --no-warnings scripts/auto-top-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-autotop-test");
const WEB = 5397, API = 9097;
const t = tally();

let SEAT = "contractor";
const PM = () => ({
  id: "acc_pm", name: "Sound Property Management", subdomain: "soundpm",
  kind: "property_manager", plan: "scale", billing: "monthly", useDefaultMark: true,
  theme: null, trades: [], logoKey: null, subscriptionStatus: "active",
  user: SEAT === "contractor"
    ? { id: "u_juan", name: "Juan Soto", email: "juan@pacificam.test", role: "contractor" }
    : { id: "u_rb", name: "Richard B", email: "rb@soundpm.test", role: "admin" },
});
let AUTO = false;
const SUB = () => ({
  engagedAs: "subcontractor",
  id: "cmp_pac", company: "Pacific apartment maintenance", engagementId: "en_pac",
  accountId: "acc_pm", contact: "Juan Soto", email: "juan@pacificam.test", phone: "555-0100",
  categories: ["electrical", "plumbing"],
  caps: ["Panel upgrades", "Repiping", "Water heaters", "Fixture install"],
  crews: [], propertyIds: [], zips: [], notify: {}, rating: null,
  bond: true, insurance: true, contract: true, w9: true,
  hasPortal: true, answersForItself: true, license: "", licenseCheck: null,
  available: true, unavailableDays: [], docReview: {}, coverage: {},
  autoSchedule: AUTO,
});
const patched = [];

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, PM()];
  if (path === "/api/account") return [200, PM()];
  if (path === "/api/subs") return [200, [SUB()]];
  if (/^\/api\/subs\/cmp_pac$/.test(path) && method === "PATCH") {
    patched.push(body);
    if (typeof body?.autoSchedule === "boolean") AUTO = body.autoSchedule;
    return [200, SUB()];
  }
  if (path === "/api/account-users") return [200, [
    { id: "u_juan", name: "Juan Soto", email: "juan@pacificam.test", phone: null,
      role: "contractor", subId: "cmp_pac", propertyIds: [], unit: null,
      hasLogin: true, inviteSentAt: null, hasAvatar: false },
    { id: "u_rb", name: "Richard B", email: "rb@soundpm.test", phone: null,
      role: "admin", subId: null, propertyIds: [], unit: null,
      hasLogin: true, inviteSentAt: null, hasAvatar: false },
  ]];
  if (path === "/api/my-work") return [200, { work: [] }];
  if (path === "/api/overflow/posts" || path === "/api/overflow/offers") return [200, []];
  if (path === "/api/overflow/standing") return [200, { overflowOptIn: false, overflowTrades: [], eligible: true, reasons: [], joinedOn: null }];
  if (path === "/api/properties" || path === "/api/invites" || path === "/api/jobs"
    || path === "/api/clients" || path === "/api/my-connect-requests"
    || path === "/api/connect-requests" || path === "/api/property-transfers"
    || path === "/api/visits" || path === "/api/my-quotes"
    || path === "/api/doc-shares" || path === "/api/inspections"
    || path === "/api/change-orders") return [200, []];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const nav = (page, re) => page.evaluate((src) => {
  const r = new RegExp(src, "i");
  const b = [...document.querySelectorAll("nav button, .drawer button, aside button")]
    .find((x) => r.test(x.innerText.trim().split("\n")[0]));
  if (b) b.click();
  return !!b;
}, re.source);

// Where things are on the contractor's Job settings, by rectangle.
const settings = (page) => page.evaluate(() => {
  const top = (el) => (el ? Math.round(el.getBoundingClientRect().top + window.scrollY) : null);
  const card = [...document.querySelectorAll(".auto-card")]
    .find((c) => /auto-schedule/i.test(c.querySelector(".auto-title")?.innerText || ""));
  const grids = [...document.querySelectorAll(".pick-grid")];
  return {
    cards: [...document.querySelectorAll(".auto-card")]
      .filter((c) => /auto-schedule/i.test(c.querySelector(".auto-title")?.innerText || "")).length,
    card: top(card),
    tabs: top(document.querySelector(".seg-tabs")),
    firstGrid: top(grids[0]),
    lastGrid: top(grids[grids.length - 1]),
    gridCount: grids.length,
    on: card?.querySelector(".auto-toggle input")?.checked ?? null,
    label: card?.querySelector(".auto-toggle span")?.innerText.trim() || "",
  };
});

try {
  console.log("\n-- the contractor's own Job settings --");
  SEAT = "contractor";
  const { page } = await visitApp(browser, { host: "soundpm", webPort: WEB,
    seat: { userId: "u_juan", accountId: "acc_pm" }, viewport: { width: 1280, height: 1600 } });
  const logs = [];
  page.on("pageerror", (e) => logs.push("THROW " + String(e).slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/i.test(m.text())) logs.push(m.text().slice(0, 300)); });
  await wait(2600);
  t.ck("Job settings is in the nav", await nav(page, /^job settings/));
  await wait(900);
  let s = await settings(page);
  // The positive half first: "the switch is above the grids" passes loudest
  // on a screen that never rendered.
  t.ck("the trades tab drew both chip grids", s.gridCount >= 2, JSON.stringify(s));
  t.ck("there is exactly one Auto-schedule switch on the page", s.cards === 1, JSON.stringify(s));
  t.ck("it sits above the tabs", s.card != null && s.tabs != null && s.card < s.tabs,
    `${s.card} vs tabs ${s.tabs}`);
  t.ck("and above the first chip grid, not under the last",
    s.card != null && s.card < s.firstGrid, `${s.card} vs ${s.firstGrid}/${s.lastGrid}`);

  // Every tab, not only Trades: it is not a trades setting.
  for (const tab of ["Coverage", "Availability", "Overflow work"]) {
    await page.evaluate((l) => [...document.querySelectorAll(".seg-tabs button")]
      .find((b) => b.innerText.trim() === l)?.click(), tab);
    await wait(500);
    const x = await settings(page);
    t.ck(`it is still there on ${tab}`, x.cards === 1 && x.card < x.tabs, JSON.stringify(x));
  }

  // And it still does what it did.
  const el = await page.$(".auto-card .auto-toggle input");
  t.ck("the switch can be pressed", !!el);
  if (el) { await el.click(); await wait(900); }
  t.ck("the press reached the server", patched.some((b) => b?.autoSchedule === true),
    JSON.stringify(patched));
  s = await settings(page);
  t.ck("and it now reads On", s.on === true && s.label === "On", JSON.stringify(s));
  t.ck("nothing threw on the contractor side", logs.length === 0, logs.join(" | "));
  await page.close();

  console.log("\n-- the hiring side's card for the same contractor --");
  SEAT = "admin"; AUTO = false;
  const v2 = await visitApp(browser, { host: "soundpm", webPort: WEB,
    seat: { userId: "u_rb", accountId: "acc_pm" }, viewport: { width: 1280, height: 1600 } });
  const p2 = v2.page;
  const logs2 = [];
  p2.on("pageerror", (e) => logs2.push("THROW " + String(e).slice(0, 200)));
  await wait(2600);
  t.ck("the roster is in the nav", await nav(p2, /^(sub)?contractors/));
  await wait(900);
  const opened = await p2.evaluate(() => {
    const card = [...document.querySelectorAll(".grid .card")]
      .find((c) => /Pacific apartment maintenance/.test(c.innerText));
    if (!card) return false;
    card.click(); return true;
  });
  await wait(900);
  t.ck("their card opens", opened);
  const d = await p2.evaluate(() => {
    const top = (el) => (el ? Math.round(el.getBoundingClientRect().top) : null);
    const secs = [...document.querySelectorAll(".detail section")];
    const auto = secs.find((x) => /auto-schedule/i.test(x.querySelector("h4")?.innerText || ""));
    const caps = secs.find((x) => /^capabilities/i.test(x.querySelector("h4")?.innerText.trim() || ""));
    return {
      auto: top(auto), caps: top(caps),
      stats: top(document.querySelector(".detail .stat-cards")),
      trades: top(document.querySelector(".detail .detail-trades")),
    };
  });
  t.ck("the card drew its capabilities and stats", d.caps != null && d.stats != null, JSON.stringify(d));
  t.ck("Auto-schedule is above the capabilities", d.auto != null && d.auto < d.caps, JSON.stringify(d));
  t.ck("and above the stat cards", d.auto != null && d.auto < d.stats, JSON.stringify(d));
  t.ck("but under who they are and what they do", d.auto != null && d.auto > d.trades, JSON.stringify(d));
  t.ck("nothing threw on the hiring side", logs2.length === 0, logs2.join(" | "));
} finally {
  await browser.close(); web.close(); api.close();
}
t.done();
