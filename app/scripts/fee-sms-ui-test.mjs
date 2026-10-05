// SubSub's payment fee and the text-message allowance, on screen.
//
// The server suites (test:escrow, test:smsquota) prove the rules. This one
// proves the two things a static check cannot: that the fee is SAID on the
// paying side before the press, and that buying more texts asks first and
// sends a count rather than an increment.
//
//   node --no-warnings scripts/fee-sms-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-feesms-test");
const WEB = 5353, API = 9049;
const t = tally();
const sent = [];

const acct = () => ({
  id: "acc_gc", name: "Alder Construction", subdomain: "alder", kind: "general_contractor",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: ["roofing"],
  logoKey: null, subscriptionStatus: "active", hostnameStatus: "active",
  user: { id: "usr_a", name: "Chris Lane", email: "chris@alder.test", role: "admin" },
});
const verified = { status: "verified", checks: {}, limits: {} };
const SUBS = () => [{
  id: "cmp_sub", engagementId: "en_1", accountId: "acc_gc", company: "Pacific Roofing", contact: "Juan Soto",
  phone: "(206)555-0100", email: "juan@pacific.test", city: "Seattle", state: "WA", zip: "98122",
  license: "PACIFRC123", licenseCheck: null,
  crews: [{ id: "c1", name: "Crew 1", available: true, unavailableDays: [], members: [{ name: "Joe", role: "Lead" }] }],
  coverage: { mode: "cities", cities: ["Seattle"] }, available: true, unavailableDays: [], warranty: null,
  insurance: 1, bond: 1, contract: 1, w9: 1, docFiles: {}, notify: { email: true, sms: false },
  docReview: { insurance: verified, bond: verified, contract: verified, w9: verified },
  categories: ["roofing"], caps: [], rating: 4.5, ratedJobs: 4, accepted: 4, declined: 0, notes: "",
  status: "active", propertyIds: [], hasPortal: true, answersForItself: true, autoSchedule: false,
  engagedAs: "subcontractor", docs: {}, docState: "current", docAssignable: true, docSoonest: null,
}];
const JOBS = () => [{
  id: "job_1", accountId: "acc_gc", title: "Re-roof Press Apartments", address: "1620 Belmont",
  area: "Seattle", zip: "98122", propertyId: null, date: "2026-09-01", time: "09:00",
  trades: ["roofing"], status: "active", severity: null, notes: "", sqft: null, stories: null,
  materialsBy: null, createdAt: "2026-09-01", requestedBy: null, approvedAt: "2026-09-01",
  withdrawnAt: null, completedAt: null, measurementDocs: [], readOnly: false, scope: "",
  assignments: { roofing: { id: "wo_1", subId: "cmp_sub", company: "Pacific Roofing", wo: "WO-1001",
    value: 1000000, status: "accepted", crewName: "Crew 1", payKind: "fixed" } },
}];
// A release carrying a stamped fee of $20 on $3,800 net.
const PLAN = { workOrderId: "wo_1", valueCents: 1000000, scopeKind: "labor_materials", retainageBps: 500, events: [],
  milestones: [{ id: "ms_1", seq: 1, label: "Tear-off", amountCents: 400000, status: "verified",
    verifiedAt: "2026-10-02 10:00:00" }, { id: "ms_2", seq: 2, label: "Shingles", amountCents: 600000, status: "pending" }],
  releases: [{ id: "rel_1", workOrderId: "wo_1", milestoneId: "ms_1", grossCents: 400000, retainageCents: 20000,
    feeBps: 5, feeCents: 2000, netCents: 380000, status: "due", createdAt: "2026-10-02 10:00:00" }] };
const FUNDING = { configured: true, onScale: true, payeeReady: true, payeeStatus: "verified",
  fundedCents: 380000, refundedCents: 0, transferredCents: 0, dueCents: 380000, feesTakenCents: 0,
  feesDueCents: 2000, owedCents: 382000, availableCents: 380000, shortfallCents: 2000, refundableCents: 0,
  fundings: [], transfers: [] };
// Over the included 2,500 this month, and billed for last month.
const SMS = { used: 3140, allowance: 2500, included: 2500, billable: true, overageBlocks: 1, overageCents: 5000,
  blockMessages: 5000, blockPriceCents: 5000, maxBlocks: 20, configured: true,
  lastMonth: { month: "2026-09", used: 8000, blocks: 2, amountCents: 10000, status: "billed" } };

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, acct()];
  if (path === "/api/account") return [200, acct()];
  if (path === "/api/account-users") return [200, [{ id: "usr_a", name: "Chris Lane", email: "chris@alder.test",
    phone: null, role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }]];
  if (path === "/api/subs") return [200, SUBS()];
  if (path === "/api/jobs" && method === "GET") return [200, JOBS()];
  if (path === "/api/work-orders/wo_1/plan") return [200, PLAN];
  if (path === "/api/work-orders/wo_1/funding") return [200, FUNDING];
  if (path === "/api/releases/rel_1/cover-state") return [200, { clear: true, problems: [], advisories: [] }];
  if (path === "/api/releases/rel_1/waiver-state") return [200, { clear: true, reasons: [], onScale: true }];
  if (path === "/api/releases/rel_1/waivers") return [200, { forms: { state: "WA", statutory: false, sources: [] },
    waivers: [], chain: { clear: true, reasons: [] } }];
  if (path === "/api/billing" && method === "GET") return [200, { plan: "scale", cycle: "monthly", status: "active",
    currentPeriodEnd: null, hasCustomer: true, configured: true, invoices: [], sms: SMS }];
  if (path === "/api/work-orders/wo_1/fund" && method === "POST") {
    sent.push({ path, body });
    return [200, { fundingId: "f_1", clientSecret: "pi_1_secret_x", amountCents: body.amountCents }];
  }
  if (path === "/api/billing/card") return [200, { card: null }];
  if (path === "/api/billing/invoices") return [200, { invoices: [] }];
  if (path === "/api/payouts/status") return [200, { status: "none", ready: false, requirements: [], configured: false }];
  if (/\/inspection$/.test(path)) return [404, { error: "not_found" }];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

try {
  console.log("\n-- the fee, said on the paying side before the press --");
  {
    const { ctx, page, crashes } = await visitApp(browser, { host: "alder", webPort: WEB,
      seat: { userId: "usr_a", accountId: "acc_gc" }, viewport: { width: 1340, height: 1500 } });
    await wait(2600);
    await page.evaluate(() => [...document.querySelectorAll("nav button")]
      .find((b) => /^Jobs/i.test((b.innerText || "").trim()))?.click());
    await wait(900);
    const opened = await page.evaluate(() => { const b = document.querySelector(".ta-wo-link"); b?.click(); return !!b; });
    await wait(1400);
    const panel = await page.evaluate(() => document.querySelector(".wof-figs")?.innerText || "");
    // CENTS ARE NOT DOLLARS. Every figure on this panel is stored in cents and
    // the formatter takes dollars, which printed a $10,000 work order as
    // "$1,000,000.00" -- so the drawn figures are read, not the source.
    const total = await page.evaluate(() => document.querySelector(".wop-total")?.innerText || "");
    t.ck("the work order's total reads in dollars", /^\$10,000\.00 /.test(total), total);
    t.ck("the work order opened", opened, String(opened));
    t.ck("the money panel counts the fee in what is owed",
      /\$3,820\.00 owed/.test(panel) && /incl\. \$20\.00 SubSub fee/.test(panel), panel);
    const pay = await page.evaluate(() => {
      const b = [...document.querySelectorAll(".modal .wop-row-acts button")].find((x) => /^Pay /.test(x.innerText));
      b?.click(); return b?.innerText || "";
    });
    t.ck("the release offers to pay the subcontractor's full amount", /Pay \$3,800\.00/.test(pay), pay);
    await wait(1200);
    let r = await page.evaluate(() => ({
      fee: document.querySelector(".pay-fee")?.innerText || "",
      refusal: document.querySelector(".cx-found-note")?.innerText || "",
    }));
    t.ck("the pay window names the fee before anybody presses anything",
      /Plus SubSub's fee of \$20\.00 \(0\.05% of each payment, at most \$500 a payment\)/.test(r.fee), r.fee);
    t.ck("and says the subcontractor receives the full amount", /They receive the full \$3,800\.00/.test(r.fee), r.fee);
    // Funded for the net and not the fee: the screen's own check agrees with
    // the route's, and says how much to add.
    t.ck("funding that covers only the net is not enough, and it says by how much",
      /SubSub's \$20\.00 fee/.test(r.refusal) && /Add \$20\.00/.test(r.refusal), r.refusal);

    // Add funds: the box is DOLLARS and what is sent is CENTS. Read off the
    // wire, because a box that shows the right figure and sends a hundredth
    // of it charges the wrong amount with nothing on screen looking wrong.
    await page.evaluate(() => [...document.querySelectorAll(".wof-acts button")]
      .find((b) => /Add funds/.test(b.innerText))?.click());
    await wait(600);
    const box = await page.evaluate(() => document.querySelector(".modal .form .fld input")?.value || "");
    // What is to come ($6,000 gross + $3 fee) and what is already owed
    // ($3,800 + $20 fee), less the $3,800 already in.
    t.ck("the suggested figure covers the work to come, what is owed, and the fee",
      box === "$6,023.00", box);
    const fee = await page.evaluate(() => document.querySelector(".fund-fee")?.innerText || "");
    t.ck("and the form says the fee is included", /0\.05% of each payment, at most \$500 a payment/.test(fee), fee);
    sent.length = 0;
    await page.evaluate(() => [...document.querySelectorAll(".form-actions .btn-solid")]
      .find((b) => /Continue/.test(b.innerText))?.click());
    await wait(800);
    const fund = sent.find((x) => /\/fund$/.test(x.path));
    t.ck("and it sends that figure in CENTS -- $6,023 is 602300, not 6023",
      fund?.body?.amountCents === 602300, JSON.stringify(fund?.body));
    await page.evaluate(() => [...document.querySelectorAll(".form-actions .btn-ghost")]
      .find((x) => /^Cancel$/.test((x.innerText || "").trim()))?.click());
    await wait(400);

    // The record path, from the same row.
    const closed = await page.evaluate(() => { const b = [...document.querySelectorAll(".form-actions .btn-ghost")]
      .find((x) => /^Cancel$/.test((x.innerText || "").trim())); b?.click(); return !!b; });
    t.ck("the pay window can be closed", closed);
    await wait(500);
    await page.evaluate(() => [...document.querySelectorAll(".modal .wop-row-acts button")]
      .find((x) => /Record payment/.test(x.innerText))?.click());
    await wait(1000);
    r = await page.evaluate(() => ({ fee: [...document.querySelectorAll(".pay-fee")].map((e) => e.innerText).join(" | ") }));
    t.ck("recording a payment made elsewhere says it carries no fee", /No SubSub fee/.test(r.fee), r.fee);
    t.ck("and does not quote one", !/Plus SubSub's fee/.test(r.fee), r.fee);
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- text messages: over the 2,500, said before the bill --");
  {
    const { ctx, page, crashes } = await visitApp(browser, { host: "alder", webPort: WEB,
      seat: { userId: "usr_a", accountId: "acc_gc" }, viewport: { width: 1340, height: 1500 } });
    await wait(2600);
    await page.click(".user-btn");
    await wait(300);
    await page.click(".um-account");
    await wait(800);
    const tab = await page.evaluate(() => { const b = [...document.querySelectorAll(".seg-tabs button")]
      .find((x) => /^Subscription$/.test(x.innerText.trim())); b?.click(); return !!b; });
    await wait(1200);
    const r = await page.evaluate(() => ({
      line: document.querySelector(".sms-use-line")?.innerText || "",
      over: document.querySelector(".sms-over")?.innerText || "",
      fine: document.querySelector(".sms-use .fine")?.innerText || "",
      last: document.querySelector(".sms-last")?.innerText || "",
      bar: document.querySelector(".sms-bar")?.className || "",
      buttons: [...document.querySelectorAll(".sms-use button")].map((b) => b.innerText),
    }));
    t.ck("the Subscription tab opened", tab);
    t.ck("it says how many texts went and how far over", r.line === "3,140 text messages this month — 640 over the 2,500 included.", r.line);
    t.ck("and what the next bill will carry for it, before the bill arrives",
      r.over === "$50 for an extra block of 5,000 will be added to next month's bill.", r.over);
    t.ck("and how going over works", /texts keep going/.test(r.fine)
      && /each extra 5,000 texts, or part of 5,000, adds \$50 to the following month's bill/.test(r.fine), r.fine);
    t.ck("and that emergencies always go", /Emergency call-outs are always texted/.test(r.fine), r.fine);
    t.ck("last month's charge is shown", /September: 8,000 sent, \$100\.00 for the extra — on your bill/.test(r.last), r.last);
    t.ck("the bar is amber, not red -- going over is billed, not broken", /\bover\b/.test(r.bar), r.bar);
    t.ck("and there is nothing to buy -- it happens by itself", r.buttons.length === 0, r.buttons.join(","));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }
} catch (err) {
  t.ck("the suite ran to the end", false, err?.stack || String(err));
} finally {
  await browser.close();
  web.close(); api.close();
}
t.done();
