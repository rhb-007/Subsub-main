// THE SUBCONTRACTOR COULD NEITHER ACCEPT A TIME NOR SAY IT DOES NOT WORK.
//
// Reported as: *"on this contractor -- we need to allow it to be edited and
// [a] new time [proposed] by [the] subcontractor, or the other way: the
// property manager needs to send it to [the] subcontractor and tenant, or just
// [the] subcontractor, to be confirmed."*
//
// 019 built a visit as manager-proposes, TENANT-confirms, because somebody has
// to be in. The party who physically drives to the address was never asked --
// so a time could be agreed between a manager and a tenant for a morning the
// crew was already on another roof, and the first anybody found out was nobody
// turning up. The contractor's own card offered accept or decline the WORK,
// and a time that does not suit is not a reason to turn a job down.
//
// Migration 061, `visits.contractor_at` / `.contractor_note`,
// `app/shared/visitparty.js`. What this pins:
//
//   `status` IS THE COMBINED VERDICT, from one rule. Proposed while anybody
//   who must agree has not; confirmed once everybody who must has. Two
//   expressions of that is how the two sides both draw "waiting on them" and
//   an appointment stalls for ever.
//
//   WHO MUST AGREE IS PER JOB. The tenant only where 060 says they have to be
//   in -- which is the "or just the subcontractor" half of the request -- and
//   the contractor only once somebody actually holds the work.
//
//   THE DATE LANDS WHEN IT IS SETTLED, not when the tenant alone has answered.
//
//   PROPOSING IS AGREEING, for whoever proposed it.
//
//   A DECLINE FROM EITHER SIDE ENDS IT, and the two notes stay apart.
//
//   AND A DATABASE WITHOUT 061 KEEPS THE TWO-PARTY SHAPE IT HAS, rather than
//   leaving every window waiting on a contractor who can never answer.
//
//   node --no-warnings scripts/visit-party-test.mjs

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { visitParties, waitingOn, visitSettled, waitingText,
  VISIT_PARTIES, PARTY_ORDER, nextToAnswer, mayAnswer } from "../shared/visitparty.js";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(join(app, "worker", "schema.sql"), "utf8");

// A fixture with every shape the rule can be told apart on: a tenant's own
// report, the same repair with the tenant taken out of it, a job nobody
// reported, and -- the row that matters most -- a company holding an ACCEPTED
// work order beside one that is still only pending.
const seed = (base = SCHEMA) => {
  const db = freshDb({ base, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,kind,subdomain,plan) VALUES
      ('acc_pm','Sound Property Management','property_manager','soundpm','scale');
    INSERT INTO users(id,name,email) VALUES
      ('u_mgr','Chris Lane','chris@soundpm.test'),
      ('u_ten','John Smith','john@tenant.test'),
      ('u_sub','Juan Soto','juan@pacific.test'),
      ('u_oth','Other Crew','crew@other.test');
    INSERT INTO companies(id,company,contact,email,state) VALUES
      ('cmp_pac','Pacific apartment maintenance','Juan Soto','juan@pacific.test','WA'),
      ('cmp_oth','Other Maintenance','Other Crew','crew@other.test','WA');
    INSERT INTO engagements(id,account_id,company_id,status,categories) VALUES
      ('en_pac','acc_pm','cmp_pac','active','["plumbing"]'),
      ('en_oth','acc_pm','cmp_oth','active','["plumbing"]');
    INSERT INTO properties(id,account_id,name,address,city,state,zip) VALUES
      ('prop_1','acc_pm','Press Apartments','1620 Belmont','Seattle','WA','98122');
    INSERT INTO memberships(id,user_id,account_id,role,company_id) VALUES
      ('m_mgr','u_mgr','acc_pm','admin',NULL),
      ('m_ten','u_ten','acc_pm','tenant',NULL),
      ('m_sub','u_sub','acc_pm','contractor','cmp_pac'),
      ('m_oth','u_oth','acc_pm','contractor','cmp_oth');
    INSERT INTO membership_properties(membership_id,property_id) VALUES ('m_ten','prop_1');

    -- A tenant's own report: 060 says they have to be in.
    INSERT INTO jobs(id,account_id,property_id,title,trades,status,requested_by,approved_at,created_at)
      VALUES ('job_both','acc_pm','prop_1','Leaking sink','["plumbing"]','active','u_ten','2026-10-01','2026-10-01');
    -- The same repair, fixed from outside. The tenant is taken out of it, so
    -- the contractor is the ONLY party -- which is the half that used to be
    -- booked outright with nobody asked at all.
    INSERT INTO jobs(id,account_id,property_id,title,trades,status,requested_by,approved_at,access,created_at)
      VALUES ('job_subonly','acc_pm','prop_1','Leaking roof','["plumbing"]','active','u_ten','2026-10-01','none','2026-10-01');
    -- Nobody reported it and nobody holds it: no party at all.
    INSERT INTO jobs(id,account_id,property_id,title,trades,status,created_at)
      VALUES ('job_nobody','acc_pm','prop_1','Repaint hallway','["plumbing"]','active','2026-10-01');
    -- Held, but only OFFERED. Somebody who has not said yes to the job cannot
    -- be waited on for the time.
    INSERT INTO jobs(id,account_id,property_id,title,trades,status,access,created_at)
      VALUES ('job_pending','acc_pm','prop_1','Fix the gate','["plumbing"]','active','none','2026-10-01');

    INSERT INTO work_orders(id,wo_number,job_id,trade,company_id,engagement_id,status,value_cents) VALUES
      ('wo_both','WO-1','job_both','plumbing','cmp_pac','en_pac','accepted',40000),
      ('wo_sub','WO-2','job_subonly','plumbing','cmp_pac','en_pac','accepted',40000),
      ('wo_pend','WO-3','job_pending','plumbing','cmp_pac','en_pac','pending',40000);
  `);
  return { db, env: { DB: makeD1(db) } };
};

const call = (env, path, body, who = "u_mgr", method = "POST") => worker.fetch(
  new Request(`https://api.subsub.work${path}`, {
    method, body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", "X-User-Id": who, "X-Account-Id": "acc_pm" },
  }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];
const visitOf = (db, jobId) => db.prepare(
  `SELECT * FROM visits WHERE job_id = ? AND status != 'superseded' ORDER BY created_at DESC`).get(jobId);
const jobOf = (db, id) => db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id);
const propose = (env, jobId, who = "u_mgr") => call(env, `/api/jobs/${jobId}/visits`,
  { date: "2026-10-09", startTime: "09:00", endTime: "11:00" }, who);
const respond = (env, visitId, body, who) => call(env, `/api/visits/${visitId}/respond`, body, who);

try {
  console.log("\n-- who has to agree, which is decided per job --");
  {
    // THE TENANT ONLY WHERE THEY HAVE TO BE IN. "Or just the subcontractor" is
    // this answer, and it is 060's column doing the work rather than a second
    // switch beside it.
    ck("a tenant who has to be in is a party",
      visitParties({ access: "tenant", requestedBy: "u_ten" },
        { hasContractor: false, hasManagerLeg: false }).join() === "tenant");
    ck("and is not one when they do not",
      visitParties({ access: "none", requestedBy: "u_ten" },
        { hasContractor: false, hasManagerLeg: false }).join() === "");
    // A JOB NOBODY REPORTED HAS NOBODY TO ASK, whatever the column says --
    // 060's own rule, read here rather than restated.
    ck("nor when there is nobody to ask",
      visitParties({ access: "tenant" }, { hasContractor: false, hasManagerLeg: false })
        .join() === "");
    ck("the contractor is a party once somebody holds it",
      visitParties({ access: "none" }, { hasContractor: true, hasManagerLeg: false })
        .join() === "contractor");
    // 064. THE HIRING SIDE IS ALWAYS A PARTY once there is a column to record
    // it in, and the ORDER is the feature: the crew first, because they are
    // the constraint, and the tenant last, because they are the one who books
    // a morning off to be in.
    ck("and all three can be",
      visitParties({ access: "tenant", requestedBy: "u_ten" }, { hasContractor: true })
        .join() === "contractor,manager,tenant");
    // The column's ABSENCE, not a preference: a party that can never answer
    // would leave every appointment waiting for ever.
    ck("and the hiring side drops out on a database without 064",
      visitParties({ access: "tenant", requestedBy: "u_ten" },
        { hasContractor: true, hasManagerLeg: false }).join() === "contractor,tenant");
    // NULL falls back to 019's rule, untouched -- the same asymmetry that
    // makes 060 and 061 safe against a live database.
    ck("an unanswered access column still reads the seat role",
      visitParties({ requestedBy: "u_ten" },
        { tenantReported: true, hasContractor: false, hasManagerLeg: false }).join() === "tenant"
      && visitParties({ requestedBy: "u_ten" },
        { tenantReported: false, hasManagerLeg: false }).join() === "");
  }
  {
    // THE COMBINED VERDICT, from one function. Pinning only "confirmed when
    // nobody is left" passes with a decline silently upgraded the moment the
    // other side answers.
    const half = { respondedAt: "2026-10-02", contractorAt: null };
    ck("waiting on whoever has not answered",
      waitingOn(half, ["tenant", "contractor"]).join() === "contractor");
    ck("so a half-answered window is still only proposed",
      visitSettled({ ...half, status: "proposed" }, ["tenant", "contractor"]) === "proposed");
    ck("and is confirmed once everybody has",
      visitSettled({ respondedAt: "x", contractorAt: "y", status: "proposed" },
        ["tenant", "contractor"]) === "confirmed");
    // A DECLINE FROM EITHER SIDE ENDS IT. Carrying on collecting the other
    // party's answer would leave a window with a tick against it that nobody
    // is attending, which reads as settled.
    ck("a decline outranks the other side's yes",
      visitSettled({ status: "declined", respondedAt: "x", contractorAt: "y" },
        ["tenant", "contractor"]) === "declined");
    // "Waiting on you" and "waiting on the tenant" are the same fact and
    // completely different instructions.
    ck("the sentence is written from the reader's own side",
      waitingText(half, ["tenant", "contractor"], "contractor") === "Waiting on you to confirm."
      && waitingText(half, ["tenant", "contractor"], "tenant")
        === "Waiting on the contractor to confirm.",
      waitingText(half, ["tenant", "contractor"], "contractor"));
    ck("and nothing is said when nobody is owed",
      waitingText({ respondedAt: "x", contractorAt: "y" }, ["tenant", "contractor"], "tenant") === null);
    ck("every side is named", Object.keys(VISIT_PARTIES).join() === "tenant,contractor,manager");
    // AND THE ORDER IS ITS OWN RECORD, read by `nextToAnswer` rather than by
    // the order `visitParties` happens to build -- so the chain cannot be
    // reordered by an edit somewhere else.
    ck("and the chain asks the crew first and the tenant last",
      PARTY_ORDER.join() === "contractor,manager,tenant", PARTY_ORDER.join());
    const all = ["contractor", "manager", "tenant"];
    ck("nobody has answered, so it is the contractor's turn",
      nextToAnswer({ status: "proposed" }, all) === "contractor");
    ck("the hiring side is next once the crew has agreed",
      nextToAnswer({ status: "proposed", contractorAt: "x" }, all) === "manager");
    // THE TENANT IS OUTSTANDING THROUGHOUT AND ASKED ONLY AT THE END, which is
    // the whole point: asking them about a window the crew has not committed
    // to risks asking them twice, and the second ask is the expensive one.
    ck("and the tenant only at the end",
      nextToAnswer({ status: "proposed", contractorAt: "x", managerAt: "y" }, all) === "tenant");
    ck("with nobody left once all three have",
      nextToAnswer({ status: "proposed", contractorAt: "x", managerAt: "y", respondedAt: "z" }, all)
        === null);
    ck("and may-answer is that turn and no other",
      mayAnswer({ status: "proposed" }, all, "contractor")
      && !mayAnswer({ status: "proposed" }, all, "tenant")
      && !mayAnswer({ status: "proposed" }, all, "manager"));
  }

  console.log("\n-- the job with nobody in it still has somebody turning up --");
  {
    // THE CORE OF THE REPORT, and the case that used to be booked outright.
    // A repair fixed from outside needs no tenant -- and the crew still has
    // to be able to come.
    const { db, env } = seed();
    const [s, b] = await json(await propose(env, "job_subonly"));
    ck("a manager's time is proposed, not booked", s === 201 && b.status === "proposed",
      `${s} ${b.status}`);
    ck("and the reply says who it is waiting on", (b.waitingOn || []).join() === "contractor",
      JSON.stringify(b.waitingOn));
    // THE DATE LANDS WHEN IT IS SETTLED. A window the crew has not agreed to
    // is not a booking, and writing the date for it puts a job on a calendar
    // nobody has committed to.
    ck("so the job gets no date yet", jobOf(db, "job_subonly").date === null,
      String(jobOf(db, "job_subonly").date));

    const [s2, b2] = await json(await respond(env, b.id, { status: "confirmed" }, "u_sub"));
    ck("the contractor may answer it", s2 === 200, `${s2} ${JSON.stringify(b2)}`);
    ck("and that books it", b2.status === "confirmed", String(b2.status));
    ck("with the date on the job", jobOf(db, "job_subonly").date === "2026-10-09",
      String(jobOf(db, "job_subonly").date));
    // IN THEIR OWN COLUMN, and the tenant's left empty. 019 stamped
    // `responded_at` on a visit nobody had to confirm, so the row read as
    // answered by a tenant who was never asked -- which is the ambiguity the
    // two columns exist to remove.
    ck("recorded in their own column, and not the tenant's",
      !!visitOf(db, "job_subonly").contractor_at
      && visitOf(db, "job_subonly").responded_at === null,
      JSON.stringify(visitOf(db, "job_subonly")));
  }
  {
    // AND NOBODY AT ALL IS STILL BOOKED OUTRIGHT. Without this the change
    // would leave every job with no tenant and no contractor permanently
    // unbookable -- the permanently-amber failure, on a calendar.
    const { db, env } = seed();
    await propose(env, "job_nobody");
    ck("a job with no party is booked the moment a time is set",
      visitOf(db, "job_nobody").status === "confirmed", visitOf(db, "job_nobody").status);
    ck("and the date lands", jobOf(db, "job_nobody").date === "2026-10-09",
      String(jobOf(db, "job_nobody").date));
  }
  {
    // OFFERED IS NOT HELD. Treating a pending work order as a party would
    // leave every visit stuck behind an offer nobody has opened.
    const { db, env } = seed();
    await propose(env, "job_pending");
    ck("a work order nobody has accepted is not a party",
      visitOf(db, "job_pending").status === "confirmed", visitOf(db, "job_pending").status);
    const v = visitOf(db, "job_pending");
    const [s] = await json(await respond(env, v.id, { status: "confirmed" }, "u_sub"));
    ck("and they cannot answer for it either", s === 409 || s === 403, String(s));
  }

  console.log("\n-- both sides, and neither alone is enough --");
  {
    const { db, env } = seed();
    const [, b] = await json(await propose(env, "job_both"));
    // 064. THE CHAIN, IN THE ORDER IT WAS ASKED FOR. The hiring side has
    // already agreed by proposing, so what is outstanding is the crew and then
    // the person who has to be in.
    ck("a manager's proposal waits on the crew, then the tenant",
      b.status === "proposed" && (b.waitingOn || []).join() === "contractor,tenant",
      `${b.status} ${JSON.stringify(b.waitingOn)}`);
    ck("and the hiring side is not waited on for its own proposal",
      !(b.waitingOn || []).includes("manager"), JSON.stringify(b.waitingOn));

    // THE TENANT IS NOT ASKED YET, which is the whole of 064. Asking them to
    // confirm a window the crew has not committed to risks asking them twice,
    // and the second ask is the one that costs their trust -- by then they
    // have booked a morning off work to be in.
    const [ts, tEarly] = await json(await respond(env, b.id, { status: "confirmed" }, "u_ten"));
    ck("the tenant cannot answer before the crew has", ts === 409, String(ts));
    ck("and is told whose turn it is", tEarly.turn === "contractor", String(tEarly.turn));
    ck("so the job still has no date", jobOf(db, "job_both").date === null,
      String(jobOf(db, "job_both").date));

    const [, c] = await json(await respond(env, b.id, { status: "confirmed" }, "u_sub"));
    // THE CREW'S YES DOES NOT SETTLE IT, because somebody still has to be in.
    ck("the crew agreeing hands it to the tenant", c.status === "proposed", String(c.status));
    ck("and it says so", (c.waitingOn || []).join() === "tenant", JSON.stringify(c.waitingOn));
    ck("with no date yet", jobOf(db, "job_both").date === null,
      String(jobOf(db, "job_both").date));

    const [, t] = await json(await respond(env, b.id, { status: "confirmed" }, "u_ten"));
    ck("the tenant is what settles it", t.status === "confirmed", String(t.status));
    ck("and only then does the date land", jobOf(db, "job_both").date === "2026-10-09",
      String(jobOf(db, "job_both").date));
    const row = visitOf(db, "job_both");
    ck("with all three answers kept apart",
      !!row.responded_at && !!row.contractor_at && !!row.manager_at, JSON.stringify(row));
  }
  {
    // THE COUNTER, WHICH IS THE ONE HOP THE HIRING SIDE IS PULLED BACK INTO.
    // A crew that accepts the date costs them nothing -- they agreed by
    // setting it. A crew that MOVES the time is proposing a slot they did not
    // choose, and they may be the one letting the crew in, so they answer.
    const { db, env } = seed();
    const [, first] = await json(await propose(env, "job_both"));
    const [cs, counter] = await json(await propose(env, "job_both", "u_sub"));
    ck("the crew may counter", cs === 201, String(cs));
    ck("their own counter is their agreement",
      !!counter.contractorAt, String(counter.contractorAt));
    ck("and it comes back to the hiring side first",
      (counter.waitingOn || []).join() === "manager,tenant", JSON.stringify(counter.waitingOn));
    // The tenant is still not asked -- the time is not settled upstream yet.
    const [te] = await json(await respond(env, counter.id, { status: "confirmed" }, "u_ten"));
    ck("the tenant is still not asked", te === 409, String(te));
    const [, m] = await json(await respond(env, counter.id, { status: "confirmed" }, "u_mgr"));
    ck("the hiring side agreeing hands it to the tenant",
      m.status === "proposed" && (m.waitingOn || []).join() === "tenant",
      `${m.status} ${JSON.stringify(m.waitingOn)}`);
    const [, t2] = await json(await respond(env, counter.id, { status: "confirmed" }, "u_ten"));
    ck("and the tenant closes it", t2.status === "confirmed", String(t2.status));
    ck("the superseded first window is not still live",
      visitOf(db, "job_both").id === counter.id, visitOf(db, "job_both").id + " vs " + first.id);
  }

  console.log("\n-- proposing is agreeing, for whoever proposed it --");
  {
    // A contractor who offers Tuesday has said they can come on Tuesday.
    // Asking them to confirm their own suggestion is a round trip that
    // answers nothing.
    const { db, env } = seed();
    const [s, b] = await json(await propose(env, "job_both", "u_sub"));
    ck("a contractor may propose a different time", s === 201, `${s} ${JSON.stringify(b)}`);
    ck("and is not asked to confirm their own",
      !(b.waitingOn || []).includes("contractor"), JSON.stringify(b.waitingOn));
    ck("the hiring side answers a time it did not choose",
      (b.waitingOn || []).join() === "manager,tenant", JSON.stringify(b.waitingOn));
    ck("their answer is already recorded", !!visitOf(db, "job_both").contractor_at);
    await respond(env, b.id, { status: "confirmed" }, "u_mgr");
    const [, t] = await json(await respond(env, b.id, { status: "confirmed" }, "u_ten"));
    ck("so the tenant agreeing books it", t.status === "confirmed", String(t.status));
  }
  {
    // AND A MANAGER PROPOSING IS NOT the contractor agreeing. Pinning only
    // the line above passes with every proposal counted as the crew's yes.
    const { db, env } = seed();
    await propose(env, "job_subonly");
    ck("a manager's proposal is not the contractor's answer",
      visitOf(db, "job_subonly").contractor_at === null,
      String(visitOf(db, "job_subonly").contractor_at));
  }

  console.log("\n-- a decline from either side ends it --");
  {
    const { db, env } = seed();
    const [, b] = await json(await propose(env, "job_both"));
    const [s, d] = await json(await respond(env,
      b.id, { status: "declined", note: "We are on another roof that morning" }, "u_sub"));
    ck("the contractor may say it does not work", s === 200 && d.status === "declined",
      `${s} ${d.status}`);
    ck("and the tenant's yes cannot revive it",
      (await json(await respond(env, b.id, { status: "confirmed" }, "u_ten")))[0] === 409);
    ck("the job is not dated", jobOf(db, "job_both").date === null,
      String(jobOf(db, "job_both").date));
    const row = visitOf(db, "job_both");
    // WHOSE REASON IT IS. "The tenant can't make it" over a contractor who
    // turned it down sends somebody to the wrong telephone.
    ck("the reason is filed as theirs",
      row.contractor_note === "We are on another roof that morning" && row.tenant_note === null,
      JSON.stringify(row));
  }
  {
    // The tenant's half, unchanged since 019.
    const { db, env } = seed();
    const [, b] = await json(await propose(env, "job_both"));
    await respond(env, b.id, { status: "declined", note: "I am at work" }, "u_ten");
    const row = visitOf(db, "job_both");
    ck("a tenant's decline still ends it", row.status === "declined", row.status);
    ck("and is filed as theirs",
      row.tenant_note === "I am at work" && row.contractor_note === null, JSON.stringify(row));
  }

  console.log("\n-- and only the two of them may answer --");
  {
    const { env } = seed();
    const [, b] = await json(await propose(env, "job_both"));
    // A contractor answers only where they hold the work. Holding a work
    // order is what says this job was given to them.
    const [s1] = await json(await respond(env, b.id, { status: "confirmed" }, "u_oth"));
    ck("another company on the same roster cannot", s1 === 403, String(s1));
    // The manager is the side that asked. Letting them answer would be one
    // party agreeing with itself.
    // 064. THE MANAGER MAY ANSWER NOW -- but not this one, and not yet: they
    // proposed it, so they have already agreed, and the turn is the crew's.
    const [s2, b2] = await json(await respond(env, b.id, { status: "confirmed" }, "u_mgr"));
    ck("nor the manager who proposed it, whose turn it is not", s2 === 409, String(s2));
    ck("and the refusal says whose turn it is", b2.turn === "contractor", String(b2.turn));
    const [s3] = await json(await respond(env, b.id, { status: "maybe" }, "u_sub"));
    ck("and an answer that is neither is refused", s3 === 400, String(s3));
  }

  console.log("\n-- a database without 061 keeps the shape it has --");
  {
    // THE COLUMN'S ABSENCE IS THE SIGNAL: `SELECT v.*` returns no key at all,
    // rather than null. Without this the tenant confirms, the contractor is
    // counted as a party who can never answer, and the window sits proposed
    // for ever -- a repair that stops moving because of a migration nobody
    // has run, which is strictly worse than the gap it reports.
    const base = SCHEMA.replace(
      /  responded_at  TEXT,[\s\S]*?  manager_at      TEXT\n/,
      "  responded_at  TEXT\n");
    ck("the fixture really is missing them",
      !/contractor_at/.test(base) && !/manager_at/.test(base));
    const { db, env } = seed(base);
    const [s, b] = await json(await propose(env, "job_both"));
    ck("a time can still be proposed", s === 201 && b.status === "proposed", `${s} ${b.status}`);
    const [s2, t] = await json(await respond(env, b.id, { status: "confirmed" }, "u_ten"));
    ck("and the tenant's yes still books it", s2 === 200 && t.status === "confirmed",
      `${s2} ${t.status}`);
    ck("with the date on the job", jobOf(db, "job_both").date === "2026-10-09",
      String(jobOf(db, "job_both").date));
    // A JOB WITH NO TENANT IS BOOKED OUTRIGHT THERE, which is 019's own
    // behaviour and the whole point of the fallback: losing the contractor's
    // leg costs a confirmation, refusing the insert costs anybody the ability
    // to schedule a repair at all.
    const { db: db2, env: env2 } = seed(base);
    await propose(env2, "job_subonly");
    ck("and a job with no tenant is booked as it always was",
      visitOf(db2, "job_subonly").status === "confirmed",
      visitOf(db2, "job_subonly").status);
    // And a contractor who does answer is told what is missing, not 500ed.
    const [, b2] = await json(await propose(env2, "job_both"));
    const [s3, r3] = await json(await respond(env2, b2.id, { status: "confirmed" }, "u_sub"));
    ck("a contractor answering is told which migration",
      s3 === 503 && r3.migration === "061_visit_contractor", `${s3} ${JSON.stringify(r3)}`);
  }

  console.log("\n-- recorded where an operator looks --");
  {
    const chk = readFileSync(join(app, "worker", "migrations", "CHECK.sql"), "utf8");
    ck("CHECK.sql asks whether 061 ran",
      /m061_visit_contractor_at/.test(chk) && /m061_visit_contractor_note/.test(chk));
    // Must read ZERO: a window marked confirmed that somebody who had to
    // agree never answered.
    ck("and counts a confirmed window nobody agreed",
      /m061_inv_confirmed_unanswered/.test(chk));
    const sql = readFileSync(join(app, "worker", "migrations", "061_visit_contractor.sql"), "utf8");
    // Statements, not mentions: the file's own prose names the statement, and
    // a comment reads to a substring count exactly like code -- the trap this
    // project records about `test:rosterword`.
    const alters = (sql.match(/^ALTER TABLE/gm) || []).length;
    // ADD COLUMN is the one statement that cannot be run twice, so each is
    // its own paste and the file says so.
    ck("061 is two ALTER TABLEs", alters === 2, String(alters));
    ck("and says they are one paste each", /one paste EACH/i.test(sql));
  }

  console.log("\n-- the screens read the one rule --");
  {
    const App = readFileSync(join(app, "src", "App.tsx"), "utf8");
    const sched = readFileSync(join(app, "shared", "schedule.js"), "utf8");
    // Whether THIS side has answered, which is what decides whether their
    // card offers a button or says who is still owed.
    ck("workWhen carries whether this side answered", /contractorAt \|\| v\.contractor_at/.test(sched));
    const card = App.slice(App.indexOf("function JobRequestCard("));
    const block = card.slice(0, card.indexOf("function ", 10));
    ck("the card offers Confirm and a counter-proposal",
      /Confirm this time/.test(block) && /Propose a different time/.test(block));
    // Only while it is still open, and only on a row at THIS account:
    // answering is an account-scoped write.
    ck("only on an open window at this account",
      /!away && !past && when\.visitId && when\.kind === "proposed"/.test(block), block.slice(0, 40));
    ck("and it says who is left once we have answered", /jr-vis-wait/.test(block));
    // ONE form for both sides. A second copy of three inputs and a window
    // validation is two things to keep in step.
    ck("there is one propose form, used twice",
      (App.match(/<VisitForm /g) || []).length === 2,
      String((App.match(/<VisitForm /g) || []).length));
    ck("and the contractor's door opens it", /onProposeVisit={setProposeWO}/.test(App));
    // The effective access answer, off /api/my-work, because the raw column
    // is null on nearly every job.
    ck("the card reads the effective access answer", /const myAccess = useMemo/.test(App));
    ck("including on the other clients' rows",
      /access: w\.access \|\| null/.test(App));
  }
} catch (err) {
  fail++; console.log("FAIL  threw:", err?.stack || err);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
