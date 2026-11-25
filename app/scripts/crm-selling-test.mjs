// 110. THE CRM'S SELLING HALF: deal values and lost reasons, the reports
// built on them, an unsubscribe link on every lead email and the office's Do
// not contact flag, email templates with follow-up sequences, and the website
// lead form.
//
// What is pinned:
//
//   A DEAL IS THE SALES SIDE'S, a lost reason is kept only while the estimate
//   is marked not sold, and a call-center seat cannot price one.
//
//   EVERY LEAD EMAIL SAYS HOW TO STOP, in words and a link, with
//   List-Unsubscribe headers. Pressing it stops email and the running
//   sequence; a yes to email given AFTER is them changing their mind.
//
//   DO NOT CONTACT stops email, texts, letters, outbound calls and sequences,
//   in the same request. Only the office takes it off, with a reason.
//
//   A SEQUENCE SENDS EACH STEP ONCE, and stops the moment they reply, buy,
//   unsubscribe or are marked Do not contact.
//
//   THE WEBSITE FORM answers the same for a new homeowner and a known one,
//   records the form's own consent, and tells the office.
//
//   node --no-warnings scripts/crm-selling-test.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeD1, makeR2, freshDb } from "./lib/d1-sqlite.mjs";
import { runCheck } from "./lib/check-sql.mjs";
import { salesReport, validDeal, dollarsToCents, optOutBlock, validSequence, fillTemplate, sequenceStop,
  unknownVars, unsubscribePathToken } from "../shared/crmsales.js";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker, crmSequenceSweep } = await import("../worker/index.js");
const SCHEMA = readFileSync(join(app, "worker", "schema.sql"), "utf8");

const sent = [];
globalThis.fetch = async (input, init = {}) => {
  const url = String(input?.url || input);
  if (url.includes("mail.test")) sent.push(JSON.parse(String(init.body || "{}")));
  return new Response(JSON.stringify({ id: "em_" + sent.length }), { headers: { "Content-Type": "application/json" } });
};

const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,kind,subdomain,plan) VALUES
      ('acc_gc','Outerhome','general_contractor','outerhome','scale'),
      ('acc_pm','Sound PM','property_manager','soundpm','scale');
    INSERT INTO users(id,name,email) VALUES
      ('u_admin','Richard Braun','rb@outerhome.test'),
      ('u_sm','Sam Seller','sam@outerhome.test'),
      ('u_cc','Cara Call','cara@outerhome.test');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES
      ('m_admin','u_admin','acc_gc','admin'),
      ('m_sm','u_sm','acc_gc','sales'),
      ('m_cc','u_cc','acc_gc','callcenter');
  `);
  return { db, env: { DB: makeD1(db), FILES: makeR2(), RESEND_API_KEY: "re_test", MAIL_FROM: "SubSub <hello@subsub.work>",
    RESEND_API_BASE: "https://mail.test", MESSAGE_REPLY_DOMAIN: "reply.subsub.work" } };
};
const call = (env, path, { method = "GET", body, who = "u_admin", acct = "acc_gc", ip = "1.1.1.1" } = {}) => worker.fetch(
  new Request(`https://api.subsub.work${path}`, {
    method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: { "Content-Type": "application/json", "X-User-Id": who, "X-Account-Id": acct, "CF-Connecting-IP": ip },
  }), env);
const pub = (env, path, { method = "GET", body, ip = "2.2.2.2" } = {}) => worker.fetch(
  new Request(`https://api.subsub.work${path}`, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip } }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];

const booking = (over = {}) => ({
  direction: "inbound", source: "Google", services: ["roofing"],
  details: { roofing: { material: "Asphalt shingle", age: "Over 20 years", leaks: "Yes", stories: "2" } },
  home: { owns: "Yes", timeline: "Within 3 months" },
  homeowner: { firstName: "Dana", lastName: "Ruiz", phone: "(253) 555-0142", email: "dana@home.test" },
  address: { street: "1204 N Pine St", city: "Tacoma", state: "WA", zip: "98406" },
  second: null, date: "2027-12-07", time: "10:00", minutes: 90, repId: "u_sm",
  consent: { email: true, phone: true, text: true, record: null }, ...over,
});

try {
  console.log("\n-- the rules --");
  ck("dollars become cents", dollarsToCents("$12,450.50") === 1245050 && dollarsToCents("") === null && dollarsToCents("abc") === undefined);
  ck("a negative or absurd figure is refused", validDeal({ amount: "-5" }).error === "bad_amount" && validDeal({ amount: "99999999999" }).error === "bad_amount");
  ck("a lost reason off the list is refused", validDeal({ lostReason: "mood" }).error === "bad_lost_reason");
  ck("a date that is not a day is refused", validDeal({ expectedClose: "2027-02-31" }).error === "bad_date");
  ck("do not contact stops a text and a letter", optOutBlock("text", { optOut: { dncAt: "x" } }) === "do_not_contact"
    && optOutBlock("mail", { optOut: { dncAt: "x" } }) === "do_not_contact");
  ck("but not a call they made", optOutBlock("call_in", { optOut: { dncAt: "x" } }) === null);
  ck("unsubscribed stops email", optOutBlock("email", { optOut: { unsubscribedAt: "2027-01-02T00:00:00Z" },
    consent: { email: true, capturedAt: "2027-01-01T00:00:00Z" } }) === "unsubscribed");
  ck("until they say yes to email again, after it", optOutBlock("email", { optOut: { unsubscribedAt: "2027-01-02T00:00:00Z" },
    consent: { email: true, capturedAt: "2027-01-03T00:00:00Z" } }) === null);
  ck("and it never stops a text", optOutBlock("text", { optOut: { unsubscribedAt: "x" } }) === null);
  ck("a template names only values it has", unknownVars("Hi {{firstName}} {{bogus}}").join() === "bogus");
  ck("a filled template leaves no hole", fillTemplate("Hi {{firstName}}, from {{accountName}}", { accountName: "Outerhome" }) === "Hi, from Outerhome");
  ck("sequence steps go forward in time", validSequence({ name: "x", steps: [{ day: 3, templateId: "std:thanks" }, { day: 1, templateId: "std:checkin" }] }).error === "days_out_of_order");
  ck("and name a template that exists", validSequence({ name: "x", steps: [{ day: 0, templateId: "nope" }] }).error === "bad_template");
  ck("a reply stops a sequence", sequenceStop({ lead: { stage: "lead", email: "a@b.c" }, consent: { email: true }, repliedSince: true }) === "replied");
  ck("and so does a booking, when it started before one", sequenceStop({ lead: { stage: "opportunity", email: "a@b.c" }, consent: { email: true },
    startStage: "lead" }) === "booked");
  ck("but not one that started as an opportunity", sequenceStop({ lead: { stage: "opportunity", email: "a@b.c" }, consent: { email: true },
    startStage: "opportunity" }) === null);
  ck("the unsubscribe path is read", unsubscribePathToken(`/unsubscribe/${"a".repeat(24)}`) === "a".repeat(24) && unsubscribePathToken("/unsubscribe/x") === null);
  {
    const appts = [
      { id: "a1", status: "sold", repId: "r1", repName: "Sam", createdAt: "2027-11-01 10:00:00", statusAt: "2027-11-11 10:00:00", deal: { amountCents: 2000000 } },
      { id: "a2", status: "lost", repId: "r1", repName: "Sam", createdAt: "2027-11-02", statusAt: "2027-11-12", deal: { lostReason: "price" } },
      { id: "a3", status: "lost", repId: "r2", repName: "Tia", createdAt: "2027-11-02", statusAt: "2027-11-12", deal: null },
      { id: "a4", status: "scheduled", repId: "r2", repName: "Tia", createdAt: "2027-11-20", deal: { amountCents: 1500000, expectedClose: "2027-11-30" } },
      { id: "a5", status: "scheduled", repId: "r2", repName: "Tia", createdAt: "2027-11-20", deal: null },
      { id: "a6", status: "cancelled", repId: "r2", createdAt: "2027-11-20", deal: { amountCents: 9900000 } },
    ];
    const leads = [
      { id: "l1", source: "website", createdAt: "2027-10-30", appointments: [{ id: "a1", status: "sold" }, { id: "a2", status: "lost" }] },
      { id: "l2", source: "referral", createdAt: "2027-11-01", appointments: [{ id: "a3", status: "lost" }, { id: "a4", status: "scheduled" }] },
      { id: "l3", source: "website", createdAt: "2027-11-15", appointments: [] },
    ];
    const r = salesReport({ leads, appointments: appts, today: "2027-11-25" });
    ck("the pipeline is what is open, a canceled estimate left out", r.pipeline.valueCents === 1500000 && r.pipeline.open === 2, JSON.stringify(r.pipeline));
    ck("and an unpriced estimate is counted, not valued at nothing quietly", r.pipeline.unpriced === 1);
    ck("the close rate is sold over sold and lost", r.totals.closeRate === 33, String(r.totals.closeRate));
    ck("a lost estimate with no reason is its own row", r.lostReasons.find((x) => x.id === "none")?.n === 1 && r.lostReasons.find((x) => x.id === "price")?.n === 1);
    const web = r.bySource.find((s) => s.id === "website");
    ck("by source: leads, booked and sold", web.leads === 2 && web.booked === 1 && web.sold === 1 && web.soldCents === 2000000, JSON.stringify(web));
    const sam = r.byRep.find((x) => x.id === "r1");
    ck("by sales manager", sam.sold === 1 && sam.lost === 1 && sam.closeRate === 50 && sam.soldCents === 2000000, JSON.stringify(sam));
    ck("sold per month, by the day it was marked sold", r.byMonth.find((m) => m.month === "2027-11").soldCents === 2000000);
    ck("booking to sale, in days", r.timing.bookedToSoldDays === 10, JSON.stringify(r.timing));
  }

  console.log("\n-- a deal on an estimate --");
  const { db, env } = seed();
  let [st, b] = await json(await call(env, "/api/appointments", { method: "POST", body: booking() }));
  const appt = b.appointment?.id;
  const lead = b.lead?.leadId;
  ck("an estimate is booked", st === 201 && !!lead, JSON.stringify(b).slice(0, 200));
  [st, b] = await json(await call(env, `/api/appointments/${appt}`, { method: "PATCH", who: "u_cc", body: { deal: { amount: "15000" } } }));
  ck("the call center cannot price one", st === 403 && b.error === "sales_only", JSON.stringify(b));
  [st, b] = await json(await call(env, `/api/appointments/${appt}`, { method: "PATCH", who: "u_sm",
    body: { deal: { amount: "18,450", expectedClose: "2027-12-20" } } }));
  ck("the sales manager prices their own", st === 200 && b.appointment.deal?.amountCents === 1845000 && b.appointment.deal.expectedClose === "2027-12-20", JSON.stringify(b.appointment?.deal));
  [st, b] = await json(await call(env, `/api/appointments/${appt}`, { method: "PATCH", who: "u_sm",
    body: { status: "lost", deal: { lostReason: "competitor", lostNote: "Went with ABC Roofing" } } }));
  ck("marked not sold, with why", st === 200 && b.appointment.deal?.lostReason === "competitor" && b.appointment.deal.amountCents === 1845000, JSON.stringify(b.appointment?.deal));
  [st, b] = await json(await call(env, `/api/appointments/${appt}`, { method: "PATCH", who: "u_sm", body: { status: "sold" } }));
  ck("and marked sold after, the lost reason goes", st === 200 && b.appointment.deal?.lostReason === null && b.appointment.deal.amountCents === 1845000, JSON.stringify(b.appointment?.deal));
  [st, b] = await json(await call(env, `/api/appointments/${appt}`, { method: "PATCH", who: "u_sm", body: { deal: { amount: "nope" } } }));
  ck("a bad figure is refused, naming the field", st === 400 && b.field === "deal.amount");
  [st, b] = await json(await call(env, "/api/appointments"));
  ck("the list carries each deal", b.appointments[0].deal?.amountCents === 1845000 && b.dealsReady === true);
  ck("the invariant reads zero", runCheck(db).m110_inv_bad_deal === 0);
  db.exec(`UPDATE sales_deals SET lost_reason = 'price'`);
  ck("and counts a lost reason on a sold estimate", runCheck(db).m110_inv_bad_deal === 1);
  db.exec(`UPDATE sales_deals SET lost_reason = NULL`);

  console.log("\n-- unsubscribe --");
  sent.length = 0;
  [st, b] = await json(await call(env, `/api/sales-leads/${lead}/messages`, { method: "POST", who: "u_sm",
    body: { channel: "email", subject: "Your roof", body: "Hi Dana" } }));
  const em = sent[0] || {};
  ck("a lead email goes", st === 201 && b.sent?.ok, JSON.stringify(b));
  const link = (String(em.text || "").match(/https:\/\/app\.subsub\.work\/unsubscribe\/([a-z0-9]{24})/) || [])[1];
  ck("and says how to stop, with a link", !!link && /Don't want these emails\? Unsubscribe/.test(em.text), em.text);
  ck("and List-Unsubscribe headers, one click", /\/api\/public\/unsubscribe\//.test(em.headers?.["List-Unsubscribe"] || "")
    && em.headers?.["List-Unsubscribe-Post"] === "List-Unsubscribe=One-Click", JSON.stringify(em.headers));
  sent.length = 0;
  await call(env, `/api/sales-leads/${lead}/messages`, { method: "POST", who: "u_sm", body: { channel: "email", subject: "Again", body: "x" } });
  ck("the same link on every email to them", (String(sent[0]?.text).match(/unsubscribe\/([a-z0-9]{24})/) || [])[1] === link);
  [st, b] = await json(await pub(env, `/api/public/unsubscribe/${link}`));
  ck("the page says whose emails they are", st === 200 && b.accountName === "Outerhome" && b.unsubscribed === false, JSON.stringify(b));
  [st] = await json(await pub(env, `/api/public/unsubscribe/${"z".repeat(24)}`));
  ck("an unknown token is not found", st === 404);
  [st, b] = await json(await pub(env, `/api/public/unsubscribe/${link}`, { method: "POST" }));
  ck("pressing it unsubscribes them", st === 200 && b.unsubscribed === true);
  [st, b] = await json(await call(env, `/api/sales-leads/${lead}/messages`, { method: "POST", who: "u_sm",
    body: { channel: "email", subject: "Hi", body: "x" } }));
  ck("and the next email is refused by name", st === 409 && b.error === "unsubscribed", JSON.stringify(b));
  [st, b] = await json(await call(env, `/api/sales-leads/${lead}/messages`, { who: "u_sm" }));
  ck("the conversation says so", b.blocks.email === "unsubscribed" && !!b.optOut?.unsubscribedAt);
  [st, b] = await json(await call(env, `/api/sales-leads/${lead}/messages`, { method: "POST", who: "u_sm",
    body: { channel: "text", body: "Hi" } }));
  ck("a text still opens, because unsubscribing is from email", st === 201, JSON.stringify(b));
  await new Promise((r) => setTimeout(r, 5));
  [st] = await json(await call(env, `/api/sales-leads/${lead}/consent`, { method: "PUT", who: "u_sm",
    body: { consent: { email: true, phone: true, text: true } } }));
  [st, b] = await json(await call(env, `/api/sales-leads/${lead}/messages`, { method: "POST", who: "u_sm",
    body: { channel: "email", subject: "Hi", body: "x" } }));
  ck("a yes to email after it is them changing their mind", st === 201, JSON.stringify(b));

  console.log("\n-- do not contact --");
  [st, b] = await json(await call(env, `/api/sales-leads/${lead}/do-not-contact`, { method: "PUT", who: "u_cc", body: { on: true, reason: "Asked us to stop calling" } }));
  ck("anybody on the CRM can mark it", st === 200 && !!b.optOut?.dncAt, JSON.stringify(b));
  for (const [ch, body] of [["email", { subject: "x", body: "x" }], ["text", { body: "x" }], ["mail", { body: "x" }],
    ["call", { direction: "outbound", outcome: "No answer" }]]) {
    [st, b] = await json(await call(env, `/api/sales-leads/${lead}/messages`, { method: "POST", who: "u_sm", body: { channel: ch, ...body } }));
    ck(`it refuses ${ch === "call" ? "an outbound call" : ch}`, st === 409 && b.error === "do_not_contact", JSON.stringify(b));
  }
  [st] = await json(await call(env, `/api/sales-leads/${lead}/messages`, { method: "POST", who: "u_sm",
    body: { channel: "call", direction: "inbound", outcome: "Reached them" } }));
  ck("a call they made is still logged", st === 201);
  [st, b] = await json(await call(env, `/api/sales-leads/${lead}/do-not-contact`, { method: "PUT", who: "u_sm", body: { on: false, reason: "x" } }));
  ck("only the office takes it off", st === 403 && b.error === "office_only");
  [st, b] = await json(await call(env, `/api/sales-leads/${lead}/do-not-contact`, { method: "PUT", body: { on: false } }));
  ck("and says why", st === 400 && b.error === "reason_required");
  [st, b] = await json(await call(env, `/api/sales-leads/${lead}/do-not-contact`, { method: "PUT", body: { on: false, reason: "They called back and asked" } }));
  ck("the office takes it off", st === 200 && !b.optOut.dncAt);

  console.log("\n-- templates and sequences --");
  [st, b] = await json(await call(env, "/api/crm-library", { who: "u_sm" }));
  ck("every account has the starters", st === 200 && b.templates.filter((t) => t.builtin).length >= 3, JSON.stringify(b).slice(0, 200));
  [st, b] = await json(await call(env, "/api/crm-templates", { method: "POST", who: "u_sm", body: { name: "x", subject: "x", body: "x" } }));
  ck("a sales manager cannot write the account's templates", st === 403);
  [st, b] = await json(await call(env, "/api/crm-templates", { method: "POST", body: { name: "Metal roof", subject: "Metal, {{firstName}}", body: "Hi {{firsName}}" } }));
  ck("a placeholder that does not exist is refused by name", st === 400 && b.error === "unknown_placeholder" && b.field === "firsName", JSON.stringify(b));
  [st, b] = await json(await call(env, "/api/crm-templates", { method: "POST", body: { name: "Metal roof", subject: "Metal, {{firstName}}", body: "Hi {{firstName}}, about {{services}} in {{city}}." } }));
  const tpl = b.template?.id;
  ck("the office adds one", st === 201 && !!tpl);
  [st, b] = await json(await call(env, "/api/crm-sequences", { method: "POST",
    body: { name: "After the estimate", steps: [{ day: 0, templateId: tpl }, { day: 3, templateId: "std:checkin" }] } }));
  const seq = b.sequence?.id;
  ck("and a sequence of two", st === 201 && b.sequence.steps.length === 2, JSON.stringify(b));
  [st, b] = await json(await call(env, `/api/crm-templates/${tpl}`, { method: "DELETE" }));
  ck("a template a sequence sends cannot be deleted", st === 409 && b.error === "template_in_use" && b.sequences[0] === "After the estimate");
  [st, b] = await json(await call(env, `/api/crm-templates/std:thanks`, { method: "DELETE" }));
  ck("nor can a starter", st === 409 && b.error === "builtin_read_only");

  [st, b] = await json(await call(env, `/api/sales-leads/${lead}/sequence`, { method: "POST", who: "u_sm", body: { sequenceId: seq } }));
  ck("a customer is not put on a selling sequence", st === 409 && b.error === "bought", JSON.stringify(b));
  // A second homeowner, still a prospect, for the rest of the section.
  [st, b] = await json(await call(env, "/api/sales-leads", { method: "POST", who: "u_sm",
    body: { firstName: "Dana", lastName: "Ruiz", phone: "2535550143", email: "dana2@home.test", stage: "prospect",
      services: ["roofing"], address: { street: "1 Elm", city: "Tacoma", state: "WA", zip: "98406" } } }));
  const lead2 = b.lead?.id;
  ck("a prospect is added", st === 201 && !!lead2, JSON.stringify(b));
  [st, b] = await json(await call(env, `/api/sales-leads/${lead2}/sequence`, { method: "POST", who: "u_sm", body: { sequenceId: seq } }));
  ck("one with no yes to email is refused", st === 409 && b.error === "no_email_consent", JSON.stringify(b));
  await call(env, `/api/sales-leads/${lead2}/consent`, { method: "PUT", who: "u_sm", body: { consent: { email: true, phone: true, text: false } } });
  [st, b] = await json(await call(env, `/api/sales-leads/${lead2}/sequence`, { method: "POST", who: "u_cc", body: { sequenceId: seq } }));
  ck("the call center does not put leads on sequences", st === 403);
  [st, b] = await json(await call(env, `/api/sales-leads/${lead2}/sequence`, { method: "POST", who: "u_sm", body: { sequenceId: seq } }));
  ck("a sales manager puts their lead on it", st === 201 && b.enrollment?.status === "active", JSON.stringify(b));
  [st, b] = await json(await call(env, `/api/sales-leads/${lead2}/sequence`, { method: "POST", who: "u_sm", body: { sequenceId: seq } }));
  ck("once", st === 409 && b.error === "already_on_sequence");
  sent.length = 0;
  const t0 = Date.now() + 60_000;
  let out = await crmSequenceSweep(env, t0);
  ck("the sweep sends the first step", out.sent === 1 && sent.length === 1, JSON.stringify(out));
  ck("filled in for them, with the unsubscribe link", /Hi Dana, about Roof replacement in Tacoma\./.test(sent[0]?.text || "")
    && /unsubscribe\//.test(sent[0]?.text || ""), sent[0]?.text);
  out = await crmSequenceSweep(env, t0);
  ck("and never twice", out.sent === 0 && sent.length === 1, JSON.stringify(out));
  out = await crmSequenceSweep(env, t0 + 4 * 86400000);
  ck("the next step goes on its day", out.sent === 1 && sent.length === 2);
  ck("and the sequence is done", db.prepare(`SELECT status FROM crm_enrollments`).get().status === "done");

  db.exec(`DELETE FROM crm_enrollments`);
  await call(env, `/api/sales-leads/${lead2}/sequence`, { method: "POST", who: "u_sm", body: { sequenceId: seq } });
  db.prepare(`INSERT INTO lead_messages (id, account_id, lead_id, channel, direction, body, status, created_at)
    VALUES ('rep1', 'acc_gc', ?, 'email', 'inbound', 'Call me', 'received', ?)`).run(lead2, new Date(Date.now() + 1000).toISOString());
  sent.length = 0;
  out = await crmSequenceSweep(env, Date.now() + 60_000);
  ck("a reply stops it before the next email", out.sent === 0 && out.stopped === 1
    && db.prepare(`SELECT stopped_reason FROM crm_enrollments WHERE status = 'stopped'`).get()?.stopped_reason === "replied", JSON.stringify(out));
  db.exec(`DELETE FROM crm_enrollments; DELETE FROM lead_messages WHERE id = 'rep1'`);
  await call(env, `/api/sales-leads/${lead2}/sequence`, { method: "POST", who: "u_sm", body: { sequenceId: seq } });
  await call(env, `/api/sales-leads/${lead2}/do-not-contact`, { method: "PUT", who: "u_sm", body: { on: true } });
  ck("Do not contact stops it in the same request",
    db.prepare(`SELECT status, stopped_reason FROM crm_enrollments`).get()?.stopped_reason === "do_not_contact");
  ck("so the invariant reads zero", runCheck(db).m110_inv_sequence_opted_out === 0);
  db.exec(`UPDATE crm_enrollments SET status = 'active'`);
  ck("and counts one left running", runCheck(db).m110_inv_sequence_opted_out === 1);
  db.exec(`UPDATE crm_enrollments SET status = 'stopped'`);
  [st, b] = await json(await call(env, `/api/sales-leads/${lead2}/sequence`, { method: "POST", who: "u_sm", body: { sequenceId: seq } }));
  ck("and a lead marked so cannot be put back on one", st === 409 && b.error === "do_not_contact");

  console.log("\n-- the website lead form --");
  sent.length = 0;
  const form = { firstName: "Lee", lastName: "Park", phone: "253-555-0177", email: "lee@home.test", street: "9 Oak Ave", city: "Tacoma",
    state: "WA", zip: "98405", services: ["siding"], message: "Siding is cracking on the north wall.",
    consentEmail: true, consentPhone: false, consentText: true };
  [st, b] = await json(await pub(env, "/api/public/lead/outerhome", { method: "POST", body: form, ip: "9.9.9.1" }));
  ck("a homeowner's form lands", st === 200 && b.ok === true, JSON.stringify(b));
  const webLead = db.prepare(`SELECT * FROM sales_leads WHERE phone = '2535550177'`).get();
  ck("as a lead from the website", webLead?.stage === "lead" && webLead.source === "website" && JSON.parse(webLead.services)[0] === "siding");
  const cs = db.prepare(`SELECT * FROM sales_lead_consents WHERE lead_id = ?`).get(webLead?.id);
  ck("with the form's own consent, an unticked box a no", cs?.email === 1 && cs.phone === 0 && cs.text === 1 && /^web-/.test(cs.script_version), JSON.stringify(cs));
  ck("and what they wrote waits in the Inbox, unread", db.prepare(`SELECT direction, read_at, body FROM lead_messages WHERE lead_id = ?`).get(webLead?.id)?.body
    === "Siding is cracking on the north wall.");
  ck("the office is told", sent.some((m) => /New website lead: Lee Park/.test(m.subject) && [].concat(m.to).includes("rb@outerhome.test")),
    JSON.stringify(sent.map((m) => [m.to, m.subject])));
  ck("and a sales manager or the call center is not", !sent.some((m) => [].concat(m.to).some((t) => /sam@|cara@/.test(t))));
  const first = b;
  [st, b] = await json(await pub(env, "/api/public/lead/outerhome", { method: "POST", body: form, ip: "9.9.9.2" }));
  ck("asking again answers the same", st === 200 && JSON.stringify(b) === JSON.stringify(first));
  ck("and makes no second lead", db.prepare(`SELECT COUNT(*) AS n FROM sales_leads WHERE phone = '2535550177'`).get().n === 1);
  [st, b] = await json(await pub(env, "/api/public/lead/outerhome", { method: "POST", body: { ...form, phone: "2535550188", email: "", website: "spam.biz" }, ip: "9.9.9.3" }));
  ck("a filled-in hidden box is told it worked, and saves nothing", st === 200 && b.ok
    && db.prepare(`SELECT COUNT(*) AS n FROM sales_leads WHERE phone = '2535550188'`).get().n === 0);
  [st, b] = await json(await pub(env, "/api/public/lead/outerhome", { method: "POST", body: { firstName: "No", phone: "", email: "" }, ip: "9.9.9.4" }));
  ck("a form with no way to reach them is refused", st === 400 && b.error === "contact_required");
  [st] = await json(await pub(env, "/api/public/lead/soundpm", { method: "POST", body: form, ip: "9.9.9.5" }));
  ck("an account that does not sell to homeowners has no form", st === 404);
} catch (err) {
  console.error(err);
  fail++;
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
