// WHO HAS TO BE THERE FOLLOWS WHICH WALK IT WAS, AND THE PERSON TURNING UP
// FINALLY SEES THE PICTURES.
//
// Two requests, one change, because both land on the job an inspection raises.
//
// Asked for as: *"for scheduling jobs for move out or move in, obviously those
// do not include any tenant input"*, corrected in the same breath to *"move in
// would need to coordinate with a tenant since they are moving in, they will
// be in the unit when the job is done"*. And: *"in the work orders when they
// are passed over to subcontractors the images should be passed along in the
// full report so they can visually see what they are fixing prior"*.
//
// Migration 062, `jobs.access_user_id`, `accessForInspection` and
// `contractorInspectionShape` in `app/shared/inspection.js`. What this pins:
//
//   THE TWO KINDS ANSWER DIFFERENTLY, and neither answer is 019's default.
//
//   WHICH TENANT, resolved from the UNIT -- the half 060 recorded as still
//   open, because a job carries a property and a property carries many
//   tenancies. Only a fixture with two tenants in two units on one building
//   can tell a resolved id from a guessed one.
//
//   AND IT IS NOT `requested_by`. That column means who asked for the work,
//   and a tenant written into it reads as a request they never made.
//
//   THE WORK ORDER IS THE KEY, never the inspection, so nothing can be
//   walked -- and it carries the FLAGGED rooms, the kept captions, and
//   neither the model's drafts nor who was moving out.
//
//   node --no-warnings scripts/inspection-job-test.mjs

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { runCheck } from "./lib/check-sql.mjs";
import { suggestedAccessForInspection, contractorInspectionShape } from "../shared/inspection.js";
import { accessTenant, canAskTenant, accessFor } from "../shared/access.js";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(join(app, "worker", "schema.sql"), "utf8");
const CHECK = readFileSync(join(app, "worker", "migrations", "CHECK.sql"), "utf8");

// TWO TENANTS IN TWO UNITS ON ONE BUILDING, plus a tenant on the OTHER
// building. A fixture with one tenant on the property passes whichever rule is
// in force -- "the tenant of this unit" and "any tenant here" give the same
// answer, which is the two-guards-covering-for-each-other shape.
const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,kind,subdomain,plan) VALUES
      ('acc_pm','Sound Property Management','property_manager','soundpm','scale');
    INSERT INTO users(id,name,email) VALUES
      ('u_mgr','Chris Lane','chris@soundpm.test'),
      ('u_t3b','Ada Three','ada@t.test'),
      ('u_t4a','Ben Four','ben@t.test'),
      ('u_tother','Cleo Other','cleo@t.test'),
      ('u_sub','Juan Soto','juan@pacific.test'),
      ('u_oth','Other Crew','crew@other.test');
    INSERT INTO companies(id,company,contact,email,state) VALUES
      ('cmp_pac','Pacific apartment maintenance','Juan Soto','juan@pacific.test','WA'),
      ('cmp_oth','Other Maintenance','Other Crew','crew@other.test','WA');
    INSERT INTO engagements(id,account_id,company_id,status,categories) VALUES
      ('en_pac','acc_pm','cmp_pac','active','["plumbing"]'),
      ('en_oth','acc_pm','cmp_oth','active','["plumbing"]');
    INSERT INTO properties(id,account_id,name,address,city,state,zip) VALUES
      ('prop_1','acc_pm','Press Apartments','1620 Belmont','Seattle','WA','98122'),
      ('prop_2','acc_pm','Belmont Court','9 Pine','Seattle','WA','98101');
    INSERT INTO memberships(id,user_id,account_id,role,company_id,unit) VALUES
      ('m_mgr','u_mgr','acc_pm','admin',NULL,NULL),
      ('m_t4a','u_t4a','acc_pm','tenant',NULL,'4A'),
      ('m_t3b','u_t3b','acc_pm','tenant',NULL,' 3b '),
      ('m_toth','u_tother','acc_pm','tenant',NULL,'3B'),
      ('m_sub','u_sub','acc_pm','contractor','cmp_pac',NULL),
      ('m_oth','u_oth','acc_pm','contractor','cmp_oth',NULL);
    INSERT INTO membership_properties(membership_id,property_id) VALUES
      ('m_t4a','prop_1'), ('m_t3b','prop_1'), ('m_toth','prop_2');

    -- A move-OUT walk of 3B. The unit is being handed back.
    INSERT INTO inspections(id,account_id,property_id,unit,kind,tenant_name,inspected_on,status,finished_at)
      VALUES ('ins_out','acc_pm','prop_1','3B','move_out','Ada Three','2026-10-01','finished','2026-10-01 12:00:00');
    -- A move-IN walk of the same unit. Somebody is moving into it.
    INSERT INTO inspections(id,account_id,property_id,unit,kind,tenant_name,inspected_on,status,finished_at)
      VALUES ('ins_in','acc_pm','prop_1','3B','move_in','Dee New','2026-10-02','finished','2026-10-02 12:00:00');
    -- A move-in walk of a unit NOBODY has a seat on, which is the ordinary
    -- shape: the person moving in very often has no login yet.
    INSERT INTO inspections(id,account_id,property_id,unit,kind,status,finished_at)
      VALUES ('ins_new','acc_pm','prop_1','9C','move_in','finished','2026-10-02 12:00:00');

    INSERT INTO inspection_rooms(id,inspection_id,name,status,note,position) VALUES
      ('r_bath','ins_out','Shower and bath','fail','Cracked basin, chip to the enamel',0),
      ('r_wall','ins_out','Walls and floors','follow_up','Scuff to the wall left of the door',1),
      ('r_ok','ins_out','Hall','ok','Nothing to report',2),
      ('ri_1','ins_in','Kitchen','fail','Oven door will not latch',0),
      ('rn_1','ins_new','Kitchen','fail','Tap drips',0);
    INSERT INTO inspection_photos(id,room_id,file_key,name,content_type) VALUES
      ('ph_bath','r_bath','acc_pm/inspection-photo/a-basin.jpg','basin.jpg','image/jpeg'),
      ('ph_wall','r_wall','acc_pm/inspection-photo/b-wall.jpg','wall.jpg','image/jpeg'),
      ('ph_ok','r_ok','acc_pm/inspection-photo/c-hall.jpg','hall.jpg','image/jpeg');
    INSERT INTO inspection_photo_notes(photo_id,caption,draft,drafted_at) VALUES
      ('ph_bath','Hairline crack across the basin','A white basin with a crack','2026-10-01T10:00:00.000Z'),
      ('ph_wall',NULL,'Scuffing to the painted wall','2026-10-01T10:00:00.000Z');

    -- A job no inspection raised, so the work-order route has something to
    -- answer 404 about for a real reason rather than a missing row.
    INSERT INTO jobs(id,account_id,property_id,title,trades,status,created_at)
      VALUES ('job_plain','acc_pm','prop_1','Repaint hallway','["painting"]','active','2026-10-01');
    INSERT INTO work_orders(id,wo_number,job_id,trade,company_id,engagement_id,status,value_cents)
      VALUES ('wo_plain','WO-9','job_plain','painting','cmp_pac','en_pac','accepted',10000);
  `);
  const files = new Map([
    ["acc_pm/inspection-photo/a-basin.jpg", "BASIN"],
    ["acc_pm/inspection-photo/b-wall.jpg", "WALL"],
    ["acc_pm/inspection-photo/c-hall.jpg", "HALL"],
  ]);
  return { db, env: { DB: makeD1(db), FILES: {
    put: async () => {},
    get: async (k) => files.has(k) ? { body: files.get(k) } : null,
  } } };
};

const call = (env, path, body, who = "u_mgr", method = "POST") => worker.fetch(
  new Request(`https://api.subsub.work${path}`, {
    method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json", "X-User-Id": who, "X-Account-Id": "acc_pm" },
  }), env);
const get = (env, path, who) => call(env, path, undefined, who, "GET");
const json = async (r) => [r.status, await r.json().catch(() => ({}))];
const jobOf = (db, id) => db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id);
const raise = (env, inspId, who = "u_mgr", extra = {}) =>
  call(env, `/api/inspections/${inspId}/job`,
    { trades: ["plumbing"], date: "2026-10-09", ...extra }, who);
const visitOf = (db, jobId) => db.prepare(
  `SELECT * FROM visits WHERE job_id = ? AND status != 'superseded' ORDER BY created_at DESC`).get(jobId);
const propose = (env, jobId, who = "u_mgr") => call(env, `/api/jobs/${jobId}/visits`,
  { date: "2026-10-12", startTime: "09:00", endTime: "11:00" }, who);
// The work order the raised job needs before a contractor can read anything.
const issue = (db, jobId, wo = "WO-1", company = "cmp_pac", en = "en_pac", status = "accepted") =>
  db.prepare(`INSERT INTO work_orders(id,wo_number,job_id,trade,company_id,engagement_id,status,value_cents)
              VALUES (?,?,?,'plumbing',?,?,?,40000)`).run(`w_${wo}`, wo, jobId, company, en, status);

try {
  console.log("\n-- which walk it was decides who has to be there --");
  {
    ck("a move-out suggests nobody in the loop", suggestedAccessForInspection("move_out") === "manager",
      String(suggestedAccessForInspection("move_out")));
    // The correction, in its own assertion: move-in is the one that does.
    ck("a move-in suggests the tenant", suggestedAccessForInspection("move_in") === "tenant",
      String(suggestedAccessForInspection("move_in")));
    // An unrecognised kind leaves 019's rule in force rather than guessing.
    ck("and an unknown kind answers nothing", suggestedAccessForInspection("x") === null);
    // 062's predicate: two columns, two facts.
    ck("the access tenant is not only the requester",
      accessTenant({ access_user_id: "u_t3b" }) === "u_t3b"
      && accessTenant({ requestedBy: "u_own" }) === "u_own"
      && accessTenant({}) === null);
    ck("so there is somebody to ask on a job nobody asked for",
      canAskTenant({ access_user_id: "u_t3b" }) === true && canAskTenant({}) === false);
    // SAID OUT LOUD RATHER THAN CLAIMED: `partiesFor` looks the seat role up
    // by `accessTenant` rather than by `requested_by`, and mutating that back
    // changes no outcome today -- so there is no assertion on it. The reason
    // it is still written that way is that the lookup only decides anything on
    // a job with a NULL access answer, and nothing in the product writes
    // `access_user_id` on one of those: the raise route always writes an
    // explicit answer beside it. Pinning it would need a row the product never
    // produces, which is a test of its own fixture. It is defence against the
    // day a second route writes that column, and it fails in the quiet
    // direction if it is wrong.
  }

  console.log("\n-- a move-out job is the agent's to open --");
  {
    const { db, env } = seed();
    const [s, b] = await json(await raise(env, "ins_out"));
    ck("the job is raised", s === 201, `${s} ${JSON.stringify(b)}`);
    ck("marked as ours to let them in", b.access === "manager", String(b.access));
    ck("and names no tenant", b.accessUserId === null, String(b.accessUserId));
    const job = jobOf(db, b.jobId);
    ck("stored on the row", job.access === "manager" && job.access_user_id === null,
      JSON.stringify({ a: job.access, u: job.access_user_id }));
    // Nobody to coordinate with, which is the whole of the first request.
    issue(db, b.jobId);
    const [, v] = await json(await propose(env, b.jobId));
    ck("so a time waits on the crew and not on a tenant",
      (v.waitingOn || []).join() === "contractor", JSON.stringify(v.waitingOn));
  }

  console.log("\n-- a move-in job names the tenant of that unit --");
  {
    const { db, env } = seed();
    const [s, b] = await json(await raise(env, "ins_in"));
    ck("the job is raised", s === 201, `${s} ${JSON.stringify(b)}`);
    ck("marked as the tenant needing to be in", b.access === "tenant", String(b.access));
    // THE DISCRIMINATING ASSERTION. m_t3b is the tenant of 3B with a stored
    // unit of " 3b " -- a managing agent types what is on the door -- and
    // m_t4a is a tenant of the same building in 4A. Matching the building
    // rather than the unit answers either one.
    ck("and names the tenant of the unit that was walked", b.accessUserId === "u_t3b",
      String(b.accessUserId));
    ck("case and space in the unit do not matter",
      jobOf(db, b.jobId).access_user_id === "u_t3b");
    // AND IT IS NOT `requested_by`. Writing them there would put the job on
    // the manager's own Work requests panel as something the tenant asked for.
    ck("nobody is recorded as having asked for it",
      jobOf(db, b.jobId).requested_by === null, String(jobOf(db, b.jobId).requested_by));

    issue(db, b.jobId);
    const [, v] = await json(await propose(env, b.jobId));
    // 064. The chain: the crew first because they are the constraint, the
    // named tenant last because they are the one who has to be in.
    ck("a time waits on the crew, then on them",
      (v.waitingOn || []).join() === "contractor,tenant", JSON.stringify(v.waitingOn));
    // The job keeps the TARGET date the raise form typed; what it must not
    // take is the proposed window, because nobody has agreed to that yet.
    ck("so the job has not taken the proposed window",
      jobOf(db, b.jobId).date === "2026-10-09", String(jobOf(db, b.jobId).date));

    // THE NAMED TENANT MAY ANSWER IT, which is what the column is for: before
    // 062 the respond route compared against `requested_by` and this job has
    // none, so every answer was a 403.
    // Not before the crew, though -- 064 asks them last on purpose, so the
    // window the chain reaches them with is one somebody is actually coming
    // to. The 062 question is whether they may answer AT ALL, which is what
    // the second press below settles.
    const [sEarly] = await json(await call(env, `/api/visits/${v.id}/respond`,
      { status: "confirmed" }, "u_t3b"));
    ck("the named tenant is not asked before the crew", sEarly === 409, String(sEarly));
    await call(env, `/api/visits/${v.id}/respond`, { status: "confirmed" }, "u_sub");
    const [s2, t] = await json(await call(env, `/api/visits/${v.id}/respond`,
      { status: "confirmed" }, "u_t3b"));
    ck("the named tenant may confirm it", s2 === 200, `${s2} ${JSON.stringify(t)}`);
    ck("and that settles it", t.status === "confirmed", String(t.status));
    // AND NOBODY ELSE MAY. A tenant of the next flat along is a real tenant on
    // a real seat, which is the only fixture this can be checked against.
    const [s3] = await json(await call(env, `/api/visits/${v.id}/respond`,
      { status: "declined" }, "u_t4a"));
    ck("the tenant of another unit may not", s3 === 403, String(s3));
  }
  {
    // A TENANT OF ANOTHER BUILDING IS NOT NAMED either, even in a unit with
    // the same name -- u_tother is in 3B of prop_2.
    const { db, env } = seed();
    const [, b] = await json(await raise(env, "ins_in"));
    ck("a matching unit at another building is not named",
      jobOf(db, b.jobId).access_user_id !== "u_tother", String(jobOf(db, b.jobId).access_user_id));
  }
  {
    // THE ORDINARY MOVE-IN: nobody has a login yet. The inspection schema says
    // so in its own words, so this is the common case rather than the edge.
    const { db, env } = seed();
    const [, b] = await json(await raise(env, "ins_new"));
    ck("a unit nobody has a seat on still says the tenant has to be in",
      b.access === "tenant", String(b.access));
    ck("and names nobody", b.accessUserId === null, String(b.accessUserId));
    issue(db, b.jobId);
    const [, v] = await json(await propose(env, b.jobId));
    // 060's rule, unchanged: whether to ask is the override, whether there is
    // anybody to ask is still a fact, so this books rather than waiting on
    // somebody who cannot reply.
    ck("so the time does not wait on nobody",
      (v.waitingOn || []).join() === "contractor", JSON.stringify(v.waitingOn));
    ck("which the screen is told by the effective answer",
      accessFor({ access: "tenant" }) === "tenant"
      && canAskTenant({ access: "tenant" }) === false);
  }

  console.log("\n-- but the kind only SUGGESTS it, and the raiser settles it --");
  {
    // THE SECOND CORRECTION: *"a move in doesn't necessarily need a tenant in
    // the unit, only if required."* A unit being turned round between
    // tenancies is often empty on the day the work is done, so the kind
    // pre-answers and the person standing in the flat decides.
    const { db, env } = seed();
    const [, b] = await json(await raise(env, "ins_in", "u_mgr", { access: "manager" }));
    ck("the body outranks the suggestion", b.access === "manager", String(b.access));
    ck("and nobody is named when nobody is being asked",
      jobOf(db, b.jobId).access_user_id === null, String(jobOf(db, b.jobId).access_user_id));
    issue(db, b.jobId);
    const [, v] = await json(await propose(env, b.jobId));
    ck("so the time waits on the crew alone",
      (v.waitingOn || []).join() === "contractor", JSON.stringify(v.waitingOn));
  }
  {
    // AND THE OTHER DIRECTION, in the same place: a move-OUT the manager says
    // the tenant has to be in for. Asserting one alone passes with the body
    // ignored for the kind that already agreed with it.
    const { db, env } = seed();
    const [, b] = await json(await raise(env, "ins_out", "u_mgr", { access: "tenant" }));
    ck("a move-out can be told the tenant has to be in", b.access === "tenant", String(b.access));
    ck("and the tenant of that unit is named", b.accessUserId === "u_t3b", String(b.accessUserId));
  }
  {
    // A word the picker never offered must not reach the column -- the
    // invariant CHECK.sql counts one table along.
    const { db, env } = seed();
    const [, b] = await json(await raise(env, "ins_in", "u_mgr", { access: "whenever" }));
    ck("an unrecognised answer falls back to the suggestion",
      b.access === "tenant", String(b.access));
    ck("and nothing unknown is stored",
      jobOf(db, b.jobId).access === "tenant", String(jobOf(db, b.jobId).access));
  }

  console.log("\n-- the work order carries what was found --");
  {
    const { db, env } = seed();
    const [, b] = await json(await raise(env, "ins_out"));
    issue(db, b.jobId);
    const [s, d] = await json(await get(env, "/api/work-orders/w_WO-1/inspection", "u_sub"));
    ck("the company holding it may read it", s === 200, `${s} ${JSON.stringify(d)}`);
    ck("it says which walk and which unit",
      d.kind === "move_out" && d.unit === "3B", JSON.stringify({ k: d.kind, u: d.unit }));
    const names = (d.rooms || []).map((r) => r.name);
    // FLAGGED ROOMS ONLY, the same line the job's scope draws: an inspection
    // is a record of the whole unit and a job is a list of things to do.
    ck("the flagged rooms are there",
      names.includes("Shower and bath") && names.includes("Walls and floors"), JSON.stringify(names));
    ck("and the room that was fine is not", !names.includes("Hall"), JSON.stringify(names));
    const bath = (d.rooms || []).find((r) => r.name === "Shower and bath");
    ck("with the note somebody typed", /Cracked basin/.test(bath?.note || ""), bath?.note);
    ck("and the photograph", (bath?.photos || []).length === 1, JSON.stringify(bath?.photos));
    // THE CAPTION IS THE RECORD AND THE DRAFT IS NOT. A sentence a model wrote
    // and nobody kept would read here as a finding somebody made.
    ck("the kept caption travels",
      bath.photos[0].caption === "Hairline crack across the basin", bath.photos[0].caption);
    const wall = (d.rooms || []).find((r) => r.name === "Walls and floors");
    ck("an unkept draft does not",
      !JSON.stringify(wall).includes("Scuffing to the painted wall"), JSON.stringify(wall));
    // Who was moving out is not a contractor's business.
    ck("nor who was moving out", !JSON.stringify(d).includes("Ada Three"), JSON.stringify(d).slice(0, 200));

    // The bytes, and only for a room the job is actually about.
    const img = await get(env, "/api/work-orders/w_WO-1/inspection/photo/ph_bath", "u_sub");
    ck("the picture is served", img.status === 200, String(img.status));
    ck("as an image", /^image\//.test(img.headers.get("Content-Type") || ""),
      img.headers.get("Content-Type"));
    const no = await get(env, "/api/work-orders/w_WO-1/inspection/photo/ph_ok", "u_sub");
    ck("a photo of the room that was fine is not", no.status === 404, String(no.status));

    // The hiring account's own team reads it too -- the inspection is theirs.
    ck("the manager may read it",
      (await get(env, "/api/work-orders/w_WO-1/inspection", "u_mgr")).status === 200);
  }

  console.log("\n-- and the work order is the only key --");
  {
    const { db, env } = seed();
    const [, b] = await json(await raise(env, "ins_out"));
    issue(db, b.jobId);
    // Another company on the same roster. They hold no work order on this
    // job, so there is nothing to answer -- and `not_found` rather than
    // `forbidden`, so this cannot be walked to find out which ids are real.
    const [s1] = await json(await get(env, "/api/work-orders/w_WO-1/inspection", "u_oth"));
    ck("another company gets not_found", s1 === 404, String(s1));
    // A TENANT IS ON THE ACCOUNT TOO, and an inspection is explicitly not
    // shown to the tenant it is about. A route scoped only by account id
    // would have undone that recorded decision by a different door.
    const [s2] = await json(await get(env, "/api/work-orders/w_WO-1/inspection", "u_t3b"));
    ck("and a tenant seat is refused outright", s2 === 403, String(s2));
    // AND THE TWO GUARDS COVER FOR EACH OTHER, which mutation is what showed:
    // deleting the role gate changed no outcome, because `TENANT_ALLOWED`
    // refuses any path it does not list and a new route is not on it. That
    // direction is deliberate -- the allowlist's own comment says a new route
    // should fail closed -- so the role gate is pinned STATICALLY as well,
    // exactly as 056 pins the allowlist's methods for the same reason.
    const src = readFileSync(join(app, "worker", "index.js"), "utf8");
    // Up to `, async`, not up to the first comma: a role list has commas in
    // it, and reading only as far as the first one would have left every role
    // after "admin" unchecked -- which is this suite's own could-not-fail
    // shape on the assertion below.
    const gates = [...src.matchAll(
      /app\.get\("\/api\/work-orders\/:id\/inspection(?:\/photo\/:photoId)?",\s*([\s\S]*?),\s*async \(c\)/g)]
      .map((m) => m[1]);
    ck("both routes carry a role gate of their own", gates.length === 2
      && gates.every((g) => /requireRole\(/.test(g)), JSON.stringify(gates));
    ck("and neither of them lists a tenant",
      gates.every((g) => !/"tenant"/.test(g)), JSON.stringify(gates));
    // A job no inspection raised, which is most of them.
    const [s3] = await json(await get(env, "/api/work-orders/wo_plain/inspection", "u_sub"));
    ck("a job with no inspection answers not_found", s3 === 404, String(s3));
    // Reissuing voids the old row, and somebody taken off the job keeps no
    // view of the unit they were going to walk into.
    db.prepare(`UPDATE work_orders SET voided_at = '2026-10-03' WHERE id = 'w_WO-1'`).run();
    const [s4] = await json(await get(env, "/api/work-orders/w_WO-1/inspection", "u_sub"));
    ck("a voided work order is not a key", s4 === 404, String(s4));
  }

  console.log("\n-- the shape, on its own --");
  {
    const out = contractorInspectionShape(
      { kind: "move_in", unit: " 3B ", inspectedOn: "2026-10-02", tenantName: "Dee New" },
      [{ id: "a", name: "Kitchen", status: "fail", note: " oven ",
         photos: [{ id: "p", name: "x.jpg", caption: " chip ", draft: "a model wrote this" }] },
       { id: "b", name: "Hall", status: "ok", photos: [{ id: "q" }] },
       { id: "c", name: "Bath", status: "unchecked", photos: [] }]);
    ck("neither the fine room nor the unwalked one is in it",
      out.rooms.map((r) => r.name).join() === "Kitchen",
      JSON.stringify(out.rooms.map((r) => r.name)));
    ck("the unit is trimmed", out.unit === "3B", JSON.stringify(out.unit));
    ck("the draft is absent and the caption is not",
      out.rooms[0].photos[0].caption === "chip"
      && !("draft" in out.rooms[0].photos[0]), JSON.stringify(out.rooms[0].photos[0]));
    ck("and who was moving is absent", !("tenantName" in out), Object.keys(out).join());
  }

  console.log("\n-- recorded where an operator looks --");
  {
    ck("CHECK.sql asks whether 062 ran", /m062_job_access_user/.test(CHECK));
    ck("and counts a named person who is not a tenant",
      /m062_inv_access_not_a_tenant/.test(CHECK));
    const sql = readFileSync(join(app, "worker", "migrations", "062_job_access_user.sql"), "utf8");
    ck("062 is one ALTER TABLE, which is one paste",
      (sql.match(/^ALTER TABLE/gm) || []).length === 1);
    // RUN AGAINST REAL ROWS, which is the lesson 057 paid for: every invariant
    // reads zero on an empty database, so one that is subtly wrong passes for
    // ever. Seeded both ways here.
    const { db, env } = seed();
    const [, b] = await json(await raise(env, "ins_in"));
    const clean = runCheck(db);
    ck("a real move-in job reads zero",
      clean.m062_inv_access_not_a_tenant === 0 && clean.m062_job_access_user === 1,
      JSON.stringify([clean.m062_job_access_user, clean.m062_inv_access_not_a_tenant]));
    // And it catches the fault it exists to report: a job naming somebody with
    // no tenant seat is a confirmation step waiting on nobody.
    db.prepare(`UPDATE jobs SET access_user_id = 'u_mgr' WHERE id = ?`).run(b.jobId);
    ck("and names one that does not",
      runCheck(db).m062_inv_access_not_a_tenant === 1,
      String(runCheck(db).m062_inv_access_not_a_tenant));
  }

  console.log("\n-- the jobs list says which job came from a walk --");
  {
    // Asked for as "a quick design reference to created from an inspection to
    // differentiate them from other jobs". The list is where it has to be
    // known, so the route answers it rather than the browser guessing.
    const { db, env } = seed();
    const [, made] = await json(await raise(env, "ins_out"));
    const [st, list] = await json(await get(env, "/api/jobs", "u_mgr"));
    const raised = (list || []).find((j) => j.id === made.jobId);
    const plain = (list || []).find((j) => j.id === "job_plain");
    ck("the list loads", st === 200 && !!raised && !!plain, String(st));
    ck("the walk-raised job names its inspection, kind and unit",
      raised?.fromInspection?.id === "ins_out" && raised?.fromInspection?.kind === "move_out"
        && raised?.fromInspection?.unit === "3B", JSON.stringify(raised?.fromInspection));
    ck("and a job nobody walked carries nothing", plain && !("fromInspection" in plain),
      JSON.stringify(plain?.fromInspection));
    // A TENANT IS NEVER TOLD. An inspection is deliberately not shown to the
    // tenant it is about, and "this came from your move-out walk" is that
    // inspection by another name. Only a job the tenant can actually SEE can
    // check it, so the raised job is made theirs.
    db.prepare(`UPDATE jobs SET requested_by = 'u_t3b' WHERE id = ?`).run(made.jobId);
    const [, tl] = await json(await get(env, "/api/jobs", "u_t3b"));
    const theirs = (tl || []).find((j) => j.id === made.jobId);
    ck("a tenant sees the job", !!theirs, JSON.stringify((tl || []).map((j) => j.id)));
    ck("without the inspection on it", theirs && !("fromInspection" in theirs), JSON.stringify(theirs?.fromInspection));
  }
} catch (err) {
  fail++; console.log("FAIL  threw:", err?.stack || err);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
