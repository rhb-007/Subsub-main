// 108. CRM SALES APPOINTMENTS ON GOOGLE CALENDAR, end to end through the real
// Worker, with Google stubbed at fetch the way gcal-test does it.
//
// Asked for as: "make sure that the appointments within the CRM are also being
// added to a calendar, so there needs to be another calendar setting
// integration with Google Calendar for CRM specific sales meetings".
//
// What is pinned:
//   A CALENDAR OF ITS OWN, "SubSub Sales", never the jobs one, made only once
//   there is an estimate to put on it.
//   WHOSE: the sales manager the estimate is for, while they hold an admin or
//   pm seat on an account that sells to homeowners. Not the booker.
//   WHAT: the work, the address, a first name and initial; never a phone or
//   an email. A canceled one comes off; one that has happened says how it went.
//   IN STEP: booking, moving, reassigning and canceling each reach Google
//   without waiting for the sweep.
//   ITS OWN SWITCH: off takes the SubSub Sales calendar off Google and leaves
//   the jobs calendar alone.
//   BUSY: an estimate the sales manager's own calendar shows taken is refused
//   by name, Book anyway gets past it, and an edit that moves nothing is never
//   refused.
//
//   node --no-warnings scripts/gcal-sales-test.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { signEstimateFor } from "./lib/signed-estimate.mjs";
import { runCheck } from "./lib/check-sql.mjs";
import { salesEventFor, salesOnCalendar, plusMinutes, wallToUtc, GCAL_REQUIRED_SCOPES,
  GCAL_SALES_CALENDAR_NAME } from "../shared/gcal.js";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d && !ok ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(join(app, "worker", "schema.sql"), "utf8");
const KEY = "a-long-random-sealing-key-for-tests-0108";
const TZ = "America/Los_Angeles";
const iso = (ms) => new Date(ms).toISOString();
const dayAhead = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const D1 = dayAhead(20), D2 = dayAhead(27), FAR = dayAhead(400);
const settle = () => new Promise((r) => setTimeout(r, 60));

// ---- Google ------------------------------------------------------------------
const G = { calls: [], busy: {}, events: new Map(), calendars: new Map(), n: 0 };
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url;
  const method = init.method || "GET";
  const auth = init.headers?.Authorization || null;
  let body = null;
  if (typeof init.body === "string") { try { body = JSON.parse(init.body); } catch { body = init.body; } }
  G.calls.push({ url, method, body });
  const json = (status, b) => new Response(b == null ? null : JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
  if (url.startsWith("https://oauth.test/token")) {
    const f = new URLSearchParams(init.body);
    if (f.get("grant_type") === "authorization_code") {
      const who = f.get("code").replace(/^code-/, "");
      const payload = Buffer.from(JSON.stringify({ email: `${who}@gmail.test` })).toString("base64url");
      return json(200, { access_token: `at-${who}`, expires_in: 3599, refresh_token: `rt-${who}`,
        scope: `openid email ${GCAL_REQUIRED_SCOPES.join(" ")}`, id_token: `h.${payload}.s` });
    }
    return json(200, { access_token: String(f.get("refresh_token")).replace(/^rt-/, "at-"), expires_in: 3599 });
  }
  if (url.startsWith("https://oauth.test/revoke")) return json(200, {});
  if (url.startsWith("https://gapi.test/calendar/v3")) {
    const who = String(auth || "").replace(/^Bearer at-/, "");
    const path = new URL(url).pathname.replace("/calendar/v3", "");
    if (path === "/freeBusy" && method === "POST") return json(200, { calendars: { primary: { busy: G.busy[who] || [] } } });
    if (path === "/calendars" && method === "POST") {
      const id = `cal-${who}-${++G.n}`;
      G.calendars.set(id, body);
      return json(200, { id, summary: body.summary });
    }
    let m;
    if ((m = path.match(/^\/calendars\/([^/]+)$/)) && method === "DELETE") {
      const cal = decodeURIComponent(m[1]);
      G.calendars.delete(cal);
      for (const [k, v] of G.events) if (v.cal === cal) G.events.delete(k);
      return new Response(null, { status: 204 });
    }
    if ((m = path.match(/^\/calendars\/([^/]+)\/events$/)) && method === "POST") {
      const cal = decodeURIComponent(m[1]);
      if (!G.calendars.has(cal)) return json(404, { error: { message: "Not Found" } });
      const id = `ev${++G.n}`;
      G.events.set(id, { cal, ...body });
      return json(200, { id, ...body });
    }
    if ((m = path.match(/^\/calendars\/([^/]+)\/events\/([^/]+)$/))) {
      const id = decodeURIComponent(m[2]);
      if (!G.events.has(id)) return json(404, { error: { message: "Not Found" } });
      if (method === "PATCH") { G.events.set(id, { ...G.events.get(id), ...body }); return json(200, { id }); }
      if (method === "DELETE") { G.events.delete(id); return new Response(null, { status: 204 }); }
    }
    return json(404, {});
  }
  if (url.includes("api.resend.com")) return json(200, { id: "em" });
  return new Response("nope", { status: 404 });
};

const DETAILS = JSON.stringify({
  roofing: { material: "Asphalt shingle", age: "Over 20 years", leaks: "Yes", stories: "2", storm: "No" },
  gutters: { scope: "Whole home", stories: "2", issues: ["Overflowing", "Sagging"] },
});
const appt = (id, rep, date, time, over = {}) => ({ id, rep, date, time, status: "scheduled", minutes: 90, ...over });
const seed = ({ drop108 = false } = {}) => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,kind,subdomain,plan) VALUES
      ('acc_gc','Outerhome','general_contractor','outerhome','scale'),
      ('acc_pm','Sound Property Management','property_manager','soundpm','scale');
    INSERT INTO users(id,name,email,phone) VALUES
      ('u_rep','Marcus Hill','marcus@outerhome.test','+12535550100'),
      ('u_admin','Richard Braun','rb@outerhome.test',NULL),
      ('u_cc','Cara Call','cara@outerhome.test',NULL),
      ('u_pm','Chris Lane','chris@soundpm.test',NULL);
    INSERT INTO memberships(id,user_id,account_id,role) VALUES
      ('m_rep','u_rep','acc_gc','pm'),
      ('m_admin','u_admin','acc_gc','admin'),
      ('m_cc','u_cc','acc_gc','callcenter'),
      ('m_pm','u_pm','acc_pm','admin');
  `);
  const ins = db.prepare(`INSERT INTO sales_appointments (id, account_id, status, direction, services, details, home,
      first_name, last_name, phone, email, street, city, state, zip, second, date, time, minutes, rep_user_id, created_by)
    VALUES (?, 'acc_gc', ?, 'inbound', '["roofing","gutters"]', '${DETAILS}', '{"owns":"Yes","timeline":"Within 3 months"}', 'Dana', 'Ruiz', '2535550142', 'dana@home.test',
      '1204 N Pine St', 'Tacoma', 'WA', '98406', ?, ?, ?, ?, ?, 'u_cc')`);
  for (const a of [
    appt("a1", "u_rep", D1, "10:00", { second: '{"firstName":"Alex","lastName":"Ruiz","relationship":"Spouse","attends":true}' }),
    appt("a_gone", "u_rep", D1, "15:00", { status: "cancelled" }),
    appt("a_far", "u_rep", FAR, "10:00"),
  ]) ins.run(a.id, a.status, a.second || null, a.date, a.time, a.minutes, a.rep);
  if (drop108) db.exec(`DROP TABLE gcal_sales; DROP TABLE gcal_sales_events;`);
  return db;
};
const DB = seed();
const ENV = { DB: makeD1(DB), INTEGRATION_SECRET_KEY: KEY, GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "secret",
  GOOGLE_OAUTH_API_BASE: "https://oauth.test", GOOGLE_API_BASE: "https://gapi.test",
  RESEND_API_KEY: "re_test", MAIL_FROM: "SubSub <hello@subsub.work>", FILES: { put: async () => {}, get: async () => null } };
const SEATS = { rep: ["u_rep", "acc_gc"], admin: ["u_admin", "acc_gc"], cc: ["u_cc", "acc_gc"], pm: ["u_pm", "acc_pm"] };
const call = async (seat, path, { method = "GET", body, env = ENV } = {}) => {
  const [u, a] = SEATS[seat];
  const r = await worker.fetch(new Request(`https://api.subsub.work${path}`, {
    method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: { "Content-Type": "application/json", "X-User-Id": u, "X-Account-Id": a },
  }), env);
  return [r.status, await r.json().catch(() => ({}))];
};
const connect = async (seat, code, env = ENV) => {
  const [, b] = await call(seat, "/api/google-calendar/start", { method: "POST",
    body: { timeZone: TZ, returnTo: "https://outerhome.subsub.work/" }, env });
  const state = new URL(b.url).searchParams.get("state");
  const r = await worker.fetch(new Request(`https://api.subsub.work/api/google-calendar/callback?state=${state}&code=code-${code}`,
    { redirect: "manual" }), env);
  await settle();
  return r.headers.get("location");
};
const calsOf = (who) => [...G.calendars.entries()].filter(([id]) => id.startsWith(`cal-${who}-`));
const salesCal = (who) => calsOf(who).find(([, b]) => b.summary === GCAL_SALES_CALENDAR_NAME)?.[0] || null;
const jobsCal = (who) => calsOf(who).find(([, b]) => b.summary === "SubSub Jobs")?.[0] || null;
const evOn = (cal) => [...G.events.values()].filter((e) => e.cal === cal);
const evFor = (cal, apptId) => evOn(cal).find((e) => e.extendedProperties?.private?.subsubAppointment === apptId);
const booking = (over = {}) => ({
  direction: "inbound", source: "Google", services: ["roofing"],
  details: { roofing: { material: "Asphalt shingle", age: "Over 20 years", leaks: "Yes", stories: "2", storm: "No" } },
  home: { owns: "Yes", timeline: "Within 3 months" },
  homeowner: { firstName: "Lee", lastName: "Park", phone: "(253) 555-0177", email: "lee@home.test" },
  address: { street: "88 Oak Ave", city: "Tacoma", state: "WA", zip: "98405" },
  second: null, date: D2, time: "13:00", minutes: 60, repId: "u_rep",
  consent: { email: false, phone: true, text: false, record: null }, emailHomeowner: false,
  ...over,
});

try {
  console.log("\n-- the rules in shared/gcal.js --");
  {
    const ev = salesEventFor({ appointmentId: "a9", status: "scheduled", date: "2026-12-07", time: "10:00", minutes: 90,
      services: ["Roof replacement", "Gutter replacement"], firstName: "Dana", lastName: "Ruiz",
      address: "1204 N Pine St, Tacoma, WA 98406", second: true, secondAttends: true, account: "Outerhome",
      link: "https://app.subsub.work/?open=appointment&id=a9" }, TZ);
    ck("labelled as a SubSub estimate, naming the work and a first name and initial",
      ev.summary === "SubSub Estimate: Roof replacement, Gutter replacement -- Dana R.", ev.summary);
    ck("runs for its own length, in its own zone",
      ev.start.dateTime === "2026-12-07T10:00:00" && ev.end.dateTime === "2026-12-07T11:30:00" && ev.start.timeZone === TZ);
    ck("blocks time: an estimate is a commitment", ev.transparency === "opaque");
    ck("with the address as its place", ev.location === "1204 N Pine St, Tacoma, WA 98406");
    ck("says the second decision maker will be there", /Both decision makers/.test(ev.description));
    ck("and links straight to the appointment", /open=appointment&id=a9/.test(ev.description));
    ck("tagged with the appointment, not a visit",
      ev.extendedProperties.private.subsubAppointment === "a9" && !ev.extendedProperties.private.subsubVisit);
    const sold = salesEventFor({ appointmentId: "a9", status: "sold", date: "2026-12-07", time: "10:00", services: ["Roof replacement"] }, TZ);
    ck("one that has happened says how it went", / \(sold\)$/.test(sold.summary), sold.summary);
    ck("a canceled one is not on the calendar, anything else is",
      !salesOnCalendar("cancelled") && ["scheduled", "confirmed", "sat", "sold", "lost", "no_show"].every(salesOnCalendar));
    ck("an estimate running past midnight ends on its own day", plusMinutes("23:30", 90) === "23:59");
  }

  console.log("\n-- who is offered it --");
  {
    const [s, b] = await call("rep", "/api/google-calendar");
    ck("a sales manager on an account that sells to homeowners is offered it, on by default",
      s === 200 && b.sales?.available === true && b.sales.on === true && b.sales.calendarName === "SubSub Sales", JSON.stringify(b.sales));
    const [, p] = await call("pm", "/api/google-calendar");
    ck("a property manager's admin is not: nothing to estimate", p.sales?.available === false, JSON.stringify(p.sales));
  }

  console.log("\n-- connecting --");
  {
    const to = await connect("rep", "rep");
    ck("connects", (to || "").endsWith("gcal=connected"), to);
    const sc = salesCal("rep");
    ck("a calendar of its own, called SubSub Sales, beside SubSub Jobs", sc && jobsCal("rep") && sc !== jobsCal("rep"),
      JSON.stringify(calsOf("rep").map(([, b]) => b.summary)));
    const mine = evOn(sc);
    ck("one event: the live estimate they are the sales manager for", mine.length === 1 && !!evFor(sc, "a1"),
      JSON.stringify(mine.map((e) => e.summary)));
    ck("not the canceled one", !evFor(sc, "a_gone"));
    ck("not one past the four months the calendar keeps", !evFor(sc, "a_far"));
    ck("not on the jobs calendar", evOn(jobsCal("rep")).every((e) => !e.extendedProperties?.private?.subsubAppointment));
    const e = evFor(sc, "a1") || {};
    ck("carries no phone number and no email", !/555|2535550142|@home\.test/.test(JSON.stringify(e)), JSON.stringify(e));
    const [, st] = await call("rep", "/api/google-calendar");
    ck("the panel counts it", st.sales.events === 1, JSON.stringify(st.sales));

    await connect("admin", "admin");
    ck("somebody with no estimates gets no SubSub Sales calendar", jobsCal("admin") && !salesCal("admin"),
      JSON.stringify(calsOf("admin").map(([, b]) => b.summary)));
  }

  console.log("\n-- booked, moved, reassigned, canceled --");
  let a2 = null;
  {
    const [s, b] = await call("cc", "/api/appointments", { method: "POST", body: booking() });
    a2 = b.appointment?.id;
    await settle();
    ck("a booking by the call center is on the sales manager's calendar straight away",
      s === 201 && !!evFor(salesCal("rep"), a2), `${s} ${JSON.stringify(b).slice(0, 200)}`);
    ck("not on the booker's", !calsOf("cc").length);

    const [s2] = await call("cc", `/api/appointments/${a2}`, { method: "PATCH", body: { time: "15:00" } });
    await settle();
    const moved = evFor(salesCal("rep"), a2) || {};
    ck("moving it moves the event", s2 === 200 && moved.start?.dateTime === `${D2}T15:00:00`, `${s2} ${JSON.stringify(moved.start)}`);
    ck("by patching it rather than adding another", evOn(salesCal("rep")).filter((e) => e.extendedProperties?.private?.subsubAppointment === a2).length === 1);

    const [s3, b3x] = await call("admin", `/api/appointments/a1`, { method: "PATCH", body: { repId: "u_admin" } });
    await settle();
    ck("reassigned: off the old sales manager's calendar", s3 === 200 && !evFor(salesCal("rep"), "a1"), `${s3} ${JSON.stringify(b3x)}`);
    ck("and onto the new one's, whose SubSub Sales calendar is made for it", !!salesCal("admin") && !!evFor(salesCal("admin"), "a1"));

    signEstimateFor(DB, "a1");
    await call("admin", `/api/appointments/a1`, { method: "PATCH", body: { status: "sold" } });
    await settle();
    ck("an outcome shows in the title", / \(sold\)$/.test(evFor(salesCal("admin"), "a1")?.summary || ""), evFor(salesCal("admin"), "a1")?.summary);

    const [s4] = await call("cc", `/api/appointments/${a2}`, { method: "PATCH", body: { status: "cancelled" } });
    await settle();
    ck("canceling takes it off", s4 === 200 && !evFor(salesCal("rep"), a2), String(s4));
  }

  console.log("\n-- a time their calendar already shows taken --");
  {
    G.busy.rep = [{ start: iso(wallToUtc(D2, "09:00", TZ)), end: iso(wallToUtc(D2, "12:00", TZ)) }];
    const [s, b] = await call("cc", "/api/appointments", { method: "POST", body: booking({ time: "10:00" }) });
    ck("an estimate the sales manager's own calendar shows busy is refused by name",
      s === 409 && b.error === "rep_calendar_busy" && b.repName === "Marcus Hill", `${s} ${JSON.stringify(b)}`);
    const [s2] = await call("cc", "/api/appointments", { method: "POST", body: booking({ time: "12:00" }) });
    ck("a time after it goes", s2 === 201, String(s2));
    const [s3, b3] = await call("cc", "/api/appointments", { method: "POST", body: booking({ time: "10:00", allowClash: true }) });
    ck("and Book anyway gets past it", s3 === 201, `${s3} ${JSON.stringify(b3).slice(0, 120)}`);
    const id3 = b3.appointment?.id;
    const [s4] = await call("cc", `/api/appointments/${id3}`, { method: "PATCH", body: { notes: "Gate code 1234" } });
    ck("an edit that moves nothing is never refused over it", s4 === 200, String(s4));
    const [s5, b5] = await call("cc", `/api/appointments/${id3}`, { method: "PATCH", body: { time: "11:00" } });
    ck("an edit that moves it into the busy time is", s5 === 409 && b5.error === "rep_calendar_busy", String(s5));
    await call("rep", "/api/google-calendar", { method: "PATCH", body: { blockOn: false } });
    const [s6] = await call("cc", "/api/appointments", { method: "POST", body: booking({ time: "09:00" }) });
    ck("with the check turned off, nothing blocks", s6 === 201, String(s6));
    await call("rep", "/api/google-calendar", { method: "PATCH", body: { blockOn: true } });
    const [s7] = await call("cc", "/api/appointments", { method: "POST", body: booking({ time: "10:15", repId: "u_admin" }) });
    ck("another sales manager free then is booked", s7 === 201, String(s7));
    G.busy.rep = [];
  }

  console.log("\n-- its own switch --");
  {
    const jc = jobsCal("rep"), sc = salesCal("rep");
    const [s] = await call("rep", "/api/google-calendar", { method: "PATCH", body: { salesOn: false } });
    ck("off takes the SubSub Sales calendar off Google", s === 200 && !G.calendars.has(sc), String(s));
    ck("and leaves the jobs calendar alone", G.calendars.has(jc));
    ck("and forgets the events", !DB.prepare(`SELECT 1 FROM gcal_sales_events WHERE user_id = 'u_rep'`).get());
    const [, st] = await call("rep", "/api/google-calendar");
    ck("the panel reads it as off", st.sales.on === false && st.syncOn === true, JSON.stringify(st.sales));
    await call("rep", "/api/google-calendar/sync", { method: "POST" });
    ck("and a sync does not put it back", !salesCal("rep"));
    const [s2] = await call("rep", "/api/google-calendar", { method: "PATCH", body: { salesOn: true } });
    ck("on makes it again, with their estimates", s2 === 200 && !!salesCal("rep") && evOn(salesCal("rep")).length >= 1,
      `${s2} ${evOn(salesCal("rep") || "").length}`);
    const [s3, b3] = await call("rep", "/api/google-calendar", { method: "PATCH", body: { salesOn: "yes" } });
    ck("a value that is not true or false is refused", s3 === 400 && b3.field === "salesOn");
    // The jobs switch off does not stop the sales calendar.
    await call("rep", "/api/google-calendar", { method: "PATCH", body: { syncOn: false } });
    const { gcalSweep } = await import("../worker/index.js");
    const someId = DB.prepare(`SELECT appointment_id AS id FROM gcal_sales_events WHERE user_id = 'u_rep' LIMIT 1`).get()?.id;
    DB.prepare(`UPDATE sales_appointments SET time = '07:45' WHERE id = ?`).run(someId);
    await gcalSweep(ENV);
    ck("the sweep keeps the sales calendar in step with the jobs switch off",
      evFor(salesCal("rep"), someId)?.start?.dateTime === `${D2}T07:45:00`, JSON.stringify(evFor(salesCal("rep"), someId)?.start));
    await call("rep", "/api/google-calendar", { method: "PATCH", body: { syncOn: true } });
  }

  console.log("\n-- leaving the account --");
  {
    DB.prepare(`DELETE FROM memberships WHERE id = 'm_rep'`).run();
    await call("rep", "/api/google-calendar/sync", { method: "POST" }).catch(() => null);
    const { gcalSweep } = await import("../worker/index.js");
    await gcalSweep(ENV);
    ck("somebody taken off the account stops getting its estimates", evOn(salesCal("rep")).length === 0);
    DB.prepare(`INSERT INTO memberships(id,user_id,account_id,role) VALUES ('m_rep','u_rep','acc_gc','pm')`).run();
  }

  console.log("\n-- disconnecting --");
  {
    const sc = salesCal("admin"), jc = jobsCal("admin");
    const [s] = await call("admin", "/api/google-calendar", { method: "DELETE" });
    ck("both SubSub calendars come off their Google account", s === 200 && !G.calendars.has(sc) && !G.calendars.has(jc), String(s));
    ck("and nothing is left pointing at them", !DB.prepare(`SELECT 1 FROM gcal_sales_events WHERE user_id = 'u_admin'`).get());
  }

  console.log("\n-- a database without 108 --");
  {
    const db2 = seed({ drop108: true });
    const env2 = { ...ENV, DB: makeD1(db2) };
    const to = await connect("rep", "rep2", env2);
    ck("connecting still works", (to || "").endsWith("gcal=connected"), to);
    const [, st] = await call("rep", "/api/google-calendar", { env: env2 });
    ck("the panel names the file", st.connected && st.sales?.migration === "108_gcal_sales", JSON.stringify(st.sales));
    const [s, b] = await call("rep", "/api/google-calendar", { method: "PATCH", body: { salesOn: true }, env: env2 });
    ck("and the switch says which file", s === 503 && b.migration === "108_gcal_sales", `${s} ${JSON.stringify(b)}`);
    const [s2] = await call("cc", "/api/appointments", { method: "POST", body: booking({ time: "16:00" }), env: env2 });
    ck("booking an estimate is not stopped by it", s2 === 201, String(s2));
    const [s3] = await call("rep", "/api/google-calendar", { method: "DELETE", env: env2 });
    ck("and nor is disconnecting", s3 === 200, String(s3));
  }

  console.log("\n-- CHECK.sql --");
  {
    const r = runCheck(DB);
    ck("108 reads as run on a migrated database", r.m108_gcal_sales > 0 && r.m108_gcal_sales_events > 0, JSON.stringify([r.m108_gcal_sales, r.m108_gcal_sales_events]));
    const r2 = runCheck(seed({ drop108: true }));
    ck("and as not run without it", r2.m108_gcal_sales === 0 && r2.m108_gcal_sales_events === 0);
  }
} catch (err) {
  fail++;
  console.log("FAIL  threw:", err?.stack || err);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
