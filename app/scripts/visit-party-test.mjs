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
import { runCheck } from "./lib/check-sql.mjs";
import { visitParties, waitingOn, visitSettled, waitingText, partyText, joinAnd,
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

    // THE TENANT IS NOT ASKED YET, which is the whole of 064 -- the turn says
    // so. Whether they may answer early is the next block.
    ck("the crew is asked first", b.turn === "contractor", String(b.turn));

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
    ck("the hiring side's turn, not the tenant's", counter.turn === "manager", String(counter.turn));
    const [, m] = await json(await respond(env, counter.id, { status: "confirmed" }, "u_mgr"));
    ck("the hiring side agreeing hands it to the tenant",
      m.status === "proposed" && (m.waitingOn || []).join() === "tenant",
      `${m.status} ${JSON.stringify(m.waitingOn)}`);
    const [, t2] = await json(await respond(env, counter.id, { status: "confirmed" }, "u_ten"));
    ck("and the tenant closes it", t2.status === "confirmed", String(t2.status));
    ck("the superseded first window is not still live",
      visitOf(db, "job_both").id === counter.id, visitOf(db, "job_both").id + " vs " + first.id);
  }

  console.log("\n-- the tenant is asked last and may answer first --");
  {
    // Reported as no functional way for a tenant to accept: their report read
    // "Confirm a time" over nothing to press, because the route refused them
    // until the crew and the hiring side had both agreed. The chain decides
    // whom we ASK; it does not have to stop the person who has to be in from
    // saying the time works.
    const { db, env } = seed();
    const [, b] = await json(await propose(env, "job_both"));
    const [ts, early] = await json(await respond(env, b.id, { status: "confirmed" }, "u_ten"));
    ck("the tenant may say yes before the crew has", ts === 200, `${ts} ${JSON.stringify(early)}`);
    ck("which does not settle it", early.status === "proposed", String(early.status));
    ck("and leaves only the crew to answer", (early.waitingOn || []).join() === "contractor",
      JSON.stringify(early.waitingOn));
    ck("and says whose turn it now is", early.turn === "contractor", String(early.turn));
    ck("so the job still has no date", jobOf(db, "job_both").date === null,
      String(jobOf(db, "job_both").date));
    const [, c] = await json(await respond(env, b.id, { status: "confirmed" }, "u_sub"));
    ck("the crew's yes then books it, without asking the tenant again",
      c.status === "confirmed", String(c.status));
    ck("and the date lands", jobOf(db, "job_both").date === "2026-10-09",
      String(jobOf(db, "job_both").date));
  }
  {
    // A WINDOW THE TENANT PUT FORWARD IS SETTLED BY THE CREW. Reported as
    // "Pacific confirmed newly proposed time by tenant, but it's not
    // confirming still on the tenants side": the crew said yes and the window
    // sat waiting on the managing agent, who was never asked anything. The
    // two people who have to be there have both said yes.
    const { db, env } = seed();
    const [ps, tp] = await json(await propose(env, "job_both", "u_ten"));
    ck("a tenant may propose a time for their own report", ps === 201, `${ps} ${JSON.stringify(tp)}`);
    ck("their own proposal is their agreement", !!tp.respondedAt, String(tp.respondedAt));
    ck("and it goes to the crew, and only the crew",
      (tp.waitingOn || []).join() === "contractor" && tp.turn === "contractor"
      && !(tp.parties || []).includes("manager"),
      `${JSON.stringify(tp.waitingOn)} ${tp.turn} ${JSON.stringify(tp.parties)}`);
    // Every reader says the same, or the crew's card and the tenant's row
    // disagree about whether it is booked.
    const listed = async (who) => {
      const r = await worker.fetch(new Request("https://api.subsub.work/api/visits", {
        headers: { "X-User-Id": who, "X-Account-Id": "acc_pm" } }), env);
      return ((await r.json().catch(() => [])) || []).find((x) => x.id === tp.id);
    };
    const lt = await listed("u_ten"), lm = await listed("u_mgr");
    ck("the tenant's list is not waiting on the agent",
      !(lt?.parties || []).includes("manager") && lt?.turn === "contractor",
      JSON.stringify(lt && { parties: lt.parties, turn: lt.turn }));
    ck("and neither is the agent's", !(lm?.parties || []).includes("manager"),
      JSON.stringify(lm?.parties));
    const mw = await worker.fetch(new Request("https://api.subsub.work/api/my-work", {
      headers: { "X-User-Id": "u_sub", "X-Account-Id": "acc_pm" } }), env);
    const mine = ((await mw.json().catch(() => ({}))).work || []).find((w) => w.jobId === "job_both");
    ck("the crew's own card asks them, and names nobody else",
      mine?.visit?.turn === "contractor" && (mine?.visit?.waitingOn || []).join() === "contractor",
      JSON.stringify(mine?.visit));
    const [cs, cy] = await json(await respond(env, tp.id, { status: "confirmed" }, "u_sub"));
    ck("so the crew's yes books it", cs === 200 && cy.status === "confirmed", `${cs} ${JSON.stringify(cy)}`);
    ck("with no turn left over", cy.turn === null, String(cy.turn));
    ck("and the date lands on the job", jobOf(db, "job_both").date === "2026-10-09",
      String(jobOf(db, "job_both").date));
    // Only their own report, and only where they have to be in.
    const [fs, f] = await json(await propose(env, "job_nobody", "u_ten"));
    ck("a tenant cannot propose for a job that is not theirs", fs === 404 || fs === 403,
      `${fs} ${JSON.stringify(f)}`);
    const [ns, n] = await json(await propose(env, "job_subonly", "u_ten"));
    ck("nor for one they do not have to be in for", ns === 409 && n.error === "no_tenant_needed",
      `${ns} ${JSON.stringify(n)}`);
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

  console.log("\n-- 067: a window the hiring side proposed carries their agreement --");
  {
    // Reported from a manager's own Jobs screen: *"Proposed Oct 16, 2026 ·
    // 9 AM-10 AM -- waiting on the contractor and the hiring side to
    // confirm"*, on a job they had set the time for themselves, with no
    // button anywhere to answer it. They are told they are waiting on
    // themselves, and the chain cannot resolve it: the crew is asked FIRST,
    // so until they answer it is never the manager's turn.
    //
    // Nothing is wrong with the screen. These are rows written before 064 --
    // under 061 a manager proposing stamped nothing, because the hiring side
    // had no leg -- so `manager_at` is NULL and 064 counts them as a party
    // who has not answered.
    const db = freshDb({ base: SCHEMA, migrations: [] });
    db.exec(`
      INSERT INTO accounts(id,name,kind,subdomain,plan) VALUES
        ('acc_pm','Sound PM','property_manager','soundpm','scale'),
        ('acc_b','Cascade','property_manager','cascade','basic');
      INSERT INTO users(id,name,email) VALUES
        ('u_mgr','Chris','c@t.test'), ('u_pm','Dev','d@t.test'),
        ('u_sub','Juan','j@t.test'), ('u_ten','John','t@t.test');
      INSERT INTO memberships(id,user_id,account_id,role) VALUES
        ('m1','u_mgr','acc_pm','admin'), ('m2','u_pm','acc_pm','pm'),
        ('m3','u_sub','acc_pm','contractor'), ('m4','u_ten','acc_pm','tenant'),
        -- THE SAME PERSON, ADMIN SOMEWHERE ELSE. The membership has to be
        -- matched on the visit's own account or a contractor seat here would
        -- be backfilled as the hiring side because of a seat over there.
        ('m5','u_sub','acc_b','admin');
      INSERT INTO jobs(id,account_id,title,trades,status,created_at) VALUES
        ('j1','acc_pm','A','["plumbing"]','active','2026-09-01');
      INSERT INTO visits(id,account_id,job_id,proposed_by,date,start_time,end_time,status,created_at) VALUES
        -- Proposed by an admin, pre-064: nothing stamped.
        ('v_admin','acc_pm','j1','u_mgr','2026-10-16','09:00','10:00','proposed','2026-09-20 10:00:00'),
        -- And by a project manager, who is equally the hiring side.
        ('v_pm','acc_pm','j1','u_pm','2026-10-17','09:00','10:00','proposed','2026-09-20 11:00:00'),
        -- THE DISCRIMINATING ROW: proposed by the CONTRACTOR. Their agreement,
        -- not the manager's -- so the hiring side must go on waiting, which is
        -- the whole of what 064 added. A backfill that caught this one would
        -- settle windows nobody on the team has seen.
        ('v_sub','acc_pm','j1','u_sub','2026-10-18','09:00','10:00','proposed','2026-09-20 12:00:00'),
        -- A tenant's own counter, for the same reason.
        ('v_ten','acc_pm','j1','u_ten','2026-10-19','09:00','10:00','proposed','2026-09-20 13:00:00'),
        -- FINISHED BUSINESS. Nothing reads its legs, and a backfill that
        -- reaches one row too far is worse than one that reaches none.
        ('v_old','acc_pm','j1','u_mgr','2026-09-02','09:00','10:00','superseded','2026-09-01 10:00:00'),
        -- Already stamped. Running the file twice must change nothing.
        ('v_done','acc_pm','j1','u_mgr','2026-10-20','09:00','10:00','proposed','2026-09-20 14:00:00');
      UPDATE visits SET manager_at = '2026-09-20T14:00:00.000Z' WHERE id = 'v_done';
    `);
    const unstamped = () => runCheck(db).m067_inv_manager_unstamped;
    const legOf = (id) => db.prepare(`SELECT manager_at FROM visits WHERE id = ?`).get(id).manager_at;

    // THE INVARIANT IS RUN AGAINST REAL ROWS, which is 057's lesson: every
    // invariant reads zero on an empty database, so one that is subtly wrong
    // passes for ever.
    ck("the invariant sees the rows before the backfill", unstamped() === 2,
      String(unstamped()));

    const SQL = readFileSync(join(app, "worker", "migrations", "067_visit_manager_backfill.sql"), "utf8");
    db.exec(SQL);
    ck("and reads zero after it", unstamped() === 0, String(unstamped()));
    // Set to the row's own created_at -- what the route would have written had
    // the column existed: the moment they proposed it.
    ck("the admin's window is stamped at the moment it was proposed",
      legOf("v_admin") === "2026-09-20 10:00:00", String(legOf("v_admin")));
    ck("and the project manager's too", !!legOf("v_pm"), String(legOf("v_pm")));
    // BOTH DIRECTIONS, because a backfill that stamped everything passes every
    // assertion above on its own.
    ck("the contractor's own proposal is left alone", legOf("v_sub") === null,
      String(legOf("v_sub")));
    ck("and the tenant's", legOf("v_ten") === null, String(legOf("v_ten")));
    ck("a superseded window is not touched", legOf("v_old") === null, String(legOf("v_old")));
    ck("and one already stamped keeps its own value",
      legOf("v_done") === "2026-09-20T14:00:00.000Z", String(legOf("v_done")));
    // Idempotent: it is a paste an operator may run twice.
    db.exec(SQL);
    ck("running it twice changes nothing",
      legOf("v_admin") === "2026-09-20 10:00:00" && legOf("v_sub") === null,
      `${legOf("v_admin")} / ${legOf("v_sub")}`);
    // STATUS IS DELIBERATELY NOT TOUCHED, and that is safe rather than an
    // omission: the rows this matches had NO leg stamped, so the contractor is
    // still outstanding and `proposed` remains the correct verdict.
    ck("and the window is still proposed, not settled",
      db.prepare(`SELECT status FROM visits WHERE id = 'v_admin'`).get().status === "proposed");
  }

  console.log("\n-- the parties in words, read from the one list --");
  {
    // Reported as *"one of the times for a job says waiting on a contractor
    // and a contractor to confirm"*. The manager's screen built that sentence
    // with a two-branch ternary -- tenant, else "the contractor" -- which was
    // complete when 061 shipped two parties and silently wrong the moment 064
    // added a third: the hiring side came out wearing the contractor's label,
    // beside the real contractor, in the same sentence.
    //
    // THE THREE-PARTY CASE IS THE ONLY ONE EITHER BEHAVIOUR CAN BE TOLD APART
    // ON. With two parties a hand-written ternary and this helper agree.
    const three = partyText(["contractor", "manager", "tenant"], { tenantName: "John Smith" });
    ck("each party is named once", three.split("the contractor").length === 2, three);
    ck("and the hiring side by its own label", /the hiring side/.test(three), three);
    // AND THE TENANT CARRIES THEIR ROLE. Asked as *"who is John Smith? Juan
    // Soto is the account holder"* -- a bare name is the one party a managing
    // agent may never have spoken to, so it read as a stranger.
    ck("the tenant is named with their role", /the tenant \(John Smith\)/.test(three), three);
    ck("and keeps the plain label with no name",
      partyText(["tenant"]) === "the tenant", partyText(["tenant"]));
    // Order is PARTY_ORDER's, not the caller's: the chain cannot be reordered
    // by an edit somewhere else.
    ck("in the order they are asked",
      partyText(["tenant", "contractor"]) === "the contractor and the tenant",
      partyText(["tenant", "contractor"]));
    // Three read as a stammer with join(" and ").
    ck("three are comma-joined", /^the contractor, the hiring side and /.test(three), three);
    ck("two are joined with and", joinAnd(["a", "b"]) === "a and b", joinAnd(["a", "b"]));
    ck("one is itself", joinAnd(["a"]) === "a", joinAnd(["a"]));
    ck("none is empty", joinAnd([]) === "", JSON.stringify(joinAnd([])));
    // A party the list has never heard of is dropped rather than rendered as
    // `undefined` in a sentence somebody reads.
    ck("an unknown party is dropped", partyText(["nobody"]) === "", partyText(["nobody"]));
    // AND THE CONTRACTOR'S WORD IS THE CALLER'S, not the constant. Reported as
    // *"it should actually say handyman since pacific is a handyman"*. The
    // label in VISIT_PARTIES is the default and stays right for every roster
    // that has not said otherwise; `jobHiresWord` is what reads the engagement.
    const hm = partyText(["contractor", "manager", "tenant"],
      { tenantName: "John Smith", contractorWord: "handyman" });
    ck("a handyman is called a handyman", /the handyman/.test(hm), hm);
    ck("and the constant does not come out beside it", !/the contractor/.test(hm), hm);
    // THE OTHER TWO ARE UNTOUCHED BY IT, asserted here because a change that
    // overwrote every label with the word would pass the two checks above.
    ck("while the hiring side and the tenant keep their own",
      /the hiring side/.test(hm) && /the tenant \(John Smith\)/.test(hm), hm);
    // AND NO WORD IS THE OLD SENTENCE, which is what every call site that has
    // no job to read gets. Both branches in the same place.
    ck("and passing none leaves the default word",
      /the contractor/.test(three) && !/the handyman/.test(three), three);
    // EVERY PARTY HAS A LABEL, so a party added later cannot reach a screen
    // nameless -- which is the whole class of bug this helper exists to close.
    ck("every party in the order has a label",
      PARTY_ORDER.every((pp) => !!VISIT_PARTIES[pp]?.label),
      PARTY_ORDER.filter((pp) => !VISIT_PARTIES[pp]?.label).join() || "all");
    ck("and the order covers every party",
      Object.keys(VISIT_PARTIES).every((pp) => PARTY_ORDER.includes(pp)),
      Object.keys(VISIT_PARTIES).filter((pp) => !PARTY_ORDER.includes(pp)).join() || "all");
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
    // THE ANSWER MOVED OUT OF THE CARD AND INTO ITS OWN BLOCK, which is the
    // point of that change rather than a detail of it: 061 drew it as a chip
    // row and the person it is aimed at could not see it. So the three
    // answers are asserted where they now live, and the card is asserted to
    // mount it -- a check that only looked in `block` would pass with the
    // panel built and never rendered.
    const ans = App.slice(App.indexOf("function VisitAnswer("));
    const panel = ans.slice(0, ans.indexOf("function ", 10));
    ck("the panel offers all three answers",
      /Yes, I'll be there/.test(panel) && /Propose another time/.test(panel)
        && /Can't make it/.test(panel));
    ck("and the card mounts it", /<VisitAnswer /.test(block));
    // Only while it is still open, only when it is THIS side's turn, and only
    // answerable on a row at this account: answering is an account-scoped
    // write. `turn` comes off the server; where a route does not carry it the
    // 061 question stands in, so an older reply cannot hide the button.
    ck("only on an open window whose turn is ours",
      /!past && when\.visitId && when\.kind === "proposed"/.test(block)
        && /when\.turn === "contractor"/.test(block)
        && /: !when\.mine/.test(block), block.slice(0, 40));
    ck("and answerable only at this account", /canAnswer={!away}/.test(block));
    ck("and it says who is left once we have answered", /jr-vis-wait/.test(block));
    // THE MANAGER'S BLOCK READS THE HELPER, not a ternary of its own. The bug
    // was a two-branch map written at the call site, so what is pinned is the
    // absence of one.
    const vb = App.slice(App.indexOf("function VisitBlock("));
    const vblock = vb.slice(0, vb.indexOf("\nfunction ", 10));
    ck("the manager's block names parties through the helper",
      /partyWords\(stillOwed/.test(vblock) && /partyWords\(parties/.test(vblock));
    // STRIPPED OF COMMENTS FIRST. The note recording the bug QUOTES the
    // expression it replaced, which reads to a substring check exactly like
    // the expression still being there -- the fifth time this repository has
    // paid for that, and the first version of this assertion duly failed on
    // its own explanation.
    const code = vblock
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
    ck("and has no label ternary of its own",
      !/=== "tenant" \? name :/.test(code));
    // The note goes to whoever ATTENDS, so the hiring side -- the people
    // writing it -- is off it. It read "Note for the tenant" on a job with no
    // tenant in the loop at all.
    ck("the note is addressed to whoever attends",
      /pp !== "manager"/.test(vblock));
    // ONE form for all three sides -- the hiring side, the crew and the
    // tenant. A second copy of three inputs and a window validation is two
    // things to keep in step; a fourth mount should raise this number on
    // purpose, never by a copy.
    ck("there is one propose form, used three times",
      (App.match(/<VisitForm /g) || []).length === 3,
      String((App.match(/<VisitForm /g) || []).length));
    ck("and the contractor's door opens it", /onProposeVisit={setProposeWO}/.test(App));
    // ONE DOOR INTO ANOTHER ACCOUNT. `onGoClient` -- the only route a
    // subcontractor ACCOUNT's own admin has to a screen where they can answer
    // a proposed time -- set `currentAccountId` and stopped: no `setAuth`, no
    // `hydrateAccount`, no tab change, so pressing Open left every fetch
    // pointed at the account just left. The identical bug CLAUDE.md records
    // about the drawer, in a third door nobody had noticed was one.
    ck("the client link goes through goToSeat", /onGoClient={goToSeat}/.test(App));
    // AND NOTHING ELSE SWITCHES ACCOUNT BY HAND. Four copies of "set the id,
    // re-auth, re-fetch, land on a screen this role has" is four places for
    // one of them to be missing a step, which is how this happened twice. The
    // remaining call sites are signing in, resuming and the staff seat --
    // none of them a switch between two seats somebody already holds.
    const switches = (App.match(/setCurrentAccountId\(/g) || []).length;
    ck("and only the entry points set the account id by hand", switches <= 5,
      String(switches));
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
