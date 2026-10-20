// The job window is three tabs: Work, Schedule, Access.
//
// Reported as "a lot of information on one modal, overwhelming ... can we tab
// this page out". The window drew the scope, the trades, the message row, the
// visit block and the access panel in one column. It is split into what the
// work is, when it happens, and how the crew gets in, with the title and the
// footer on every tab. The assertions that matter:
//
//   A QUESTION BEHIND A TAB IS THE STALL. A job whose time is waiting on this
//   side opens on Schedule, and that tab carries the dot; a job with nothing
//   waiting opens on Work with no dot.
//
//   EACH TAB SHOWS ITS OWN PART AND NOT THE OTHERS, read from the drawn box.
//
//   CARDS VIEW KEEPS THE WHOLE CARD, because it is for reading many at once.
//
//   node scripts/job-tabs-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait, openCards } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-job-tabs-test");
const WEB = 5442, API = 9142;
const t = tally();

const PM = {
  id: "acc_pm", name: "Sound Property Management", subdomain: "soundpm",
  kind: "property_manager", plan: "scale", billing: "monthly", useDefaultMark: true,
  theme: null, trades: [], logoKey: null, subscriptionStatus: "active", hostnameStatus: "active",
  user: { id: "u_mgr", name: "Christopher Lane", email: "chris@soundpm.test", role: "admin" },
};
const sub = (id, company, cats, extra = {}) => ({
  id, company, engagementId: `en_${id}`, accountId: "acc_pm", contact: `${company} owner`,
  email: `${id}@test.test`, phone: null, categories: cats, caps: ["Repairs"], crews: [],
  propertyIds: [], zips: [], notify: {}, rating: 0, ratedJobs: 0, bond: true, insurance: true,
  contract: true, w9: true, hasPortal: true, license: "", licenseCheck: null, available: true,
  unavailableDays: [], docReview: {}, coverage: {}, engagedAs: "subcontractor", status: "active", ...extra,
});
const SUBS = [
  sub("cmp_pac", "Pacific apartment maintenance", ["plumbing", "painting"], { engagedAs: "handyman" }),
  sub("cmp_bay", "Bay Roofing", ["roofing", "gutters"]),
];
const USERS = [{ id: "u_mgr", name: "Christopher Lane", email: "chris@soundpm.test", phone: null,
  role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }];
const wo = (id, subId, company, extra = {}) => ({ id, subId, company, wo: `WO-${id}`, status: "accepted",
  auto: false, value: "900", respondBy: null, tradeScope: null, crewName: "Crew A", ...extra });
const base = (id, title, trades, assignments) => ({
  id, accountId: "acc_pm", propertyId: "prop_1", title, status: "active", date: "2026-11-02", time: null,
  address: "1620 Belmont Ave", area: "Seattle", zip: "98122", trades, assignments,
  notes: "", createdAt: "2026-10-05", photos: [], severity: null, client: null, sqft: null,
  stories: null, scope: "", measurementDocs: [], materialSource: null, materialsPaidBy: null,
  requestedBy: null, approvedAt: "2026-10-05", declinedAt: null, withdrawnAt: null, completedAt: null,
  access: null, accessEffective: "manager", accessUserId: null, reportDetail: null,
  propertyName: "Press Apartments", visit: null,
});
const JOBS = [
  // A crew's counter waits on this side, so the window opens on Schedule.
  base("j_ask", "Bedroom window frame seems to be bent", ["plumbing"],
    { plumbing: wo("1", "cmp_pac", "Pacific apartment maintenance") }),
  // A time everybody agreed, ahead: nothing waits, so the window opens on Work.
  base("j_calm", "Gutter run at the back", ["gutters"], { gutters: wo("2", "cmp_bay", "Bay Roofing") }),
];
const VISITS = [
  { id: "v_ask", jobId: "j_ask", date: "2026-11-20", startTime: "10:45", endTime: "11:45", status: "proposed",
    turn: "manager", waitingOn: ["manager"], parties: ["manager", "contractor"], proposedBy: "u_crew",
    note: "", tenantNote: null, createdAt: "2026-10-18" },
  { id: "v_calm", jobId: "j_calm", date: "2026-11-21", startTime: "09:00", endTime: "10:00", status: "confirmed",
    turn: null, waitingOn: [], parties: ["manager", "contractor"], proposedBy: "u_mgr",
    note: "", tenantNote: null, createdAt: "2026-10-18" },
];
const PLAN = {
  kind: "manager", how: "Buzz the unit from the gate", howFrom: "manager", live: true,
  when: { date: "2026-11-20", startTime: "10:45", endTime: "11:45", status: "proposed" },
  people: [{ side: "crew", firstName: "Juan", company: "Pacific apartment maintenance", phone: "+12065550199" }],
  canEditHow: true,
};
const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path) => {
  if (path === "/api/auth/me") return [200, { user: PM.user, memberships: [
    { accountId: "acc_pm", accountName: PM.name, subdomain: "soundpm", kind: "property_manager",
      role: "admin", companyId: null, plan: "scale", billing: "monthly", theme: null, trades: [],
      logoKey: null, useDefaultMark: true }] }];
  if (path.startsWith("/api/account-by-subdomain/")) return [200, PM];
  if (path === "/api/account") return [200, PM];
  if (path === "/api/subs") return [200, SUBS];
  if (path === "/api/account-users") return [200, USERS];
  if (path === "/api/jobs") return [200, JOBS];
  if (path === "/api/visits") return [200, VISITS];
  if (/^\/api\/jobs\/[^/]+\/access$/.test(path)) return [200, PLAN];
  if (path === "/api/my-work") return [200, { work: [] }];
  if (/^\/api\/jobs\/[^/]+\/trade-scope$/.test(path)) return [200, { scopes: {} }];
  if (path === "/api/properties") return [200, [{ id: "prop_1", accountId: "acc_pm", name: "Press Apartments",
    address: "1620 Belmont Ave", city: "Seattle", state: "WA", zip: "98122", units: 20, notes: "",
    vendorIds: [], ownerIds: [], tenantIds: [], ownerAccountId: "acc_pm", ownedNotOperated: false, readOnly: false }]];
  if (path === "/api/invites" || path === "/api/clients" || path === "/api/connect-requests"
    || path === "/api/my-connect-requests" || path === "/api/doc-shares"
    || path === "/api/property-transfers" || path === "/api/overflow-posts"
    || path === "/api/inspections" || path === "/api/my-quotes") return [200, []];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const nav = (page, re) => page.evaluate((src) => [...document.querySelectorAll("nav button")]
  .find((b) => new RegExp(src, "i").test((b.innerText || "").trim()))?.click(), re);
const openJob = (page, id) => page.evaluate((i) =>
  document.querySelector(`.job-line[data-job-id="${i}"] .jl-btn`)?.click(), id);
// What the open window shows: its tabs, which one is on, and which panes are
// actually drawn -- read from the box, because a pane hidden by a class is
// still in the DOM.
const read = (page) => page.evaluate(() => {
  const m = document.querySelector(".modal-job");
  if (!m) return null;
  const vis = (el) => !!el && el.getClientRects().length > 0;
  return {
    tabs: [...m.querySelectorAll(".job-tab")].map((b) => b.innerText.trim()),
    on: m.querySelector(".job-tab.on")?.getAttribute("data-tab") || null,
    dot: !!m.querySelector('.job-tab[data-tab="schedule"] .act-dot, .job-tab[data-tab="schedule"] [class*="dot"]'),
    trades: vis(m.querySelector(".trade-rows")),
    visit: vis(m.querySelector(".visit-block .form-sec")),
    access: vis(m.querySelector(".visit-block .access-panel, .visit-block .acc-panel, .visit-block [class*='access-p']")),
    accessText: [...m.querySelectorAll(".visit-block .jt-on")].map((x) => x.innerText).join(" ").includes("Buzz the unit"),
    title: vis(m.querySelector(".job-card-head h3")),
    footer: vis(m.querySelector(".job-footer")),
    height: Math.round(m.getBoundingClientRect().height),
  };
});
const tab = (page, id) => page.evaluate((i) => document.querySelector(`.modal-job .job-tab[data-tab="${i}"]`)?.click(), id);
const close = (page) => page.evaluate(() => document.querySelector(".modal-job .modal-close")?.click());

try {
  const { ctx, page, crashes } = await visitApp(browser, { host: "soundpm", webPort: WEB,
    seat: { userId: "u_mgr", accountId: "acc_pm" }, viewport: { width: 1024, height: 1366 } });
  await wait(2800);
  await nav(page, "^Jobs");
  await wait(1200);

  console.log("\n-- a job waiting on this side opens on Schedule --");
  await openJob(page, "j_ask");
  await wait(700);
  let w = await read(page);
  t.ck("the window opened, so the rest of this can fail", !!w && w.title, JSON.stringify(w));
  t.ck("it has three tabs: Work, Schedule, Access", JSON.stringify(w?.tabs) === '["Work","Schedule","Access"]',
    JSON.stringify(w?.tabs));
  t.ck("it opens on Schedule, where the question is", w?.on === "schedule", String(w?.on));
  t.ck("and the Schedule tab carries the dot", w?.dot === true);
  t.ck("Schedule shows the visit and not the trades or access",
    w?.visit && !w?.trades && !w?.accessText, JSON.stringify(w));
  t.ck("the title and the footer stay", w?.title && w?.footer, JSON.stringify(w));

  await tab(page, "work");
  await wait(300);
  w = await read(page);
  t.ck("Work shows the trades and nothing of the visit", w?.trades && !w?.visit && !w?.accessText, JSON.stringify(w));

  await tab(page, "access");
  await wait(300);
  w = await read(page);
  t.ck("Access shows how the crew gets in, alone", w?.accessText && !w?.visit && !w?.trades, JSON.stringify(w));
  t.ck("the footer is still there on Access", w?.footer === true);

  await close(page);
  await wait(400);
  t.ck("closing it closes it", (await read(page)) === null);

  console.log("\n-- a job with nothing waiting opens on Work --");
  await openJob(page, "j_calm");
  await wait(700);
  w = await read(page);
  t.ck("it opens on Work", w?.on === "work", String(w?.on));
  t.ck("with no dot on Schedule", w?.dot === false);
  await close(page);
  await wait(400);

  console.log("\n-- cards view keeps the whole card --");
  await openCards(page);
  await wait(500);
  const cards = await page.evaluate(() => {
    const c = document.querySelector('.job-card[data-job-id="j_ask"]');
    return { tabs: c ? c.querySelectorAll(".job-tab").length : -1,
      trades: !!c?.querySelector(".trade-rows")?.getClientRects().length,
      access: [...(c?.querySelectorAll(".visit-block .jt-on") || [])].map((x) => x.innerText).join(" ").includes("Buzz the unit") };
  });
  t.ck("no tabs on a card", cards.tabs === 0, JSON.stringify(cards));
  t.ck("and the trades and the access are both on it", cards.trades && cards.access, JSON.stringify(cards));
  t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
  await ctx.close();
} finally {
  await browser.close();
  web.close(); api.close();
}

t.done();
