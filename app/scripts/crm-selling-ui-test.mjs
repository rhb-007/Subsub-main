// 110. THE CRM'S SELLING HALF, DRAWN: Reports, Setup, a deal on an estimate,
// why it was lost, Do not contact, templates and sequences on a lead, and the
// homeowner's unsubscribe page.
//
// What is pinned in a browser, against a stubbed API:
//
//   REPORTS AND SETUP ARE IN THE OFFICE'S CRM MENU, and the call center gets
//   neither. Reports values the open pipeline from each estimate's amount.
//
//   NOT SOLD ASKS WHY FIRST, and the reason goes in the same save as the
//   status. The amount saves on its own.
//
//   DO NOT CONTACT IS ONE PRESS, and once on, every channel that it closes is
//   greyed out saying so.
//
//   A TEMPLATE FILLS THE EMAIL, the sequence panel starts one, Setup saves a
//   template, and the website form's code posts to this account.
//
//   THE UNSUBSCRIBE PAGE says whose emails they are and stops them in one press.
//
//   node --no-warnings scripts/crm-selling-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-crmsellingui-test");
const WEB = 5833, API = 8913;
const t = tally();

const pad = (n) => String(n).padStart(2, "0");
const key = (off) => { const d = new Date(); d.setDate(d.getDate() + off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

const GC = {
  id: "acc_gc", name: "Outerhome", subdomain: "outerhome", kind: "general_contractor", plan: "scale",
  billing: "monthly", useDefaultMark: true, theme: null, trades: [], logoKey: null,
  subscriptionStatus: "active", hostnameStatus: "active",
  user: { id: "u_admin", name: "Richard Braun", email: "rb@outerhome.test", role: "admin" },
};
let SEAT = { userId: "u_admin", accountId: "acc_gc", role: "admin" };
const REPS = [{ id: "u_admin", name: "Richard Braun", role: "admin" }, { id: "u_sm", name: "Sam Seller", role: "sales" }];
const TOKEN = "abcdefghijklmnopqrstuvwx";

const appt = (id, extra = {}) => ({ id, status: "scheduled", direction: "inbound", source: "Google", services: ["roofing"],
  details: { roofing: { material: "Asphalt shingle", age: "Over 20 years", leaks: "Yes", stories: "2" } },
  home: { owns: "Yes", timeline: "Within 3 months" },
  homeowner: { firstName: "Dana", lastName: "Ruiz", phone: "2535550142", email: "dana@home.test" },
  address: { street: "1204 N Pine St", city: "Tacoma", state: "WA", zip: "98406" }, second: null,
  date: key(3), time: "10:00", minutes: 90, repId: "u_sm", repName: "Sam Seller", notes: null, outcomeNote: null, jobId: null,
  createdAt: `${key(-5)} 09:00:00`, updatedAt: `${key(-5)} 09:00:00`, statusAt: `${key(-5)} 09:00:00`,
  consent: { email: true, phone: true, text: true, record: null }, deal: null, ...extra });
let APPTS = [
  appt("ap_open", { deal: { amountCents: 1500000, expectedClose: key(10) } }),
  appt("ap_lost", { status: "lost", date: key(-2), homeowner: { firstName: "Eli", lastName: "Fox", phone: "2535550199", email: "" },
    deal: { lostReason: "price" } }),
];
const lead = (id, extra = {}) => ({ id, stage: "opportunity", firstName: "Dana", lastName: "Ruiz", phone: "2535550142", email: "dana@home.test",
  address: { street: "1204 N Pine St", city: "Tacoma", state: "WA", zip: "98406" }, services: ["roofing"], source: "website",
  notes: null, ownerId: "u_sm", ownerName: "Sam Seller", createdBy: "u_admin", createdByName: "Richard Braun",
  createdAt: `${key(-6)} 09:00:00`, updatedAt: `${key(0)} 09:00:00`, stageAt: `${key(0)} 09:00:00`,
  appointments: [{ id: "ap_open", status: "scheduled", date: key(3), time: "10:00" }],
  consent: { email: true, phone: true, text: true, record: null, capturedAt: "2026-11-01T00:00:00Z" },
  optOut: null, enrollment: null, ...extra });
let LEADS = [lead("ld_dana")];
let OPT = null;
const LIB = { templates: [
  { id: "std:thanks", name: "Thanks for meeting", subject: "Thanks for having us out, {{firstName}}", body: "Hi {{firstName}},\n\nThanks.", builtin: true },
], sequences: [{ id: "sq_1", name: "After the estimate", steps: [{ day: 0, templateId: "std:thanks" }], stopOnBooking: true, active: true, running: 0 }] };
const patches = [], dnc = [], enrolls = [], tplPosts = [], unsubPosts = [];

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, GC];
  if (path === "/api/account") return [200, { ...GC, user: { ...GC.user, id: SEAT.userId, role: SEAT.role } }];
  if (path === "/api/appointments" && method === "GET") return [200, { appointments: APPTS, reps: REPS, team: REPS, crmReady: true, dealsReady: true }];
  const pa = path.match(/^\/api\/appointments\/([^/]+)$/);
  if (pa && method === "PATCH") {
    patches.push(body);
    const cur = APPTS.find((a) => a.id === pa[1]);
    const next = { ...cur, ...(body.status ? { status: body.status } : {}),
      deal: { ...(cur.deal || {}), ...(body.deal?.amount ? { amountCents: Math.round(Number(String(body.deal.amount).replace(/[$,]/g, "")) * 100) } : {}),
        ...(body.deal && "lostReason" in body.deal ? { lostReason: body.deal.lostReason } : {}) } };
    APPTS = APPTS.map((a) => (a.id === cur.id ? next : a));
    return [200, { appointment: next }];
  }
  if (/^\/api\/appointments\/[^/]+\/activities$/.test(path)) return [200, { activities: [], consent: null, crmReady: true }];
  if (path === "/api/sales-followups") return [200, { followUps: [] }];
  if (path === "/api/sales-leads" && method === "GET") return [200, { leads: LEADS, owners: REPS, sellingReady: true }];
  if (path === "/api/crm-inbox") return [200, { messages: [] }];
  if (path === "/api/crm-library") return [200, LIB];
  if (path === "/api/crm-templates" && method === "POST") {
    tplPosts.push(body);
    LIB.templates.push({ id: "tp_new", ...body, builtin: false });
    return [201, { template: { id: "tp_new", ...body, builtin: false } }];
  }
  const mm = path.match(/^\/api\/sales-leads\/([^/]+)\/messages$/);
  if (mm && method === "GET") {
    const dncOn = !!OPT?.dncAt;
    return [200, { messages: [], consent: LEADS[0].consent, optOut: OPT, enrollment: null, callBlock: dncOn ? "do_not_contact" : null,
      blocks: { email: dncOn ? "do_not_contact" : null, text: dncOn ? "do_not_contact" : null, mail: dncOn ? "do_not_contact" : null },
      canReply: true, accountName: "Outerhome" }];
  }
  if (/\/do-not-contact$/.test(path)) { dnc.push(body); OPT = body.on ? { dncAt: "2026-11-25T00:00:00Z", dncReason: body.reason, dncByName: "Richard Braun" } : null; return [200, { optOut: OPT }]; }
  if (/\/sequence$/.test(path) && method === "POST") {
    enrolls.push(body);
    return [201, { enrollment: { id: "en1", sequenceId: body.sequenceId, sequenceName: "After the estimate", status: "active", steps: 1, sent: 0, nextAt: new Date().toISOString() } }];
  }
  if (path === `/api/public/unsubscribe/${TOKEN}` && method === "GET") return [200, { accountName: "Outerhome", unsubscribed: unsubPosts.length > 0 }];
  if (path === `/api/public/unsubscribe/${TOKEN}` && method === "POST") { unsubPosts.push(1); return [200, { ok: true, unsubscribed: true }]; }
  if (path === "/api/account-users") return [200, [{ id: SEAT.userId, name: "Richard Braun", email: "rb@outerhome.test", phone: null,
    role: SEAT.role, subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }]];
  if (path === "/api/google-calendar") return [200, { configured: false }];
  if (path.startsWith("/api/")) return [200, []];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const click = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); if (el) el.click(); return !!el; }, sel);
const setVal = (page, sel, v) => page.evaluate((s, val) => {
  const el = document.querySelector(s);
  if (!el) return false;
  const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, val);
  el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  return true;
}, sel, v);
const crmNav = (page) => page.evaluate(() => [...document.querySelectorAll("[data-crm-nav]")].map((b) => b.dataset.crmNav));
const closeModal = async (page) => { await page.evaluate(() => document.querySelector(".modal-backdrop")?.click()); await wait(300); };

try {
  console.log("\n-- the office --");
  const { ctx, page, crashes } = await visitApp(browser, { host: "outerhome", webPort: WEB, seat: SEAT });
  for (let n = 0; n < 40; n++) { await wait(200); if (await page.$("[data-ws='crm']")) break; }
  await click(page, "[data-ws='crm']");
  for (let n = 0; n < 20; n++) { await wait(200); if (await page.$(".appt-view")) break; }
  const nav = await crmNav(page);
  t.ck("the office's CRM has Reports and Setup", nav.includes("reports") && nav.includes("setup"), nav.join(","));
  const kpi = await page.evaluate(() => document.querySelector('[data-kpi="pipeline"]')?.innerText || "");
  t.ck("the dashboard names the open pipeline", kpi === "$15,000", kpi);

  await click(page, '[data-crm-nav="reports"]');
  await wait(400);
  const rep = await page.evaluate(() => ({
    value: document.querySelector("[data-pipeline-value]")?.innerText || "",
    lost: [...document.querySelectorAll("[data-lost-row]")].map((r) => r.dataset.lostRow),
    rep: document.querySelector('[data-rep-row="u_sm"]')?.innerText || "",
    src: !!document.querySelector('[data-source-row="website"]') }));
  t.ck("Reports values the pipeline from each estimate", rep.value === "$15,000", rep.value);
  t.ck("and counts why estimates were lost", rep.lost.includes("price"), rep.lost.join(","));
  t.ck("by sales manager and by source", /Sam Seller/.test(rep.rep) && rep.src, JSON.stringify(rep));

  console.log("\n-- a deal --");
  await click(page, '[data-crm-nav="appointments"]');
  await wait(300);
  await page.evaluate(() => { const s = document.querySelector('select'); return s; });
  await click(page, '[data-appt="ap_open"]');
  await wait(400);
  const amt = await page.evaluate(() => document.querySelector("[data-deal-amount]")?.value);
  t.ck("an estimate shows its amount", amt === "15000", String(amt));
  await setVal(page, "[data-deal-amount]", "18,450");
  await wait(100);
  await click(page, "[data-deal-save]");
  await wait(300);
  t.ck("the amount saves on its own", patches.some((p) => p.deal?.amount === "18,450" && !p.status), JSON.stringify(patches));
  const before = patches.length;
  await click(page, '[data-set="lost"]');
  await wait(200);
  t.ck("Not sold asks why before anything is saved", !!(await page.$("[data-lost-pick]")) && patches.length === before);
  await click(page, '[data-lost="competitor"]');
  await setVal(page, "[data-lost-note]", "Went with ABC");
  await wait(100);
  await click(page, "[data-lost-save]");
  await wait(400);
  const last = patches[patches.length - 1] || {};
  t.ck("and the reason goes in the same save as the status", last.status === "lost" && last.deal?.lostReason === "competitor"
    && last.deal?.lostNote === "Went with ABC", JSON.stringify(last));
  const lostLine = await page.evaluate(() => document.querySelector("[data-lost-reason]")?.innerText || "");
  t.ck("and the estimate says why it was lost", /Went with another company/.test(lostLine), lostLine);
  await closeModal(page);

  console.log("\n-- a lead --");
  await click(page, '[data-crm-nav="leads"]');
  await wait(300);
  await click(page, '[data-lead="ld_dana"]');
  await wait(300);
  await click(page, '[data-lead-tab="contact"]');
  await wait(500);
  await click(page, '[data-contact="email"]');
  await wait(200);
  await setVal(page, "[data-email-template]", "std:thanks");
  await wait(200);
  const subj = await page.evaluate(() => document.querySelector("[data-email-subject]")?.value);
  t.ck("a template fills the email for them", subj === "Thanks for having us out, Dana", String(subj));
  t.ck("and the box says an unsubscribe link is added", await page.evaluate(() => /unsubscribe link is added/.test(document.querySelector('[data-compose="email"]')?.innerText || "")));
  await setVal(page, "[data-sequence-pick]", "sq_1");
  await wait(100);
  await click(page, "[data-sequence-start]");
  await wait(300);
  t.ck("the sequence panel starts one", enrolls[0]?.sequenceId === "sq_1" && !!(await page.$("[data-sequence-running]")), JSON.stringify(enrolls));
  await click(page, "[data-dnc-on]");
  await wait(150);
  await setVal(page, "[data-dnc-reason]", "Asked us to stop calling");
  await wait(100);
  await click(page, "[data-dnc-save]");
  await wait(600);
  const dncState = await page.evaluate(() => ({
    on: document.querySelector("[data-dnc]")?.dataset.dnc,
    btns: Object.fromEntries([...document.querySelectorAll("[data-contact]")].map((b) => [b.dataset.contact, b.disabled])),
    why: [...document.querySelectorAll("[data-contact-block]")].map((x) => x.innerText).join(" | ") }));
  t.ck("Do not contact is one press", dnc[0]?.on === true && dnc[0]?.reason === "Asked us to stop calling" && dncState.on === "on", JSON.stringify(dnc));
  t.ck("and it greys out email, texts and letters, saying so", dncState.btns.email && dncState.btns.text && dncState.btns.mail
    && /Do not contact/.test(dncState.why), JSON.stringify(dncState));
  t.ck("the office is offered the way to take it off", !!(await page.$("[data-dnc-off]")));
  await closeModal(page);

  console.log("\n-- setup --");
  await click(page, '[data-crm-nav="setup"]');
  await wait(400);
  t.ck("Setup lists the starters", await page.evaluate(() => !!document.querySelector('[data-tpl="std:thanks"]')));
  await click(page, "[data-tpl-new]");
  await wait(150);
  await setVal(page, "[data-tpl-name]", "Metal roof");
  await setVal(page, "[data-tpl-subject]", "Metal roofing, {{firstName}}");
  await wait(150);
  const prev = await page.evaluate(() => document.querySelector("[data-tpl-preview]")?.innerText || "");
  t.ck("a template previews filled in", /Metal roofing, Dana/.test(prev), prev);
  await click(page, "[data-tpl-save]");
  await wait(400);
  t.ck("and saves", tplPosts[0]?.name === "Metal roof", JSON.stringify(tplPosts));
  await click(page, '[data-setup-tab="form"]');
  await wait(300);
  await page.evaluate(() => [...document.querySelectorAll("[data-lead-form-embed] .seg-tabs button")].find((b) => /code/i.test(b.innerText))?.click());
  await wait(200);
  const code = await page.evaluate(() => document.querySelector("[data-lead-form-code]")?.innerText || "");
  t.ck("the website form posts to this account", /\/api\/public\/lead\/outerhome/.test(code) && /Text me about my project/.test(code), code.slice(0, 120));
  t.ck("and nothing crashed", crashes.length === 0, crashes.join(" | "));
  await ctx.close();

  console.log("\n-- the call center --");
  SEAT = { userId: "u_cc", accountId: "acc_gc", role: "callcenter" };
  const cc = await visitApp(browser, { host: "outerhome", webPort: WEB, seat: SEAT });
  for (let n = 0; n < 40; n++) { await wait(200); if (await cc.page.$("[data-crm-nav]")) break; }
  const ccNav = await crmNav(cc.page);
  t.ck("the call center gets neither Reports nor Setup", ccNav.length > 0 && !ccNav.includes("reports") && !ccNav.includes("setup"), ccNav.join(","));
  await cc.ctx.close();

  console.log("\n-- the unsubscribe page --");
  const un = await visitApp(browser, { host: "app", webPort: WEB, seat: null, path: `/unsubscribe/${TOKEN}` });
  for (let n = 0; n < 30; n++) { await wait(200); if (await un.page.$("[data-unsubscribe-go]")) break; }
  const ask = await un.page.evaluate(() => document.querySelector("[data-unsubscribe-page]")?.innerText || "");
  t.ck("it says whose emails they are", /Stop emails from Outerhome/.test(ask), ask);
  await click(un.page, "[data-unsubscribe-go]");
  await wait(400);
  t.ck("and one press stops them", unsubPosts.length === 1 && !!(await un.page.$("[data-unsubscribed-done]")));
  await un.ctx.close();
} catch (err) {
  t.ck("threw", false, err?.stack || String(err));
} finally {
  await browser.close();
  web.close(); api.close();
}
t.done();
