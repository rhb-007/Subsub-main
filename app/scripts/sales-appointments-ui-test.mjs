// 105. The call-center seat and the appointments screen, drawn.
//
// test:appointments proves the routes. This proves the screens:
//
//   A CALL-CENTER SEAT SEES APPOINTMENTS AND NOTHING ELSE in the menu, and
//   lands on it.
//
//   THE SCRIPT IS WALKED IN ORDER, and Next says what it is waiting for: the
//   call, the services, each service's questions, the homeowner and home, the
//   second decision maker, the time and the sales manager. What is sent is what
//   was answered.
//
//   A REP'S OTHER APPOINTMENT THAT DAY IS SHOWN, and an overlap is named.
//
//   THE OUTCOME IS THE OFFICE'S. The call center is offered Confirmed and
//   Canceled; the admin is offered Sold, and "create the job" opens the job
//   form already filled in from the call, and sends the appointment with it.
//
//   ONLY A HOMEOWNER-SELLING ACCOUNT HAS IT. A property manager gets no menu
//   entry, and the user form offers the role only where it exists.
//
//   node --no-warnings scripts/sales-appointments-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-apptui-test");
const WEB = 5806, API = 8970;
const t = tally();

const pad = (n) => String(n).padStart(2, "0");
const key = (off) => { const d = new Date(); d.setDate(d.getDate() + off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const DAY = key(6);

const GC = {
  id: "acc_gc", name: "Outerhome", subdomain: "outerhome", kind: "general_contractor", plan: "scale",
  billing: "monthly", useDefaultMark: true, theme: null, trades: [], logoKey: null,
  subscriptionStatus: "active", hostnameStatus: "active",
  user: { id: "u_admin", name: "Richard Braun", email: "rb@outerhome.test", role: "admin" },
};
const PM = { ...GC, id: "acc_pm", name: "Sound Property Management", subdomain: "soundpm", kind: "property_manager" };
let ACC = GC;
let SEAT = { userId: "u_cc", accountId: "acc_gc", role: "callcenter" };

const REPS = [{ id: "u_admin", name: "Richard Braun", role: "admin" }, { id: "u_rep", name: "Marcus Hill", role: "pm" }];
const appt = (id, extra = {}) => ({
  id, status: "scheduled", direction: "inbound", source: "Google", services: ["roofing"],
  details: { roofing: { material: "Metal", age: "10-20 years", leaks: "No", stories: "1" } },
  home: { owns: "Yes", timeline: "Within 3 months" },
  homeowner: { firstName: "Gale", lastName: "Fern", phone: "2535550100", email: "" },
  address: { street: "9 Oak Ave", city: "Tacoma", state: "WA", zip: "98405" }, second: null,
  date: DAY, time: "10:30", minutes: 90, repId: "u_rep", repName: "Marcus Hill", notes: null,
  outcomeNote: null, jobId: null, createdBy: "u_cc", createdByName: "Cara Call", ...extra,
});
let APPTS = [appt("ap_1", { consent: { email: false, phone: true, text: true, record: null } }),
  appt("ap_sat", { status: "sat", date: key(-2), consent: { email: false, phone: false, text: false, record: false },
  homeowner: { firstName: "Hal", lastName: "Stone", phone: "2535550101", email: "" },
  services: ["roofing", "gutters"], details: { roofing: { material: "Asphalt shingle", age: "Over 20 years", leaks: "Yes", stories: "2" },
    gutters: { scope: "Whole home", stories: "2" } } })];
const posted = [], patched = [], jobsPosted = [], actsPosted = [], fuPatched = [];
let ACTS = [];
let FUS = [
  { id: "fu_1", kind: "follow_up", appointmentId: "ap_1", body: "Call back about financing", dueDate: key(-1), channel: "call",
    assigneeId: "u_admin", assigneeName: "Richard Braun", who: "Gale Fern", doneAt: null, createdAt: "2026-11-01T10:00:00Z" },
  { id: "fu_2", kind: "follow_up", appointmentId: "ap_1", body: "Text the brochure", dueDate: key(3), channel: "text",
    assigneeId: "u_rep", assigneeName: "Marcus Hill", who: "Gale Fern", doneAt: null, createdAt: "2026-11-01T10:00:00Z" },
];
// 107. The CRM's leads.
const lead = (id, extra = {}) => ({ id, stage: "lead", firstName: "Ivy", lastName: "Lane", phone: "2535550102", email: "ivy@home.test",
  address: { street: "4 Elm St", city: "Tacoma", state: "WA", zip: "98405" }, services: ["siding"], source: "website",
  notes: null, ownerId: null, ownerName: null, createdBy: "u_cc", createdByName: "Cara Call",
  createdAt: `${key(0)} 09:00:00`, updatedAt: `${key(0)} 09:00:00`, stageAt: `${key(0)} 09:00:00`, appointments: [], consent: null, ...extra });
let LEADS = [
  lead("ld_gale", { stage: "opportunity", firstName: "Gale", lastName: "Fern", phone: "2535550100", services: ["roofing"], source: "call_center",
    appointments: [{ id: "ap_1", status: "scheduled", date: DAY, time: "10:30", jobId: null }], consent: { email: false, phone: true, text: true, record: null } }),
  lead("ld_hal", { stage: "opportunity", firstName: "Hal", lastName: "Stone", phone: "2535550101", source: "call_center",
    appointments: [{ id: "ap_sat", status: "sat", date: key(-2), time: "10:30", jobId: null }] }),
  lead("ld_ivy"),
];
const leadsPosted = [], leadsPatched = [];
const USERS = [
  { id: "u_admin", name: "Richard Braun", email: "rb@outerhome.test", phone: null, role: "admin", subId: null,
    propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false },
];

const web = serveApp({ dir: OUT, port: WEB });
let CAL_BUSY = false;
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, ACC];
  if (path === "/api/account") return [200, { ...ACC, user: { ...ACC.user, id: SEAT.userId, role: SEAT.role } }];
  if (path === "/api/appointments" && method === "GET") {
    if (ACC !== GC) return [403, { error: "no_appointments_for_this_account" }];
    return [200, { appointments: APPTS, reps: REPS, team: REPS, crmReady: true }];
  }
  if (path === "/api/appointments" && method === "POST") {
    posted.push(body);
    // 108. The sales manager's own Google Calendar shows them busy, once.
    if (CAL_BUSY && !body.allowClash) { CAL_BUSY = false; return [409, { error: "rep_calendar_busy", repName: "Marcus Hill" }]; }
    const a = appt("ap_new", { ...body, status: "scheduled", repName: REPS.find((r) => r.id === body.repId)?.name || null });
    APPTS = [a, ...APPTS];
    return [201, { appointment: a, confirmation: { sent: !!body.homeowner?.email, reason: null } }];
  }
  const am = path.match(/^\/api\/appointments\/([^/]+)\/activities$/);
  if (am && method === "GET") {
    return [200, { activities: ACTS.filter((x) => x.appointmentId === am[1]), consent: APPTS.find((a) => a.id === am[1])?.consent || null, team: REPS }];
  }
  if (am && method === "POST") {
    actsPosted.push({ id: am[1], body });
    const a = { id: `act_${actsPosted.length}`, appointmentId: am[1], ...body, createdByName: "Richard Braun", createdAt: new Date().toISOString() };
    ACTS = [a, ...ACTS];
    return [201, { activity: a }];
  }
  const fm = path.match(/^\/api\/appointments\/([^/]+)\/activities\/([^/]+)$/);
  if (fm && method === "PATCH") {
    fuPatched.push({ id: fm[2], body });
    return [200, { activity: { ...(FUS.find((x) => x.id === fm[2]) || {}), doneAt: body.done ? new Date().toISOString() : null } }];
  }
  if (path === "/api/sales-followups") return [200, { followUps: FUS }];
  if (path === "/api/sales-leads" && method === "GET") return ACC !== GC ? [403, { error: "no_appointments_for_this_account" }] : [200, { leads: LEADS, owners: REPS }];
  if (path === "/api/sales-leads" && method === "POST") {
    leadsPosted.push(body);
    const l = lead("ld_new", { ...body, stage: body.stage || "lead" });
    LEADS = [l, ...LEADS];
    return [201, { lead: l }];
  }
  const lm = path.match(/^\/api\/sales-leads\/([^/]+)$/);
  if (lm && method === "PATCH") {
    leadsPatched.push({ id: lm[1], body });
    LEADS = LEADS.map((l) => l.id === lm[1] ? { ...l, ...body } : l);
    return [200, { lead: LEADS.find((l) => l.id === lm[1]) }];
  }
  const pm = path.match(/^\/api\/appointments\/([^/]+)$/);
  if (pm && method === "PATCH") {
    patched.push({ id: pm[1], body });
    APPTS = APPTS.map((a) => a.id === pm[1] ? { ...a, ...body } : a);
    return [200, { appointment: APPTS.find((a) => a.id === pm[1]) }];
  }
  if (path === "/api/jobs" && method === "POST") {
    jobsPosted.push(body);
    return [201, { id: "j_new", requested: false, job: null, fromAppointment: { id: body.fromAppointment, linked: true } }];
  }
  if (path === "/api/account-users") return [200, SEAT.role === "callcenter"
    ? [{ id: "u_cc", name: "Cara Call", email: "cara@outerhome.test", phone: null, role: "callcenter", subId: null,
      propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }] : USERS];
  if (path === "/api/jobs" || path === "/api/subs" || path === "/api/visits" || path === "/api/properties"
    || path === "/api/invites" || path === "/api/connect-requests" || path === "/api/my-connect-requests"
    || path === "/api/clients" || path === "/api/notices" || path === "/api/inspections") {
    return SEAT.role === "callcenter" ? [403, { error: "forbidden" }] : [200, []];
  }
  if (path === "/api/payouts/status") return [200, { status: "none", ready: false, requirements: [], configured: false }];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const navLabels = (page) => page.evaluate(() =>
  [...document.querySelectorAll("nav.tabs button")].map((b) => (b.innerText || "").trim().split("\n")[0]).filter(Boolean));
const click = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); if (el) el.click(); return !!el; }, sel);
const clickText = (page, sel, re) => page.evaluate((s, r) => {
  const el = [...document.querySelectorAll(s)].find((b) => new RegExp(r).test((b.innerText || "").trim()));
  if (el) el.click(); return !!el;
}, sel, re);
const setVal = (page, sel, v) => page.evaluate((s, val) => {
  const el = document.querySelector(s);
  if (!el) return false;
  const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, val);
  el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  return true;
}, sel, v);
// A field by the label text it sits in, within the flow.
const setField = (page, label, v) => page.evaluate((lab, val) => {
  const l = [...document.querySelectorAll(".appt-flow label.fld")].find((x) => (x.childNodes[0]?.textContent || "").trim().startsWith(lab));
  const el = l?.querySelector("input, select, textarea");
  if (!el) return false;
  const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, val);
  el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  return true;
}, label, v);
const chip = (page, qid, text, scope = "") => page.evaluate((q, tx, sc) => {
  const root = sc ? document.querySelector(sc) : document;
  const el = [...(root?.querySelectorAll(`[data-q="${q}"] .chip`) || [])].find((b) => b.innerText.trim() === tx);
  if (el) el.click(); return !!el;
}, qid, text, scope);
const next = async (page) => { const ok = await click(page, "[data-next]"); await wait(200); return ok; };
const stepNow = (page) => page.evaluate(() => document.querySelector(".appt-flow")?.dataset.step || "");
const nextState = (page) => page.evaluate(() => ({
  disabled: document.querySelector("[data-next]")?.disabled, why: document.querySelector("[data-why]")?.innerText || "" }));

try {
  console.log("\n-- a call-center seat --");
  {
    const { ctx, page, crashes } = await visitApp(browser, { host: "outerhome", webPort: WEB, seat: SEAT });
    for (let n = 0; n < 40; n++) { await wait(200); if (await page.$(".appt-view")) break; }
    const nav = await navLabels(page);
    t.ck("the menu is the CRM's pages and nothing else on the account",
      ["Dashboard", "Inbox", "Leads", "Appointments", "Follow-ups"].every((l) => nav.includes(l))
      && !nav.some((l) => /^(Jobs|Subcontractors|Contractors|Availability|Properties|CRM \/ Sales)$/.test(l)),
      nav.join(" | "));
    // 109. The one Inbox on the menu is the CRM's (leads), never the
    // account's conversations, which a call-center seat does not have.
    t.ck("and its one Inbox is the CRM's", nav.filter((l) => l === "Inbox").length === 1 && !!(await page.$('[data-crm-nav="inbox"]')));
    t.ck("and no Jobs / CRM switch, since it has only the CRM", !(await page.$(".ws-switch")));
    if (process.env.DBG) console.log(await page.evaluate(() => document.body.innerText.slice(0, 1500)), crashes);
    const head = await page.evaluate(() => document.querySelector(".appt-view .dash-hello h2")?.innerText || "");
    t.ck("and it lands on its own dashboard, not the office's", /^CRM/.test(head.trim()) && !!(await page.$("[data-caller-dash]"))
      && !(await page.$("[data-funnel]")), head);
    const ck = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("[data-ck]")].map((x) => [x.dataset.ck, x.innerText.trim()])));
    t.ck("which counts what this seat did today and this month", ck.leadsToday === "3" && ck.bookedMonth !== undefined
      && ck.bookRate === "67%", JSON.stringify(ck));
    const toCall = await page.$$eval("[data-call-lead]", (xs) => xs.map((x) => x.dataset.callLead));
    t.ck("and lists the leads with no estimate booked, ready to book", toCall.join() === "ld_ivy", toCall.join());
    const head2 = await page.evaluate(() => [...document.querySelectorAll(".page-head button, .appt-view > * button")].slice(0, 4).map((b) => b.innerText.trim()));
    t.ck("its first press is New lead", !!(await page.$("[data-caller-new-lead]")) && !!(await page.$("[data-new-lead-book].btn-solid")), head2.join(" | "));
    await click(page, "[data-caller-new-lead]");
    await wait(300);
    t.ck("which opens the lead form with Add and book as the main button", !!(await page.$("[data-save-lead-book].btn-solid"))
      && !!(await page.$("[data-save-lead].btn-ghost")));
    await page.evaluate(() => {
      const set = (lab, val) => { const l = [...document.querySelectorAll(".lead-form label.fld")].find((x) => (x.querySelector("span")?.textContent || "").trim() === lab);
        const el = l?.querySelector("input"); if (!el) return;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, val);
        el.dispatchEvent(new Event("input", { bubbles: true })); };
      set("First name", "Kim"); set("Last name", "Ward"); set("Mobile", "253-555-0188");
    });
    await click(page, "[data-save-lead-book]");
    await wait(500);
    const before = leadsPosted.length;
    t.ck("adding them saves the lead first", leadsPosted.some((x) => x.firstName === "Kim"), JSON.stringify(leadsPosted));
    const seededName = await page.evaluate(() => !!document.querySelector(".appt-flow"));
    t.ck("then goes straight into booking their estimate", seededName, String(before));
    await page.evaluate(() => document.querySelector(".modal-backdrop")?.click());
    await wait(300);
    LEADS = LEADS.filter((l) => l.firstName !== "Kim"); leadsPosted.length = 0;
    await click(page, '[data-crm-nav="appointments"]');
    await wait(300);
    t.ck("Appointments lists what is booked", (await page.$$("[data-appt]")).length === 1);

    await click(page, "[data-new-appt]");
    await wait(300);
    t.ck("New appointment opens the call script on its first step", (await stepNow(page)) === "call");
    let ns = await nextState(page);
    t.ck("Next waits for inbound or outbound, and says so", ns.disabled === true && /Still needed/.test(ns.why), JSON.stringify(ns));
    await click(page, '[data-direction="outbound"]');
    const recAsk = await page.evaluate(() => document.querySelector('[data-consent="record"]')?.innerText || "");
    t.ck("the call step asks before recording, in words to read out", /may be recorded/.test(recAsk), recAsk);
    await page.evaluate(() => [...document.querySelectorAll('[data-consent="record"] .chip')].find((b) => b.innerText.trim() === "They agreed")?.click());
    await setField(page, "How did they hear", "Door knocking");
    await next(page);
    t.ck("then asks which services", (await stepNow(page)) === "services");
    await click(page, '[data-service="roofing"]');
    await click(page, '[data-service="windows"]');
    await next(page);
    t.ck("then each service's questions, one section each",
      (await page.$$eval("[data-svc]", (xs) => xs.map((x) => x.dataset.svc))).join() === "roofing,windows");
    ns = await nextState(page);
    t.ck("Next names the first required answer still blank", ns.disabled && /roof/i.test(ns.why), ns.why);
    await chip(page, "material", "Asphalt shingle", '[data-svc="roofing"]');
    await chip(page, "age", "Over 20 years", '[data-svc="roofing"]');
    await chip(page, "leaks", "Yes", '[data-svc="roofing"]');
    await chip(page, "stories", "2", '[data-svc="roofing"]');
    await page.evaluate(() => {
      const el = document.querySelector('[data-svc="windows"] [data-q="count"] input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "14");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await chip(page, "frame", "Wood", '[data-svc="windows"]');
    await chip(page, "issues", "Drafts", '[data-svc="windows"]');
    await chip(page, "issues", "Fogging between panes", '[data-svc="windows"]');
    await next(page);
    t.ck("then the homeowner and the home", (await stepNow(page)) === "homeowner");
    await chip(page, "owns", "No");
    const warn = await page.evaluate(() => document.querySelector(".appt-pane .appt-warn")?.innerText || "");
    t.ck("a renter is flagged: the owner has to be part of it", /don't own the home/.test(warn), warn);
    await chip(page, "owns", "Yes");
    await chip(page, "timeline", "As soon as possible");
    await setField(page, "First name", "Dana");
    await setField(page, "Last name", "Ruiz");
    await setField(page, "Mobile", "2535550142");
    await setField(page, "Email", "dana@home.test");
    await setField(page, "Street address", "1204 N Pine St");
    await setField(page, "City", "Tacoma");
    await page.evaluate(() => {
      const el = document.querySelector(".appt-flow select.fld-state");
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, "WA");
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await setField(page, "ZIP", "98406");
    await wait(150);
    const cblock = await page.evaluate(() => ({
      text: document.querySelector("[data-consent-block]")?.innerText || "",
      qs: [...document.querySelectorAll("[data-consent-block] [data-consent]")].map((x) => x.dataset.consent) }));
    t.ck("the homeowner step asks permission to follow up by email, phone and text",
      cblock.qs.join() === "email,phone,text" && /STOP/.test(cblock.text), JSON.stringify(cblock));
    ns = await nextState(page);
    t.ck("and Next waits for those answers, naming the first", ns.disabled === true && /email them/.test(ns.why), JSON.stringify(ns));
    const answer = (id, v) => page.evaluate((i, val) =>
      document.querySelector(`[data-consent-block] [data-consent="${i}"] [data-answer="${val}"]`)?.click(), id, String(v));
    await answer("email", true); await answer("phone", true); await answer("text", false);
    await wait(150);
    await next(page);
    t.ck("then the second decision maker", (await stepNow(page)) === "decider");
    ns = await nextState(page);
    t.ck("which has to be answered, alone or not", ns.disabled === true, JSON.stringify(ns));
    await click(page, '[data-decider="second"]');
    await setField(page, "First name", "Alex");
    await setField(page, "Relationship", "Spouse");
    await click(page, '[data-attends="true"]');
    await next(page);
    t.ck("then the time and the sales manager", (await stepNow(page)) === "schedule");
    await setField(page, "Date", DAY);
    await setField(page, "Time", "11:00");
    await setVal(page, "select[data-rep]", "u_rep");
    await wait(200);
    const day = await page.evaluate(() => ({ text: document.querySelector("[data-rep-day]")?.innerText || "",
      clash: document.querySelector("[data-rep-day] li.clash")?.innerText || "", box: !!document.querySelector("[data-clash]") }));
    t.ck("the rep's other appointment that day is shown", /Gale Fern/.test(day.text) && /Marcus Hill/.test(day.text), day.text);
    t.ck("and an overlap is named", /10:30 AM/.test(day.clash) && day.box === true, JSON.stringify(day));
    await setField(page, "Time", "13:30");
    await wait(150);
    t.ck("a free time clears it", !(await page.$("[data-clash]")));
    const conf = await page.evaluate(() => document.querySelector(".appt-check")?.innerText || "");
    t.ck("the confirmation email is offered to the address given", /dana@home.test/.test(conf), conf);
    await next(page);
    t.ck("and last, a review", (await stepNow(page)) === "review");
    const rev = await page.evaluate(() => document.querySelector("[data-review]")?.innerText.replace(/\s+/g, " ") || "");
    t.ck("which reads back the call", /Dana Ruiz/.test(rev) && /Alex.*Spouse.*will be there/.test(rev)
      && /Window replacement/.test(rev) && /About how many windows: 14/.test(rev) && /1:30 PM/.test(rev), rev);
    // 108. The server answers that the sales manager's Google Calendar shows
    // them busy: the form goes back to the time, says so, and books only once
    // Book anyway is ticked.
    CAL_BUSY = true;
    await click(page, "[data-book]");
    await wait(600);
    const busy = await page.evaluate(() => ({ box: document.querySelector("[data-calbusy]")?.innerText || "" }));
    t.ck("a sales manager busy on their Google Calendar sends the form back to the time, saying so",
      (await stepNow(page)) === "schedule" && /Marcus Hill's Google Calendar shows them busy then/.test(busy.box), JSON.stringify(busy));
    await next(page);
    const blocked = await page.evaluate(() => document.querySelector("[data-book]")?.disabled);
    t.ck("and Book waits for Book anyway", blocked === true, String(blocked));
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => x.innerText.trim() === "Back"); b?.click(); });
    await wait(200);
    await page.evaluate(() => document.querySelector("[data-calbusy] input")?.click());
    await wait(150);
    await next(page);
    await click(page, "[data-book]");
    await wait(600);
    t.ck("ticked, it books, saying to book anyway", posted.length === 2 && posted[1].allowClash === true, JSON.stringify(posted.map((x) => x.allowClash)));
    const sent = posted[0] || {};
    t.ck("Book sends what was answered", sent.direction === "outbound" && sent.source === "Door knocking"
      && sent.services?.join() === "roofing,windows" && sent.details?.windows?.count === 14
      && sent.details?.windows?.issues?.join() === "Drafts,Fogging between panes"
      && sent.second?.relationship === "Spouse" && sent.second?.attends === true
      && sent.repId === "u_rep" && sent.time === "13:30" && sent.emailHomeowner === true, JSON.stringify(sent));
    t.ck("and the follow-up answers", sent.consent?.email === true && sent.consent?.phone === true
      && sent.consent?.text === false && sent.consent?.record === true, JSON.stringify(sent.consent));
    const after = await page.evaluate(() => ({ flash: document.querySelector(".appt-flash")?.innerText || "",
      detail: !!document.querySelector("[data-detail]"),
      sets: [...document.querySelectorAll("[data-set]")].map((b) => b.dataset.set),
      convert: !!document.querySelector("[data-convert]") }));
    t.ck("it says it was booked and that the homeowner was emailed", /Booked Dana Ruiz/.test(after.flash) && /emailed/.test(after.flash), after.flash);
    t.ck("and opens the appointment", after.detail);
    t.ck("where the call center may confirm or cancel, and nothing about the outcome",
      after.sets.sort().join() === "cancelled,confirmed", JSON.stringify(after.sets));
    t.ck("and cannot make it a job", after.convert === false);
    await click(page, '[data-set="confirmed"]');
    await wait(400);
    t.ck("confirming sends the status", patched.some((p) => p.id === "ap_new" && p.body.status === "confirmed"), JSON.stringify(patched));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- the call center and leads --");
  {
    SEAT = { userId: "u_cc", accountId: "acc_gc", role: "callcenter" };
    const { ctx, page, crashes } = await visitApp(browser, { host: "outerhome", webPort: WEB, seat: SEAT });
    for (let n = 0; n < 40; n++) { await wait(200); if (await page.$("[data-crm-nav]")) break; }
    await click(page, '[data-crm-nav="leads"]');
    for (let n = 0; n < 20; n++) { await wait(150); if (await page.$("[data-lead]")) break; }
    await click(page, '[data-lead="ld_ivy"]');
    await wait(300);
    const btns = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("[data-move]")].map((b) => [b.dataset.move, b.disabled])));
    t.ck("a call-center seat may qualify a lead to prospect, and nothing past it", btns.prospect === false
      && btns.opportunity === true && btns.customer === true && btns.former === true, JSON.stringify(btns));
    await click(page, '[data-move="prospect"]');
    await wait(300);
    t.ck("and pressing it saves the stage", leadsPatched.some((x) => x.id === "ld_ivy" && x.body.stage === "prospect"), JSON.stringify(leadsPatched));
    t.ck("and the detail shows it", await page.evaluate(() => document.querySelector('[data-move="prospect"]')?.getAttribute("aria-pressed") === "true"));
    await click(page, "[data-book-lead]");
    await wait(300);
    const seeded = await page.evaluate(() => [...document.querySelectorAll(".appt-flow")].length);
    t.ck("Book an appointment opens the call script for them", seeded === 1);
    await page.evaluate(() => document.querySelector(".modal-backdrop")?.click());
    await wait(200);
    await click(page, "[data-new-lead]");
    await wait(300);
    const opts = await page.$$eval("[data-lead-stage-pick] option", (xs) => xs.map((x) => x.value));
    t.ck("Add a lead offers the call center Lead and Prospect only", opts.join() === "lead,prospect", opts.join());
    await page.evaluate(() => {
      const set = (lab, val) => { const l = [...document.querySelectorAll(".lead-form label.fld")].find((x) => (x.querySelector("span")?.textContent || "").trim() === lab);
        const el = l?.querySelector("input"); if (!el) return;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, val);
        el.dispatchEvent(new Event("input", { bubbles: true })); };
      set("First name", "Jo"); set("Last name", "Banks"); set("Mobile", "253-555-0177");
    });
    await page.evaluate(() => [...document.querySelectorAll(".lead-form .chip")].find((b) => b.innerText.trim() === "Gutter replacement")?.click());
    await click(page, "[data-save-lead]");
    await wait(400);
    const lp = leadsPosted[0] || {};
    t.ck("and adding one sends who they are and what they want", lp.firstName === "Jo" && lp.phone === "253-555-0177"
      && lp.services?.join() === "gutters" && lp.stage === "lead", JSON.stringify(lp));
    t.ck("and opens them", !!(await page.$('[data-lead-detail="ld_new"]')));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- the admin --");
  {
    SEAT = { userId: "u_admin", accountId: "acc_gc", role: "admin" };
    const { ctx, page, crashes } = await visitApp(browser, { host: "outerhome", webPort: WEB, seat: SEAT });
    for (let n = 0; n < 40; n++) { await wait(200); if (await page.$(".ws-switch")) break; }
    const nav = await navLabels(page);
    t.ck("the admin logs in to Jobs, and the CRM is not in its menu", nav.includes("Jobs") && nav.includes("Dashboard")
      && !nav.some((l) => /^(CRM \/ Sales|Leads|Appointments|Follow-ups)$/.test(l)), nav.join(" | "));
    const ws = await page.evaluate(() => [...document.querySelectorAll(".ws-switch [data-ws]")].map((b) => `${b.dataset.ws}:${b.getAttribute("aria-selected")}`));
    t.ck("a Jobs / CRM switch, on Jobs", ws.join() === "jobs:true,crm:false", ws.join());
    const wsText = await page.evaluate(() => [...document.querySelectorAll(".ws-switch [data-ws]")].map((b) => b.textContent.trim()));
    t.ck("the switch reads Workbench | CRM", wsText.join("|") === "Workbench|CRM", wsText.join("|"));
    await click(page, '[data-ws="crm"]');
    for (let n = 0; n < 30; n++) { await wait(200); if (await page.$("[data-crm-dash]")) break; }
    const crmNav = await navLabels(page);
    const from = crmNav.indexOf("Dashboard");
    t.ck("the CRM has its own menu, starting with its dashboard", from >= 0 && ["Dashboard", "Inbox", "Leads", "Appointments", "Calendar", "Follow-ups"].every((l, i) => crmNav[from + i] === l)
      && !crmNav.includes("Jobs"), crmNav.join(" | "));
    await click(page, '[data-stage-card="opportunity"]');
    await wait(300);
    const rows = await page.$$eval("[data-lead]", (xs) => xs.map((x) => x.dataset.lead));
    t.ck("a stage on the dashboard opens Leads at that stage", rows.join() === "ld_gale,ld_hal", rows.join());
    await click(page, '[data-ws="jobs"]');
    await wait(300);
    t.ck("and Jobs takes it back to where it was", !!(await page.$(".ws-switch [data-ws=jobs][aria-selected=true]")) && !(await page.$(".appt-view")));
    await click(page, '[data-ws="crm"]');
    await wait(300);
    await click(page, '[data-crm-nav="calendar"]');
    for (let n = 0; n < 20; n++) { await wait(150); if (await page.$("[data-appt-cal]")) break; }
    t.ck("Calendar is its own page with a month grid", !!(await page.$("[data-appt-cal] .jcal-grid")));
    await click(page, `[data-cal-day="${APPTS.find((a) => a.id === "ap_1").date}"]`);
    await wait(250);
    const dayAppts = await page.$$eval("[data-cal-appt]", (xs) => xs.map((x) => x.dataset.calAppt));
    const onDay = APPTS.filter((a) => a.date === APPTS.find((x) => x.id === "ap_1").date && a.status !== "cancelled").map((a) => a.id);
    t.ck("pressing a day lists the estimates on it", dayAppts.includes("ap_1") && dayAppts.length === onDay.length
      && dayAppts.every((id) => onDay.includes(id)), `${dayAppts.join()} / ${onDay.join()}`);
    const dot = await page.evaluate((d) => document.querySelector(`[data-cal-day="${d}"] .jc-dot`)?.className || "", APPTS.find((a) => a.id === "ap_sat").date);
    t.ck("an estimate that has gone by with no outcome is marked late", /late/.test(dot), dot);
    await click(page, "[data-cal-appt]");
    await wait(300);
    t.ck("and pressing one opens it", !!(await page.$(".appt-detail, [data-appt-lead]")));
    await page.evaluate(() => document.querySelector(".modal-backdrop")?.click());
    await wait(200);
    await click(page, '[data-crm-nav="appointments"]');
    for (let n = 0; n < 30; n++) { await wait(200); if (await page.$(".appt-view")) break; }
    const needs = await page.evaluate(() => document.querySelector("[data-needs-outcome]")?.innerText || "");
    t.ck("an appointment gone by with no outcome is called out", /has gone by/.test(needs), needs);
    await click(page, "[data-needs-outcome]");
    await wait(300);
    await click(page, '[data-appt="ap_sat"]');
    await wait(500);
    // 106. The activity panel, on a homeowner who said no to everything.
    const chips = await page.evaluate(() => [...document.querySelectorAll("[data-activity] [data-chip]")].map((x) => `${x.dataset.chip}:${x.className.split(" ").pop()}`));
    t.ck("the appointment shows what they agreed to", chips.join() === "email:no,phone:no,text:no,record:no", chips.join());
    await click(page, '[data-act="call"]');
    await wait(150);
    const callF = await page.evaluate(() => ({ out: document.querySelector('[data-call-dir="outbound"]')?.disabled,
      inb: document.querySelector('[data-call-dir="inbound"]')?.disabled, note: !!document.querySelector("[data-no-call]") }));
    t.ck("an outbound call can't be logged for somebody who said no to calls", callF.out === true && callF.inb === false && callF.note,
      JSON.stringify(callF));
    await click(page, '[data-act="follow_up"]');
    await wait(150);
    const ch = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("[data-channels] [data-channel]")].map((b) => [b.dataset.channel, b.disabled])));
    t.ck("a follow-up offers only channels they agreed to", ch.call === true && ch.email === true && ch.text === true && ch.visit === false,
      JSON.stringify(ch));
    await click(page, '[data-act="recording"]');
    await wait(150);
    t.ck("and no recording, because they said no to it", !!(await page.$("[data-no-record]")) && !(await page.$("[data-recording-file]")));
    await click(page, '[data-act="note"]');
    await wait(150);
    await setVal(page, '[data-act-form="note"] textarea', "Wants to think about metal.");
    await wait(100);
    await click(page, "[data-act-save]");
    await wait(400);
    const noteNow = await page.evaluate(() => [...document.querySelectorAll('[data-activity] [data-item="note"]')].map((x) => x.innerText).join(" | "));
    t.ck("a note is saved and shows on the timeline", actsPosted.some((x) => x.id === "ap_sat" && x.body.kind === "note"
      && /think about metal/.test(x.body.body)) && /think about metal/.test(noteNow), noteNow);
    const d = await page.evaluate(() => ({ sets: [...document.querySelectorAll("[data-set]")].map((b) => b.dataset.set),
      convert: !!document.querySelector("[data-convert]") }));
    t.ck("the office may record the outcome", d.sets.includes("sold") && d.sets.includes("lost") && d.sets.includes("no_show"), JSON.stringify(d.sets));
    t.ck("and turn it into a job", d.convert);
    await click(page, "[data-convert]");
    for (let n = 0; n < 20; n++) { await wait(200); if (await page.$(".modal input")) break; }
    const form = await page.evaluate(() => {
      const val = (re) => { const l = [...document.querySelectorAll(".modal label")].find((x) => re.test(x.innerText || ""));
        return l?.querySelector("input, textarea")?.value || ""; };
      return { title: val(/^Job name/i), client: val(/Homeowner|client/i), zip: val(/^ZIP/i) };
    });
    t.ck("the job form opens filled in from the call",
      /Roof replacement \+ Gutter replacement — Hal Stone/.test(form.title) && /Hal Stone/.test(form.client) && form.zip === "98405",
      JSON.stringify(form));
    // Walk the job form to its save, filling a date when the form asks.
    for (let n = 0; n < 8 && !jobsPosted.length; n++) {
      await page.evaluate((dt) => {
        const el = document.querySelector('.modal input[type="date"]');
        if (el && !el.value) {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, dt);
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }, DAY);
      await wait(150);
      const pressed = await page.evaluate(() => {
        const bs = [...document.querySelectorAll(".modal .form-actions button, .modal button.btn-solid")];
        const save = bs.find((b) => /^(Create job|Create|Save job)/i.test(b.innerText.trim()) && !b.disabled);
        if (save) { save.click(); return "save"; }
        const nx = bs.find((b) => /^Next/i.test(b.innerText.trim()) && !b.disabled);
        if (nx) { nx.click(); return "next"; }
        return "none";
      });
      await wait(400);
      if (pressed === "none") break;
    }
    const jb = jobsPosted[0] || {};
    t.ck("and saving it sends the appointment with the job", jb.fromAppointment === "ap_sat"
      && jb.trades?.join() === "roofing,gutters" && /Hal Stone/.test(jb.client || ""), JSON.stringify(jb).slice(0, 300));
    // Back to the section for the other two tabs.
    await page.evaluate(() => document.querySelector(".modal-backdrop")?.click());
    await wait(200);
    // Saving the job lands on Jobs; the switch takes it back to the CRM.
    if (!(await page.$("[data-crm-nav]"))) { await click(page, '[data-ws="crm"]'); await wait(300); }
    await click(page, '[data-crm-nav="appointments"]');
    for (let n = 0; n < 20; n++) { await wait(200); if (await page.$("[data-pipe]")) break; }
    const pipe = await page.evaluate(() => [...document.querySelectorAll("[data-pipe]")].map((b) => `${b.dataset.pipe}:${b.querySelector("b")?.innerText}`));
    t.ck("the pipeline counts each stage", pipe.includes("scheduled:1") && pipe.includes("confirmed:1") && pipe.length === 6, pipe.join());
    await click(page, '[data-crm-nav="followups"]');
    await wait(300);
    const mine = await page.$$eval("[data-fu]", (xs) => xs.map((x) => x.dataset.fu));
    t.ck("Follow-ups opens on the ones owed by me", mine.join() === "fu_1", mine.join());
    const late = await page.evaluate(() => document.querySelector('[data-fu="fu_1"] .crm-fu-state')?.innerText || "");
    t.ck("and an overdue one says so", /Overdue/.test(late), late);
    await click(page, '[data-whose="all"]');
    await wait(150);
    t.ck("everybody's shows the rest", (await page.$$("[data-fu]")).length === 2);
    await click(page, '[data-fu="fu_1"] [data-fu-done]');
    await wait(400);
    t.ck("Done ticks it off and it leaves the list", fuPatched.some((x) => x.id === "fu_1" && x.body.done === true)
      && (await page.$$("[data-fu]")).length === 1, JSON.stringify(fuPatched));
    await click(page, '[data-crm-nav="leads"]');
    await wait(300);
    const lpipe = await page.evaluate(() => [...document.querySelectorAll("[data-lead-stage]")].map((b) => `${b.dataset.leadStage}:${b.querySelector("b")?.innerText}`));
    t.ck("Leads counts each stage in the owner's words", lpipe.length === 5 && lpipe.includes("opportunity:2"), lpipe.join());
    await click(page, '[data-lead="ld_hal"]');
    await wait(300);
    const adm = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("[data-move]")].map((b) => [b.dataset.move, b.disabled])));
    t.ck("the office may move a lead to any stage", adm.customer === false && adm.former === false && adm.lead === false, JSON.stringify(adm));
    await click(page, '[data-move="former"]');
    await wait(300);
    t.ck("and the move is saved", leadsPatched.some((x) => x.id === "ld_hal" && x.body.stage === "former"));
    await click(page, '[data-lead-appt="ap_sat"]');
    await wait(300);
    t.ck("an appointment opens from its lead", !!(await page.$(".appt-detail, [data-appt-lead]")));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- a property manager --");
  {
    ACC = PM; SEAT = { userId: "u_admin", accountId: "acc_pm", role: "admin" };
    const { ctx, page, crashes } = await visitApp(browser, { host: "soundpm", webPort: WEB, seat: SEAT });
    for (let n = 0; n < 40; n++) { await wait(200); if ((await navLabels(page)).includes("Dashboard")) break; }
    const nav = await navLabels(page);
    t.ck("the screen opened", nav.includes("Dashboard"), nav.join(" | "));
    t.ck("and it has no CRM", !nav.includes("CRM / Sales") && !nav.includes("Leads") && !nav.includes("Appointments")
      && !(await page.$(".ws-switch")), nav.join(" | "));
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
