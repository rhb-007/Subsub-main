// A building's window links to its tenants, its jobs and its vendors.
//
// Reported with Properties -> Ballard Apts open and three figures circled:
// "6 units", "2 open jobs", "0 vendors scoped" -- "need to add a link to
// tenants, jobs, and vendors". They were plain text in the window, while the
// same figures on the list row were buttons that only looked like buttons on
// hover, which on an iPad is never.
//
// What this pins:
//   each figure is a visible, thumb-sized control in the window;
//   units opens Tenants narrowed to THAT building, and says so;
//   the narrowing is used once -- Tenants from the nav later shows everybody;
//   jobs opens Jobs narrowed to the building, vendors opens the roster
//   narrowed to it, and a building with no vendors opens the vendor picker;
//   a building with no jobs keeps a plain figure (a link onto nothing);
//   a building somebody else runs gets no tenants link -- its tenants are not
//   this account's.
//
//   node scripts/property-detail-links-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-propdetaillinks-test");
const WEB = 5503, API = 9105;
const t = tally();

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });

const PM = {
  id: "acc_pm", name: "Sound Property Management", subdomain: "sound", kind: "property_manager",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: [],
  logoKey: null, subscriptionStatus: "active",
  user: { id: "u_pm", name: "Priya Manager", email: "priya@sound.test", role: "admin" },
};
const prop = (id, name, units, extra = {}) => ({ id, accountId: "acc_pm", name, address: `${name} St`,
  city: "Seattle", state: "WA", zip: "98107", units, notes: "", ownedByAnother: false, ownerDeclared: false, ...extra });
const PROPS = [
  prop("p_ballard", "Ballard Apts", 6),
  prop("p_press", "Press Apartments", 12),
  // Owned here, run by somebody else: its tenants are that account's.
  prop("p_other", "Lake House", 4, { ownedNotOperated: true, managedBy: "Cascade Management" }),
];
const SUBS = [
  { id: "s1", company: "Ridge Roofing", engagementId: "en1", accountId: "acc_pm",
    categories: ["roofing"], propertyIds: ["p_ballard"], crews: [], bond: true, insurance: true,
    contract: true, hasPortal: false, notify: {}, rating: null, zips: [] },
  { id: "s2", company: "Elm Electric", engagementId: "en2", accountId: "acc_pm",
    categories: ["electrical"], propertyIds: ["p_ballard"], crews: [], bond: true, insurance: true,
    contract: true, hasPortal: false, notify: {}, rating: null, zips: [] },
];
const today = new Date().toISOString().slice(0, 10);
const job = (id, title, status) => ({ id, accountId: "acc_pm", title, propertyId: "p_ballard",
  trades: ["roofing"], assignments: {}, status, date: null, time: null, photos: [], createdAt: today });
const JOBS = [job("j1", "Roof leak", "active"), job("j2", "Gutter clean", "active"), job("j3", "Old repair", "completed")];
const tenant = (userId, name, unit, propertyId, propertyName) => ({ userId, name, email: `${userId}@t.test`,
  phone: null, unit, propertyId, propertyName, addedAt: "2026-09-01", status: "active", lastSentAt: null });
const TENANTS = [
  tenant("t1", "Ana Lopez", "1A", "p_ballard", "Ballard Apts"),
  tenant("t2", "Ben Cho", "2B", "p_ballard", "Ballard Apts"),
  tenant("t3", "Cara Diaz", "10C", "p_press", "Press Apartments"),
];
const USERS = [
  { id: "u_pm", name: "Priya Manager", email: "priya@sound.test", phone: null, role: "admin",
    subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false },
];

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, PM];
  if (path === "/api/account") return [200, PM];
  if (path === "/api/properties") return [200, PROPS];
  if (path === "/api/subs") return [200, SUBS];
  if (path === "/api/jobs") return [200, JOBS];
  if (path === "/api/visits") return [200, []];
  if (path === "/api/account-users") return [200, USERS];
  if (path === "/api/tenants") return [200, TENANTS];
  if (path === "/api/property-transfers") return [200, []];
  if (path === "/api/invites" || path === "/api/connect-requests") return [200, []];
  return undefined;
} });

const browser = await launch();
const nav = async (page, re) => {
  await page.evaluate((src) => [...document.querySelectorAll("button")]
    .find((b) => new RegExp(src).test(b.innerText.trim().split("\n")[0]))?.click(), re);
  await wait(1100);
};
const openDetail = async (page, name) => {
  await nav(page, "^(Properties|Buildings)");
  await page.evaluate((n) => [...document.querySelectorAll(".pt-open")]
    .find((b) => b.innerText.trim() === n)?.click(), name);
  await wait(500);
  return page.evaluate(() => {
    const d = document.querySelector(".prop-detail");
    if (!d) return null;
    return {
      links: [...d.querySelectorAll(".pd-stats .pd-link")].map((b) => ({
        go: b.dataset.go, text: b.innerText.replace(/\s+/g, " ").trim(),
        h: Math.round(b.getBoundingClientRect().height),
        color: getComputedStyle(b).color, ink: getComputedStyle(b.closest(".pd-stats")).color })),
      plain: [...d.querySelectorAll(".pd-stats > span")].map((s) => s.innerText.replace(/\s+/g, " ").trim()),
    };
  });
};
const press = (page, go) => page.evaluate((g) =>
  document.querySelector(`.prop-detail .pd-link[data-go="${g}"]`)?.click(), go);
const tenantNames = (page) => page.evaluate(() =>
  [...document.querySelectorAll(".user-list .user-row h4")].map((h) => h.innerText.trim()));

try {
  const { ctx, page } = await visitApp(browser, { host: "sound", webPort: WEB,
    seat: { userId: "u_pm", accountId: "acc_pm" }, viewport: { width: 1024, height: 900 } });
  await wait(2600);

  console.log("\n-- the window's figures are controls --");
  {
    const d = await openDetail(page, "Ballard Apts");
    t.ck("the building's window opened", !!d, JSON.stringify(d));
    const gos = (d?.links || []).map((l) => l.go);
    t.ck("units, jobs and vendors are each a link", ["tenants", "jobs", "vendors"].every((g) => gos.includes(g)),
      JSON.stringify(gos));
    t.ck("each is a thumb-sized target", (d?.links || []).length === 3 && d.links.every((l) => l.h >= 36),
      JSON.stringify(d?.links.map((l) => l.h)));
    t.ck("and drawn in the brand color, not the figures' gray",
      (d?.links || []).length === 3 && d.links.every((l) => l.color !== l.ink), JSON.stringify(d?.links.map((l) => l.color)));
    const tn = d?.links.find((l) => l.go === "tenants");
    t.ck("the units link says it goes to the tenants", /6 units/.test(tn?.text) && /tenants/.test(tn?.text), tn?.text);
    const jb = d?.links.find((l) => l.go === "jobs");
    t.ck("the jobs link carries the count and what is finished", /2 open jobs/.test(jb?.text) && /1 finished/.test(jb?.text), jb?.text);
  }

  console.log("\n-- units -> tenants at that building --");
  {
    await press(page, "tenants");
    await wait(1200);
    const s = await page.evaluate(() => ({
      head: document.querySelector(".page-head h2, .ss-main h2")?.innerText.trim(),
      scoped: document.querySelector(".tn-scoped")?.innerText.replace(/\s+/g, " ").trim() || "",
      modal: !!document.querySelector(".prop-detail"),
    }));
    t.ck("the window closed on the way", !s.modal);
    t.ck("the Tenants screen says which building", /Showing tenants at Ballard Apts/.test(s.scoped), s.scoped);
    const names = await tenantNames(page);
    t.ck("and lists only that building's tenants",
      names.length === 2 && names.includes("Ana Lopez") && names.includes("Ben Cho"), JSON.stringify(names));
    await page.evaluate(() => document.querySelector(".tn-scoped button")?.click());
    await wait(300);
    t.ck("Show all brings everybody back", (await tenantNames(page)).length === 3);

    // The narrowing is spent once: a later visit from the nav is the whole list.
    await nav(page, "^(Properties|Buildings)");
    await nav(page, "^Tenants");
    const later = await tenantNames(page);
    t.ck("Tenants from the nav afterwards is not narrowed",
      later.length === 3 && !(await page.evaluate(() => !!document.querySelector(".tn-scoped"))), JSON.stringify(later));
  }

  console.log("\n-- jobs and vendors --");
  {
    await openDetail(page, "Ballard Apts");
    await press(page, "jobs");
    await wait(1200);
    const scoped = await page.evaluate(() => document.querySelector(".scoped-to")?.innerText.replace(/\s+/g, " ").trim() || "");
    t.ck("jobs opens Jobs narrowed to the building", /Showing jobs at Ballard Apts/.test(scoped), scoped);

    await openDetail(page, "Ballard Apts");
    await press(page, "vendors");
    await wait(1200);
    const v = await page.evaluate(() => document.querySelector(".scoped-to")?.innerText.replace(/\s+/g, " ").trim() || "");
    t.ck("vendors opens the roster narrowed to the building", /Showing contractors who work Ballard Apts/.test(v), v);
  }

  console.log("\n-- a building with nothing yet --");
  {
    const d = await openDetail(page, "Press Apartments");
    const gos = (d?.links || []).map((l) => l.go);
    t.ck("no jobs keeps a plain figure rather than a link onto nothing",
      !!d && !gos.includes("jobs") && d.plain.some((x) => /0 open jobs/.test(x)), JSON.stringify(d));
    const vd = d?.links.find((l) => l.go === "vendors");
    t.ck("no vendors still links, and says it is to choose them", /0 vendors scoped/.test(vd?.text) && /choose/.test(vd?.text), vd?.text);
    await press(page, "vendors");
    await wait(600);
    const pick = await page.evaluate(() => [...document.querySelectorAll("h4")].map((h) => h.innerText.trim()));
    t.ck("which opens the vendor picker for that building",
      pick.some((x) => /Vendors at Press Apartments/i.test(x)), JSON.stringify(pick));
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /Done/.test(b.innerText))?.click());
    await wait(300);
  }

  console.log("\n-- a building somebody else runs --");
  {
    const d = await openDetail(page, "Lake House");
    t.ck("its window opened", !!d, JSON.stringify(d));
    t.ck("and carries no tenants link -- they are the manager's tenants",
      !!d && !(d.links || []).some((l) => l.go === "tenants") && d.plain.some((x) => /4 units/.test(x)), JSON.stringify(d));
  }

  await ctx.close();
} finally {
  await browser.close();
  web.close(); api.close();
}
t.done();
