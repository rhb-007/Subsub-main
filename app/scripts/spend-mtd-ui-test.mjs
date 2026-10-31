// COMMITTED SPEND: ALL TIME, AND THIS MONTH UNDER IT.
//
// The dashboard tile summed every accepted work order and said nothing about
// when. It now leads with the all-time figure and says this month under it,
// dated by when the order was accepted (or issued, when auto-scheduled).
//
//   node --no-warnings scripts/spend-mtd-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait, openCards } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-spendmtd-test");
const WEB = 5493, API = 9293;
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
const pad2 = (n) => String(n).padStart(2, "0");
const now = new Date();
const thisMonth = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-01 12:00:00`;
const lastYear = `${now.getFullYear() - 1}-${pad2(now.getMonth() + 1)}-10 12:00:00`;
const withWo = (job, trade, status, extra) => ({ [trade]: { ...a(job, trade, status), ...extra } });
const JOBS = [
  job("j_now", "Repaint unit 4", withWo("j_now", "plumbing", "accepted", { value: "1200", respondedAt: thisMonth })),
  job("j_old", "Roof patch", withWo("j_old", "plumbing", "accepted", { value: "3000", respondedAt: lastYear })),
  job("j_auto", "Tap washer", withWo("j_auto", "plumbing", "pending", { value: "250", auto: true, woIssued: thisMonth.slice(0, 10) })),
  job("j_offer", "Offer only", withWo("j_offer", "plumbing", "pending", { value: "9999" })),
];
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
  const tile = await m.page.evaluate(() => {
    const t = document.querySelector('[data-spend="total"]');
    const card = t?.closest(".dash-card");
    return t ? { total: t.innerText.trim(), mtd: card.querySelector('[data-spend="mtd"]')?.innerText.trim() || null,
      label: card.querySelector(".dc-lab")?.innerText.trim() } : null;
  });
  t.ck("the spend tile is drawn", !!tile, JSON.stringify(tile));
  t.ck("the big figure is every accepted order, all time", /\$4,450/.test(tile?.total || ""), tile?.total);
  t.ck("and it says so", /all time/i.test(tile?.label || ""), tile?.label);
  t.ck("this month counts only orders committed this month", /\$1,450/.test(tile?.mtd || "") && /this month/.test(tile?.mtd || ""), tile?.mtd);
  t.ck("the screen did not crash", m.crashes.length === 0, JSON.stringify(m.crashes));
} finally {
  await browser.close();
  web.close(); api.close();
}
t.done();
