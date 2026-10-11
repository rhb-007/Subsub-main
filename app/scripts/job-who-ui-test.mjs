// Who a job is assigned to, said on the trade row and on the job's line.
//
// Reported as "on new jobs UI make it more obvious who the job has been
// assigned to ... this is very difficult to understand who this particular job
// was assigned to". The trade row drew a crew, a price and a WO number, and the
// company's name sat inline at 12.5px -- when it was there at all: the server's
// assignment shape never carried it, so after a reload the name was blank.
//
// The assertions that matter:
//
//   THE ROW SAYS "ASSIGNED TO <COMPANY>", with the relationship beside it, on
//   its own line rather than among the work-order details.
//
//   A ROW WITH NO NAME ON IT FROM THE SERVER STILL NAMES THEM, off the roster.
//   An older API, or a cached list, answers without the field, and the row must
//   not go back to naming nobody.
//
//   THE LINE NAMES THEM TOO, so a list of forty answers it without opening
//   forty cards -- and a job nobody is on names nobody.
//
//   node scripts/job-who-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait, openCards } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-job-who-test");
const WEB = 5413, API = 9113;
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
  // One trade carries the name from the server; the other arrives without it,
  // the shape the API answered before this change.
  base("j_two", "Move-out work — unit 14", ["plumbing", "roofing"], {
    plumbing: wo("1", "cmp_pac", "Pacific apartment maintenance"),
    roofing: wo("2", "cmp_bay", null),
  }),
  base("j_one", "Gutter run at the back", ["gutters"], { gutters: wo("3", "cmp_bay", "Bay Roofing") }),
  base("j_none", "Repaint the lobby", ["painting"], {}),
];

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
  if (path === "/api/my-work") return [200, { work: [] }];
  if (/^\/api\/jobs\/[^/]+\/trade-scope$/.test(path)) return [200, { scopes: {} }];
  if (path === "/api/properties") return [200, [{ id: "prop_1", accountId: "acc_pm", name: "Press Apartments",
    address: "1620 Belmont Ave", city: "Seattle", state: "WA", zip: "98122", units: 20, notes: "",
    vendorIds: [], ownerIds: [], tenantIds: [], ownerAccountId: "acc_pm", ownedNotOperated: false, readOnly: false }]];
  if (path === "/api/invites" || path === "/api/clients" || path === "/api/connect-requests"
    || path === "/api/my-connect-requests" || path === "/api/doc-shares"
    || path === "/api/property-transfers" || path === "/api/overflow-posts"
    || path === "/api/inspections" || path === "/api/my-quotes" || path === "/api/visits") return [200, []];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const nav = (page, re) => page.evaluate((src) => [...document.querySelectorAll("nav button")]
  .find((b) => new RegExp(src, "i").test((b.innerText || "").trim()))?.click(), re);
const allTab = (page) => page.evaluate(() => [...document.querySelectorAll(".seg-tabs.sm button")]
  .find((b) => /^All/i.test(b.innerText.trim()))?.click());

try {
  const { ctx, page, crashes } = await visitApp(browser, { host: "soundpm", webPort: WEB,
    seat: { userId: "u_mgr", accountId: "acc_pm" }, viewport: { width: 1280, height: 1600 } });
  await wait(2800);
  await nav(page, "^Jobs");
  await wait(1200);
  await allTab(page);
  await wait(600);

  console.log("\n-- the line names who has the job --");
  const lines = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll(".jobs-list .job-line")]
    .map((c) => [c.getAttribute("data-job-id"), c.querySelector(".jl-who")?.innerText.trim() || null])));
  t.ck("the lines are on screen", Object.keys(lines).length === 3, JSON.stringify(lines));
  t.ck("a job with one company names it", lines.j_one === "Bay Roofing", String(lines.j_one));
  t.ck("a job with two names the first and how many more",
    lines.j_two === "Pacific apartment maintenance + 1 more", String(lines.j_two));
  t.ck("a job nobody is on names nobody", Object.keys(lines).length === 3 && lines.j_none === null, String(lines.j_none));

  console.log("\n-- the trade row says Assigned to <company> --");
  await openCards(page);
  await wait(500);
  const rows = await page.evaluate(() => [...document.querySelectorAll('[data-job-id="j_two"] .trade-row')]
    .map((r) => ({
      trade: r.querySelector(".trade-name")?.innerText.trim(),
      who: r.querySelector(".ta-who")?.innerText.replace(/\s+/g, " ").trim() || null,
      company: r.querySelector(".ta-who .ta-company")?.innerText.trim() || null,
      rel: r.querySelector(".ta-who .ta-rel")?.innerText.trim() || null,
      size: parseFloat(getComputedStyle(r.querySelector(".ta-company") || r).fontSize),
      weight: Number(getComputedStyle(r.querySelector(".ta-company") || r).fontWeight),
      whoTop: r.querySelector(".ta-who")?.getBoundingClientRect().top ?? null,
      woTop: r.querySelector(".ta-wo-link")?.getBoundingClientRect().top ?? null,
    })));
  const plumb = rows.find((r) => /Plumbing/i.test(r.trade || "")) || {};
  const roof = rows.find((r) => /Roofing/i.test(r.trade || "")) || {};
  t.ck("both trade rows are drawn", rows.length === 2, JSON.stringify(rows));
  t.ck("the row reads Assigned to the company", /^Assigned to Pacific apartment maintenance/.test(plumb.who || ""),
    String(plumb.who));
  t.ck("and says what they are to this account", plumb.rel === "Handyman", String(plumb.rel));
  t.ck("a row the server sent with no name still names them, off the roster",
    roof.company === "Bay Roofing", String(roof.company));
  t.ck("with their own relationship", roof.rel === "Contractor", String(roof.rel));
  t.ck("the name is bold and not small", plumb.size >= 14 && plumb.weight >= 700,
    JSON.stringify([plumb.size, plumb.weight]));
  t.ck("on its own line, above the work-order details",
    plumb.whoTop != null && plumb.woTop != null && plumb.whoTop < plumb.woTop - 4,
    JSON.stringify([plumb.whoTop, plumb.woTop]));
  t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
  await ctx.close();
} finally {
  await browser.close();
  web.close(); api.close();
}

t.done();
