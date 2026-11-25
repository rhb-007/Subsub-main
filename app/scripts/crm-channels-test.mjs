// 111. TEXT AND LETTER TEMPLATES, STARTER SEQUENCES FOR EACH CHANNEL,
// FOLLOW-UPS ON A LEAD, AND THE WEBSITE FORM'S ONE CONSENT BOX.
//
// What is pinned:
//
//   A TEMPLATE IS FOR ONE CHANNEL. An email needs a subject, a text and a
//   letter do not; a text is short; the channel is fixed once made. Without
//   111 an email template still saves and a text one names the migration.
//
//   A STARTER SEQUENCE IS MADE THE ACCOUNT'S OWN ONCE, whether from Setup or
//   by putting a lead on it, so an enrollment points at a real row.
//
//   A TEXT OR LETTER STEP BECOMES A FOLLOW-UP for whoever owns the lead, due
//   that day, with the words filled in, and only for somebody who agreed to
//   texts (or has an address). An email step is still sent.
//
//   A FOLLOW-UP CAN HANG OFF A LEAD with no estimate, by the consent on the
//   lead, is listed with the others, ticked done on the lead, and is in the
//   nightly digest.
//
//   THE WEBSITE FORM'S ONE BOX is a yes or a no to all three; an old pasted
//   form's three boxes still read; a trade the call script does not know is
//   named in the note.
//
//   node --no-warnings scripts/crm-channels-test.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeD1, makeR2, freshDb } from "./lib/d1-sqlite.mjs";
import { runCheck } from "./lib/check-sql.mjs";
import { validTemplate, BUILTIN_TEMPLATES, BUILTIN_SEQUENCES, sequenceStepBlock, webConsent, webConsentText,
  validSequence, starterSequenceId } from "../shared/crmsales.js";
import { leadFormHtml } from "../shared/embed.js";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker, crmSequenceSweep, salesCrmSweep } = await import("../worker/index.js");
const SCHEMA = readFileSync(join(app, "worker", "schema.sql"), "utf8");

const sent = [];
globalThis.fetch = async (input, init = {}) => {
  const url = String(input?.url || input);
  if (url.includes("mail.test")) sent.push(JSON.parse(String(init.body || "{}")));
  return new Response(JSON.stringify({ id: "em_" + sent.length }), { headers: { "Content-Type": "application/json" } });
};

const seed = (schema = SCHEMA) => {
  const db = freshDb({ base: schema, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,kind,subdomain,plan) VALUES ('acc_gc','Outerhome','general_contractor','outerhome','scale');
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
const call = (env, path, { method = "GET", body, who = "u_admin", ip = "1.1.1.1" } = {}) => worker.fetch(
  new Request(`https://api.subsub.work${path}`, {
    method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: { "Content-Type": "application/json", "X-User-Id": who, "X-Account-Id": "acc_gc", "CF-Connecting-IP": ip },
  }), env);
const pub = (env, path, { method = "GET", body, ip = "2.2.2.2" } = {}) => worker.fetch(
  new Request(`https://api.subsub.work${path}`, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip } }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];
const addLead = async (env, over = {}) => {
  const [st, b] = await json(await call(env, "/api/sales-leads", { method: "POST", who: "u_sm",
    body: { firstName: "Dana", lastName: "Ruiz", phone: "2535550142", email: "dana@home.test", stage: "prospect", services: ["roofing"],
      address: { street: "1204 N Pine St", city: "Tacoma", state: "WA", zip: "98406" }, ownerId: "u_sm", ...over } }));
  if (st !== 201) throw new Error(`lead not added: ${st} ${JSON.stringify(b)}`);
  return b.lead.id;
};

try {
  console.log("\n-- the rules --");
  ck("a starter of every channel ships", ["email", "text", "mail"].every((ch) => BUILTIN_TEMPLATES.some((t) => t.channel === ch)));
  ck("ten more emails than there were", BUILTIN_TEMPLATES.filter((t) => t.channel === "email").length >= 14);
  ck("every starter names only values a template has", BUILTIN_TEMPLATES.every((t) => validTemplate(t).ok),
    BUILTIN_TEMPLATES.filter((t) => !validTemplate(t).ok).map((t) => `${t.id}:${validTemplate(t).error}`).join());
  ck("a starter sequence for each channel, every step a real template", ["email", "text", "mail"].every((ch) => BUILTIN_SEQUENCES.some((s) => s.channel === ch))
    && BUILTIN_SEQUENCES.every((s) => validSequence(s).ok));
  ck("and each starter's steps are on its own channel", BUILTIN_SEQUENCES.every((s) =>
    s.steps.every((st) => BUILTIN_TEMPLATES.find((t) => t.id === st.templateId).channel === s.channel)));
  ck("an email needs a subject", validTemplate({ name: "x", body: "y" }).error === "subject_required");
  ck("a text does not, and loses one sent", validTemplate({ channel: "text", name: "x", subject: "s", body: "y" }).value?.subject === "");
  ck("a text is short", validTemplate({ channel: "text", name: "x", body: "y".repeat(481) }).error === "text_too_long");
  ck("a channel that is not one is refused", validTemplate({ channel: "fax", name: "x", body: "y" }).error === "bad_channel");
  ck("no channel is an email, as before 111", validTemplate({ name: "x", subject: "s", body: "y" }).value?.channel === "email");
  ck("a text step needs a yes to texts", sequenceStepBlock("text", { lead: { phone: "2535550142" }, consent: { text: false } }) === "no_text_consent"
    && sequenceStepBlock("text", { lead: { phone: "2535550142" }, consent: { text: true } }) === null);
  ck("and a mobile", sequenceStepBlock("text", { lead: { phone: "" }, consent: { text: true } }) === "no_phone");
  ck("a letter step needs a whole address", sequenceStepBlock("mail", { lead: { address: { street: "1", city: "T", state: "WA" } } }) === "no_address");
  ck("one box is a yes to all three", JSON.stringify(webConsent({ consent: true })).includes('"email":true,"phone":true,"text":true'));
  ck("and unticked a no to all three", Object.values(webConsent({ consent: false })).filter((v) => v === true).length === 0);
  ck("an old pasted form's three boxes still read", webConsent({ consentEmail: true, consentText: false }).email === true
    && webConsent({ consentEmail: true }).version !== webConsent({ consent: true }).version);
  const stmt = webConsentText("Outerhome");
  ck("the statement covers calls, texts and email, and says how to stop", /call, text and email/.test(stmt) && /STOP/.test(stmt)
    && /not a condition of purchase/.test(stmt) && /Msg & data rates/.test(stmt));
  const html = leadFormHtml({ subdomain: "outerhome", accountName: "Outerhome", services: ["plumbing", "roofing", "nope"] });
  ck("the form offers the trades picked, and nothing that is not one", /value="plumbing"/.test(html) && /value="roofing"/.test(html)
    && !/value="nope"/.test(html) && !/value="siding"/.test(html));
  ck("with one consent box, unticked", (html.match(/name="consent/g) || []).length === 1 && /name="consent">/.test(html));
  ck("nothing picked is the four the form always had", /value="windows_doors"/.test(leadFormHtml({ subdomain: "x", accountName: "x", services: [] })));

  console.log("\n-- templates by channel --");
  let { db, env } = seed();
  let [st, b] = await json(await call(env, "/api/crm-templates", { method: "POST", body: { channel: "text", name: "Quick hello", body: "Hi {{firstName}}" } }));
  ck("a text template is saved", st === 201 && b.template?.channel === "text" && b.template.subject === "", JSON.stringify(b));
  const textTpl = b.template?.id;
  [st, b] = await json(await call(env, `/api/crm-templates/${textTpl}`, { method: "PATCH", body: { channel: "email", subject: "x" } }));
  ck("its channel is fixed", st === 409 && b.error === "channel_fixed", JSON.stringify(b));
  [st, b] = await json(await call(env, "/api/crm-library"));
  ck("the library carries each template's channel", b.templates?.find((t) => t.id === textTpl)?.channel === "text"
    && b.templates?.find((t) => t.id === "std:thanks")?.channel === "email");
  ck("and the starter sequences, not yet the account's", BUILTIN_SEQUENCES.every((x) => b.sequences?.some((s) => s.id === x.id && s.starter)));
  [st, b] = await json(await call(env, "/api/crm-sequences", { method: "POST", body: { starterId: "std:seq-text" } }));
  const ownText = starterSequenceId("acc_gc", "std:seq-text");
  ck("Use this makes the account's copy", st === 201 && b.sequence?.id === ownText, JSON.stringify(b));
  await call(env, "/api/crm-sequences", { method: "POST", body: { starterId: "std:seq-text" } });
  ck("once", db.prepare(`SELECT COUNT(*) n FROM crm_sequences WHERE id = ?`).get(ownText).n === 1);
  [st, b] = await json(await call(env, "/api/crm-library"));
  ck("and the starter stops being offered beside it", !b.sequences.some((s) => s.id === "std:seq-text")
    && b.sequences.find((s) => s.id === ownText)?.starterOf === "std:seq-text");
  [st, b] = await json(await call(env, "/api/crm-sequences", { method: "POST", who: "u_sm", body: { starterId: "std:seq-mail" } }));
  ck("a sales manager does not make sequences", st === 403, JSON.stringify(b));

  console.log("\n-- a text sequence --");
  const lead = await addLead(env);
  [st, b] = await json(await call(env, `/api/sales-leads/${lead}/sequence`, { method: "POST", who: "u_sm", body: { sequenceId: "std:seq-mail" } }));
  ck("putting a lead on a starter makes it the account's own", st === 201
    && db.prepare(`SELECT sequence_id FROM crm_enrollments WHERE lead_id = ?`).get(lead)?.sequence_id === starterSequenceId("acc_gc", "std:seq-mail"), JSON.stringify(b));
  db.exec(`DELETE FROM crm_enrollments`);
  [st, b] = await json(await call(env, `/api/sales-leads/${lead}/sequence`, { method: "POST", who: "u_sm", body: { sequenceId: ownText } }));
  ck("a text sequence is refused for somebody with no yes to texts", st === 409 && b.error === "no_text_consent", JSON.stringify(b));
  await call(env, `/api/sales-leads/${lead}/consent`, { method: "PUT", who: "u_sm", body: { consent: { email: true, phone: true, text: true } } });
  [st, b] = await json(await call(env, `/api/sales-leads/${lead}/sequence`, { method: "POST", who: "u_sm", body: { sequenceId: ownText } }));
  ck("and allowed once they say yes", st === 201, JSON.stringify(b));
  sent.length = 0;
  const t0 = Date.now() + 60_000;
  let out = await crmSequenceSweep(env, t0);
  const fu = db.prepare(`SELECT * FROM lead_followups WHERE lead_id = ?`).get(lead);
  ck("the step is a follow-up, not a send", out.queued === 1 && !out.sent && sent.length === 0 && !!fu, JSON.stringify(out));
  ck("for whoever owns the lead, due today, by text", fu?.assignee_id === "u_sm" && fu?.channel === "text"
    && fu?.due_date === new Date(t0).toISOString().slice(0, 10) && !!fu?.enrollment_id);
  ck("with the words filled in for them", /^Text them: After the visit/.test(fu?.body || "") && /Hi Dana, thanks for having us out/.test(fu?.body || ""), fu?.body);
  out = await crmSequenceSweep(env, t0);
  ck("and never twice", !out.queued && db.prepare(`SELECT COUNT(*) n FROM lead_followups`).get().n === 1);

  console.log("\n-- follow-ups on a lead --");
  const lead2 = await addLead(env, { firstName: "Lee", lastName: "Park", phone: "2535550199", email: "lee@home.test" });
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  [st, b] = await json(await call(env, `/api/sales-leads/${lead2}/follow-ups`, { method: "POST", who: "u_cc",
    body: { body: "Call back about gutters", dueDate: tomorrow, channel: "call" } }));
  ck("a call follow-up needs their yes to calls", st === 400 && b.error === "no_channel_consent" && b.channel === "call", JSON.stringify(b));
  [st, b] = await json(await call(env, `/api/sales-leads/${lead2}/follow-ups`, { method: "POST", who: "u_cc",
    body: { body: "Drop off a brochure", dueDate: tomorrow, channel: "mail", assigneeId: "u_sm" } }));
  ck("a letter needs none, and the call center can add one", st === 201 && b.followUp?.leadId === lead2 && b.followUp.appointmentId === null, JSON.stringify(b));
  const fid = b.followUp?.id;
  ck("whoever it is handed to is emailed", sent.some((m) => [m.to].flat().includes("sam@outerhome.test")), JSON.stringify(sent.map((m) => m.to)));
  [st, b] = await json(await call(env, `/api/sales-leads/${lead2}/follow-ups`, { method: "POST", who: "u_cc",
    body: { body: "x", dueDate: "2027-02-31", channel: "visit" } }));
  ck("a day that is not a day is refused", st === 400 && b.error === "due_required");
  [st, b] = await json(await call(env, "/api/sales-followups", { who: "u_sm" }));
  ck("it is listed beside the others, with who it is about", b.followUps?.some((x) => x.id === fid && x.who === "Lee Park"), JSON.stringify(b));
  db.exec(`INSERT INTO users(id,name,email) VALUES ('u_sm2','Other Seller','o@outerhome.test');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES ('m_sm2','u_sm2','acc_gc','sales')`);
  [st, b] = await json(await call(env, "/api/sales-followups", { who: "u_sm2" }));
  ck("but not to a sales manager it is nothing to do with", !b.followUps?.some((x) => x.id === fid), JSON.stringify(b.followUps?.map((x) => x.id)));
  [st, b] = await json(await call(env, `/api/sales-leads/${lead2}/follow-ups/${fid}`, { method: "PATCH", who: "u_sm2", body: { done: true } }));
  ck("nor ticked by them", st === 404);
  sent.length = 0;
  const digest = await salesCrmSweep(env, Date.now() + 2 * 86400000);
  ck("a lead follow-up is in the nightly digest", digest.followUps >= 1 && sent.some((m) => /Drop off a brochure/.test(m.text || "")), JSON.stringify(digest));
  ck("once", db.prepare(`SELECT reminded_at FROM lead_followups WHERE id = ?`).get(fid)?.reminded_at != null);
  [st, b] = await json(await call(env, `/api/sales-leads/${lead2}/follow-ups/${fid}`, { method: "PATCH", who: "u_sm", body: { done: true } }));
  ck("ticked done on the lead", st === 200 && !!b.followUp?.doneAt);
  [st, b] = await json(await call(env, "/api/sales-followups", { who: "u_sm" }));
  ck("and then off the list", !b.followUps?.some((x) => x.id === fid));
  await call(env, `/api/sales-leads/${lead2}/do-not-contact`, { method: "PUT", who: "u_sm", body: { on: true } });
  [st, b] = await json(await call(env, `/api/sales-leads/${lead2}/follow-ups`, { method: "POST", who: "u_sm",
    body: { body: "Mail a flyer", dueDate: tomorrow, channel: "mail" } }));
  ck("Do not contact closes planning to contact them", st === 409 && b.error === "do_not_contact", JSON.stringify(b));
  ck("the invariant reads zero", runCheck(db).m111_inv_bad_lead_followup === 0);
  db.exec(`INSERT INTO lead_followups (id, account_id, lead_id, body, channel, due_date, created_at) VALUES ('bad', 'acc_gc', '${lead2}', 'x', 'fax', '2027-01-01', 'now')`);
  ck("and one a screen cannot draw reads one", runCheck(db).m111_inv_bad_lead_followup === 1);

  console.log("\n-- the website form --");
  [st, b] = await json(await pub(env, "/api/public/lead/outerhome", { method: "POST",
    body: { firstName: "Ana", lastName: "Gray", phone: "2535550111", email: "ana@home.test", services: ["windows_doors", "plumbing"], consent: true } }));
  ck("a form with the one box lands", st === 200, JSON.stringify(b));
  const ana = db.prepare(`SELECT * FROM sales_leads WHERE email = 'ana@home.test'`).get();
  const anaC = db.prepare(`SELECT * FROM sales_lead_consents WHERE lead_id = ?`).get(ana?.id);
  ck("ticked is a yes to email, calls and texts", anaC?.email === 1 && anaC?.phone === 1 && anaC?.text === 1, JSON.stringify(anaC));
  ck("recorded as the one statement", anaC?.script_version === webConsent({ consent: true }).version);
  ck("a trade the script knows is a service", JSON.parse(ana?.services || "[]").includes("windows"));
  ck("and one it does not is named in the note", /Also asked about: Plumbing\./.test(
    db.prepare(`SELECT body FROM lead_messages WHERE lead_id = ?`).get(ana?.id)?.body || ""));
  [st, b] = await json(await pub(env, "/api/public/lead/outerhome", { method: "POST", ip: "3.3.3.3",
    body: { firstName: "Bo", phone: "2535550112", email: "bo@home.test", consent: false } }));
  const boC = db.prepare(`SELECT c.* FROM sales_lead_consents c JOIN sales_leads l ON l.id = c.lead_id WHERE l.email = 'bo@home.test'`).get();
  ck("unticked is a no to all three", st === 200 && boC?.email === 0 && boC?.phone === 0 && boC?.text === 0, JSON.stringify(boC));

  console.log("\n-- a database without 111 --");
  const old = SCHEMA.replace(/,\n  channel    TEXT NOT NULL DEFAULT 'email'\n\);/, "\n);").replace(/CREATE TABLE IF NOT EXISTS lead_followups[\s\S]*$/, "");
  ({ db, env } = seed(old));
  ck("the fixture really has no 111", !db.prepare(`SELECT COUNT(*) n FROM pragma_table_info('crm_templates') WHERE name = 'channel'`).get().n
    && !db.prepare(`SELECT COUNT(*) n FROM sqlite_master WHERE name = 'lead_followups'`).get().n);
  [st, b] = await json(await call(env, "/api/crm-templates", { method: "POST", body: { name: "Hi", subject: "Hi", body: "Hi" } }));
  ck("an email template still saves", st === 201 && b.template?.channel === "email", JSON.stringify(b));
  [st, b] = await json(await call(env, "/api/crm-templates", { method: "POST", body: { channel: "text", name: "Hi", body: "Hi" } }));
  ck("a text one names the migration", st === 503 && b.migration === "111_crm_channels", JSON.stringify(b));
  const l3 = await addLead(env);
  await call(env, `/api/sales-leads/${l3}/consent`, { method: "PUT", who: "u_sm", body: { consent: { email: true, phone: true, text: true } } });
  [st, b] = await json(await call(env, `/api/sales-leads/${l3}/sequence`, { method: "POST", who: "u_sm", body: { sequenceId: "std:seq-text" } }));
  ck("a text sequence names it too, rather than stopping later", st === 503 && b.migration === "111_crm_channels", JSON.stringify(b));
  [st, b] = await json(await call(env, `/api/sales-leads/${l3}/sequence`, { method: "POST", who: "u_sm", body: { sequenceId: "std:seq-email" } }));
  ck("an email one still runs", st === 201, JSON.stringify(b));
  [st, b] = await json(await call(env, "/api/sales-followups"));
  ck("and the follow-ups list still loads", st === 200 && Array.isArray(b.followUps), JSON.stringify(b));
  [st, b] = await json(await call(env, `/api/sales-leads/${l3}/follow-ups`, { method: "POST", body: { body: "x", dueDate: "2027-01-02", channel: "visit" } }));
  ck("a lead follow-up names the migration", st === 503 && b.migration === "111_crm_channels", JSON.stringify(b));
} catch (err) {
  fail++;
  console.log("FAIL  the suite threw  -- " + (err?.stack || err));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
