// 111. EACH CRM PAGE'S OWN BUTTON, DRAWN: the dashboard's welcome and New
// lead, the CRM's Add menu by stage, the Inbox's New message, the
// new-appointment choice, Add a follow-up, Update report, and Setup's text and
// letter templates, starter sequences and the website form's trades and one
// consent statement.
//
// What is pinned in a browser, against a stubbed API:
//
//   THE DASHBOARD OPENS ON A GREETING, like the Workbench's, and its button
//   is New lead. No page but Appointments and the calendar offers New
//   appointment.
//
//   THE ADD MENU IN THE CRM is Lead, Prospect, Opportunity and Customer, and
//   each opens the lead form at that stage.
//
//   NEW MESSAGE picks the channel and the lead, grays a lead the channel
//   cannot reach, and lands on their Contact tab with that form open.
//
//   NEW APPOINTMENT ASKS WHO IT IS FOR: somebody in the leads (the call
//   script seeded with them) or a new homeowner.
//
//   ADD A FOLLOW-UP posts to the lead, and grays a way they have not agreed to.
//
//   UPDATE REPORT finds a lead and saves their stage and an estimate's amount.
//
//   SETUP shows templates by channel, starter sequences with Use this, and a
//   form whose trades are picked here, with one consent statement.
//
//   node --no-warnings scripts/crm-pages-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-crmpagesui-test");
const WEB = 5835, API = 8914;
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
const SEAT = { userId: "u_admin", accountId: "acc_gc", role: "admin" };
const REPS = [{ id: "u_admin", name: "Richard Braun", role: "admin" }, { id: "u_sm", name: "Sam Seller", role: "sales" }];

const appt = (id, extra = {}) => ({ id, status: "scheduled", direction: "inbound", source: "Google", services: ["roofing"],
  details: { roofing: { material: "Asphalt shingle", age: "Over 20 years", leaks: "Yes", stories: "2" } },
  home: { owns: "Yes", timeline: "Within 3 months" },
  homeowner: { firstName: "Dana", lastName: "Ruiz", phone: "2535550142", email: "dana@home.test" },
  address: { street: "1204 N Pine St", city: "Tacoma", state: "WA", zip: "98406" }, second: null,
  date: key(0), time: "10:00", minutes: 90, repId: "u_admin", repName: "Richard Braun", notes: null, outcomeNote: null, jobId: null,
  createdAt: `${key(-5)} 09:00:00`, updatedAt: `${key(-5)} 09:00:00`, statusAt: `${key(-5)} 09:00:00`,
  consent: { email: true, phone: true, text: true, record: null }, deal: null, ...extra });
let APPTS = [appt("ap_dana")];
const lead = (id, extra = {}) => ({ id, stage: "opportunity", firstName: "Dana", lastName: "Ruiz", phone: "2535550142", email: "dana@home.test",
  address: { street: "1204 N Pine St", city: "Tacoma", state: "WA", zip: "98406" }, services: ["roofing"], source: "website",
  notes: null, ownerId: "u_admin", ownerName: "Richard Braun", createdBy: "u_admin", createdByName: "Richard Braun",
  createdAt: `${key(-6)} 09:00:00`, updatedAt: `${key(0)} 09:00:00`, stageAt: `${key(0)} 09:00:00`,
  appointments: [{ id: "ap_dana", status: "scheduled", date: key(0), time: "10:00" }],
  consent: { email: true, phone: true, text: true, record: null, capturedAt: "2026-11-01T00:00:00Z" },
  optOut: null, enrollment: null, ...extra });
let LEADS = [
  lead("ld_dana"),
  lead("ld_ivy", { firstName: "Ivy", lastName: "Long", email: "", phone: "2535550177", stage: "prospect", appointments: [],
    consent: { email: false, phone: true, text: false, record: null, capturedAt: "2026-11-01T00:00:00Z" } }),
];
const LIB = { templates: [
  { id: "std:thanks", channel: "email", name: "Thanks for meeting", subject: "Thanks, {{firstName}}", body: "Hi {{firstName}}", builtin: true },
  { id: "std:text-after", channel: "text", name: "After the visit", subject: "", body: "Hi {{firstName}}, thanks for having us out.", builtin: true },
  { id: "std:mail-thanks", channel: "mail", name: "Thank you for meeting", subject: "", body: "Thank you for having us out.", builtin: true },
], sequences: [
  { id: "std:seq-text", name: "Text follow-up after the estimate", steps: [{ day: 0, templateId: "std:text-after" }], stopOnBooking: true,
    active: true, running: 0, starter: true, channel: "text" },
] };
const posts = { followUps: [], leadPatches: [], apptPatches: [], seqPosts: [], tplPosts: [] };

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, GC];
  if (path === "/api/account") return [200, GC];
  if (path === "/api/appointments" && method === "GET") return [200, { appointments: APPTS, reps: REPS, team: REPS, crmReady: true, dealsReady: true }];
  const pa = path.match(/^\/api\/appointments\/([^/]+)$/);
  if (pa && method === "PATCH") {
    posts.apptPatches.push(body);
    const cur = APPTS.find((a) => a.id === pa[1]);
    const next = { ...cur, deal: { ...(cur.deal || {}), amountCents: Math.round(Number(String(body.deal?.amount || 0).replace(/[$,]/g, "")) * 100) } };
    APPTS = APPTS.map((a) => (a.id === cur.id ? next : a));
    return [200, { appointment: next }];
  }
  if (/^\/api\/appointments\/[^/]+\/activities$/.test(path)) return [200, { activities: [], consent: null, crmReady: true }];
  if (path === "/api/sales-followups") return [200, { followUps: [] }];
  if (path === "/api/sales-leads" && method === "GET") return [200, { leads: LEADS, owners: REPS, sellingReady: true }];
  const pl = path.match(/^\/api\/sales-leads\/([^/]+)$/);
  if (pl && method === "PATCH") {
    posts.leadPatches.push(body);
    LEADS = LEADS.map((l) => (l.id === pl[1] ? { ...l, ...body } : l));
    return [200, { lead: LEADS.find((l) => l.id === pl[1]) }];
  }
  const pf = path.match(/^\/api\/sales-leads\/([^/]+)\/follow-ups$/);
  if (pf && method === "POST") {
    posts.followUps.push({ lead: pf[1], ...body });
    return [201, { followUp: { id: "fu1", leadId: pf[1], appointmentId: null, ...body } }];
  }
  if (path === "/api/crm-inbox") return [200, { messages: [] }];
  if (path === "/api/crm-library") return [200, LIB];
  if (path === "/api/crm-templates" && method === "POST") { posts.tplPosts.push(body); return [201, { template: { id: "tp_new", ...body } }]; }
  if (path === "/api/crm-sequences" && method === "POST") { posts.seqPosts.push(body); return [201, { sequence: { id: "stdseq_text_acc_gc", name: "x", steps: [], stopOnBooking: true } }]; }
  const mm = path.match(/^\/api\/sales-leads\/([^/]+)\/messages$/);
  if (mm && method === "GET") {
    return [200, { messages: [], consent: LEADS.find((l) => l.id === mm[1])?.consent, optOut: null, enrollment: null, callBlock: null,
      blocks: { email: null, text: null, mail: null }, canReply: true, accountName: "Outerhome" }];
  }
  if (path === "/api/account-users") return [200, [{ id: "u_admin", name: "Richard Braun", email: "rb@outerhome.test", phone: null,
    role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }]];
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
const headBtns = (page) => page.evaluate(() => [...document.querySelectorAll(".appt-view > .dash-hello .dash-cta button")].map((b) => b.innerText.trim()));
const nav = async (page, id) => { await click(page, `[data-crm-nav="${id}"]`); await wait(300); };
const closeModal = async (page) => { await page.evaluate(() => document.querySelector(".modal-backdrop")?.click()); await wait(300); };

try {
  const { ctx, page, crashes } = await visitApp(browser, { host: "outerhome", webPort: WEB, seat: SEAT });
  for (let n = 0; n < 40; n++) { await wait(200); if (await page.$("[data-ws='crm']")) break; }
  await click(page, "[data-ws='crm']");
  for (let n = 0; n < 20; n++) { await wait(200); if (await page.$(".appt-view")) break; }
  await wait(400);

  console.log("\n-- the dashboard --");
  const hello = await page.evaluate(() => document.querySelector("[data-crm-hello]")?.innerText || "");
  t.ck("it opens on a greeting with their name", /^(Good (morning|afternoon|evening)|Still up), Richard/.test(hello.trim()), hello);
  t.ck("and a seller's line: get after it, and what is on today", /Get after it!/.test(hello) && /1 estimate on the calendar today/.test(hello), hello);
  t.ck("its button is New lead", (await headBtns(page)).join() === "New lead", (await headBtns(page)).join());

  console.log("\n-- the Add menu --");
  await page.evaluate(() => [...document.querySelectorAll(".add-btn")].find((b) => /Add/.test(b.innerText))?.click());
  await wait(200);
  const items = await page.evaluate(() => [...document.querySelectorAll(".add-menu:not(.user-menu) button")].map((b) => b.innerText.trim()));
  t.ck("it offers Lead, Prospect, Opportunity and Customer", items.join() === "Lead,Prospect,Opportunity,Customer", items.join());
  await page.evaluate(() => [...document.querySelectorAll(".add-menu:not(.user-menu) button")].find((b) => b.innerText.trim() === "Customer")?.click());
  await wait(400);
  const stage = await page.evaluate(() => document.querySelector("[data-lead-stage-pick]")?.value);
  const ftitle = await page.evaluate(() => document.querySelector("[data-lead-form] .form-title")?.innerText || "");
  t.ck("Customer opens the lead form at that stage", stage === "customer" && /Add a customer/.test(ftitle), `${stage} ${ftitle}`);
  await closeModal(page);

  for (const [pane, want] of [["leads", "Add a lead"], ["inbox", "New message"], ["appointments", "New appointment"], ["calendar", "New appointment"],
    ["followups", "Add a follow-up"], ["reports", "Update report"], ["setup", ""]]) {
    await nav(page, pane);
    const b = await headBtns(page);
    t.ck(`${pane}: its one button is ${want || "nothing"}`, b.join() === want, b.join());
  }

  console.log("\n-- New message --");
  await nav(page, "inbox");
  await click(page, "[data-new-message]");
  await wait(300);
  const ivyEmail = await page.evaluate(() => {
    const b = document.querySelector('[data-pick-lead="ld_ivy"]'); return b ? { off: b.disabled, why: b.innerText } : null; });
  t.ck("a lead with no email is grayed for Email, saying why", ivyEmail?.off === true && /No email address/.test(ivyEmail.why), JSON.stringify(ivyEmail));
  await click(page, '[data-new-msg-channel="text"]');
  await wait(150);
  t.ck("and open for Text", await page.evaluate(() => document.querySelector('[data-pick-lead="ld_ivy"]')?.disabled === false));
  await setVal(page, "[data-lead-search]", "ivy");
  await wait(150);
  t.ck("the search narrows the list", (await page.$$("[data-pick-lead]")).length === 1);
  await click(page, '[data-pick-lead="ld_ivy"]');
  for (let n = 0; n < 15; n++) { await wait(200); if (await page.$('[data-compose="text"]')) break; }
  t.ck("picking them opens their Contact tab with the text form open", !!(await page.$('[data-lead-contact="ld_ivy"]')) && !!(await page.$('[data-compose="text"]')));
  t.ck("with the text templates to start from", await page.evaluate(() =>
    [...document.querySelectorAll("[data-text-template] option")].some((o) => o.value === "std:text-after")
    && ![...document.querySelectorAll("[data-text-template] option")].some((o) => o.value === "std:thanks")));
  await closeModal(page);

  console.log("\n-- New appointment --");
  await nav(page, "appointments");
  await click(page, "[data-new-appt]");
  await wait(300);
  t.ck("it asks who it is for first", !!(await page.$('[data-appt-start="choose"]')) && !(await page.$(".appt-flow")));
  await click(page, "[data-appt-start-existing]");
  await wait(200);
  await click(page, '[data-pick-lead="ld_dana"]');
  await wait(400);
  const seeded = await page.evaluate(() => [...document.querySelectorAll(".appt-flow input")].map((i) => i.value).join("|"));
  t.ck("somebody in the leads opens the call script with them in it", !!(await page.$(".appt-flow")), seeded.slice(0, 80));
  await closeModal(page);
  await click(page, "[data-new-appt]");
  await wait(300);
  await click(page, "[data-appt-start-new]");
  await wait(300);
  t.ck("a new homeowner opens the call script", !!(await page.$(".appt-flow")));
  await closeModal(page);

  console.log("\n-- Add a follow-up --");
  await nav(page, "followups");
  await click(page, "[data-add-followup]");
  await wait(300);
  // On a phone the search was squeezed to 20px: the picker shared its class
  // with the Leads list's bulk checkbox. Measured, not read off the CSS.
  await page.setViewport({ width: 390, height: 844 });
  await wait(300);
  const fit = await page.evaluate(() => {
    const box = document.querySelector("[data-lead-search]")?.getBoundingClientRect();
    const lab = document.querySelector("[data-lead-picker] .fld span")?.getBoundingClientRect();
    return { box: box ? Math.round(box.width) : 0, labH: lab ? Math.round(lab.height) : 0 };
  });
  t.ck("on a phone the homeowner search is full width", fit.box >= 280, JSON.stringify(fit));
  t.ck("and its label is one line", fit.labH > 0 && fit.labH < 30, JSON.stringify(fit));
  await page.setViewport({ width: 1180, height: 900 });
  await wait(300);
  await click(page, '[data-pick-lead="ld_ivy"]');
  await wait(300);
  const chans = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("[data-fu-channel]")].map((b) => [b.dataset.fuChannel, b.disabled])));
  t.ck("a way they have not agreed to is grayed", chans.email === true && chans.text === true && chans.call === false && chans.mail === false, JSON.stringify(chans));
  await setVal(page, "[data-fu-body]", "Call back about gutters");
  await click(page, "[data-fu-save]");
  await wait(400);
  t.ck("it is saved on the lead", posts.followUps.length === 1 && posts.followUps[0].lead === "ld_ivy" && posts.followUps[0].channel === "call"
    && /^\d{4}-\d{2}-\d{2}$/.test(posts.followUps[0].dueDate), JSON.stringify(posts.followUps));
  t.ck("and the page says so", /Follow-up added for Ivy Long/.test(await page.evaluate(() => document.querySelector(".appt-flash")?.innerText || "")));

  console.log("\n-- Update report --");
  await nav(page, "reports");
  await click(page, "[data-update-report]");
  await wait(300);
  await click(page, '[data-pick-lead="ld_dana"]');
  await wait(300);
  t.ck("it opens their stage and each estimate", !!(await page.$("[data-report-stage]")) && !!(await page.$('[data-report-appt="ap_dana"] [data-deal-amount]')));
  await setVal(page, "[data-report-stage]", "customer");
  await wait(150);
  await click(page, "[data-report-stage-save]");
  await wait(300);
  t.ck("the stage saves", posts.leadPatches.some((p) => p.stage === "customer"), JSON.stringify(posts.leadPatches));
  await setVal(page, '[data-report-appt="ap_dana"] [data-deal-amount]', "18,450");
  await wait(150);
  await click(page, '[data-report-appt="ap_dana"] [data-deal-save]');
  await wait(300);
  t.ck("and the estimate amount saves", posts.apptPatches.some((p) => p.deal?.amount === "18,450"), JSON.stringify(posts.apptPatches));
  await closeModal(page);

  console.log("\n-- Setup --");
  await nav(page, "setup");
  await click(page, '[data-tpl-channel="text"]');
  await wait(200);
  t.ck("texts have their own templates", !!(await page.$('[data-tpl="std:text-after"]')) && !(await page.$('[data-tpl="std:thanks"]')));
  await click(page, "[data-tpl-new]");
  await wait(200);
  t.ck("and a text template asks for no subject", !!(await page.$('[data-tpl-form-channel="text"]')) && !(await page.$("[data-tpl-subject]")));
  await setVal(page, "[data-tpl-name]", "Quick hi");
  await setVal(page, "[data-tpl-body]", "Hi {{firstName}}");
  await click(page, "[data-tpl-save]");
  await wait(300);
  t.ck("it saves as a text", posts.tplPosts[0]?.channel === "text" && posts.tplPosts[0]?.subject === "", JSON.stringify(posts.tplPosts));
  await click(page, '[data-setup-tab="sequences"]');
  await wait(200);
  t.ck("starter sequences are listed", !!(await page.$('[data-seq-starters] [data-seq="std:seq-text"]')));
  await click(page, '[data-seq="std:seq-text"] [data-seq-use]');
  await wait(300);
  t.ck("Use this makes the account's own", posts.seqPosts.some((p) => p.starterId === "std:seq-text"), JSON.stringify(posts.seqPosts));

  // ON A PHONE: one row of tabs that scrolls, never wraps or runs off the
  // page, and the sequence explainer is three short lines, not a paragraph.
  await page.setViewport({ width: 390, height: 844 });
  await wait(300);
  const tabs = await page.evaluate(() => {
    const nav = document.querySelector(".setup-nav");
    const bs = [...document.querySelectorAll("[data-setup-tab]")].map((b) => b.getBoundingClientRect());
    const nr = nav?.getBoundingClientRect();
    return { n: bs.length, tops: [...new Set(bs.map((r) => Math.round(r.top)))].length,
      maxH: Math.max(...bs.map((r) => Math.round(r.height))), navRight: nr ? Math.round(nr.right) : 9999,
      scrolls: nav ? nav.scrollWidth > nav.clientWidth : false, pageWide: document.documentElement.scrollWidth,
      head: document.querySelector("[data-setup-head]")?.innerText || "", how: document.querySelectorAll("[data-seq-how] li").length };
  });
  t.ck("on a phone the setup tabs are one row", tabs.n === 7 && tabs.tops === 1 && tabs.maxH <= 48, JSON.stringify(tabs));
  t.ck("that scrolls inside itself rather than off the page", tabs.scrolls && tabs.navRight <= 390 && tabs.pageWide <= 390, JSON.stringify(tabs));
  t.ck("the tab's header says what it is in one line", /^Sequences\s+Timed steps/.test(tabs.head), tabs.head);
  t.ck("and how a sequence works is three short lines", tabs.how === 3, JSON.stringify(tabs));
  await page.setViewport({ width: 1180, height: 900 });
  await wait(300);
  await click(page, '[data-setup-tab="form"]');
  await wait(300);
  const consent = await page.evaluate(() => document.querySelector("[data-lead-form-consent]")?.innerText || "");
  t.ck("the form shows one consent statement for every channel", /call, text and email/.test(consent) && /Reply STOP/.test(consent), consent);
  await click(page, '[data-lead-form-service="plumbing"]');
  await wait(200);
  await page.evaluate(() => [...document.querySelectorAll("[data-lead-form-embed] .seg-tabs button")].find((b) => /code/i.test(b.innerText))?.click());
  await wait(200);
  const code = await page.evaluate(() => document.querySelector("[data-lead-form-code]")?.innerText || "");
  t.ck("a trade picked is on the form", /value="plumbing"/.test(code) && /value="roofing"/.test(code), code.slice(0, 80));
  t.ck("with one consent box, unticked", (code.match(/name="consent/g) || []).length === 1 && !/consentText/.test(code));
  t.ck("and nothing crashed", crashes.length === 0, crashes.join(" | "));
  await ctx.close();
} catch (err) {
  t.ck("the suite ran to the end", false, err?.stack || String(err));
} finally {
  await browser.close();
  web.close(); api.close();
}
t.done();
