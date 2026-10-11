// HOURS ON AN HOURLY WORK ORDER, ON SCREEN, FROM BOTH SIDES.
//
// test:hours proves the rules on the route. This proves what only a drawn
// panel can: that the contractor is offered a place to log hours and is told
// BEFORE the press when a batch runs past what is approved -- with the exact
// number to ask for -- and that the hiring side approves hours and answers a
// request for more, rather than being handed a dollar plan to cut up.
//
//   node --no-warnings scripts/hours-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait, openCards } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-hours-test");
const WEB = 5473, API = 9173;
const t = tally();
const sent = [];

const S = { role: "admin", pending: true };
const ACC = () => ({
  id: "acc_pm", name: "Sound Property Management", subdomain: "soundpm",
  kind: "property_manager", plan: "scale", billing: "monthly", useDefaultMark: true,
  theme: null, trades: [], logoKey: null, subscriptionStatus: "active",
  user: { id: "u_me", name: "Juan Soto", email: "juan@pacific.test", role: S.role },
});
const SUB = {
  id: "cmp_pac", company: "Pacific apartment maintenance", engagementId: "en_pac",
  accountId: "acc_pm", contact: "Juan Soto", email: "juan@pacific.test", phone: null,
  categories: ["plumbing"], caps: [], crews: [], propertyIds: [], zips: [],
  notify: {}, rating: null, bond: true, insurance: true, contract: true, w9: true,
  hasPortal: true, license: "", licenseCheck: null, available: true, unavailableDays: [],
  docReview: {}, coverage: {},
};
const JOB = () => ({
  id: "job_leak", accountId: "acc_pm", propertyId: null, title: "Leak behind the bathroom wall",
  status: "active", date: "2026-10-09", time: "09:00",
  address: "1620 Belmont Ave", area: "Seattle", zip: "98122",
  trades: ["plumbing"], notes: "", createdAt: "2026-10-01",
  assignments: { plumbing: {
    id: "wo_h", wo: "WO-2001", subId: "cmp_pac", company: "Pacific apartment maintenance",
    contact: "Juan Soto", status: "accepted", auto: false, responseWindow: null, respondBy: null,
    respondedAt: null, value: "450", payKind: "hourly", rate: "45", capHours: 10,
    tradeScope: "Find and fix the leak", crewName: null, signedWO: null, rating: null,
  } },
  photos: [], severity: null, client: null, sqft: null, stories: null, scope: "Find and fix the leak",
  measurementDocs: [], materialSource: null, materialsPaidBy: null,
  requestedBy: null, approvedAt: "2026-10-01", declinedAt: null, withdrawnAt: null,
  completedAt: null, access: null, accessEffective: null, accessUserId: null,
  reportDetail: null, propertyName: null, visit: null,
});
const D = (n) => { const d = new Date(); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
// Four hours approved and paid-for, three and a half waiting, and one batch
// sent back -- every state a row can be in.
const PLAN = () => {
  const submissions = [
    { id: "ms_a", seq: 1, status: "verified", hours: 4, amountCents: 18000, note: null,
      entries: [{ date: D(-3), hours: 4, note: null }] },
    { id: "ms_b", seq: 2, status: "reached", hours: 3.5, amountCents: 15750, note: "Opened the wall",
      entries: [{ date: D(-2), hours: 2 }, { date: D(-1), hours: 1.5 }] },
    { id: "ms_c", seq: 3, status: "rejected", hours: 2, amountCents: 9000, note: null,
      entries: [{ date: D(-1), hours: 2 }] },
  ];
  const pendingRequest = S.pending
    ? { id: "rq_1", hours: 4, reason: "Found rot behind the wall", status: "pending" } : null;
  return {
    workOrderId: "wo_h", valueCents: 45000, scopeKind: "labor_materials", retainageBps: 0,
    payKind: "hourly", rateCents: 4500, capHours: 10,
    milestones: submissions.map((x) => ({ id: x.id, seq: x.seq, label: "Hours", amountCents: x.amountCents,
      status: x.status, note: x.note, verifiedAt: x.status === "verified" ? "2026-10-08 10:00:00" : null,
      reachedAt: "2026-10-08 09:00:00" })),
    events: [{ id: "e1", kind: "milestone.rejected", milestoneId: "ms_c", at: "2026-10-09",
      payload: { reason: "We agreed one hour for the patch" } }],
    releases: [{ id: "rel_a", workOrderId: "wo_h", milestoneId: "ms_a", grossCents: 18000, retainageCents: 0,
      feeBps: 0, feeCents: 0, netCents: 18000, status: "due", createdAt: "2026-10-08 10:00:00" }],
    hours: { legacyPlan: false, rateCents: 4500, capHours: 10, submissions,
      requests: pendingRequest ? [pendingRequest] : [],
      estimateHours: 10, extraHours: 0, ceilingHours: 10, usedHours: 7.5, approvedHours: 4,
      waitingHours: 3.5, remainingHours: 2.5, overBy: 0, ceilingCents: 45000, approvedCents: 18000,
      pendingRequest },
  };
};

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, ACC()];
  if (path === "/api/account") return [200, ACC()];
  if (path === "/api/subs") return [200, [SUB]];
  if (path === "/api/account-users") return [200, [
    { id: "u_me", name: "Juan Soto", email: "juan@pacific.test", phone: null,
      role: S.role, subId: S.role === "contractor" ? "cmp_pac" : null, propertyIds: [], unit: null,
      hasLogin: true, inviteSentAt: null, hasAvatar: false },
  ]];
  if (path === "/api/jobs") return [200, [JOB()]];
  if (path === "/api/work-orders/wo_h/plan") return [200, PLAN()];
  if (path === "/api/work-orders/wo_h/funding") return [200, { configured: false, onScale: true,
    fundedCents: 0, refundedCents: 0, transferredCents: 0, dueCents: 18000, owedCents: 18000,
    availableCents: 0, shortfallCents: 18000, refundableCents: 0, fundings: [], transfers: [] }];
  if (method === "POST" && (/\/hours$/.test(path) || /hour-requests/.test(path))) {
    sent.push({ path, body });
    return [/decide|withdraw/.test(path) ? 200 : 201, { ok: true }];
  }
  if (/^\/api\/work-orders\/[^/]+\/inspection$/.test(path)) return [404, { error: "not_found" }];
  if (/^\/api\/work-orders\/[^/]+\/claim-link$/.test(path)) return [200, { url: null }];
  if (/^\/api\/jobs\/[^/]+\/trade-scope$/.test(path)) return [200, {}];
  if (/^\/api\/jobs\/[^/]+\/access$/.test(path)) return [404, { error: "job_not_found" }];
  if (path === "/api/my-work") return [200, { work: [] }];
  if (path === "/api/properties" || path === "/api/invites"
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

const openWo = async (page) => {
  if (S.role === "contractor") {
    await openCards(page);
    await page.evaluate(() => document.querySelector(".jr-card .wo-open-btn")?.click());
  } else {
    await page.evaluate(() => [...document.querySelectorAll("nav button, .nav button, aside button, button")]
      .find((b) => /^Jobs\b/.test((b.innerText || "").trim()))?.click());
    await wait(700);
    await openCards(page);
    await page.evaluate(() => document.querySelector(".ta-wo-link")?.click());
  }
  await wait(1500);
};
const panel = (page) => page.evaluate(() => {
  const p = document.querySelector(".modal .wop");
  if (!p) return null;
  const btns = [...p.querySelectorAll("button")].map((b) => b.innerText.replace(/\s+/g, " ").trim());
  return {
    total: (p.querySelector(".wop-total")?.innerText || "").replace(/\s+/g, " ").trim(),
    figs: (p.querySelector(".hrs-figs")?.innerText || "").replace(/\s+/g, " ").trim(),
    ask: (p.querySelector(".hrs-ask")?.innerText || "").replace(/\s+/g, " ").trim(),
    rows: [...p.querySelectorAll(".wop-row")].map((r) => r.innerText.replace(/\s+/g, " ").trim()),
    btns,
  };
});
// React only hears a value set through the element's own setter.
const type = (page, sel, i, v) => page.evaluate(({ sel, i, v }) => {
  const el = document.querySelectorAll(sel)[i];
  if (!el) return false;
  Object.getOwnPropertyDescriptor(el.constructor.prototype, "value").set.call(el, v);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}, { sel, i, v });
const press = (page, re) => page.evaluate((src) => {
  const rx = new RegExp(src);
  const b = [...document.querySelectorAll(".modal .wop button")].find((x) => rx.test(x.innerText.replace(/\s+/g, " ").trim()));
  if (!b) return null;
  b.click(); return { disabled: b.disabled };
}, re.source);

try {
  console.log("\n-- the hiring side --");
  {
    S.role = "admin"; S.pending = true;
    const { ctx, page, crashes } = await visitApp(browser, { host: "soundpm", webPort: WEB,
      seat: { userId: "u_me", accountId: "acc_pm" }, viewport: { width: 1340, height: 1500 } });
    await wait(2600);
    await openWo(page);
    const p = await panel(page);
    t.ck("the progress panel opened", !!p, JSON.stringify(p));
    t.ck("its head says the rate and what is approved", /\$45\.00\/hr · 4 h approved/.test(p?.total || ""), p?.total);
    t.ck("the four figures are drawn", /Estimated 10 h/i.test(p?.figs || "") && /Logged 7\.5 h/i.test(p?.figs || "")
      && /Approved 4 h/i.test(p?.figs || "") && /Left 2\.5 h/i.test(p?.figs || ""), p?.figs);
    t.ck("the waiting hours are said", /3\.5 h waiting on approval/.test(p?.figs || ""), p?.figs);
    t.ck("each batch says its days and hours", p?.rows.some((r) => /3\.5 h at \$45\.00\/hr/.test(r)), JSON.stringify(p?.rows));
    // THE DOLLAR PLAN IS GONE: two answers to what is owed is one too many.
    t.ck("no dollar draws to cut up", !p?.btns.some((b) => /Split into draws|Change the plan/.test(b)), JSON.stringify(p?.btns));
    t.ck("approving says how many hours", p?.btns.includes("Approve 3.5 h"), JSON.stringify(p?.btns));
    t.ck("a sent-back batch says why", p?.rows.some((r) => /Sent back: We agreed one hour for the patch/.test(r)));
    t.ck("the hiring side is not offered a timesheet", !p?.btns.some((b) => /Log hours/.test(b)));
    t.ck("the request for more is drawn with its reason and price",
      /The contractor asked for 4 h more/.test(p?.ask || "") && /\$180\.00/.test(p?.ask || "")
      && /Found rot behind the wall/.test(p?.ask || ""), p?.ask);

    sent.length = 0;
    await press(page, /^Decline$/);
    await wait(300);
    const dead = await press(page, /^Decline$/);
    t.ck("declining with no reason cannot be pressed", dead?.disabled === true, JSON.stringify(dead));
    await type(page, ".modal .hrs-ask input", 0, "Patch only, no rebuild");
    await wait(200);
    await press(page, /^Decline$/);
    await wait(600);
    const dec = sent.find((x) => /decide/.test(x.path));
    t.ck("and with one it sends the reason", dec?.body?.approve === false && dec.body.note === "Patch only, no rebuild",
      JSON.stringify(sent));
    sent.length = 0;
    await press(page, /^Approve 4 h more$/);
    await wait(600);
    const ap = sent.find((x) => /decide/.test(x.path));
    t.ck("approving the extra hours asks the route", ap?.path === "/api/hour-requests/rq_1/decide" && ap.body.approve === true,
      JSON.stringify(sent));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- the contractor logs hours --");
  {
    S.role = "contractor"; S.pending = true;
    const { ctx, page, crashes } = await visitApp(browser, { host: "soundpm", webPort: WEB,
      seat: { userId: "u_me", accountId: "acc_pm" }, viewport: { width: 1340, height: 1500 } });
    await wait(2600);
    await openWo(page);
    let p = await panel(page);
    t.ck("their progress panel opened", !!p, JSON.stringify(p));
    t.ck("they are offered Log hours", p?.btns.some((b) => /Log hours/.test(b)), JSON.stringify(p?.btns));
    t.ck("a batch is never marked done by hand", !p?.btns.some((b) => /Mark it done/.test(b)), JSON.stringify(p?.btns));
    t.ck("one waiting can be edited", p?.btns.includes("Edit hours"));
    t.ck("and one sent back can be fixed and resent", p?.btns.includes("Fix and resend"));
    t.ck("their own request says it is theirs", /You asked for 4 h more/.test(p?.ask || "") && /Take it back/.test(p?.ask || ""), p?.ask);
    t.ck("and with one open, they cannot ask again", !p?.btns.some((b) => /^Ask for more hours$/.test(b)));

    await press(page, /Log hours/);
    await wait(400);
    // THREE HOURS INTO TWO AND A HALF LEFT: said before the press, with the
    // number to ask for.
    await type(page, ".modal .hrs-day input[inputmode=decimal]", 0, "3");
    await wait(300);
    let f = await page.evaluate(() => ({
      hold: document.querySelector(".modal .hrs-hold")?.innerText || "",
      total: document.querySelector(".modal .hrs-total")?.innerText.replace(/\s+/g, " ") || "",
      send: [...document.querySelectorAll(".modal .hrs-form button")].find((b) => /Send for approval/.test(b.innerText))?.disabled,
      ask: [...document.querySelectorAll(".modal .hrs-form button")].map((b) => b.innerText).find((x) => /^Ask for/.test(x)) || null,
    }));
    t.ck("the total is worked out", /3 h × \$45\.00 = \$135\.00/.test(f.total), f.total);
    t.ck("going over is said before the press", /0\.5 h over what's approved \(2\.5 h left\)/.test(f.hold), f.hold);
    t.ck("and Send cannot be pressed", f.send === true, String(f.send));
    // With a request already open, the screen does not offer a second one.
    t.ck("no second ask while one is open", f.ask === null, String(f.ask));
    await type(page, ".modal .hrs-day input[inputmode=decimal]", 0, "2.3");
    await wait(200);
    f = await page.evaluate(() => document.querySelector(".modal .hrs-hold")?.innerText || "");
    t.ck("a number that is not a quarter hour is said", /quarter hours/.test(f), f);
    await type(page, ".modal .hrs-day input[inputmode=decimal]", 0, "2.5");
    await type(page, ".modal .hrs-day input:not([type=date]):not([inputmode=decimal])", 0, "Patched the joint");
    await wait(300);
    sent.length = 0;
    await press(page, /^Send for approval$/);
    await wait(700);
    const sub = sent.find((x) => /\/hours$/.test(x.path));
    t.ck("two and a half hours go", sub?.body?.entries?.length === 1 && sub.body.entries[0].hours === 2.5
      && sub.body.entries[0].date === D(0) && sub.body.entries[0].note === "Patched the joint", JSON.stringify(sent));
    t.ck("as a new batch, not a correction", !("milestoneId" in (sub?.body || {})), JSON.stringify(sub?.body));

    // Fixing the sent-back one replaces it.
    await press(page, /^Fix and resend$/);
    await wait(400);
    f = await page.evaluate(() => ({
      head: document.querySelector(".modal .hrs-form .form-sec")?.innerText || "",
      hours: [...document.querySelectorAll(".modal .hrs-day input[inputmode=decimal]")].map((i) => i.value),
    }));
    t.ck("it opens on the batch's own days", /Correct these hours/i.test(f.head) && JSON.stringify(f.hours) === '["2"]',
      JSON.stringify(f));
    await type(page, ".modal .hrs-day input[inputmode=decimal]", 0, "1");
    await wait(200);
    sent.length = 0;
    await press(page, /^Send the corrected hours$/);
    await wait(700);
    const fix = sent.find((x) => /\/hours$/.test(x.path));
    t.ck("and sends it as a correction of that batch", fix?.body?.milestoneId === "ms_c" && fix.body.entries[0].hours === 1,
      JSON.stringify(sent));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- the contractor asks for more --");
  {
    S.role = "contractor"; S.pending = false;
    const { ctx, page, crashes } = await visitApp(browser, { host: "soundpm", webPort: WEB,
      seat: { userId: "u_me", accountId: "acc_pm" }, viewport: { width: 1340, height: 1500 } });
    await wait(2600);
    await openWo(page);
    await press(page, /Log hours/);
    await wait(300);
    await type(page, ".modal .hrs-day input[inputmode=decimal]", 0, "4");
    await wait(300);
    const asked = await press(page, /^Ask for 1\.5 h more$/);
    t.ck("over the estimate, the exact ask is one press away", !!asked, JSON.stringify(asked));
    await wait(400);
    const pre = await page.evaluate(() => document.querySelectorAll(".modal .hrs-form")[1]
      ?.querySelector("input[inputmode=decimal]")?.value || "");
    t.ck("and it arrives filled in", pre === "1.5", pre);
    const empty = await page.evaluate(() => [...document.querySelectorAll(".modal .hrs-form")][1]
      ?.querySelector(".btn-solid")?.disabled);
    t.ck("it cannot go without a reason", empty === true, String(empty));
    await page.evaluate(() => {
      const f = document.querySelectorAll(".modal .hrs-form")[1];
      const el = [...f.querySelectorAll("input")].find((i) => !i.getAttribute("inputmode"));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "Second joint was rotten too");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await wait(200);
    sent.length = 0;
    await press(page, /^Send the request$/);
    await wait(700);
    const rq = sent.find((x) => /hour-requests$/.test(x.path));
    t.ck("the request carries the hours and the reason",
      rq?.body?.hours === 1.5 && rq.body.reason === "Second joint was rotten too", JSON.stringify(sent));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }
} finally {
  await browser.close();
  web.close(); api.close();
}
t.done();
