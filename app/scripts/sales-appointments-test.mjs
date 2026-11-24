// 105. SALES APPOINTMENTS AND THE CALL-CENTER SEAT.
//
// A call-center seat books homeowners for estimates through a script, and
// reaches nothing else on the account. An admin or project manager records the
// outcome and turns a sold one into a job. What is pinned:
//
//   THE SEAT IS RESTRICTED. It books, reads and edits appointments, and is
//   refused jobs, the roster, the users list and billing.
//
//   A BOOKING IS COMPLETE OR REFUSED, by name: the services, each service's
//   required answers, the homeowner, the address, the second decision maker if
//   named, and a date and time.
//
//   A REP IS NOT DOUBLE-BOOKED without saying so.
//
//   THE OUTCOME IS THE SALES SIDE'S. The call center confirms, reschedules and
//   cancels; it cannot mark a visit sold or lost.
//
//   SOLD BECOMES A JOB ONCE. The job links back, the appointment reads sold,
//   and a second press is refused.
//
//   ONLY ACCOUNTS THAT SELL TO HOMEOWNERS have either.
//
//   node --no-warnings scripts/sales-appointments-test.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { validAppointment, repClashes, jobSeedFromAppointment, SERVICES, SERVICE_QUESTIONS,
  apptWhenText } from "../shared/salesappt.js";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(join(app, "worker", "schema.sql"), "utf8");
const TRADES = new Set((await import("../shared/trades.js")).TRADE_IDS);

const sent = [];
const seed = ({ drop105 = false } = {}) => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,kind,subdomain,plan) VALUES
      ('acc_gc','Outerhome','general_contractor','outerhome','scale'),
      ('acc_pm','Sound Property Management','property_manager','soundpm','scale');
    INSERT INTO users(id,name,email) VALUES
      ('u_admin','Richard Braun','rb@outerhome.test'),
      ('u_rep','Marcus Hill','marcus@outerhome.test'),
      ('u_cc','Cara Call','cara@outerhome.test'),
      ('u_pmadmin','Chris Lane','chris@soundpm.test');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES
      ('m_admin','u_admin','acc_gc','admin'),
      ('m_rep','u_rep','acc_gc','pm'),
      ('m_cc','u_cc','acc_gc','callcenter'),
      ('m_pmadmin','u_pmadmin','acc_pm','admin');
  `);
  if (drop105) db.exec(`DROP TABLE sales_appointments`);
  return { db, env: { DB: makeD1(db), FILES: { put: async () => {}, get: async () => null },
    RESEND_API_KEY: "re_test", MAIL_FROM: "SubSub <hello@subsub.work>" } };
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
const json = async (r) => [r.status, await r.json().catch(() => ({}))];

const DAY = "2027-12-07";
const booking = (over = {}) => ({
  direction: "inbound", source: "Google",
  services: ["roofing", "gutters"],
  details: {
    roofing: { material: "Asphalt shingle", age: "Over 20 years", leaks: "Yes", stories: "2", storm: "No" },
    gutters: { scope: "Whole home", stories: "2", issues: ["Overflowing", "Sagging"] },
  },
  home: { owns: "Yes", yearBuilt: 1978, timeline: "Within 3 months" },
  homeowner: { firstName: "Dana", lastName: "Ruiz", phone: "(253) 555-0142", email: "dana@home.test" },
  address: { street: "1204 N Pine St", city: "Tacoma", state: "wa", zip: "98406" },
  second: { firstName: "Alex", lastName: "Ruiz", relationship: "Spouse", phone: "2535550143", attends: true },
  date: DAY, time: "10:00", minutes: 90, repId: "u_rep", notes: "Dog in the yard.",
  consent: { email: true, phone: true, text: false, record: true },
  ...over,
});

try {
  console.log("\n-- the script --");
  {
    ck("four replacements, each a SubSub trade", SERVICES.length === 4 && SERVICES.every((s) => TRADES.has(s.trade)),
      JSON.stringify(SERVICES.map((s) => s.trade)));
    ck("each has questions, some required", SERVICES.every((s) => SERVICE_QUESTIONS[s.id].some((q) => q.required)));
    const ok = validAppointment(booking());
    ck("a full booking is accepted", ok.ok, JSON.stringify(ok));
    ck("the phone and state are cleaned", ok.value?.homeowner.phone === "2535550142" && ok.value?.address.state === "WA");
    const noRoof = validAppointment(booking({ details: { roofing: { material: "Metal" }, gutters: booking().details.gutters } }));
    ck("a required answer left blank is incomplete, by name",
      noRoof.error === "incomplete" && noRoof.missing.includes("roofing.age"), JSON.stringify(noRoof));
    const bad = validAppointment(booking({ details: { ...booking().details, roofing: { ...booking().details.roofing, material: "Gold" } } }));
    ck("an answer not on the list is refused", bad.error === "bad_answer" && bad.field === "roofing.material", JSON.stringify(bad));
    const sole = validAppointment(booking({ second: null }));
    ck("a homeowner who decides alone needs no second person", sole.ok && sole.value.soleDecider === true);
    const half = validAppointment(booking({ second: { firstName: "Alex" } }));
    ck("a named second decision maker needs a relationship and whether they attend",
      half.error === "incomplete" && half.missing.includes("second.relationship") && half.missing.includes("second.attends"),
      JSON.stringify(half.missing));
    ck("no service is refused", validAppointment(booking({ services: [] })).error === "services_required");
    ck("no direction is refused", validAppointment(booking({ direction: "sideways" })).error === "bad_direction");
    ck("the time reads in words", apptWhenText("2027-12-07", "14:30") === "Tuesday, December 7 at 2:30 PM",
      apptWhenText("2027-12-07", "14:30"));
    const seed = jobSeedFromAppointment({ ...ok.value, services: ["roofing", "gutters"] });
    ck("a sold appointment seeds the job: trades, client, address",
      JSON.stringify(seed.trades) === '["roofing","gutters"]' && seed.client === "Dana Ruiz"
        && seed.zip === "98406" && /Roof replacement/.test(seed.title), JSON.stringify(seed));
    ck("and the scope carries the answers", /What is on the roof now: Asphalt shingle/.test(seed.scope), seed.scope);
    const rows = [{ id: "a", repId: "u_rep", date: DAY, time: "09:30", minutes: 60, status: "scheduled" },
      { id: "b", repId: "u_rep", date: DAY, time: "12:00", minutes: 60, status: "scheduled" },
      { id: "c", repId: "u_rep", date: DAY, time: "10:30", minutes: 60, status: "cancelled" }];
    const clash = repClashes(rows, { repId: "u_rep", date: DAY, time: "10:00", minutes: 90 });
    ck("an overlapping window is a clash; a canceled one and a later one are not",
      clash.length === 1 && clash[0].id === "a", JSON.stringify(clash));
  }

  console.log("\n-- the call-center seat books --");
  {
    const { db, env } = seed();
    sent.length = 0;
    const [st, b] = await json(await call(env, "/api/appointments", { method: "POST", body: booking() }));
    ck("a call-center seat books an appointment", st === 201 && b.appointment?.id, JSON.stringify({ st, b }));
    ck("it starts scheduled, with the rep", b.appointment?.status === "scheduled" && b.appointment?.repName === "Marcus Hill");
    ck("and it is not a job", db.prepare(`SELECT COUNT(*) AS n FROM jobs`).get().n === 0);
    const row = db.prepare(`SELECT * FROM sales_appointments`).get();
    ck("stored with the homeowner, the address and the second person",
      row?.first_name === "Dana" && row?.zip === "98406" && JSON.parse(row?.second || "{}").relationship === "Spouse");
    ck("and who booked it", row?.created_by === "u_cc");
    const home = () => sent.filter((m) => /Your estimate is booked/.test(m.subject));
    ck("the homeowner is emailed a confirmation", b.confirmation?.sent === true && home().length === 1
      && [].concat(home()[0].to).includes("dana@home.test") && /Your estimate is booked: Tuesday, December 7 at 10:00 AM/.test(home()[0].subject),
      JSON.stringify({ c: b.confirmation, s: home()[0]?.subject }));
    ck("in the account's name", /Outerhome/.test(home()[0]?.from || "") && /The Outerhome team/.test(home()[0]?.text || ""), home()[0]?.from);
    ck("and the mail log records it",
      db.prepare(`SELECT COUNT(*) AS n FROM email_log WHERE kind = 'appointment_booked'`).get().n === 1);
    const [, b2] = await json(await call(env, "/api/appointments", { method: "POST",
      body: booking({ homeowner: { ...booking().homeowner, email: "" }, emailHomeowner: false, time: "14:00",
        consent: { email: false, phone: true, text: false } }) }));
    ck("no confirmation when asked not to", b2.confirmation?.sent === false && home().length === 1, JSON.stringify(b2.confirmation));

    const [lst, list] = await json(await call(env, "/api/appointments"));
    ck("it lists the account's appointments and the reps", lst === 200 && list.appointments?.length === 2
      && list.reps?.map((r) => r.id).sort().join() === "u_admin,u_rep", JSON.stringify(list.reps));
    ck("a call-center seat is never offered as a rep", !list.reps?.some((r) => r.id === "u_cc"));

    const [cst, cb] = await json(await call(env, "/api/appointments", { method: "POST", body: booking({ time: "10:30" }) }));
    ck("the same rep at an overlapping time is refused", cst === 409 && cb.error === "rep_double_booked", JSON.stringify(cb));
    const [ost] = await json(await call(env, "/api/appointments", { method: "POST", body: booking({ time: "10:30", allowClash: true }) }));
    ck("unless the booker says to book anyway", ost === 201);
    const [rst, rb] = await json(await call(env, "/api/appointments", { method: "POST", body: booking({ repId: "u_cc", time: "16:00" }) }));
    ck("a rep who is not a sales manager here is refused", rst === 400 && rb.error === "bad_rep", JSON.stringify(rb));
    const [ist, ib] = await json(await call(env, "/api/appointments", { method: "POST",
      body: booking({ homeowner: { firstName: "Dana", lastName: "", phone: "253" } }) }));
    ck("an incomplete booking is refused, naming what is missing",
      ist === 400 && ib.error === "incomplete" && ib.missing.includes("homeowner.lastName") && ib.missing.includes("homeowner.phone"),
      JSON.stringify(ib));

    console.log("\n-- and reaches nothing else --");
    for (const [path, method] of [["/api/jobs", "GET"], ["/api/subs", "GET"],
      ["/api/billing", "GET"], ["/api/properties", "GET"], ["/api/jobs", "POST"]]) {
      const r = await call(env, path, { method, ...(method === "POST" ? { body: { title: "x" } } : {}) });
      ck(`${method} ${path} is refused to the call-center seat`, r.status === 403, String(r.status));
    }
    const [ust, users] = await json(await call(env, "/api/account-users"));
    ck("the users list gives it its own row and nobody else's", ust === 200 && users.length === 1 && users[0].id === "u_cc",
      JSON.stringify(users?.map?.((u) => u.id)));
    const me = await call(env, "/api/account");
    ck("but it can read its own account", me.status === 200, String(me.status));

    console.log("\n-- the outcome is the sales side's --");
    const id = b.appointment.id;
    const [c1, cc] = await json(await call(env, `/api/appointments/${id}`, { method: "PATCH", body: { status: "confirmed" } }));
    ck("the call center confirms", c1 === 200 && cc.appointment?.status === "confirmed", JSON.stringify(cc));
    const [c2, cs] = await json(await call(env, `/api/appointments/${id}`, { method: "PATCH", body: { status: "sold" } }));
    ck("and may not mark it sold", c2 === 403 && cs.error === "sales_only", JSON.stringify(cs));
    const [c3, rs] = await json(await call(env, `/api/appointments/${id}`, { method: "PATCH", body: { time: "08:00" } }));
    ck("the call center reschedules", c3 === 200 && rs.appointment?.time === "08:00", JSON.stringify(rs));
    const [c4, bad4] = await json(await call(env, `/api/appointments/${id}`, { method: "PATCH",
      body: { details: { roofing: { material: "Metal" } } } }));
    ck("an edit that leaves a required answer blank is refused", c4 === 400 && bad4.error === "incomplete", JSON.stringify(bad4));
    const [s1, sat] = await json(await call(env, `/api/appointments/${id}`, { method: "PATCH", who: "u_rep",
      body: { status: "sat", outcomeNote: "Wants a metal quote too." } }));
    ck("the rep records that it ran", s1 === 200 && sat.appointment?.status === "sat" && sat.appointment?.outcomeNote === "Wants a metal quote too.",
      JSON.stringify(sat));

    console.log("\n-- sold becomes a job, once --");
    const seedJob = jobSeedFromAppointment(sat.appointment);
    const [cc1, cv1] = await json(await call(env, "/api/jobs", { method: "POST", who: "u_cc",
      body: { ...seedJob, fromAppointment: id } }));
    ck("the call center cannot make the job", cc1 === 403, String(cc1));
    const [j1, jb] = await json(await call(env, "/api/jobs", { method: "POST", who: "u_admin",
      body: { ...seedJob, date: DAY, fromAppointment: id } }));
    ck("an admin turns it into a job", j1 === 201 && jb.id && jb.fromAppointment?.linked === true, JSON.stringify({ j1, jb: jb.fromAppointment, e: jb.error }));
    const ap = db.prepare(`SELECT status, job_id FROM sales_appointments WHERE id = ?`).get(id);
    ck("the appointment reads sold and points at the job", ap.status === "sold" && ap.job_id === jb.id, JSON.stringify(ap));
    const jobRow = db.prepare(`SELECT trades, client, zip FROM jobs WHERE id = ?`).get(jb.id);
    ck("the job carries the trades and the homeowner", jobRow.trades === '["roofing","gutters"]' && jobRow.client === "Dana Ruiz",
      JSON.stringify(jobRow));
    const [j2, jb2] = await json(await call(env, "/api/jobs", { method: "POST", who: "u_admin",
      body: { ...seedJob, date: DAY, fromAppointment: id } }));
    ck("a second press is refused, naming the job", j2 === 409 && jb2.error === "appointment_already_a_job" && jb2.jobId === jb.id,
      JSON.stringify(jb2));
    ck("and makes no second job", db.prepare(`SELECT COUNT(*) AS n FROM jobs`).get().n === 1);
    const [e1, eb] = await json(await call(env, `/api/appointments/${id}`, { method: "PATCH", who: "u_admin", body: { status: "lost" } }));
    ck("an appointment that is a job cannot be changed", e1 === 409 && eb.error === "already_a_job", JSON.stringify(eb));

    const [x1] = await json(await call(env, "/api/appointments/nope", { method: "PATCH", body: { status: "confirmed" } }));
    ck("another id is not found", x1 === 404);

    console.log("\n-- a canceled one, then the call center --");
    const other = list.appointments.find((a) => a.id !== id).id;
    await call(env, `/api/appointments/${other}`, { method: "PATCH", who: "u_rep", body: { status: "no_show" } });
    const [n1, nb] = await json(await call(env, `/api/appointments/${other}`, { method: "PATCH", body: { status: "scheduled" } }));
    ck("once the outcome is recorded the call center cannot reopen it", n1 === 409 && nb.error === "outcome_recorded", JSON.stringify(nb));
    const [ns, nsb] = await json(await call(env, "/api/jobs", { method: "POST", who: "u_admin", body: { ...seedJob, fromAppointment: other } }));
    ck("a no-show is not turned into a job", ns === 409 && nsb.error === "appointment_not_sold", JSON.stringify(nsb));
  }

  console.log("\n-- only accounts that sell to homeowners --");
  {
    const { env } = seed();
    const [st, b] = await json(await call(env, "/api/appointments", { who: "u_pmadmin", acct: "acc_pm" }));
    ck("a property manager has no appointments", st === 403 && b.error === "no_appointments_for_this_account", JSON.stringify(b));
    const [ust, ub] = await json(await call(env, "/api/account-users", { method: "POST", who: "u_pmadmin", acct: "acc_pm",
      body: { name: "Call Person", email: "call@soundpm.test", role: "callcenter" } }));
    ck("and cannot add a call-center seat", ust === 400 && ub.error === "no_appointments_for_this_account", JSON.stringify(ub));
    const [gst] = await json(await call(env, "/api/account-users", { method: "POST", who: "u_admin",
      body: { name: "New Caller", email: "new@outerhome.test", role: "callcenter" } }));
    ck("a general contractor can", gst === 200 || gst === 201, String(gst));
  }

  console.log("\n-- a database without 105 --");
  {
    const { env } = seed({ drop105: true });
    const [st, b] = await json(await call(env, "/api/appointments"));
    ck("names the migration", st === 503 && b.migration === "105_sales_appointments", JSON.stringify(b));
  }
} catch (err) {
  ck("the suite ran to the end", false, err?.stack || String(err));
}
globalThis.fetch = realFetch;
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
