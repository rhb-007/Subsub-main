// "IF THEY SHOW UP, A MODAL TO RATE THEIR WORK BEFORE MOVING ON."
//
// Pressing "Yes, they showed up" on a job card opens a window rating each
// trade the company accepted on that job. Drawn and pressed:
//   - Yes opens it, naming the company, with a row per ACCEPTED trade only
//     (a pending offer on the same job is not work anybody did);
//   - Save is dead until a star is picked, then posts the rating for that
//     work order and closes;
//   - a refused save keeps the window open with the reason, and Skip closes
//     it with nothing sent;
//   - No opens nothing.
//
//   node --no-warnings scripts/rate-visit-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait, openCards } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-ratevisit-test");
const WEB = 5487, API = 9287;
const t = tally();

const pad = (n) => String(n).padStart(2, "0");
const key = (off) => { const d = new Date(); d.setDate(d.getDate() + off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

const PM = {
  id: "acc_pm", name: "Sound Property Management", subdomain: "soundpm",
  kind: "property_manager", plan: "scale", billing: "monthly", useDefaultMark: true,
  theme: null, trades: [], logoKey: null, subscriptionStatus: "active", hostnameStatus: "active",
  user: { id: "u_mgr", name: "Richard Braun", email: "rb@soundpm.test", role: "admin" },
};
const USERS = [{ id: "u_mgr", name: "Richard Braun", email: "rb@soundpm.test", phone: null, role: "admin",
  subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }];
const SUB = {
  id: "cmp_pac", company: "Pacific apartment maintenance", engagementId: "en_pac",
  accountId: "acc_pm", contact: "Juan Soto", email: "juan@pacific.test", phone: null,
  categories: ["electrical", "plumbing"], caps: [], crews: [], propertyIds: [], zips: [],
  notify: {}, rating: null, bond: true, insurance: true, contract: true, w9: true,
  hasPortal: true, license: "", licenseCheck: null, available: true, unavailableDays: [],
  docReview: {}, coverage: {}, engagedAs: "subcontractor", status: "active",
};
const a = (job, trade, status) => ({
  id: `wo-${job}-${trade}`, wo: `WO-${trade}`, subId: "cmp_pac", company: "Pacific apartment maintenance",
  status, auto: false, responseWindow: "24h", respondBy: null, respondedAt: null, value: "300",
  payKind: "fixed", rate: "", capHours: null, tradeScope: null, crewName: null, signedWO: null, rating: null });
const job = (id, title, assignments) => ({
  id, accountId: "acc_pm", propertyId: "prop_1", title, status: "active",
  date: key(-2), time: "10:00", address: "1620 Belmont Ave", area: "Seattle", zip: "98122",
  trades: Object.keys(assignments), assignments, notes: "", createdAt: "Oct 1", createdAtIso: "2026-10-01T00:00:00Z",
  photos: [], severity: null, client: null, sqft: null, stories: null, scope: "", measurementDocs: [],
  materialSource: null, materialsPaidBy: null, requestedBy: null, approvedAt: "2026-10-02",
  declinedAt: null, withdrawnAt: null, completedAt: null, access: "manager", accessEffective: "manager",
  accessUserId: null, reportDetail: null, propertyName: "Press Apartments", readOnly: false, spans: {},
});
const JOBS = [
  job("j_a", "Move-out work — unit 2N", { plumbing: a("j_a", "plumbing", "accepted"), electrical: a("j_a", "electrical", "pending") }),
  job("j_b", "Move-out work — unit 3S", { plumbing: a("j_b", "plumbing", "accepted") }),
  job("j_c", "Move-out work — unit 4E", { plumbing: a("j_c", "plumbing", "accepted") }),
];
const T = "2026-10-01T12:00:00.000Z";
const v = (id, jobId) => ({ id, jobId, status: "confirmed", date: key(-2), startTime: "10:00",
  endTime: "11:00", note: "", tenantNote: null, respondedAt: null, contractorAt: T, contractorNote: null,
  managerAt: T, proposedBy: "u_mgr", createdAt: T, turn: null, waitingOn: [], companyId: null,
  parties: ["contractor", "manager"] });
const VISITS = [v("v_a", "j_a"), v("v_b", "j_b"), v("v_c", "j_c")];
const OUTCOMES = [], RATES = [];
let refuseRate = false;
const PROP = { id: "prop_1", accountId: "acc_pm", name: "Press Apartments", address: "1620 Belmont Ave",
  city: "Seattle", state: "WA", zip: "98122", units: 60, notes: "", ownedByAnother: false,
  vendorIds: [], ownerIds: [], tenantIds: [], ownerAccountId: "acc_pm", ownedNotOperated: false, readOnly: false };

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, sent) => {
  const oc = path.match(/^\/api\/visits\/([^/]+)\/outcome$/);
  if (oc && method === "POST") {
    OUTCOMES.push({ id: oc[1], ...sent });
    const row = VISITS.find((x) => x.id === oc[1]);
    if (row) row.status = sent.happened ? "happened" : "missed";
    return [200, row];
  }
  const rt = path.match(/^\/api\/work-orders\/([^/]+)\/rate$/);
  if (rt && method === "POST") {
    RATES.push({ id: rt[1], ...sent });
    return refuseRate ? [500, { error: "boom" }] : [200, { ok: true, rating: sent.rating }];
  }
  if (path.startsWith("/api/account-by-subdomain/")) return [200, PM];
  if (path === "/api/account") return [200, PM];
  if (path === "/api/account-users") return [200, USERS];
  if (path === "/api/jobs") return [200, JOBS];
  if (path === "/api/visits") return [200, VISITS];
  if (path === "/api/subs") return [200, [SUB]];
  if (path === "/api/properties") return [200, [PROP]];
  if (path === "/api/my-work") return [200, { work: [] }];
  if (/^\/api\/jobs\/[^/]+\/trade-scope$/.test(path)) return [200, { scopes: {} }];
  if (/^\/api\/jobs\/[^/]+\/access$/.test(path)) return [200, { kind: "manager", people: [], when: null }];
  if (path === "/api/payouts/status") return [200, { status: "none", ready: false, requirements: [], configured: false }];
  if (path === "/api/invites" || path === "/api/connect-requests" || path === "/api/my-connect-requests"
    || path === "/api/tenants" || path === "/api/clients" || path === "/api/notices"
    || path === "/api/my-notices" || path === "/api/inspections" || path === "/api/my-quotes"
    || path === "/api/doc-shares" || path === "/api/property-transfers" || path === "/api/overflow-posts"
    || path === "/api/threads") return [200, []];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();
const nav = (page, re) => page.evaluate((src) => [...document.querySelectorAll("nav button")]
  .find((b) => new RegExp(src, "i").test((b.innerText || "").trim()))?.click(), re);
const press = (page, jobId, re) => page.evaluate((id, src) => {
  const b = [...document.querySelectorAll(`[data-job-id="${id}"] [data-visit-outcome] button`)]
    .find((x) => new RegExp(src).test(x.innerText));
  b?.click(); return !!b;
}, jobId, re);
const modal = (page) => page.evaluate(() => {
  const m = document.querySelector("[data-rate-visit]");
  if (!m) return null;
  const btn = (re) => [...m.querySelectorAll("button")].find((b) => re.test(b.innerText));
  return {
    title: m.querySelector("h2")?.innerText.trim(),
    rows: [...m.querySelectorAll("[data-rate-trade]")].map((r) => r.getAttribute("data-rate-trade")),
    saveDisabled: btn(/Save rating|Saving/)?.disabled ?? null,
    err: m.querySelector("[role=alert]")?.innerText || null,
  };
});
const click = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); e?.click(); return !!e; }, sel);
const clickText = (page, re) => page.evaluate((src) => {
  const b = [...document.querySelectorAll("[data-rate-visit] button")].find((x) => new RegExp(src).test(x.innerText));
  b?.click(); return !!b;
}, re);

try {
  const m = await visitApp(browser, { host: "soundpm", webPort: WEB,
    seat: { userId: "u_mgr", accountId: "acc_pm" }, viewport: { width: 1180, height: 1400 } });
  await wait(2500);
  await nav(m.page, "^Jobs");
  await wait(1200);
  await openCards(m.page);
  await wait(600);

  console.log("\n-- Yes opens the rating window --");
  t.ck("the card asks whether they showed up", await press(m.page, "j_a", "Yes, they showed up"));
  await wait(900);
  let w = await modal(m.page);
  t.ck("Yes opens the rate-their-work window", !!w, JSON.stringify(w));
  t.ck("it names the company", /Pacific apartment maintenance/.test(w?.title || ""), w?.title);
  t.ck("one row per ACCEPTED trade, not the pending offer",
    JSON.stringify(w?.rows) === JSON.stringify(["plumbing"]), JSON.stringify(w?.rows));
  t.ck("Save is dead until a star is picked", w?.saveDisabled === true, JSON.stringify(w));
  await click(m.page, '[data-rate-trade="plumbing"] .sr-star:nth-of-type(4)');
  await wait(200);
  w = await modal(m.page);
  t.ck("and live once one is", w?.saveDisabled === false, JSON.stringify(w));
  await clickText(m.page, "Save rating");
  await wait(900);
  t.ck("Save posts the rating for that work order",
    RATES.length === 1 && RATES[0].id === "wo-j_a-plumbing" && RATES[0].rating === 4, JSON.stringify(RATES));
  t.ck("and the window closes", !(await modal(m.page)));

  console.log("\n-- a refused save keeps it open --");
  refuseRate = true;
  await press(m.page, "j_b", "Yes, they showed up");
  await wait(900);
  await click(m.page, '[data-rate-trade="plumbing"] .sr-star:nth-of-type(5)');
  await wait(200);
  await clickText(m.page, "Save rating");
  await wait(900);
  w = await modal(m.page);
  t.ck("a refused rating keeps the window open with the reason", !!w && /didn't save/.test(w.err || ""), JSON.stringify(w));
  const before = RATES.length;
  await clickText(m.page, "Skip for now");
  await wait(500);
  t.ck("Skip closes it and sends nothing", !(await modal(m.page)) && RATES.length === before, JSON.stringify(RATES));
  refuseRate = false;

  console.log("\n-- No opens nothing --");
  await press(m.page, "j_c", "No, nobody showed up");
  await wait(900);
  t.ck("No sends the answer", OUTCOMES.some((o) => o.id === "v_c" && o.happened === false), JSON.stringify(OUTCOMES));
  t.ck("and opens no rating window", !(await modal(m.page)));
  t.ck("the screen did not crash", m.crashes.length === 0, JSON.stringify(m.crashes));
} finally {
  await browser.close();
  web.close(); api.close();
}
t.done();
