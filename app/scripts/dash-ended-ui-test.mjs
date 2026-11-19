// A CANCELLED JOB NO LONGER ASKS FOR A CONTRACTOR.
//
// The dashboard's "Needs a contractor", "No reply" and the unassigned and
// awaiting-reply tiles read every approved job, so a cancelled one went on
// offering Assign. They read only work that can still take a contractor now:
// not cancelled, completed, closed with no work, or on hold.
//
//   node --no-warnings scripts/dash-ended-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait, openCards } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-dashended-test");
const WEB = 5634, API = 9334;
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
  status, auto: false, responseWindow: "24h", respondBy: null, respondedAt: null, value: "300", woIssued: null,
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
const ended = (j, kind, extra = {}) => ({ ...j, endingKind: kind, endingNote: "Demo", endingAt: "2026-11-01T00:00:00Z", ...extra });
const JOBS = [
  job("j_live", "Leaking faucet unit 4", { plumbing: null }),
  ended(job("j_cancel", "Queen Anne Roofing - Demo", { plumbing: null }), "cancelled"),
  ended(job("j_zap", "Zapier connection test", { electrical: a("j_zap", "electrical", "pending") }), "cancelled"),
  { ...job("j_done", "Finished repaint", { plumbing: null }), status: "completed" },
  ended(job("j_hold", "Held until spring", { electrical: null }), "deferred", { endingUntil: key(60) }),
  job("j_wait", "Gutter clean", { electrical: a("j_wait", "electrical", "pending") }),
];
JOBS.forEach((j) => { j.assignments = Object.fromEntries(Object.entries(j.assignments).filter(([, v]) => v)); });
const PROP = { id: "prop_1", accountId: "acc_pm", name: "Press Apartments", address: "1620 Belmont Ave",
  city: "Seattle", state: "WA", zip: "98122", units: 60, notes: "", ownedByAnother: false,
  vendorIds: [], ownerIds: [], tenantIds: [], ownerAccountId: "acc_pm", ownedNotOperated: false, readOnly: false };

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, PM];
  if (path === "/api/account") return [200, PM];
  if (path === "/api/account-users") return [200, USERS];
  if (path === "/api/jobs") return [200, JOBS];
  if (path === "/api/visits") return [200, []];
  if (path === "/api/subs") return [200, [SUB]];
  if (path === "/api/properties") return [200, [PROP]];
  if (path === "/api/my-work") return [200, { work: [] }];
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
try {
  const m = await visitApp(browser, { host: "soundpm", webPort: WEB,
    seat: { userId: "u_mgr", accountId: "acc_pm" }, viewport: { width: 1180, height: 1400 } });
  await wait(2500);
  const got = await m.page.evaluate(() => {
    const sec = [...document.querySelectorAll(".dash-sec")].find((s) => /Needs a contractor/i.test(s.querySelector("h3")?.innerText || ""));
    const card = (lab) => [...document.querySelectorAll(".dash-card")].find((c) => new RegExp(lab, "i").test(c.innerText));
    return {
      sec: !!sec,
      count: sec?.querySelector(".sec-count")?.innerText.trim() || null,
      titles: sec ? [...sec.querySelectorAll(".dr-title")].map((e) => e.innerText.trim()) : [],
      unassigned: card("Unassigned trade slots")?.querySelector(".dc-num")?.innerText.trim() || null,
      awaiting: card("reply")?.querySelector(".dc-num")?.innerText.trim() || null,
      body: document.body.innerText,
    };
  });
  t.ck("Needs a contractor is drawn for the live job", got.sec, JSON.stringify(got.titles));
  t.ck("it lists the live job", got.titles.includes("Leaking faucet unit 4"), JSON.stringify(got.titles));
  t.ck("a cancelled job is not in it", !got.titles.some((x) => /Queen Anne|Zapier/.test(x)), JSON.stringify(got.titles));
  t.ck("a completed job is not in it", !got.titles.includes("Finished repaint"), JSON.stringify(got.titles));
  t.ck("a job on hold is not in it", !got.titles.includes("Held until spring"), JSON.stringify(got.titles));
  t.ck("its count is one", got.count === "1", got.count);
  t.ck("the unassigned tile counts one", got.unassigned === "1", got.unassigned);
  t.ck("awaiting a reply counts only the live job's offer", got.awaiting === "1", got.awaiting);
  t.ck("the cancelled jobs appear nowhere on the dashboard", !/Queen Anne Roofing|Zapier connection test/.test(got.body), "");
  t.ck("the screen did not crash", m.crashes.length === 0, JSON.stringify(m.crashes));
} finally {
  await browser.close();
  web.close(); api.close();
}
t.done();
