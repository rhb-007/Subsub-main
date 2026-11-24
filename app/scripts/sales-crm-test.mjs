// 106. CRM / SALES: CONSENT TO FOLLOW UP, AND THE ACTIVITY ON AN APPOINTMENT.
//
// What is pinned:
//
//   CONSENT IS ASKED, AND STORED. Email, phone and text each answered yes or
//   no before a booking goes, saved with the script version, when, and who;
//   every change is an event with what it was before.
//
//   IT DECIDES WHAT IS SENT. The confirmation and the day-before reminder go
//   only to a homeowner who agreed to email; an outbound call is logged only
//   for one who agreed to be called; a follow-up by a channel only where that
//   channel was agreed; a recording only where they agreed to be recorded.
//
//   THE TEAM IS TOLD. The sales manager an estimate is booked for or moved
//   to, the person a follow-up is handed to, and each night the follow-ups
//   that are due -- once each.
//
//   A CALL-CENTER SEAT reaches the activity routes and the recording upload,
//   and still nothing else.
//
//   node --no-warnings scripts/sales-crm-test.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { runCheck } from "./lib/check-sql.mjs";
import { validConsent, validActivity, contactsFrom, followUpState, CONSENT_CHANNELS } from "../shared/salescrm.js";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker, salesCrmSweep } = await import("../worker/index.js");
const SCHEMA = readFileSync(join(app, "worker", "schema.sql"), "utf8");

let sent = [];
const seed = ({ drop106 = false } = {}) => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,kind,subdomain,plan) VALUES
      ('acc_gc','Outerhome','general_contractor','outerhome','scale'),
      ('acc_other','Other Co','general_contractor','otherco','scale');
    INSERT INTO users(id,name,email) VALUES
      ('u_admin','Richard Braun','rb@outerhome.test'),
      ('u_rep','Marcus Hill','marcus@outerhome.test'),
      ('u_rep2','Jess Ortiz','jess@outerhome.test'),
      ('u_cc','Cara Call','cara@outerhome.test'),
      ('u_other','Olive Other','olive@other.test');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES
      ('m_admin','u_admin','acc_gc','admin'),
      ('m_rep','u_rep','acc_gc','pm'),
      ('m_rep2','u_rep2','acc_gc','pm'),
      ('m_cc','u_cc','acc_gc','callcenter'),
      ('m_other','u_other','acc_other','admin');
  `);
  if (drop106) db.exec(`DROP TABLE sales_activities; DROP TABLE sales_consents;`);
  const store = new Map();
  const FILES = {
    put: async (k, body, opts) => { store.set(k, { body, type: opts?.httpMetadata?.contentType }); },
    get: async (k) => store.has(k) ? { body: store.get(k).body, httpMetadata: { contentType: store.get(k).type } } : null,
  };
  return { db, store, env: { DB: makeD1(db), FILES, RESEND_API_KEY: "re_test", MAIL_FROM: "SubSub <hello@subsub.work>" } };
};

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).includes("api.resend.com")) {
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ id: "em_" + sent.length }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return realFetch(url, init);
};

const call = (env, path, { method = "GET", body, who = "u_cc", acct = "acc_gc" } = {}) => worker.fetch(
  new Request(`https://api.subsub.work${path}`, {
    method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: { "Content-Type": "application/json", "X-User-Id": who, "X-Account-Id": acct },
  }), env);
const put = (env, path, bytes, type, who = "u_cc") => worker.fetch(new Request(`https://api.subsub.work${path}`, {
  method: "PUT", body: bytes, headers: { "Content-Type": type, "X-User-Id": who, "X-Account-Id": "acc_gc" } }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];
const to = (m) => [].concat(m.to).join(",");

const DAY = "2027-12-07";
const booking = (over = {}) => ({
  direction: "inbound", source: "Google", services: ["roofing"],
  details: { roofing: { material: "Asphalt shingle", age: "Over 20 years", leaks: "Yes", stories: "2" } },
  home: { owns: "Yes", timeline: "Within 3 months" },
  homeowner: { firstName: "Dana", lastName: "Ruiz", phone: "(253) 555-0142", email: "dana@home.test" },
  address: { street: "1204 N Pine St", city: "Tacoma", state: "WA", zip: "98406" },
  second: null, date: DAY, time: "10:00", minutes: 90, repId: "u_rep",
  consent: { email: true, phone: true, text: false, record: true },
  ...over,
});

try {
  console.log("\n-- the rules --");
  {
    ck("three channels, each with the words read out", CONSENT_CHANNELS.length === 3 && CONSENT_CHANNELS.every((c) => c.ask.length > 20));
    ck("a text asks with the opt-out in it", /STOP/.test(CONSENT_CHANNELS.find((c) => c.id === "text").ask));
    const blank = validConsent({}, { email: "a@b.co", phone: "2535550142" });
    ck("nothing answered is three missing answers", blank.ok && blank.missing.join() === "consent.email,consent.phone,consent.text",
      JSON.stringify(blank));
    ck("not asked to record is null, not no", validConsent({ email: false, phone: false, text: false }).value.record === null);
    ck("yes to email with no address is refused",
      validConsent({ email: true, phone: false, text: false }, { email: "" }).error === "consent_needs_email");
    const c = { email: true, phone: false, text: false, record: false };
    ck("an outbound call needs phone consent", validActivity({ kind: "call", direction: "outbound", outcome: "No answer" }, { consent: c }).error === "no_call_consent");
    ck("an inbound one does not", validActivity({ kind: "call", direction: "inbound", outcome: "Reached them" }, { consent: c }).ok);
    ck("a text follow-up needs text consent",
      validActivity({ kind: "follow_up", body: "x", dueDate: DAY, channel: "text" }, { consent: c }).error === "no_channel_consent");
    ck("no consent on file is not a yes",
      validActivity({ kind: "follow_up", body: "x", dueDate: DAY, channel: "email" }, { consent: null }).error === "no_channel_consent");
    ck("a recording they said no to is refused",
      validActivity({ kind: "recording", consentConfirmed: true }, { consent: c, accountId: "a" }).error === "no_recording_consent");
    ck("a follow-up is overdue the day after it was due",
      followUpState({ kind: "follow_up", dueDate: "2027-12-06" }, DAY) === "overdue"
      && followUpState({ kind: "follow_up", dueDate: DAY }, DAY) === "due");
    const people = contactsFrom([
      { id: "1", date: "2027-01-01", time: "09:00", homeowner: { firstName: "Dana", phone: "2535550142" }, consent: { email: false } },
      { id: "2", date: "2027-06-01", time: "09:00", homeowner: { firstName: "Dana", phone: "2535550142", email: "d@x.co" }, consent: { email: true } },
      { id: "3", date: "2027-03-01", time: "09:00", homeowner: { firstName: "Lee", phone: "2065550100" } },
    ]);
    ck("contacts are one per phone, the newest appointment's consent on file",
      people.length === 2 && people[0].latestId === "2" && people[0].appointments.length === 2 && people[0].consent.email === true,
      JSON.stringify(people.map((p) => [p.latestId, p.appointments])));
  }

  console.log("\n-- consent at booking --");
  const { db, env, store } = seed();
  let id;
  {
    sent = [];
    const [s0, b0] = await json(await call(env, "/api/appointments", { method: "POST", body: booking({ consent: undefined }) }));
    ck("a booking with no consent asked is incomplete, by name", s0 === 400 && b0.error === "incomplete" && b0.field === "consent.email",
      JSON.stringify(b0));
    const [s1, b1] = await json(await call(env, "/api/appointments", { method: "POST",
      body: booking({ homeowner: { ...booking().homeowner, email: "" } }) }));
    ck("yes to email with no email given is refused", s1 === 400 && b1.error === "consent_needs_email", JSON.stringify(b1));
    ck("and nothing was booked", db.prepare(`SELECT COUNT(*) AS n FROM sales_appointments`).get().n === 0);

    const [st, b] = await json(await call(env, "/api/appointments", { method: "POST", body: booking() }));
    id = b.appointment?.id;
    ck("a booking with every answer goes", st === 201 && b.consentRecorded === true, JSON.stringify(b).slice(0, 200));
    const row = db.prepare(`SELECT * FROM sales_consents WHERE appointment_id = ?`).get(id);
    ck("stored with the version, who and when", row?.email === 1 && row?.phone === 1 && row?.text === 0 && row?.record_call === 1
      && !!row?.script_version && row?.captured_by === "u_cc" && !!row?.captured_at, JSON.stringify(row));
    ck("and the appointment carries it", b.appointment?.consent?.email === true && b.appointment?.consent?.text === false);
    ck("the event log records it", db.prepare(`SELECT COUNT(*) AS n FROM events WHERE kind = 'appointment.consent'`).get().n === 1);
    ck("the homeowner is sent a confirmation, having said yes to email", sent.some((m) => to(m) === "dana@home.test"));
    const rep = sent.find((m) => to(m) === "marcus@outerhome.test");
    ck("the sales manager it was booked for is told", /New estimate: Dana Ruiz/.test(rep?.subject || "")
      && /open=appointment&id=/.test(rep?.text || ""), rep?.subject);
    ck("and the mail log records it", db.prepare(`SELECT COUNT(*) AS n FROM email_log WHERE kind = 'appointment_assigned'`).get().n === 1);

    sent = [];
    const [, b2] = await json(await call(env, "/api/appointments", { method: "POST",
      body: booking({ time: "14:00", consent: { email: false, phone: true, text: false } }) }));
    ck("somebody who said no to email gets no confirmation", b2.confirmation?.reason === "no_email_consent"
      && !sent.some((m) => to(m) === "dana@home.test"), JSON.stringify(b2.confirmation));

    sent = [];
    await call(env, "/api/appointments", { method: "POST", who: "u_rep", body: booking({ time: "16:00" }) });
    ck("a sales manager who books for themselves is not emailed about it", !sent.some((m) => to(m) === "marcus@outerhome.test"));
  }

  console.log("\n-- changing it --");
  {
    sent = [];
    const [s, b] = await json(await call(env, `/api/appointments/${id}`, { method: "PATCH", who: "u_admin",
      body: { repId: "u_rep2", consent: { email: true, phone: false, text: true, record: true } } }));
    ck("consent can be changed on an edit", s === 200 && b.appointment?.consent?.phone === false && b.appointment?.consent?.text === true,
      JSON.stringify(b).slice(0, 200));
    const ev = db.prepare(`SELECT payload FROM events WHERE kind = 'appointment.consent' AND subject_id = ? ORDER BY rowid DESC`).get(id);
    ck("the change keeps what it was before", JSON.parse(ev?.payload || "{}").from?.phone === true, ev?.payload);
    ck("the new sales manager is told it moved to them", sent.some((m) => to(m) === "jess@outerhome.test" && /Moved to you/.test(m.subject)));

    const [s2, b2] = await json(await call(env, `/api/appointments/${id}`, { method: "PATCH", who: "u_admin",
      body: { notes: "Changed note", consent: { email: true } } }));
    ck("a half-answered change is refused", s2 === 400 && b2.error === "incomplete", JSON.stringify(b2));
    ck("and saves nothing", db.prepare(`SELECT notes FROM sales_appointments WHERE id = ?`).get(id).notes !== "Changed note");
  }

  console.log("\n-- activity --");
  {
    const path = `/api/appointments/${id}/activities`;
    const [n1, nb] = await json(await call(env, path, { method: "POST", body: { kind: "note", body: "Wants metal." } }));
    ck("a call-center seat can add a note", n1 === 201 && nb.activity?.kind === "note" && nb.activity?.createdByName === "Cara Call", JSON.stringify(nb));
    const [c1, cb] = await json(await call(env, path, { method: "POST", body: { kind: "call", direction: "outbound", outcome: "No answer" } }));
    ck("an outbound call to somebody who said no to calls is refused", c1 === 400 && cb.error === "no_call_consent", JSON.stringify(cb));
    const [c2] = await json(await call(env, path, { method: "POST", body: { kind: "call", direction: "inbound", outcome: "Reached them" } }));
    ck("a call they made is logged", c2 === 201);
    const [f0, fb0] = await json(await call(env, path, { method: "POST",
      body: { kind: "follow_up", body: "Call back", dueDate: DAY, channel: "call" } }));
    ck("a follow-up by phone is refused once they said no to calls", f0 === 400 && fb0.error === "no_channel_consent", JSON.stringify(fb0));
    const [fx, fxb] = await json(await call(env, path, { method: "POST",
      body: { kind: "follow_up", body: "Send pricing", dueDate: DAY, channel: "text", assigneeId: "u_other" } }));
    ck("a follow-up cannot go to somebody off the team", fx === 400 && fxb.error === "bad_assignee", JSON.stringify(fxb));
    sent = [];
    const [f1, fb] = await json(await call(env, path, { method: "POST",
      body: { kind: "follow_up", body: "Text the metal pricing", dueDate: DAY, channel: "text", assigneeId: "u_rep2" } }));
    ck("a follow-up by a channel they agreed to goes", f1 === 201 && fb.activity?.assigneeName === "Jess Ortiz", JSON.stringify(fb));
    ck("and whoever it is for is told", sent.some((m) => to(m) === "jess@outerhome.test" && /Follow-up for you/.test(m.subject)));
    const [f2, fb2] = await json(await call(env, path, { method: "POST",
      body: { kind: "follow_up", body: "My own task", dueDate: "2027-12-20", channel: "visit" } }));
    ck("one with nobody named is the creator's own", f2 === 201 && fb2.activity?.assigneeId === "u_cc" && !fb2.told);

    const [up0] = await json(await put(env, "/api/uploads/call-recording/call.html", new Uint8Array([60, 104]), "text/html"));
    ck("a recording upload that is not audio is refused", up0 === 415, String(up0));
    const [up1, ub] = await json(await put(env, "/api/uploads/call-recording/call.m4a", new Uint8Array([1, 2, 3, 4]), "audio/mp4"));
    ck("the call center can upload a recording", up1 === 200 && ub.key?.startsWith("acc_gc/call-recording/"), JSON.stringify(ub));
    const [up2] = await json(await put(env, "/api/uploads/report-photo/x.jpg", new Uint8Array([1]), "image/jpeg"));
    ck("but no other kind of upload", up2 === 403, String(up2));
    const rec = { kind: "recording", fileKey: ub.key, fileName: "call.m4a", fileType: "audio/mp4", fileSize: 4 };
    const [r0, rb0] = await json(await call(env, path, { method: "POST", body: rec }));
    ck("a recording without the agreement confirmed is refused", r0 === 400 && rb0.error === "recording_consent_required");
    const [r1, rb1] = await json(await call(env, path, { method: "POST",
      body: { ...rec, fileKey: "acc_other/call-recording/x.m4a", consentConfirmed: true } }));
    ck("a key that is not this account's own upload is refused", r1 === 400 && rb1.error === "recording_not_uploaded");
    const [r2, rb2] = await json(await call(env, path, { method: "POST", body: { ...rec, consentConfirmed: true } }));
    ck("a recording they agreed to is kept", r2 === 201 && rb2.activity?.file?.name === "call.m4a", JSON.stringify(rb2));
    const fr = await call(env, `${path}/${rb2.activity?.id}/file`);
    ck("and played back with nosniff, never cached", fr.status === 200 && fr.headers.get("X-Content-Type-Options") === "nosniff"
      && /no-store/.test(fr.headers.get("Cache-Control") || "") && fr.headers.get("Content-Type") === "audio/mp4");

    const [l1, lb] = await json(await call(env, path));
    ck("the timeline lists everything, newest first", l1 === 200 && lb.activities?.length === 5 && lb.activities[0].kind === "recording"
      && lb.consent?.text === true, JSON.stringify(lb.activities?.map((a) => a.kind)));
    ck("and offers the team for follow-ups, not other accounts", lb.team?.some((u) => u.id === "u_cc") && !lb.team?.some((u) => u.id === "u_other"));

    const [fl, flb] = await json(await call(env, "/api/sales-followups"));
    ck("the follow-ups list carries both open ones, oldest due first", fl === 200 && flb.followUps?.length === 2
      && flb.followUps[0].dueDate === DAY && flb.followUps[0].who === "Dana Ruiz", JSON.stringify(flb.followUps?.map((f) => f.dueDate)));
    const [d1, db1] = await json(await call(env, `${path}/${fb.activity.id}`, { method: "PATCH", body: { done: true } }));
    ck("ticking one done records who", d1 === 200 && !!db1.activity?.doneAt && db1.activity?.doneByName === "Cara Call");
    const [, flb2] = await json(await call(env, "/api/sales-followups"));
    ck("and it leaves the list", flb2.followUps?.length === 1);
    const [d2, db2] = await json(await call(env, `${path}/${nb.activity.id}`, { method: "PATCH", body: { done: true } }));
    ck("a note cannot be ticked done", d2 === 409 && db2.error === "not_a_follow_up");

    const [o1] = await json(await call(env, path, { who: "u_other", acct: "acc_other" }));
    ck("another account cannot read it", o1 === 404, String(o1));
    ck("the invariant reads zero", runCheck(db).m106_inv_recording_no_consent === 0);
    db.prepare(`UPDATE sales_activities SET record_consent = NULL WHERE kind = 'recording'`).run();
    ck("and counts a recording with no agreement behind it", runCheck(db).m106_inv_recording_no_consent === 1);
    db.prepare(`UPDATE sales_activities SET record_consent = 1 WHERE kind = 'recording'`).run();
    ck("the file is in the store under the account", [...store.keys()].some((k) => k.startsWith("acc_gc/call-recording/")));
  }

  console.log("\n-- the nightly sweep --");
  {
    const sweep = salesCrmSweep;
    ck("the sweep is exported for tests", typeof sweep === "function");
    // An appointment tomorrow (relative to a fixed night) with email consent.
    const night = Date.parse("2027-12-06T03:00:00Z");
    db.prepare(`UPDATE sales_appointments SET date = '2027-12-07' WHERE id = ?`).run(id);
    db.prepare(`UPDATE sales_activities SET due_date = '2027-12-06' WHERE kind = 'follow_up' AND done_at IS NULL`).run();
    sent = [];
    const r1 = await sweep(env, night);
    ck("the follow-up due that day is emailed to its owner", sent.some((m) => to(m) === "cara@outerhome.test" && /Follow-up due/.test(m.subject)),
      JSON.stringify(r1));
    const reminders = sent.filter((m) => /Reminder: your estimate/.test(m.subject));
    ck("homeowners who agreed to email are reminded the day before",
      reminders.length >= 1 && reminders.every((m) => to(m) === "dana@home.test"), JSON.stringify(r1));
    ck("and not the one who said no to email", reminders.length === db.prepare(
      `SELECT COUNT(*) AS n FROM sales_appointments a JOIN sales_consents c ON c.appointment_id = a.id
        WHERE a.date = '2027-12-07' AND c.email = 1`).get().n);
    sent = [];
    await sweep(env, night);
    ck("a second night sends neither again", sent.length === 0, JSON.stringify(sent.map((m) => m.subject)));
    db.prepare(`UPDATE sales_appointments SET time = '11:00' WHERE id = ?`).run(id);
    await sweep(env, night);
    ck("a new time is a new reminder", sent.some((m) => /Reminder/.test(m.subject)));
  }

  console.log("\n-- without 106 --");
  {
    const { env: env2 } = seed({ drop106: true });
    const [s, b] = await json(await call(env2, "/api/appointments", { method: "POST", body: booking() }));
    ck("booking still works, and says the consent was not kept", s === 201 && b.consentRecorded === false && b.migration === "106_sales_crm",
      JSON.stringify(b).slice(0, 200));
    const [s2, b2] = await json(await call(env2, `/api/appointments/${b.appointment.id}/activities`));
    ck("the activity panel names the file", s2 === 503 && b2.migration === "106_sales_crm", JSON.stringify(b2));
    const [s3] = await json(await call(env2, "/api/appointments"));
    ck("and the list still loads", s3 === 200);
    const r = await salesCrmSweep(env2);
    ck("and the sweep skips cleanly", /106/.test(r.skipped || ""));
  }
} catch (err) {
  ck("the suite ran to the end", false, err?.stack || String(err));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
