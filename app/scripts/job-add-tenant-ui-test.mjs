// 15/16. A move-in job with nobody named as the tenant: the tenant is added
// from the job itself, on the Schedule tab and the Access tab, and named on
// the job in the same press.
//
// Reported with the Schedule tab reading "Nobody on this unit has a login yet
// ... Add them under Account -> Tenants" (a tab that no longer exists) and
// the Access tab reading "The tenant (the tenant) lets Cascade in".
//
//   node scripts/job-add-tenant-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-job-add-tenant-test");
const WEB = 5961, API = 9961;
const t = tally();

const PM = {
  id: "acc_pm", name: "Sound Property Management", subdomain: "soundpm",
  kind: "property_manager", plan: "scale", billing: "monthly", useDefaultMark: true,
  theme: null, trades: [], logoKey: null, subscriptionStatus: "active", hostnameStatus: "active",
  user: { id: "u_mgr", name: "Christopher Lane", email: "chris@soundpm.test", role: "admin" },
};
const sub = (id, company, cats) => ({
  id, company, engagementId: `en_${id}`, accountId: "acc_pm", contact: `${company} owner`,
  email: `${id}@test.test`, phone: null, categories: cats, caps: ["Repairs"], crews: [],
  propertyIds: [], zips: [], notify: {}, rating: 0, ratedJobs: 0, bond: true, insurance: true,
  contract: true, w9: true, hasPortal: true, license: "", licenseCheck: null, available: true,
  unavailableDays: [], docReview: {}, coverage: {}, engagedAs: "subcontractor", status: "active",
});
const SUBS = [sub("cmp_cas", "Cascade Apartment Services", ["plumbing", "flooring"]),
  sub("cmp_bay", "Bay Roofing", ["roofing", "gutters"])];
let USERS = [{ id: "u_mgr", name: "Christopher Lane", email: "chris@soundpm.test", phone: null,
  role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }];
const wo = (id, subId, company) => ({ id, subId, company, wo: `WO-${id}`, status: "accepted",
  auto: false, value: "900", respondBy: null, tradeScope: null, crewName: "Crew A" });
const base = (id, title, trades, assignments, extra = {}) => ({
  id, accountId: "acc_pm", propertyId: "prop_1", title, status: "active", date: null, time: null,
  address: "1620 Belmont Ave", area: "Seattle", zip: "98122", trades, assignments,
  notes: "", createdAt: "2026-10-05", photos: [], severity: null, client: null, sqft: null,
  stories: null, scope: "", measurementDocs: [], materialSource: null, materialsPaidBy: null,
  requestedBy: null, approvedAt: "2026-10-05", declinedAt: null, withdrawnAt: null, completedAt: null,
  access: null, accessEffective: "tenant", accessUserId: null, reportDetail: null,
  propertyName: "Press Apartments", visit: null, ...extra,
});
const JOBS = [
  base("j_movein", "Move-in inspection work — unit 12c", ["plumbing"],
    { plumbing: wo("1", "cmp_cas", "Cascade Apartment Services") },
    { fromInspection: { id: "insp_1", kind: "move_in", unit: "12c" } }),
  // The office lets them in and it was no move-in: no tenant is wanted.
  base("j_office", "Gutter run at the back", ["gutters"], { gutters: wo("2", "cmp_bay", "Bay Roofing") },
    { accessEffective: "manager" }),
];
const PLAN = { kind: "tenant", how: null, howFrom: null, live: false, when: null,
  people: [{ side: "crew", firstName: "Ricard", company: "Cascade Apartment Services", phone: "+12067778888" }],
  canEditHow: true };
const tenantPosts = [], jobPatches = [];
const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path === "/api/auth/me") return [200, { user: PM.user, memberships: [
    { accountId: "acc_pm", accountName: PM.name, subdomain: "soundpm", kind: "property_manager",
      role: "admin", companyId: null, plan: "scale", billing: "monthly", theme: null, trades: [],
      logoKey: null, useDefaultMark: true }] }];
  if (path.startsWith("/api/account-by-subdomain/")) return [200, PM];
  if (path === "/api/account") return [200, PM];
  if (path === "/api/subs") return [200, SUBS];
  if (path === "/api/account-users") return [200, USERS];
  if (path === "/api/tenants" && method === "POST") {
    tenantPosts.push(body);
    return [201, { ok: true, userId: "u_ana", name: `${body.firstName} ${body.lastName}`.trim(),
      email: body.email, phone: body.phone, unit: body.unit, propertyId: body.propertyId, sent: { email: true } }];
  }
  if (/^\/api\/jobs\/j_movein$/.test(path) && method === "PATCH") { jobPatches.push(body); return [200, { ok: true }]; }
  if (path === "/api/jobs") return [200, JOBS];
  if (path === "/api/visits") return [200, []];
  if (/^\/api\/jobs\/[^/]+\/access$/.test(path)) return [200, PLAN];
  if (path === "/api/my-work") return [200, { work: [] }];
  if (/^\/api\/jobs\/[^/]+\/trade-scope$/.test(path)) return [200, { scopes: {} }];
  if (path === "/api/properties") return [200, [{ id: "prop_1", accountId: "acc_pm", name: "Press Apartments",
    address: "1620 Belmont Ave", city: "Seattle", state: "WA", zip: "98122", units: 20, notes: "",
    vendorIds: [], ownerIds: [], tenantIds: [], ownerAccountId: "acc_pm", ownedNotOperated: false, readOnly: false }]];
  if (path === "/api/invites" || path === "/api/clients" || path === "/api/connect-requests"
    || path === "/api/my-connect-requests" || path === "/api/doc-shares" || path === "/api/tenants"
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
const tab = (page, id) => page.evaluate((i) => document.querySelector(`.modal-job .job-tab[data-tab="${i}"]`)?.click(), id);
const shown = (page) => page.evaluate(() => {
  const m = document.querySelector(".modal-job");
  const vis = (el) => !!el && el.getClientRects().length > 0;
  const btn = [...(m?.querySelectorAll(".ajt button") || [])].find((b) => vis(b));
  return { open: !!m, add: !!btn, addText: btn?.innerText.trim() || "",
    stale: /Account\s*→\s*Tenants/.test(m?.innerText || ""),
    head: [...(m?.querySelectorAll(".visit-block .jt-on") || [])].map((x) => x.innerText).join(" ") };
});
const fill = (page, label, value) => page.evaluate((l, v) => {
  const f = [...document.querySelectorAll(".ajt-form label")].find((x) => x.firstChild?.textContent.trim().startsWith(l));
  const i = f?.querySelector("input");
  if (!i) return false;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, v);
  i.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}, label, value);

try {
  const { ctx, page, crashes } = await visitApp(browser, { host: "soundpm", webPort: WEB,
    seat: { userId: "u_mgr", accountId: "acc_pm" }, viewport: { width: 1024, height: 1366 } });
  await wait(2800);
  await nav(page, "^Jobs");
  await wait(1200);

  console.log("\n-- a move-in job with no tenant named --");
  await openJob(page, "j_movein");
  await wait(800);
  await tab(page, "schedule");
  await wait(400);
  let s = await shown(page);
  t.ck("the window opened", s.open, JSON.stringify(s));
  t.ck("Schedule offers Add the tenant, right there", s.add && /Add the tenant/.test(s.addText), JSON.stringify(s));
  t.ck("and no longer points at a tab that does not exist", !s.stale, s.head.slice(0, 300));
  await tab(page, "access");
  await wait(400);
  s = await shown(page);
  t.ck("Access offers it too", s.add, JSON.stringify(s));
  t.ck("the headline does not say the tenant twice", !/\(the tenant\)/.test(s.head) && /nobody is named as the tenant yet/.test(s.head),
    s.head.slice(0, 200));

  await page.evaluate(() => [...document.querySelectorAll(".modal-job .ajt button")]
    .find((b) => b.getClientRects().length)?.click());
  await wait(300);
  const unit = await page.evaluate(() => [...document.querySelectorAll(".ajt-form label")]
    .find((x) => x.firstChild?.textContent.trim() === "Unit")?.querySelector("input")?.value || "");
  t.ck("the unit is filled in from the inspection", unit === "12c", unit);
  await fill(page, "First name", "Ana");
  await fill(page, "Last name", "Ruiz");
  await fill(page, "Mobile", "2065550142");
  await wait(150);
  await page.evaluate(() => document.querySelector(".ajt-form button[type=submit]")?.click());
  await wait(900);
  t.ck("the tenant is made on this building and unit", tenantPosts.length === 1
    && tenantPosts[0].propertyId === "prop_1" && tenantPosts[0].unit === "12c" && tenantPosts[0].firstName === "Ana",
    JSON.stringify(tenantPosts));
  t.ck("and named on the job, in the same press", jobPatches.length === 1 && jobPatches[0].accessUserId === "u_ana",
    JSON.stringify(jobPatches));
  const after = await page.evaluate(() => document.querySelector(".modal-job")?.innerText || "");
  t.ck("the window says so", /Ana Ruiz is the tenant on this job now/.test(after), after.slice(0, 400));
  await page.evaluate(() => document.querySelector(".modal-job .modal-close")?.click());
  await wait(400);

  console.log("\n-- a job the office lets them into, from no move-in --");
  await openJob(page, "j_office");
  await wait(800);
  await tab(page, "access");
  await wait(300);
  s = await shown(page);
  t.ck("that window opened too", s.open, JSON.stringify(s));
  t.ck("and asks for no tenant", !s.add, JSON.stringify(s));
  t.ck("nothing threw", crashes.length === 0, crashes.join(" | "));
  await ctx.close();
} finally {
  await browser.close();
  web.close(); api.close();
}
t.done();
