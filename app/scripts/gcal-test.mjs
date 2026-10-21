// 094. GOOGLE CALENDAR, end to end through the real Worker, with Google
// stubbed at fetch in the shapes of its own discovery document.
//
// Asked for as: "sync jobs with their Google Calendar -- labeled as SubSub
// jobs" and "should not schedule in SubSub if their Google Calendar is showing
// as already scheduled with something else".
//
// What is pinned:
//   CONNECTING asks for the two narrow scopes, offline, and comes back through
//   a one-use state row; the refresh token is sealed at rest; a consent that
//   left either scope unticked is refused and revoked.
//   SYNC writes a calendar of SubSub's own called "SubSub Jobs", one event per
//   live visit of the person's own work, rewrites what changed, deletes what
//   is no longer live, and carries no phone number.
//   BUSY: a window the crew's own calendar shows taken is refused by name;
//   the crew's own proposal is not; a company counts as busy only when every
//   connected person there is; an unreadable calendar blocks nothing; and the
//   auto-scheduler moves the job's own time off a busy slot.
//
//   node --no-warnings scripts/gcal-test.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { runCheck } from "./lib/check-sql.mjs";
import { openSecret } from "../worker/secretbox.js";
import { rankCandidates, busyFor } from "../shared/autopick.js";
import { eventFor, wallToUtc, companyBusyAt, gcalReturnTo, scopesGranted, GCAL_REQUIRED_SCOPES }
  from "../shared/gcal.js";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d && !ok ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(join(app, "worker", "schema.sql"), "utf8");
const KEY = "a-long-random-sealing-key-for-tests-0094";
const TZ = "America/Los_Angeles";
const VERIFIED = `{"insurance":{"status":"verified"},"bond":{"status":"verified"},"contract":{"status":"verified"},"w9":{"status":"verified"}}`;

// A weekday about a month out, so every rule about the past stays out of it.
const dayAhead = (n) => { const d = new Date(Date.now() + n * 86400000); return d.toISOString().slice(0, 10); };
let X = dayAhead(30);
for (let i = 31; [0, 6].includes(new Date(`${X}T12:00:00Z`).getUTCDay()); i += 1) X = dayAhead(i);
// Two more weekdays, a week and two weeks on, for the auto-scheduler's fixtures.
let W = dayAhead(44);
for (let i = 45; [0, 6].includes(new Date(`${W}T12:00:00Z`).getUTCDay()); i += 1) W = dayAhead(i);
let Z = dayAhead(37);
for (let i = 38; [0, 6].includes(new Date(`${Z}T12:00:00Z`).getUTCDay()); i += 1) Z = dayAhead(i);

// A Monday two months out, for a job that takes three working days: M, M+1, M+2.
let M = dayAhead(60);
for (let i = 61; new Date(`${M}T12:00:00Z`).getUTCDay() !== 1; i += 1) M = dayAhead(i);
const plusDays = (k, n) => new Date(Date.parse(`${k}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const M2 = plusDays(M, 2);

// ---- Google, as its discovery document describes it -------------------------
const G = { calls: [], busy: {}, down: false, dead: new Set(), events: new Map(), calendars: new Map(), n: 0 };
const iso = (ms) => new Date(ms).toISOString();
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url;
  const method = init.method || "GET";
  const auth = init.headers?.Authorization || null;
  let body = null;
  if (typeof init.body === "string") { try { body = JSON.parse(init.body); } catch { body = init.body; } }
  G.calls.push({ url, method, auth, body });
  const json = (status, b) => new Response(b == null ? null : JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
  if (url.startsWith("https://oauth.test/token")) {
    const f = new URLSearchParams(init.body);
    if (f.get("client_secret") !== "secret") return json(401, { error: "invalid_client" });
    if (f.get("grant_type") === "authorization_code") {
      const who = f.get("code").replace(/^code-/, "");
      const scope = who.endsWith("-noscope") ? "openid email https://www.googleapis.com/auth/calendar.app.created" : `openid email ${GCAL_REQUIRED_SCOPES.join(" ")}`;
      const payload = Buffer.from(JSON.stringify({ email: `${who}@gmail.test`, email_verified: true })).toString("base64url");
      return json(200, { access_token: `at-${who}`, expires_in: 3599, refresh_token: who.endsWith("-norefresh") ? undefined : `rt-${who}`,
        scope, token_type: "Bearer", id_token: `h.${payload}.s` });
    }
    const rt = f.get("refresh_token");
    // Google answers invalid_grant to a refresh token it never issued.
    if (G.dead.has(rt) || !String(rt).startsWith("rt-")) return json(400, { error: "invalid_grant" });
    return json(200, { access_token: rt.replace(/^rt-/, "at-"), expires_in: 3599 });
  }
  if (url.startsWith("https://oauth.test/revoke")) return json(200, {});
  if (url.startsWith("https://gapi.test/calendar/v3")) {
    if (G.down) return json(503, { error: { message: "down" } });
    const who = String(auth || "").replace(/^Bearer at-/, "");
    if (G.dead.has(`rt-${who}`)) return json(401, { error: { code: 401, message: "Invalid Credentials" } });
    const path = new URL(url).pathname.replace("/calendar/v3", "");
    if (path === "/freeBusy" && method === "POST" && G.downFor === who) return json(503, { error: { message: "down" } });
    if (path === "/freeBusy" && method === "POST") return json(200, { kind: "calendar#freeBusy",
      calendars: { primary: { busy: G.busy[who] || [] } } });
    if (path === "/calendars" && method === "POST") {
      const id = `cal-${who}-${++G.n}@group.calendar.google.com`;
      G.calendars.set(id, body);
      return json(200, { id, summary: body.summary, timeZone: body.timeZone });
    }
    let m;
    if ((m = path.match(/^\/calendars\/([^/]+)$/)) && method === "DELETE") {
      G.calendars.delete(decodeURIComponent(m[1])); return new Response(null, { status: 204 });
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
      if (method === "PATCH") { G.events.set(id, { ...G.events.get(id), ...body }); return json(200, { id, ...G.events.get(id) }); }
      if (method === "DELETE") { G.events.delete(id); return new Response(null, { status: 204 }); }
    }
    return json(404, { error: { message: "no route" } });
  }
  return new Response("nope", { status: 404 });
};

const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,kind,subdomain,plan) VALUES
      ('acc_pm','Sound Property Management','property_manager','soundpm','scale'),
      ('acc_other','Other GC','general_contractor','othergc','scale');
    INSERT INTO users(id,name,email,phone) VALUES
      ('u_mgr','Chris Lane','chris@soundpm.test','+12065550100'),
      ('u_crew','Juan Soto','juan@pacific.test','+12065550111'),
      ('u_crew2','Ana Soto','ana@pacific.test',NULL),
      ('u_ten','John Smith','john@tenant.test','+12065550199'),
      ('u_own','Olive Owner','olive@own.test',NULL);
    INSERT INTO companies(id,company,contact,email,state,insurance,bond,contract,w9) VALUES
      ('cmp_crew','Pacific Apartment Maintenance','Juan','juan@pacific.test','WA',1,1,1,1);
    INSERT INTO properties(id,account_id,name,address) VALUES ('p1','acc_pm','Ballard Apts','100 Main St');
    INSERT INTO memberships(id,user_id,account_id,role,company_id) VALUES
      ('m_mgr','u_mgr','acc_pm','admin',NULL),
      ('m_crew','u_crew','acc_pm','contractor','cmp_crew'),
      ('m_crew2','u_crew2','acc_other','contractor','cmp_crew'),
      ('m_ten','u_ten','acc_pm','tenant',NULL),
      ('m_own','u_own','acc_pm','owner',NULL);
    INSERT INTO engagements(id,account_id,company_id,status,categories,doc_review,auto_schedule) VALUES
      ('en_crew','acc_pm','cmp_crew','active','["plumbing","painting"]','${VERIFIED}',1);
    INSERT INTO jobs(id,account_id,property_id,title,address,trades,date,time,status,requested_by,approved_at) VALUES
      ('j1','acc_pm','p1','Leaking sink','100 Main St, Unit 4','["plumbing"]','${X}','10:00','active','u_ten',CURRENT_TIMESTAMP),
      ('j3','acc_pm','p1','Offer not taken','100 Main St','["plumbing"]','${X}',NULL,'active',NULL,NULL),
      ('j4','acc_pm','p1','Repaint hall','100 Main St','["painting"]','${Z}','14:00','active',NULL,NULL),
      ('j5','acc_pm','p1','Swap a tap','100 Main St','["plumbing"]','${W}',NULL,'active',NULL,NULL),
      ('j6','acc_pm','p1','Re-pipe the bathroom','100 Main St','["plumbing"]','${M}',NULL,'active',NULL,NULL),
      ('j7','acc_pm','p1','Repaint three rooms','100 Main St','["painting"]','${plusDays(M, 7)}',NULL,'active',NULL,NULL);
    INSERT INTO job_trade_spans(job_id,trade,start_date,work_days) VALUES
      ('j6','plumbing','${M}',3), ('j7','painting','${plusDays(M, 7)}',3);
    INSERT INTO work_orders(id,wo_number,job_id,trade,company_id,engagement_id,status) VALUES
      ('wo1','WO-1','j1','plumbing','cmp_crew','en_crew','accepted'),
      ('wo3','WO-3','j3','plumbing','cmp_crew','en_crew','pending'),
      ('wo6','WO-6','j6','plumbing','cmp_crew','en_crew','accepted');
    INSERT INTO visits(id,account_id,job_id,proposed_by,date,start_time,end_time,status) VALUES
      ('v1','acc_pm','j1','u_mgr','${X}','13:00','14:00','proposed'),
      ('v3','acc_pm','j3','u_mgr','${X}','08:00','09:00','proposed');
  `);
  return db;
};
const DB = seed();
const ENV = { DB: makeD1(DB), INTEGRATION_SECRET_KEY: KEY, GOOGLE_CLIENT_ID: "cid.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "secret", GOOGLE_OAUTH_API_BASE: "https://oauth.test", GOOGLE_API_BASE: "https://gapi.test",
  FILES: { put: async () => {}, get: async () => null } };
const SEATS = { mgr: ["u_mgr", "acc_pm"], crew: ["u_crew", "acc_pm"], crew2: ["u_crew2", "acc_other"],
  ten: ["u_ten", "acc_pm"], own: ["u_own", "acc_pm"] };
const call = async (seat, path, { method = "GET", body, env = ENV } = {}) => {
  const [u, a] = SEATS[seat];
  const r = await worker.fetch(new Request(`https://api.subsub.work${path}`, {
    method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: { "Content-Type": "application/json", "X-User-Id": u, "X-Account-Id": a },
  }), env);
  return [r.status, await r.json().catch(() => ({})), r];
};
const pub = (path) => worker.fetch(new Request(`https://api.subsub.work${path}`, { redirect: "manual" }), ENV);
const connect = async (seat, code, tz = TZ) => {
  const [s, b] = await call(seat, "/api/google-calendar/start", { method: "POST",
    body: { timeZone: tz, returnTo: "https://soundpm.subsub.work/" } });
  if (s !== 200) return { s, b };
  const state = new URL(b.url).searchParams.get("state");
  const r = await pub(`/api/google-calendar/callback?state=${state}&code=code-${code}`);
  return { s, b, state, r, to: r.headers.get("location") };
};
const evs = (who) => [...G.events.values()].filter((e) => e.cal.startsWith(`cal-${who}-`));

try {
  console.log("\n-- the rules in shared/gcal.js --");
  {
    ck("a wall-clock time is placed in its own zone, across daylight saving",
      iso(wallToUtc("2026-11-02", "09:00", TZ)) === "2026-11-02T17:00:00.000Z"
      && iso(wallToUtc("2026-10-30", "09:00", TZ)) === "2026-10-30T16:00:00.000Z");
    const ev = eventFor({ visitId: "v9", title: "Leaking sink", address: "1 Main", date: "2026-11-02",
      start: "09:00", end: "11:00", status: "proposed", trades: ["Plumbing"], client: "Sound" }, TZ);
    ck("a proposed time is labelled as a SubSub job and as proposed", ev.summary === "SubSub Job: Leaking sink (proposed)");
    ck("and does not show them busy until it is confirmed", ev.transparency === "transparent");
    ck("its time carries the zone rather than an offset", ev.start.dateTime === "2026-11-02T09:00:00" && ev.start.timeZone === TZ);
    const conf = eventFor({ visitId: "v9", title: "T", date: "2026-11-02", start: "09:00", status: "confirmed" }, TZ);
    ck("a confirmed one blocks time and has no '(proposed)'", conf.transparency === "opaque" && !/proposed/.test(conf.summary));
    const allDay = eventFor({ visitId: "v9", title: "T", date: "2026-11-02", status: "confirmed" }, TZ);
    ck("a visit with no time is an all-day event", allDay.start.date === "2026-11-02" && allDay.end.date === "2026-11-03");
    const busy = [{ start: iso(wallToUtc("2026-11-02", "09:00", TZ)), end: iso(wallToUtc("2026-11-02", "12:00", TZ)) }];
    ck("a company is busy when everybody connected is", companyBusyAt([{ tz: TZ, busy }], "2026-11-02", "10:00", "11:00"));
    ck("and not when one of them is free", !companyBusyAt([{ tz: TZ, busy }, { tz: TZ, busy: [] }], "2026-11-02", "10:00", "11:00"));
    ck("nobody readable is never busy", !companyBusyAt([], "2026-11-02", "10:00", "11:00"));
    ck("a window after the busy period is free", !companyBusyAt([{ tz: TZ, busy }], "2026-11-02", "12:00", "13:00"));
    ck("only a SubSub address is a return address",
      gcalReturnTo("https://soundpm.subsub.work/x?y") === "https://soundpm.subsub.work/x"
      && gcalReturnTo("https://subsub.work.evil.test/") === null && gcalReturnTo("http://app.subsub.work/") === null);
    ck("a consent missing a scope is not enough", !scopesGranted("openid https://www.googleapis.com/auth/calendar.app.created"));
  }

  console.log("\n-- not set up, and who may use it --");
  {
    const [s, b] = await call("mgr", "/api/google-calendar", { env: { ...ENV, GOOGLE_CLIENT_SECRET: "" } });
    ck("without the OAuth client it says so", s === 200 && b.configured === false && b.connected === false, JSON.stringify(b));
    const [s2, b2] = await call("mgr", "/api/google-calendar/start", { method: "POST", body: { timeZone: TZ },
      env: { ...ENV, GOOGLE_CLIENT_ID: "" } });
    ck("and starting is refused by name", s2 === 501 && b2.error === "not_configured");
    const [s3] = await call("ten", "/api/google-calendar");
    ck("a tenant may use it", s3 === 200);
    const [s4] = await call("own", "/api/google-calendar");
    ck("a building owner's guest seat is refused", s4 === 403, String(s4));
    const [s5, b5] = await call("crew", "/api/google-calendar/start", { method: "POST", body: { timeZone: "Mars/Olympus" } });
    ck("a time zone nobody knows is refused", s5 === 400 && b5.error === "bad_time_zone");
  }

  console.log("\n-- connecting --");
  let crewState;
  {
    const c = await connect("crew", "crew");
    crewState = c.state;
    const u = new URL(c.b.url);
    ck("Google's consent address", `${u.origin}${u.pathname}` === "https://accounts.google.com/o/oauth2/v2/auth");
    const scope = (u.searchParams.get("scope") || "").split(" ");
    ck("asks for exactly the two calendar scopes it needs, and nothing wider",
      GCAL_REQUIRED_SCOPES.every((s) => scope.includes(s)) && !scope.some((s) => /auth\/calendar$|calendar\.events$|calendar\.readonly/.test(s)), scope.join(" "));
    ck("offline, with consent asked again so a refresh token comes back",
      u.searchParams.get("access_type") === "offline" && u.searchParams.get("prompt") === "consent");
    ck("back to this Worker's callback", u.searchParams.get("redirect_uri") === "https://api.subsub.work/api/google-calendar/callback");
    ck("the callback is public and lands them back where they were",
      c.r.status === 302 && c.to === "https://soundpm.subsub.work/?gcal=connected", `${c.r.status} ${c.to}`);
    const row = DB.prepare(`SELECT * FROM gcal_connections WHERE user_id = 'u_crew'`).get();
    ck("the refresh token is sealed, not stored as it came",
      row && row.refresh_enc !== "rt-crew" && await openSecret(ENV, row.refresh_enc) === "rt-crew");
    ck("their Google address and zone are kept", row?.google_email === "crew@gmail.test" && row?.time_zone === TZ);
    const again = await pub(`/api/google-calendar/callback?state=${c.state}&code=code-crew`);
    ck("a state works once", (again.headers.get("location") || "").endsWith("gcal=expired"));
    const bogus = await pub(`/api/google-calendar/callback?state=nope&code=code-crew`);
    ck("an unknown state goes nowhere", (bogus.headers.get("location") || "") === "https://app.subsub.work/?gcal=expired");

    const before = G.calls.filter((x) => x.url.startsWith("https://oauth.test/revoke")).length;
    const n = await connect("mgr", "mgr-noscope");
    ck("a consent with a scope unticked is refused", (n.to || "").endsWith("gcal=missing_scope"));
    ck("and what it did grant is handed back", G.calls.filter((x) => x.url.startsWith("https://oauth.test/revoke")).length === before + 1);
    ck("and nothing is stored", !DB.prepare(`SELECT 1 FROM gcal_connections WHERE user_id = 'u_mgr'`).get());
    const nr = await connect("mgr", "mgr-norefresh");
    ck("no lasting access is said rather than stored", (nr.to || "").endsWith("gcal=no_refresh"));

    // A wrong GOOGLE_CLIENT_SECRET: Google sends them back, then refuses the
    // code exchange. The reason rides back so the screen can say it, instead
    // of "try again in a minute", which pressing again never fixes.
    const [, sb] = await call("mgr", "/api/google-calendar/start", { method: "POST",
      body: { timeZone: TZ, returnTo: "https://soundpm.subsub.work/" } });
    const bst = new URL(sb.url).searchParams.get("state");
    const badEnv = { ...ENV, GOOGLE_CLIENT_SECRET: "wrong" };
    const bad = await worker.fetch(new Request(`https://api.subsub.work/api/google-calendar/callback?state=${bst}&code=code-mgr`,
      { redirect: "manual" }), badEnv);
    const badTo = new URL(bad.headers.get("location") || "https://x/");
    ck("a refused exchange names Google's reason on the way back",
      badTo.searchParams.get("gcal") === "failed" && badTo.searchParams.get("gcal_why") === "invalid_client", badTo.toString());
    ck("and stores nothing", !DB.prepare(`SELECT 1 FROM gcal_connections WHERE user_id = 'u_mgr'`).get());
  }

  console.log("\n-- the console's health probe --");
  {
    const { PROBES } = await import("../worker/integrationhealth.js");
    const t = () => Date.now();
    const okP = await PROBES.gcal(ENV, globalThis.fetch, t);
    ck("a client Google knows reads as working", !okP.refused && !okP.error && /accepted/.test(okP.say || ""), JSON.stringify(okP));
    const badP = await PROBES.gcal({ ...ENV, GOOGLE_CLIENT_SECRET: "wrong" }, globalThis.fetch, t);
    ck("a wrong secret reads as refused, naming invalid_client", badP.refused === true && /invalid_client/.test(badP.say || ""), JSON.stringify(badP));
    const probeCall = G.calls.filter((x) => x.url.startsWith("https://oauth.test/token")).pop();
    ck("the probe grants nothing: a refresh with a token nobody issued",
      new URLSearchParams(probeCall?.body || "").get("refresh_token") === "subsub-health-check");
  }

  console.log("\n-- what goes on their calendar --");
  {
    const cals = [...G.calendars.entries()].filter(([id]) => id.startsWith("cal-crew-"));
    ck("a calendar of SubSub's own, called SubSub Jobs, in their zone",
      cals.length === 1 && cals[0][1].summary === "SubSub Jobs" && cals[0][1].timeZone === TZ, JSON.stringify(cals));
    const mine = evs("crew");
    ck("one event: the visit on work they accepted", mine.length === 1 && mine[0].extendedProperties?.private?.subsubVisit === "v1",
      JSON.stringify(mine.map((e) => e.summary)));
    ck("not the visit on an offer they have not taken", !mine.some((e) => e.extendedProperties?.private?.subsubVisit === "v3"));
    const e = mine[0] || {};
    ck("labelled as a SubSub job", /^SubSub Job: Leaking sink/.test(e.summary || ""));
    ck("with the address as its place", e.location === "100 Main St, Unit 4");
    ck("and no phone number anywhere in it", !/\+1206|555/.test(JSON.stringify(e)));
    ck("written with no notifications sent",
      G.calls.filter((x) => /\/events/.test(x.url) && x.method === "POST").every((x) => new URL(x.url).searchParams.get("sendUpdates") === "none"));
    const [, st] = await call("crew", "/api/google-calendar");
    ck("the panel says connected, to which account, and how many", st.connected && st.email === "crew@gmail.test" && st.events === 1, JSON.stringify(st));

    const writes = () => G.calls.filter((x) => x.url.startsWith("https://gapi.test") && /\/events/.test(x.url)).length;
    const w0 = writes();
    await call("crew", "/api/google-calendar/sync", { method: "POST" });
    ck("nothing changed, nothing written", writes() === w0);

    // The crew agrees the window: it becomes confirmed and the event follows.
    // The chain: the crew first, then the hiring side, then the tenant.
    const [rs, rb] = await call("crew", "/api/visits/v1/respond", { method: "POST", body: { status: "confirmed" } });
    await call("mgr", "/api/visits/v1/respond", { method: "POST", body: { status: "confirmed" } });
    await call("ten", "/api/visits/v1/respond", { method: "POST", body: { status: "confirmed" } });
    await call("crew", "/api/google-calendar/sync", { method: "POST" });
    const after = evs("crew")[0] || {};
    ck("confirming the time rewrites the event as booked",
      rs === 200 && !/proposed/.test(after.summary || "") && after.transparency === "opaque", `${rs} ${JSON.stringify(rb)} ${after.summary}`);
    ck("by patching it rather than adding another", evs("crew").length === 1);

    // Deleted in Google by hand: written again.
    G.events.clear();
    DB.prepare(`UPDATE visits SET start_time = '13:30' WHERE id = 'v1'`).run();
    await call("crew", "/api/google-calendar/sync", { method: "POST" });
    ck("an event they deleted in Google is written again", evs("crew").length === 1);
  }

  console.log("\n-- a time their calendar already shows taken --");
  {
    G.busy.crew = [{ start: iso(wallToUtc(X, "09:00", TZ)), end: iso(wallToUtc(X, "12:00", TZ)) }];
    const [s, b] = await call("mgr", "/api/jobs/j1/visits", { method: "POST", body: { date: X, startTime: "10:00", endTime: "11:00" } });
    ck("the hiring side cannot put forward a window the crew's calendar shows busy",
      s === 409 && b.error === "crew_busy" && b.company === "Pacific Apartment Maintenance", `${s} ${JSON.stringify(b)}`);
    ck("and nothing was written", !DB.prepare(`SELECT 1 FROM visits WHERE job_id='j1' AND start_time='10:00'`).get());
    const [s2] = await call("mgr", "/api/jobs/j1/visits", { method: "POST", body: { date: X, startTime: "12:00", endTime: "13:00" } });
    ck("a window after it goes", s2 === 201, String(s2));
    const [s3] = await call("crew", "/api/jobs/j1/visits", { method: "POST", body: { date: X, startTime: "10:00", endTime: "11:00" } });
    ck("the crew's own proposal is theirs to make", s3 === 201, String(s3));

    // A second person at the company, free then: the company is not busy.
    await connect("crew2", "crew2");
    const [s4, b4] = await call("mgr", "/api/jobs/j1/visits", { method: "POST", body: { date: X, startTime: "10:00", endTime: "11:00" } });
    ck("busy only when everybody connected there is", s4 === 201, `${s4} ${JSON.stringify(b4)}`);
    G.busy.crew2 = G.busy.crew;
    const [s5] = await call("mgr", "/api/jobs/j1/visits", { method: "POST", body: { date: X, startTime: "10:30", endTime: "11:30" } });
    ck("and busy when both are", s5 === 409, String(s5));

    await call("crew2", "/api/google-calendar", { method: "PATCH", body: { blockOn: false } });
    const [s6] = await call("mgr", "/api/jobs/j1/visits", { method: "POST", body: { date: X, startTime: "10:30", endTime: "11:30" } });
    ck("somebody who turned the check off is not counted, so the other's busy still holds", s6 === 409, String(s6));
    await call("crew", "/api/google-calendar", { method: "PATCH", body: { blockOn: false } });
    const [s6b] = await call("mgr", "/api/jobs/j1/visits", { method: "POST", body: { date: X, startTime: "10:30", endTime: "11:30" } });
    ck("and with nobody asking, nothing blocks", s6b === 201, String(s6b));
    await call("crew", "/api/google-calendar", { method: "PATCH", body: { blockOn: true } });
    await call("crew2", "/api/google-calendar", { method: "PATCH", body: { blockOn: true } });

    G.down = true;
    const [s7] = await call("mgr", "/api/jobs/j1/visits", { method: "POST", body: { date: X, startTime: "09:30", endTime: "10:00" } });
    ck("Google not answering blocks nothing", s7 === 201, String(s7));
    G.down = false;

    // One of the two cannot be read: they are left out, so the other decides.
    G.downFor = "crew2";
    const [s8] = await call("mgr", "/api/jobs/j1/visits", { method: "POST", body: { date: X, startTime: "10:15", endTime: "10:45" } });
    ck("a calendar Google would not read is left out, not counted as free", s8 === 409, String(s8));
    G.downFor = null;
  }

  console.log("\n-- a job that takes three days is checked on all three --");
  {
    // Both people at the crew have an afternoon appointment on day three of
    // the re-pipe. A window on day one, 9 to 10, clears day one -- and would
    // book them over that appointment, which is what checking only the first
    // day did.
    const later = [{ start: iso(wallToUtc(M2, "14:00", TZ)), end: iso(wallToUtc(M2, "15:00", TZ)) }];
    const keepCrew = G.busy.crew, keepCrew2 = G.busy.crew2;
    G.busy.crew = [...(G.busy.crew || []), ...later];
    G.busy.crew2 = [...(G.busy.crew2 || []), ...later];
    const [s, b] = await call("mgr", "/api/jobs/j6/visits", { method: "POST",
      body: { date: M, startTime: "09:00", endTime: "10:00" } });
    ck("a window on day one is refused when day three is taken", s === 409 && b.error === "crew_busy",
      `${s} ${JSON.stringify(b)}`);
    ck("and the refusal names day three, so the screen can say when", b.date === M2 && b.firstDay === false,
      JSON.stringify(b));

    // The same appointment with the estimate cut to one day: nothing clashes.
    DB.prepare(`UPDATE job_trade_spans SET work_days = 1 WHERE job_id = 'j6'`).run();
    const [s1] = await call("mgr", "/api/jobs/j6/visits", { method: "POST",
      body: { date: M, startTime: "09:00", endTime: "10:00" } });
    ck("a one-day job is checked on its own day only", s1 === 201, String(s1));

    // On a multi-day job they are on site the whole working day, so an
    // afternoon appointment on DAY ONE clashes with a 9 o'clock start too --
    // where a one-hour visit at 9 does not.
    DB.prepare(`UPDATE visits SET status = 'superseded' WHERE job_id = 'j6'`).run();
    const pm1 = [{ start: iso(wallToUtc(M, "15:00", TZ)), end: iso(wallToUtc(M, "16:00", TZ)) }];
    G.busy.crew = [...keepCrew, ...pm1]; G.busy.crew2 = [...keepCrew2, ...pm1];
    const [s2] = await call("mgr", "/api/jobs/j6/visits", { method: "POST",
      body: { date: M, startTime: "09:00", endTime: "10:00" } });
    ck("a one-hour visit at 9 is not blocked by a 3 o'clock appointment", s2 === 201, String(s2));
    DB.prepare(`UPDATE visits SET status = 'superseded' WHERE job_id = 'j6'`).run();
    DB.prepare(`UPDATE job_trade_spans SET work_days = 3 WHERE job_id = 'j6'`).run();
    const [s3, b3] = await call("mgr", "/api/jobs/j6/visits", { method: "POST",
      body: { date: M, startTime: "09:00", endTime: "10:00" } });
    ck("a three-day job starting at 9 is, because they would be there at 3", s3 === 409 && b3.firstDay === true,
      `${s3} ${JSON.stringify(b3)}`);

    // Starting the day after day three's appointment clears all three days.
    G.busy.crew = [...keepCrew, ...later]; G.busy.crew2 = [...keepCrew2, ...later];
    const [s4] = await call("mgr", "/api/jobs/j6/visits", { method: "POST",
      body: { date: plusDays(M2, 1), startTime: "09:00", endTime: "10:00" } });
    ck("starting after it goes", s4 === 201, String(s4));
    DB.prepare(`UPDATE visits SET status = 'superseded' WHERE job_id = 'j6'`).run();
    G.busy.crew = keepCrew; G.busy.crew2 = keepCrew2;
  }

  {
    // The auto-scheduler: a candidate whose calendar is free in the morning
    // and taken on the afternoon of day three. A one-day job takes Monday; a
    // three-day job needs three clear working days in a row, so Monday and
    // Tuesday are out (each run reaches day three) and it starts Thursday.
    const sunday = plusDays(M, -1);
    const cand = { companyId: "c", company: "Crew", categories: ["plumbing"], blockers: [],
      busy: [], busyAllDay: [M2], unavailable: [] };
    const one = rankCandidates([cand], { trade: "plumbing", from: sunday, length: 1 }).picked;
    const three = rankCandidates([cand], { trade: "plumbing", from: sunday, length: 3 }).picked;
    ck("a one-day job takes the first free morning", one?.day === M, JSON.stringify(one));
    ck("a three-day job waits for three clear working days in a row", three?.day === plusDays(M, 3),
      JSON.stringify(three));
    ck("a candidate with no calendar connected reads its ordinary busy days at any length",
      busyFor({ busy: ["x"] }, 3).join() === "x");
  }

  {
    // And through the real assign route. The crew has granted auto-schedule,
    // so issuing the three-day repaint puts a window forward by itself. Its
    // planned start is a Monday; both people have an afternoon appointment on
    // the Wednesday, day three. The morning slot alone is free every day, so
    // only reading the WHOLE working day of every day keeps it off that week.
    const keepCrew = G.busy.crew, keepCrew2 = G.busy.crew2;
    const wed = plusDays(M, 9);
    const pm = [{ start: iso(wallToUtc(wed, "14:00", TZ)), end: iso(wallToUtc(wed, "15:00", TZ)) }];
    G.busy.crew = [...(keepCrew || []), ...pm]; G.busy.crew2 = [...(keepCrew2 || []), ...pm];
    const [st, b] = await call("mgr", "/api/jobs/j7/assign", { method: "POST",
      body: { trade: "painting", companyId: "cmp_crew", payKind: "fixed", value: "900", responseWindow: "24h" } });
    const v = DB.prepare(`SELECT * FROM visits WHERE job_id = 'j7' AND status IN ('proposed','confirmed')`).get();
    ck("auto-booking a three-day job starts after the clash, not on a day whose run reaches it",
      st === 201 && v && v.date > wed, `${st} ${JSON.stringify(v || b)}`);
    G.busy.crew = keepCrew; G.busy.crew2 = keepCrew2;
  }

  console.log("\n-- the auto-scheduler steps round it --");
  {
    // j4: the job's own afternoon slot is busy on both calendars, while the
    // standing morning that day is free -- so only the job's-own-time check
    // can move it. The crew has granted auto-schedule, so issuing books a window.
    const pm = [{ start: iso(wallToUtc(Z, "13:30", TZ)), end: iso(wallToUtc(Z, "15:30", TZ)) }];
    G.busy.crew = [...G.busy.crew, ...pm];
    G.busy.crew2 = [...G.busy.crew2, ...pm];
    const [s, b] = await call("mgr", "/api/jobs/j4/assign", { method: "POST",
      body: { trade: "painting", companyId: "cmp_crew", payKind: "fixed", value: "300", responseWindow: "24h" } });
    const v = DB.prepare(`SELECT * FROM visits WHERE job_id = 'j4' AND status IN ('proposed','confirmed')`).get();
    ck("issuing books a window", s === 201 && !!v, `${s} ${JSON.stringify(b)}`);
    ck("not at the job's own time, which their calendar shows taken", v && !(v.date === Z && v.start_time === "14:00"),
      JSON.stringify(v));
  }

  {
    // j5: no time of its own, so the standing morning -- which both calendars
    // show taken that day. The ranking's busy days are what step round it.
    const am = [{ start: iso(wallToUtc(W, "08:00", TZ)), end: iso(wallToUtc(W, "13:00", TZ)) }];
    G.busy.crew = [...G.busy.crew, ...am];
    G.busy.crew2 = [...G.busy.crew2, ...am];
    const [s] = await call("mgr", "/api/jobs/j5/assign", { method: "POST",
      body: { trade: "plumbing", companyId: "cmp_crew", payKind: "fixed", value: "150", responseWindow: "24h" } });
    const v = DB.prepare(`SELECT * FROM visits WHERE job_id = 'j5' AND status IN ('proposed','confirmed')`).get();
    ck("a morning their calendar shows taken is stepped round, not refused", s === 201 && v && v.date !== W, JSON.stringify(v));
  }

  console.log("\n-- the hiring side's own calendar --");
  {
    const c = await connect("mgr", "mgr");
    ck("connects", (c.to || "").endsWith("gcal=connected"));
    const subs = evs("mgr").map((e) => e.extendedProperties?.private?.subsubVisit);
    ck("an admin's calendar carries the account's visits, offers included", subs.includes("v3"), subs.join(","));
    const t = await connect("ten", "ten");
    ck("a tenant connects too", (t.to || "").endsWith("gcal=connected"));
    const ts = evs("ten").map((e) => e.extendedProperties?.private?.subsubVisit);
    ck("and gets the visits on their own repair only", ts.length >= 1 && !ts.includes("v3"), ts.join(","));
  }

  console.log("\n-- switching off and leaving --");
  {
    await call("crew", "/api/google-calendar/sync", { method: "POST" });
    const live = DB.prepare(`SELECT id FROM visits WHERE job_id = 'j1' AND status IN ('proposed','confirmed')`).all().map((r) => r.id);
    const onCal = evs("crew").map((e) => e.extendedProperties?.private?.subsubVisit).filter((id) => id !== "v3");
    ck("a superseded window comes off their calendar, leaving the live one",
      onCal.filter((id) => !live.includes(id) && DB.prepare(`SELECT job_id FROM visits WHERE id = ?`).get(id)?.job_id === "j1").length === 0
      && onCal.some((id) => live.includes(id)), JSON.stringify({ live, onCal }));

    // Access removed in Google within the hour of a cached token: the next
    // call Google refuses is what finds out.
    G.dead.add("rt-crew2");
    const [ps] = await call("mgr", "/api/jobs/j1/visits", { method: "POST", body: { date: X, startTime: "10:40", endTime: "11:10" } });
    const row = DB.prepare(`SELECT last_error FROM gcal_connections WHERE user_id = 'u_crew2'`).get();
    ck("access withdrawn in Google is recorded so the panel can say so", row.last_error === "revoked", JSON.stringify(row));
    ck("and a calendar that cannot be read is left out, so the other one still decides", ps === 409, String(ps));
    const before = G.calendars.size;
    await call("crew", "/api/google-calendar", { method: "PATCH", body: { syncOn: false } });
    ck("turning the push off takes the SubSub Jobs calendar off their account", G.calendars.size === before - 1);
    ck("and forgets its events", !DB.prepare(`SELECT 1 FROM gcal_events WHERE user_id = 'u_crew'`).get());
    const [d] = await call("crew", "/api/google-calendar", { method: "DELETE" });
    ck("disconnecting revokes and deletes", d === 200 && !DB.prepare(`SELECT 1 FROM gcal_connections WHERE user_id = 'u_crew'`).get()
      && G.calls.some((x) => x.url.startsWith("https://oauth.test/revoke") && /rt-crew\b/.test(String(x.body))));
    const [d2] = await call("crew", "/api/google-calendar", { method: "DELETE" });
    ck("and a second press says there is nothing to disconnect", d2 === 404);
  }

  console.log("\n-- the paste --");
  {
    const r = runCheck(DB);
    ck("CHECK.sql sees every column of all three tables", r.m094_gcal_connections === 10 && r.m094_gcal_events === 5 && r.m094_gcal_states === 6,
      JSON.stringify([r.m094_gcal_connections, r.m094_gcal_events, r.m094_gcal_states]));
  }
} catch (err) {
  fail++;
  console.log("FAIL  threw:", err?.stack || err);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
