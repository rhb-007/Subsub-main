// 109. CONTACTING A LEAD FROM THE CRM, AND THE SALES MANAGER WHO SEES ONLY
// THEIR OWN.
//
// What is pinned:
//
//   EMAIL GOES OUT FROM SUBSUB, in the account's name, only to a lead who said
//   yes to email, with a reply address whose answer lands back on the lead --
//   and only FROM the lead's own address.
//
//   A TEXT IS OPENED ON YOUR PHONE, never claimed as delivered, and needs their
//   yes to texts. A LETTER needs a whole address and no consent. An outbound
//   CALL needs their yes to calls.
//
//   CONSENT CAN BE ASKED OF A LEAD DIRECTLY, and the newest answer on file wins
//   over one given at an older booking.
//
//   A SALES MANAGER sees the estimates booked for them and the leads they own
//   or have an estimate with, and nobody else's: lists, single reads and every
//   write. They book for themselves, and own the leads they add.
//
//   node --no-warnings scripts/lead-contact-test.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeD1, makeR2, freshDb } from "./lib/d1-sqlite.mjs";
import { runCheck } from "./lib/check-sql.mjs";
import { validLeadMessage, leadConsentFrom, channelBlock, smsHref, inboxCounts, leadTokenFromAddress,
  leadReplyAddress, messageStatusText } from "../shared/leadcontact.js";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker, handleInboundEmail } = await import("../worker/index.js");
const SCHEMA = readFileSync(join(app, "worker", "schema.sql"), "utf8");

const sent = [];
globalThis.fetch = async (input, init = {}) => {
  const url = String(input?.url || input);
  if (url.includes("mail.test")) sent.push(JSON.parse(String(init.body || "{}")));
  return new Response(JSON.stringify({ id: "em_" + sent.length }), { headers: { "Content-Type": "application/json" } });
};

const seed = ({ drop109 = false } = {}) => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,kind,subdomain,plan) VALUES
      ('acc_gc','Outerhome','general_contractor','outerhome','scale'),
      ('acc_pm','Sound PM','property_manager','soundpm','scale');
    INSERT INTO users(id,name,email) VALUES
      ('u_admin','Richard Braun','rb@outerhome.test'),
      ('u_sm','Sam Seller','sam@outerhome.test'),
      ('u_sm2','Tia Other','tia@outerhome.test'),
      ('u_cc','Cara Call','cara@outerhome.test'),
      ('u_pm','Pat Manager','pat@sound.test');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES
      ('m_admin','u_admin','acc_gc','admin'),
      ('m_sm','u_sm','acc_gc','sales'),
      ('m_sm2','u_sm2','acc_gc','sales'),
      ('m_cc','u_cc','acc_gc','callcenter'),
      ('m_pm','u_pm','acc_pm','admin');
  `);
  if (drop109) db.exec(`DROP TABLE lead_messages; DROP TABLE sales_lead_consents;`);
  return { db, env: { DB: makeD1(db), FILES: makeR2(), RESEND_API_KEY: "re_test", MAIL_FROM: "SubSub <hello@subsub.work>",
    RESEND_API_BASE: "https://mail.test", MESSAGE_REPLY_DOMAIN: "reply.subsub.work" } };
};

const call = (env, path, { method = "GET", body, who = "u_admin", acct = "acc_gc" } = {}) => worker.fetch(
  new Request(`https://api.subsub.work${path}`, {
    method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: { "Content-Type": "application/json", "X-User-Id": who, "X-Account-Id": acct },
  }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];

const DAY = "2027-12-07";
const booking = (over = {}) => ({
  direction: "inbound", source: "Google", services: ["roofing"],
  details: { roofing: { material: "Asphalt shingle", age: "Over 20 years", leaks: "Yes", stories: "2" } },
  home: { owns: "Yes", timeline: "Within 3 months" },
  homeowner: { firstName: "Dana", lastName: "Ruiz", phone: "(253) 555-0142", email: "dana@home.test" },
  address: { street: "1204 N Pine St", city: "Tacoma", state: "WA", zip: "98406" },
  second: null, date: DAY, time: "10:00", minutes: 90, repId: "u_sm",
  consent: { email: true, phone: false, text: true, record: null },
  ...over,
});

try {
  console.log("\n-- the rules --");
  {
    const lead = { email: "a@b.test", phone: "2535550100", address: { street: "1 Elm", city: "Tacoma", state: "WA", zip: "98406" } };
    const yes = { email: true, phone: true, text: true };
    ck("an email needs their yes to email", validLeadMessage({ channel: "email", subject: "Hi", body: "x" },
      { lead, consent: { ...yes, email: false } }).error === "no_email_consent");
    ck("and nothing on file is not a yes", validLeadMessage({ channel: "email", subject: "Hi", body: "x" }, { lead, consent: null }).error === "no_email_consent");
    ck("and an address", validLeadMessage({ channel: "email", subject: "Hi", body: "x" }, { lead: { ...lead, email: "" }, consent: yes }).error === "no_email");
    ck("and a subject", validLeadMessage({ channel: "email", body: "x" }, { lead, consent: yes }).error === "subject_required");
    ck("a text needs their yes to texts", validLeadMessage({ channel: "text", body: "x" }, { lead, consent: { ...yes, text: false } }).error === "no_text_consent");
    ck("and is opened on your phone, never claimed as delivered", validLeadMessage({ channel: "text", body: "x" }, { lead, consent: yes }).value.status === "device");
    ck("a letter needs no consent", validLeadMessage({ channel: "mail", body: "Dear" }, { lead, consent: null }).ok);
    ck("but a whole address", validLeadMessage({ channel: "mail", body: "Dear" }, { lead: { ...lead, address: { ...lead.address, zip: "" } }, consent: null }).error === "no_address");
    ck("an outbound call needs their yes to calls", validLeadMessage({ channel: "call", direction: "outbound", outcome: "No answer" },
      { lead, consent: { ...yes, phone: false } }).error === "no_call_consent");
    ck("taking their call does not", validLeadMessage({ channel: "call", direction: "inbound", outcome: "Reached them" }, { lead, consent: null }).ok);
    ck("the newest answer on file wins", leadConsentFrom({ email: false, capturedAt: "2027-12-02T00:00:00Z" },
      [{ email: true, capturedAt: "2027-12-01T00:00:00Z" }]).email === false);
    ck("whichever it came from", leadConsentFrom({ email: false, capturedAt: "2027-11-02T00:00:00Z" },
      [{ email: true, capturedAt: "2027-12-01T00:00:00Z" }]).email === true);
    ck("nothing asked is null", leadConsentFrom(null, []) === null);
    ck("a text opens the messages app with the words", smsHref("(253) 555-0100", "Hi Dana") === "sms:+12535550100?&body=Hi%20Dana");
    ck("the channel block names why", channelBlock("text", { lead: { phone: "" }, consent: yes }) === "no_phone");
    const c = inboxCounts([{ channel: "email", direction: "inbound" }, { channel: "email", direction: "outbound" }, { channel: "mail", direction: "outbound" }]);
    ck("the inbox counts each kind and the unread replies", c.email === 2 && c.mail === 1 && c.unread === 1 && c.all === 3);
    ck("a lead's reply address is l-, never a conversation's m-", leadTokenFromAddress(leadReplyAddress("a".repeat(24), "reply.test"), "reply.test") === "a".repeat(24)
      && leadTokenFromAddress(`m-${"a".repeat(24)}@reply.test`, "reply.test") === null);
    ck("a letter not yet mailed says so", messageStatusText({ channel: "mail", direction: "outbound" }) === "Printed, not mailed yet");
  }

  console.log("\n-- a sales manager sees their own --");
  const { db, env } = seed();
  let [st, b] = await json(await call(env, "/api/appointments", { method: "POST", who: "u_admin", body: booking() }));
  ck("the office books an estimate for a sales manager", st === 201, JSON.stringify(b));
  const apptSam = b.appointment?.id;
  const leadDana = b.lead?.leadId;
  [st, b] = await json(await call(env, "/api/appointments", { method: "POST", who: "u_admin",
    body: booking({ repId: "u_sm2", homeowner: { firstName: "Eli", lastName: "Fox", phone: "2535550199", email: "eli@home.test" } }) }));
  const apptTia = b.appointment?.id;
  const leadEli = b.lead?.leadId;
  ck("a lead nobody owned is owned by the sales manager it was booked with",
    db.prepare(`SELECT owner_id FROM sales_leads WHERE id = ?`).get(leadDana)?.owner_id === "u_sm");
  [st, b] = await json(await call(env, "/api/appointments", { who: "u_sm" }));
  ck("their appointment list is their own estimates", st === 200 && b.appointments.length === 1 && b.appointments[0].id === apptSam,
    JSON.stringify(b.appointments?.map((a) => a.id)));
  ck("and they are offered as a sales manager", b.reps.some((r) => r.id === "u_sm"));
  [st, b] = await json(await call(env, "/api/appointments", { who: "u_admin" }));
  ck("the office sees both", b.appointments.length === 2);
  [st] = await json(await call(env, `/api/appointments/${apptTia}`, { method: "PATCH", who: "u_sm", body: { status: "confirmed" } }));
  ck("somebody else's estimate answers like one that does not exist", st === 404);
  [st, b] = await json(await call(env, `/api/appointments/${apptSam}`, { method: "PATCH", who: "u_sm", body: { status: "sold" } }));
  ck("they record the outcome of their own", st === 200 && b.appointment.status === "sold", JSON.stringify(b));
  [st] = await json(await call(env, `/api/appointments/${apptSam}`, { method: "PATCH", who: "u_sm", body: { repId: "u_sm2" } }));
  ck("and cannot hand it to somebody else", st === 403);
  [st] = await json(await call(env, `/api/appointments/${apptTia}/activities`, { who: "u_sm" }));
  ck("nor read another's activity", st === 404);
  [st, b] = await json(await call(env, "/api/sales-leads", { who: "u_sm" }));
  ck("their leads are their own", st === 200 && b.leads.length === 1 && b.leads[0].id === leadDana, JSON.stringify(b.leads?.map((l) => l.id)));
  [st, b] = await json(await call(env, "/api/appointments", { method: "POST", who: "u_sm",
    body: booking({ repId: "u_sm2", homeowner: { firstName: "Gus", lastName: "Hale", phone: "2535550111", email: "" },
      consent: { email: false, phone: true, text: false, record: null } }) }));
  ck("a sales manager books for themselves, whoever was named", st === 201 && b.appointment.repId === "u_sm", JSON.stringify(b.appointment?.repId));
  [st, b] = await json(await call(env, "/api/sales-leads", { method: "POST", who: "u_sm",
    body: { firstName: "Ivy", phone: "2535550122", ownerId: "u_sm2" } }));
  ck("and owns the leads they add", st === 201 && b.lead.ownerId === "u_sm", JSON.stringify(b));
  const leadIvy = b.lead?.id;
  [st] = await json(await call(env, `/api/sales-leads/${leadEli}`, { method: "PATCH", who: "u_sm", body: { notes: "x" } }));
  ck("another seller's lead answers like one that does not exist", st === 404);
  [st] = await json(await call(env, `/api/sales-leads/${leadEli}/messages`, { who: "u_sm" }));
  ck("and so does its conversation", st === 404);
  [st] = await json(await call(env, "/api/jobs", { who: "u_sm" }));
  ck("a sales manager reaches nothing outside the CRM", st === 403);
  [st] = await json(await call(env, "/api/google-calendar", { who: "u_sm" }));
  ck("but does reach their own Google Calendar", st === 200);
  [st] = await json(await call(env, "/api/account-users", { method: "POST", who: "u_pm", acct: "acc_pm",
    body: { name: "Q", email: "q@x.test", role: "sales" } }));
  ck("a sales manager seat only exists where homeowners are sold to", st === 400);

  console.log("\n-- email --");
  sent.length = 0;
  [st, b] = await json(await call(env, `/api/sales-leads/${leadDana}/messages`, { method: "POST", who: "u_sm",
    body: { channel: "email", subject: "Your roof estimate", body: "Hi Dana,\n\nHere is the quote." } }));
  ck("an email to a lead who said yes goes out", st === 201 && b.message.status === "sent" && sent.length === 1, JSON.stringify(b));
  const em = sent[0] || {};
  ck("in the account's name", /Outerhome/.test(String(em.from)), String(em.from));
  ck("to the lead", [].concat(em.to).includes("dana@home.test"));
  const tok = leadTokenFromAddress(em.reply_to, "reply.subsub.work");
  ck("with a reply address of its own", !!tok, String(em.reply_to));
  ck("and the sender's name under the words", /Sam Seller\nOuterhome/.test(em.text || ""), em.text);
  [st, b] = await json(await call(env, `/api/sales-leads/${leadIvy}/messages`, { method: "POST", who: "u_sm",
    body: { channel: "email", subject: "Hi", body: "x" } }));
  ck("a lead with no consent on file is not emailed", st === 400 && (b.error === "no_email" || b.error === "no_email_consent"), JSON.stringify(b));

  console.log("\n-- a reply by email --");
  const mail = (o) => {
    const raw = [`From: Dana <${o.from}>`, `To: ${o.to}`, "Subject: Re: Your roof estimate",
      "Content-Type: text/plain; charset=utf-8", "", o.text].join("\r\n");
    return { from: o.from, to: o.to, raw, rawSize: raw.length, rejected: null, setReject(why) { this.rejected = why; } };
  };
  let out = await handleInboundEmail(mail({ from: "dana@home.test", to: `l-${tok}@reply.subsub.work`,
    text: "Sounds good, Tuesday works\r\n\r\nOn Mon, Sam wrote:\r\n> Here is the quote." }), env);
  const reply = db.prepare(`SELECT * FROM lead_messages WHERE direction = 'inbound'`).get();
  ck("the homeowner's answer lands on the lead", out.ok && reply?.lead_id === leadDana && reply.body === "Sounds good, Tuesday works", JSON.stringify(out));
  out = await handleInboundEmail(mail({ from: "stranger@else.test", to: `l-${tok}@reply.subsub.work`, text: "hi" }), env);
  ck("and only from the lead's own address", !!out.rejected && !out.notify);
  [st, b] = await json(await call(env, "/api/crm-inbox", { who: "u_sm" }));
  ck("the inbox lists it, unread", st === 200 && b.messages.some((m) => m.direction === "inbound" && !m.readAt), JSON.stringify(b));
  [st, b] = await json(await call(env, `/api/sales-leads/${leadDana}/messages`, { who: "u_sm" }));
  ck("opening the lead reads it", db.prepare(`SELECT read_at FROM lead_messages WHERE direction = 'inbound'`).get().read_at !== null);
  ck("and the conversation says which channels are open", b.blocks.email === null && b.blocks.text === null && b.blocks.mail === null, JSON.stringify(b.blocks));
  [st, b] = await json(await call(env, "/api/crm-inbox", { who: "u_sm2" }));
  ck("another seller's inbox does not carry it", st === 200 && b.messages.length === 0, JSON.stringify(b.messages?.length));

  console.log("\n-- text, letter, call, consent --");
  [st, b] = await json(await call(env, `/api/sales-leads/${leadDana}/messages`, { method: "POST", who: "u_sm",
    body: { channel: "text", body: "On my way" } }));
  ck("a text is logged as opened on the phone", st === 201 && b.message.status === "device" && b.message.to === "2535550142", JSON.stringify(b));
  [st, b] = await json(await call(env, `/api/sales-leads/${leadDana}/messages`, { method: "POST", who: "u_sm",
    body: { channel: "mail", body: "Thank you for your time." } }));
  ck("a letter is logged as printed", st === 201 && b.message.status === "printed" && /98406/.test(b.message.to || ""), JSON.stringify(b));
  const letter = b.message?.id;
  [st, b] = await json(await call(env, `/api/sales-leads/${leadDana}/messages/${letter}`, { method: "PATCH", who: "u_sm", body: { mailed: true } }));
  ck("and marked mailed", st === 200 && !!b.message.mailedAt);
  [st, b] = await json(await call(env, `/api/sales-leads/${leadDana}/messages`, { method: "POST", who: "u_sm",
    body: { channel: "call", direction: "outbound", outcome: "No answer" } }));
  ck("an outbound call to somebody who said no to calls is refused", st === 400 && b.error === "no_call_consent");
  [st, b] = await json(await call(env, `/api/sales-leads/${leadIvy}/consent`, { method: "PUT", who: "u_sm",
    body: { consent: { email: false, phone: true, text: true } } }));
  ck("consent can be asked of a lead with no booking", st === 200 && b.consent.phone === true && b.consent.text === true, JSON.stringify(b));
  [st, b] = await json(await call(env, `/api/sales-leads/${leadIvy}/messages`, { method: "POST", who: "u_sm",
    body: { channel: "call", direction: "outbound", outcome: "Reached them" } }));
  ck("and then counts", st === 201);
  [st, b] = await json(await call(env, `/api/sales-leads/${leadDana}/consent`, { method: "PUT", who: "u_sm",
    body: { consent: { email: false, phone: false, text: false } } }));
  [st, b] = await json(await call(env, `/api/sales-leads/${leadDana}/messages`, { method: "POST", who: "u_sm",
    body: { channel: "email", subject: "Hi", body: "x" } }));
  ck("a newer no outranks the yes given at the booking", st === 400 && b.error === "no_email_consent", JSON.stringify(b));
  [st, b] = await json(await call(env, `/api/sales-leads/${leadIvy}/consent`, { method: "PUT", who: "u_sm",
    body: { consent: { email: true, phone: true, text: true } } }));
  ck("a yes to email with no address is refused", st === 400 && b.error === "consent_needs_email");

  console.log("\n-- the invariant, against real rows --");
  ck("it reads zero on what the routes wrote", runCheck(db).m109_inv_bad_lead_message === 0);
  db.exec(`INSERT INTO lead_messages (id, account_id, lead_id, channel, direction, status, created_at)
    VALUES ('bad', 'acc_pm', '${leadDana}', 'fax', 'outbound', 'logged', '2027-01-01')`);
  ck("and counts a channel the inbox cannot draw, filed on the wrong account", runCheck(db).m109_inv_bad_lead_message === 2,
    String(runCheck(db).m109_inv_bad_lead_message));

  console.log("\n-- a database without 109 --");
  {
    const { env: e2 } = seed({ drop109: true });
    await call(e2, "/api/appointments", { method: "POST", who: "u_admin", body: booking() });
    const [s2, l2] = await json(await call(e2, "/api/sales-leads", { who: "u_admin" }));
    ck("leads still load", s2 === 200 && l2.leads.length === 1, JSON.stringify(l2));
    const [s3, b3] = await json(await call(e2, `/api/sales-leads/${l2.leads[0]?.id}/messages`, { who: "u_admin" }));
    ck("and the conversation names the file", s3 === 503 && b3.migration === "109_lead_contact", JSON.stringify(b3));
  }
} catch (err) {
  fail++;
  console.log("FAIL  threw: " + (err?.stack || err));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
