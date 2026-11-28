// 109. THE CRM INBOX, CONTACTING A LEAD, AND THE SALES MANAGER'S SCREEN, DRAWN.
//
// What is pinned in a browser, against a stubbed API:
//
//   A SALES MANAGER HAS THE CRM AND NOTHING ELSE, and its menu carries the
//   Inbox with the count of replies nobody has opened.
//
//   THE INBOX LISTS EVERY KIND, filters by kind, and a row opens the lead on
//   its Contact tab.
//
//   EACH CHANNEL IS GREYED OUT WITH THE ROUTE'S REASON before it is pressed:
//   no email consent, no address. Email posts what was typed. A text is a
//   link into the messages app with the words in it, and is logged.
//
//   A SALES MANAGER BOOKS FOR THEMSELVES, and is not offered the owner picker.
//
//   node --no-warnings scripts/lead-contact-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait, touchingSections } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-leadcontactui-test");
const WEB = 5811, API = 8912;
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
let SEAT = { userId: "u_sm", accountId: "acc_gc", role: "sales" };
const REPS = [{ id: "u_admin", name: "Richard Braun", role: "admin" }, { id: "u_sm", name: "Sam Seller", role: "sales" }];

const lead = (id, extra = {}) => ({ id, stage: "opportunity", firstName: "Dana", lastName: "Ruiz", phone: "2535550142", email: "dana@home.test",
  address: { street: "1204 N Pine St", city: "Tacoma", state: "WA", zip: "98406" }, services: ["roofing"], source: "call_center",
  notes: null, ownerId: "u_sm", ownerName: "Sam Seller", createdBy: "u_cc", createdByName: "Cara Call",
  createdAt: `${key(0)} 09:00:00`, updatedAt: `${key(0)} 09:00:00`, stageAt: `${key(0)} 09:00:00`, appointments: [],
  consent: { email: true, phone: false, text: true, record: null, capturedAt: "2026-11-01T00:00:00Z" }, ...extra });
const LEADS = [lead("ld_dana"),
  lead("ld_ivy", { firstName: "Ivy", lastName: "Lane", phone: "2535550102", email: "ivy@home.test",
    address: { street: "", city: "", state: "", zip: "" }, consent: null })];
const blocksOf = (l) => ({
  email: !l.email ? "no_email" : l.consent?.email ? null : "no_email_consent",
  text: !l.phone ? "no_phone" : l.consent?.text ? null : "no_text_consent",
  mail: l.address.street ? null : "no_address" });
let MSGS = [
  { id: "lm_1", leadId: "ld_dana", channel: "email", direction: "outbound", subject: "Your roof estimate", body: "Here is the quote.",
    to: "dana@home.test", status: "sent", sentByName: "Sam Seller", createdAt: "2026-11-20T10:00:00Z", who: "Dana Ruiz", readAt: null },
  { id: "lm_2", leadId: "ld_dana", channel: "email", direction: "inbound", subject: "Re: Your roof estimate", body: "Tuesday works",
    to: "dana@home.test", status: "received", createdAt: "2026-11-21T10:00:00Z", who: "Dana Ruiz", readAt: null },
  { id: "lm_3", leadId: "ld_dana", channel: "mail", direction: "outbound", body: "Thank you.", to: "1204 N Pine St, Tacoma, WA 98406",
    status: "printed", sentByName: "Sam Seller", createdAt: "2026-11-19T10:00:00Z", who: "Dana Ruiz", readAt: null, mailedAt: null },
];
const sentMsgs = [], apptsPosted = [];

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, GC];
  if (path === "/api/account") return [200, { ...GC, user: { ...GC.user, id: SEAT.userId, role: SEAT.role } }];
  if (path === "/api/appointments" && method === "GET") return [200, { appointments: [], reps: REPS, team: REPS, crmReady: true }];
  if (path === "/api/appointments" && method === "POST") {
    apptsPosted.push(body);
    return [201, { appointment: { id: "ap_new", ...body, status: "scheduled", repName: "Sam Seller", jobId: null, consent: body.consent }, confirmation: { sent: false } }];
  }
  if (path === "/api/sales-followups") return [200, { followUps: [] }];
  if (path === "/api/sales-leads" && method === "GET") return [200, { leads: LEADS, owners: REPS }];
  if (path === "/api/crm-inbox") return [200, { messages: MSGS }];
  const mm = path.match(/^\/api\/sales-leads\/([^/]+)\/messages$/);
  if (mm && method === "GET") {
    const l = LEADS.find((x) => x.id === mm[1]);
    MSGS = MSGS.map((m) => (m.leadId === mm[1] && m.direction === "inbound" ? { ...m, readAt: "now" } : m));
    return [200, { messages: MSGS.filter((m) => m.leadId === mm[1]), consent: l.consent, blocks: blocksOf(l), canReply: true, accountName: "Outerhome" }];
  }
  if (mm && method === "POST") {
    sentMsgs.push({ lead: mm[1], body });
    const m = { id: `lm_new${sentMsgs.length}`, leadId: mm[1], ...body, direction: body.direction || "outbound",
      status: body.channel === "email" ? "sent" : body.channel === "text" ? "device" : "logged", createdAt: new Date().toISOString(), sentByName: "Sam Seller" };
    MSGS = [m, ...MSGS];
    return [201, { message: m, ...(body.channel === "email" ? { sent: { ok: true } } : {}) }];
  }
  if (path === "/api/account-users") return [200, [{ id: SEAT.userId, name: "Sam Seller", email: "sam@outerhome.test", phone: null,
    role: SEAT.role, subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }]];
  if (path === "/api/google-calendar") return [200, { configured: false }];
  if (path.startsWith("/api/")) return SEAT.role === "sales" ? [403, { error: "forbidden" }] : [200, []];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const navLabels = (page) => page.evaluate(() =>
  [...document.querySelectorAll("nav.tabs button")].map((b) => (b.innerText || "").trim().split("\n")[0]).filter(Boolean));
const click = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); if (el) el.click(); return !!el; }, sel);
const setVal = (page, sel, v) => page.evaluate((s, val) => {
  const el = document.querySelector(s);
  if (!el) return false;
  const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, val);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}, sel, v);

try {
  console.log("\n-- a sales manager --");
  const { ctx, page, crashes } = await visitApp(browser, { host: "outerhome", webPort: WEB, seat: SEAT });
  for (let n = 0; n < 40; n++) { await wait(200); if (await page.$(".appt-view")) break; }
  const nav = await navLabels(page);
  t.ck("the menu is the CRM's pages, Inbox included", ["Dashboard", "Inbox", "Leads", "Appointments", "Calendar", "Follow-ups"].every((l) => nav.includes(l))
    && !nav.some((l) => /^(Jobs|Subcontractors|Contractors|Properties)$/.test(l)), nav.join(" | "));
  t.ck("and no Workbench / CRM switch", !(await page.$(".ws-switch")));
  const badge = await page.evaluate(() => document.querySelector('[data-crm-nav="inbox"]')?.innerText || "");
  t.ck("the Inbox entry counts the reply nobody has opened", /1/.test(badge), badge);

  await click(page, '[data-crm-nav="inbox"]');
  await wait(400);
  const rows = await page.evaluate(() => [...document.querySelectorAll("[data-crm-inbox] [data-lead-msg]")].map((r) => r.dataset.channel));
  t.ck("the inbox lists every kind", rows.length === 3 && rows.includes("mail") && rows.includes("email"), rows.join(","));
  await click(page, '[data-inbox-kind="mail"]');
  await wait(150);
  const mailRows = await page.evaluate(() => [...document.querySelectorAll("[data-crm-inbox] [data-lead-msg]")].map((r) => r.dataset.channel));
  t.ck("and filters to one kind", mailRows.length === 1 && mailRows[0] === "mail", mailRows.join(","));
  await click(page, '[data-inbox-kind="unread"]');
  await wait(150);
  const unread = await page.evaluate(() => document.querySelectorAll("[data-crm-inbox] [data-lead-msg]").length);
  t.ck("and to the unread replies", unread === 1, String(unread));
  await click(page, '[data-crm-inbox] .lm-open');
  await wait(500);
  const onContact = await page.evaluate(() => ({
    tab: document.querySelector('[data-lead-tab="contact"]')?.getAttribute("aria-selected"),
    panel: !!document.querySelector("[data-lead-contact]"),
    reply: document.querySelector("[data-lead-contact] .lm-row.inbound")?.innerText || "" }));
  t.ck("a row opens the lead on its Contact tab", onContact.tab === "true" && onContact.panel, JSON.stringify(onContact));
  {
    // The Contact tab is cards like the Overview: reach them, history; none touching.
    const secs = await page.evaluate(() => [...document.querySelectorAll("[data-lead-contact] .appt-sec > h4")].map((h) => h.innerText.trim().toLowerCase()));
    const touch = await touchingSections(page, "[data-lead-detail]");
    t.ck("the Contact tab is sections, none touching", secs.some((x) => x.startsWith("reach")) && secs.includes("history") && touch.length === 0, JSON.stringify({ secs, touch }));
    if (process.env.SHOTDIR) await page.screenshot({ path: `${process.env.SHOTDIR}/tab-contact.png` });
  }
  t.ck("with their reply in the conversation", /Tuesday works/.test(onContact.reply), onContact.reply);

  const btns = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("[data-contact]")].map((b) => [b.dataset.contact, b.disabled])));
  t.ck("email, text and a letter are open for a lead who agreed and has an address",
    btns.email === false && btns.text === false && btns.mail === false && btns.call === false, JSON.stringify(btns));
  await click(page, '[data-contact="email"]');
  await wait(150);
  await setVal(page, "[data-email-subject]", "Following up");
  await setVal(page, "[data-email-body]", "Hi Dana,\n\nAny questions?");
  await click(page, "[data-send-email]");
  await wait(400);
  const em = sentMsgs.find((x) => x.body.channel === "email");
  t.ck("Send email posts what was typed", em?.lead === "ld_dana" && em.body.subject === "Following up" && /Any questions/.test(em.body.body), JSON.stringify(em));
  t.ck("and says it went", /Emailed Dana Ruiz/.test(await page.evaluate(() => document.querySelector("[data-lead-contact] .appt-flash")?.innerText || "")));

  await click(page, '[data-contact="text"]');
  await wait(150);
  await setVal(page, "[data-text-body]", "On my way");
  const href = await page.evaluate(() => document.querySelector("[data-send-text]")?.getAttribute("href") || "");
  t.ck("a text is a link into the messages app with the words in it", href === "sms:+12535550142?&body=On%20my%20way", href);
  // The click itself would leave the page for the sms: scheme, so the link
  // is kept from navigating and the record is read.
  await page.evaluate(() => { const a = document.querySelector("[data-send-text]"); a.addEventListener("click", (e) => e.preventDefault(), { capture: false }); a.click(); });
  await wait(400);
  t.ck("and pressing it logs the text", sentMsgs.some((x) => x.body.channel === "text" && x.body.body === "On my way"));

  // The letter's row offers Mark mailed.
  t.ck("a printed letter offers Mark mailed", !!(await page.$("[data-lead-contact] [data-mark-mailed]")));

  // Another lead, no consent and no address.
  await page.keyboard.press("Escape");
  await page.evaluate(() => document.querySelector(".modal-backdrop")?.click());
  await wait(300);
  await click(page, '[data-crm-nav="leads"]');
  await wait(300);
  await click(page, '[data-lead="ld_ivy"]');
  await wait(300);
  await click(page, '[data-lead-tab="contact"]');
  await wait(400);
  const ivy = await page.evaluate(() => ({
    btns: Object.fromEntries([...document.querySelectorAll("[data-contact]")].map((b) => [b.dataset.contact, b.disabled])),
    why: [...document.querySelectorAll("[data-contact-block]")].map((x) => x.innerText).join(" | ") }));
  t.ck("a lead nobody asked cannot be emailed or texted, and says why", ivy.btns.email === true && ivy.btns.text === true
    && /agreed to be emailed/.test(ivy.why) && /agreed to texts/.test(ivy.why), JSON.stringify(ivy));
  t.ck("and a letter needs their address", ivy.btns.mail === true && /street address/.test(ivy.why), ivy.why);
  t.ck("and consent can be asked from here", !!(await page.$("[data-ask-consent]")));
  await click(page, '[data-lead-tab="overview"]');
  await wait(200);
  await click(page, ".lead-head .btn-ghost");
  await wait(300);
  const ownerPick = await page.evaluate(() => [...document.querySelectorAll("[data-lead-form] .fld span")].some((s) => s.innerText.trim() === "Owner"));
  t.ck("a sales manager is not offered the owner picker", !ownerPick);
  await page.evaluate(() => document.querySelector(".modal-backdrop")?.click());
  await wait(300);

  // 111. New appointment lives on Appointments now, not on every CRM page.
  await click(page, '[data-crm-nav="appointments"]');
  await wait(300);
  await click(page, "[data-new-appt]");
  await wait(300);
  // 111. New appointment asks who it is for; a new homeowner is the call script.
  await click(page, "[data-appt-start-new]");
  await wait(300);
  await page.evaluate(() => [...document.querySelectorAll(".appt-steps button")].find((b) => /schedule|when/i.test(b.innerText))?.click());
  await wait(300);
  t.ck("and books for themselves", !!(await page.$("[data-self-rep]")) && !(await page.$("[data-rep]")));
  t.ck("and nothing crashed", crashes.length === 0, crashes.join(" | "));
  await ctx.close();
} catch (err) {
  t.ck("threw", false, err?.stack || String(err));
} finally {
  await browser.close();
  web.close(); api.close();
}
t.done();
