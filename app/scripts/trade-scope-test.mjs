// EACH TRADE IS ASKED TO PRICE ITS OWN ROOMS, NOT THE WHOLE WALK.
//
// Reported with a nine-trade move-out job on screen. The work order line's
// "Scope for plumbing" opened BLANK, and "Ask for quotes" seeded the WHOLE
// job's scope -- eleven flagged rooms, of which one is the toilet. So filling
// nine work orders in meant typing nine scopes the inspection had already
// recorded, and the quick way out sent every contractor the entire walk and
// left them to find their own line in it.
//
// Asked for as *"carry through the details of the job on each task and
// auto-populate the content for each jobs scope ... and reduce the work of
// filling each out for the property manager"*.
//
// `inspectionTradeScopes` in `app/shared/inspection.js`, and
// `GET /api/jobs/:id/trade-scope`. What this pins:
//
//   THE ROOMS THAT SUGGESTED A TRADE ARE THAT TRADE'S SCOPE, read through the
//   one `roomTrades` the chip grid uses -- so a ticked chip and the text under
//   it cannot name different rooms. The contractor reads the second one.
//
//   A TRADE NOTHING MATCHED IS ABSENT, never a header with no rooms under it:
//   "From the move-out inspection of unit 3B:" on its own reads as a scope
//   saying there is nothing to do, on the document somebody is pricing.
//
//   A ROOM THAT WAS FINE IS IN NOBODY'S SCOPE, the same line the job's own
//   scope and the contractor's shape both draw.
//
//   DRAFTS DO NOT DECIDE IT. A sentence a model wrote and nobody kept is the
//   team's working note, so it must not put a room on a work order.
//
//   AND THE ROUTE IS ADMIN OR PM. A tenant is on this account and an
//   inspection is explicitly not shown to the tenant it is about; a contractor
//   reads the walk through the work-order route, scoped to work they hold.
//
//   node --no-warnings scripts/trade-scope-test.mjs

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { inspectionTradeScopes, inspectionJobScope, suggestTrades } from "../shared/inspection.js";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(join(app, "worker", "schema.sql"), "utf8");

// THE FIXTURE IS THE TEST, and three rows in it exist only to discriminate:
//
//   `r_bath` is plumbing by its ROOM NAME and nothing else.
//   `r_wall` is painting by its NOTE and nothing else -- and its note carries
//     "left of the door", so a rule without the positional guard would also
//     call a glazier.
//   `r_store` is flagged with a name and note naming NO trade at all, and a
//     photo whose
//     only words are an unkept DRAFT. It is the one room that tells
//     drafts-included from drafts-excluded, so it had to be a name the hint
//     list does not know: "Utility cupboard" is cabinets by its own word.
//   `r_hall` is fine, so it must appear in nobody's scope.
//
// A fixture where every flagged room matched every trade would pass whichever
// split was in force, which is the shape this project keeps recording.
const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,kind,subdomain,plan) VALUES
      ('acc_pm','Sound Property Management','property_manager','soundpm','scale');
    INSERT INTO users(id,name,email) VALUES
      ('u_mgr','Chris Lane','chris@soundpm.test'),
      ('u_pm','Pat Manager','pat@soundpm.test'),
      ('u_ten','Ada Three','ada@t.test'),
      ('u_sub','Juan Soto','juan@pacific.test');
    INSERT INTO companies(id,company,contact,email,state) VALUES
      ('cmp_pac','Pacific apartment maintenance','Juan Soto','juan@pacific.test','WA');
    INSERT INTO engagements(id,account_id,company_id,status,categories) VALUES
      ('en_pac','acc_pm','cmp_pac','active','["plumbing"]');
    INSERT INTO properties(id,account_id,name,address,city,state,zip) VALUES
      ('prop_1','acc_pm','Press Apartments','1620 Belmont','Seattle','WA','98122');
    INSERT INTO memberships(id,user_id,account_id,role,company_id,unit) VALUES
      ('m_mgr','u_mgr','acc_pm','admin',NULL,NULL),
      ('m_pm','u_pm','acc_pm','pm',NULL,NULL),
      ('m_ten','u_ten','acc_pm','tenant',NULL,'3B'),
      ('m_sub','u_sub','acc_pm','contractor','cmp_pac',NULL);

    INSERT INTO jobs(id,account_id,property_id,title,trades,status,created_at)
      VALUES ('job_out','acc_pm','prop_1','Move-out work — unit 3B','["plumbing","painting"]','active','2026-10-01');
    -- A job nobody walked, which is the ordinary case and must answer an empty
    -- map rather than a 404.
    INSERT INTO jobs(id,account_id,property_id,title,trades,status,created_at)
      VALUES ('job_plain','acc_pm','prop_1','Repaint hallway','["painting"]','active','2026-10-01');

    INSERT INTO inspections(id,account_id,property_id,unit,kind,inspected_on,status,finished_at,job_id)
      VALUES ('ins_out','acc_pm','prop_1','3B','move_out','2026-10-01','finished','2026-10-01 12:00:00','job_out');
    INSERT INTO inspection_rooms(id,inspection_id,name,status,note,position) VALUES
      ('r_bath','ins_out','Shower and bath','fail','Cracked basin',0),
      ('r_wall','ins_out','Walls and floors','follow_up','Scuff to the wall left of the door',1),
      ('r_store','ins_out','Store room','fail','Will not shut properly',2),
      ('r_hall','ins_out','Hall','ok','Nothing to report',3);
    INSERT INTO inspection_photos(id,room_id,file_key,name,content_type) VALUES
      ('ph_store','r_store','acc_pm/inspection-photo/o.jpg','o.jpg','image/jpeg');
    -- A DRAFT AND NO CAPTION, which is the only row that can tell the two
    -- readings apart: with drafts in, this room is plumbing; with them out, it
    -- names no trade at all.
    INSERT INTO inspection_photo_notes(photo_id,caption,draft,drafted_at) VALUES
      ('ph_store',NULL,'A dripping tap in the corner','2026-10-01T10:00:00.000Z');


  `);
  return { db, env: { DB: makeD1(db), FILES: { put: async () => {}, get: async () => null } } };
};

const get = (env, path, who = "u_mgr") => worker.fetch(
  new Request(`https://api.subsub.work${path}`, {
    method: "GET",
    headers: { "Content-Type": "application/json", "X-User-Id": who, "X-Account-Id": "acc_pm" },
  }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];

const INSP = { kind: "move_out", unit: "3B", inspectedOn: "2026-10-01" };
const ROOMS = [
  { id: "r_bath", name: "Shower and bath", status: "fail", note: "Cracked basin", photos: [] },
  { id: "r_wall", name: "Walls and floors", status: "follow_up", note: "Scuff to the wall left of the door", photos: [] },
  { id: "r_hall", name: "Hall", status: "ok", note: "Nothing to report", photos: [] },
];

try {
  console.log("\n-- the split itself --");
  {
    const sc = inspectionTradeScopes(INSP, ROOMS);
    // THE CHIP AND THE TEXT READ ONE RULE. Asserted against `suggestTrades`
    // rather than against a literal, because the property is that they agree:
    // a split with its own matching could be internally consistent and still
    // put rooms under a trade the grid never ticked.
    const ticked = suggestTrades(ROOMS).trades.slice().sort();
    ck("every suggested trade gets a scope and no others",
      JSON.stringify(Object.keys(sc).sort()) === JSON.stringify(ticked),
      `${JSON.stringify(Object.keys(sc).sort())} vs ${JSON.stringify(ticked)}`);

    ck("plumbing is asked to price the bathroom",
      /Shower and bath/.test(sc.plumbing || ""), JSON.stringify(sc.plumbing));
    // THE HALF THAT MATTERS: not merely that its own room is there, but that
    // the other trade's room is NOT. A split that returned the whole walk to
    // everybody passes the assertion above and fails this one.
    ck("and NOT the walls, which are somebody else's",
      !/Walls and floors/.test(sc.plumbing || ""), JSON.stringify(sc.plumbing));
    ck("painting is asked to price the walls",
      /Walls and floors/.test(sc.painting || ""), JSON.stringify(sc.painting));
    ck("and NOT the bathroom",
      !/Shower and bath/.test(sc.painting || ""), JSON.stringify(sc.painting));

    // The positional guard, which this fixture's note exists to exercise:
    // "left of the door" must not call a glazier.
    ck("a word that only says WHERE the damage is earns no trade",
      !sc.windows_doors, JSON.stringify(Object.keys(sc)));

    // A room that was fine is in nobody's scope -- the same line the job's own
    // scope draws, and the reason a work order is a list of things to do
    // rather than a document to read.
    ck("a room that was fine is in nobody's scope",
      !Object.values(sc).some((t) => /Hall/.test(t)), JSON.stringify(sc));

    // A TRADE NOTHING MATCHED IS ABSENT, not a header with nothing under it.
    ck("a trade nothing matched has no entry at all", sc.concrete === undefined);

    // It renders through the same composer as the job's own scope, so the two
    // cannot word one walk two ways.
    const whole = inspectionJobScope(INSP, ROOMS);
    ck("the header matches the job's own scope",
      (sc.plumbing || "").split("\n")[0] === whole.split("\n")[0],
      `${(sc.plumbing || "").split("\n")[0]} vs ${whole.split("\n")[0]}`);
    // And the job's own scope is still every flagged room, unchanged by any
    // of this -- the split is a seed for a form, not a rewrite of the record.
    ck("and the job's own scope still carries both rooms",
      /Shower and bath/.test(whole) && /Walls and floors/.test(whole));
  }

  console.log("\n-- an empty walk, and one room that names nothing --");
  {
    ck("no rooms is an empty map rather than a bare header",
      JSON.stringify(inspectionTradeScopes(INSP, [])) === "{}");
    const dumb = [{ id: "x", name: "Store room", status: "fail", note: "Will not shut properly", photos: [] }];
    ck("a flagged room naming no trade produces no scope",
      JSON.stringify(inspectionTradeScopes(INSP, dumb)) === "{}",
      JSON.stringify(inspectionTradeScopes(INSP, dumb)));
  }

  console.log("\n-- the route --");
  {
    const { env } = seed();
    const [st, body] = await json(await get(env, "/api/jobs/job_out/trade-scope"));
    ck("an admin gets the map", st === 200 && !!body.scopes, `${st} ${JSON.stringify(body).slice(0, 120)}`);
    ck("plumbing names the bathroom",
      /Shower and bath/.test(body.scopes?.plumbing || ""), JSON.stringify(body.scopes?.plumbing));
    ck("and not the walls",
      !/Walls and floors/.test(body.scopes?.plumbing || ""), JSON.stringify(body.scopes?.plumbing));

    // DRAFTS DO NOT DECIDE WHAT A CONTRACTOR IS ASKED TO PRICE. `r_oven`'s
    // only trade signal is an unkept draft saying "dripping tap", so with
    // drafts read it would join the plumbing scope. Mutating the route to
    // `drafts: true` is what this catches.
    ck("a room whose only signal is an unkept draft is left out",
      !/Store room/.test(JSON.stringify(body.scopes || {})),
      JSON.stringify(body.scopes));

    const [st2, body2] = await json(await get(env, "/api/jobs/job_out/trade-scope", "u_pm"));
    ck("a project manager gets it too", st2 === 200 && !!body2.scopes?.plumbing, String(st2));

    // A tenant is on this account, and an inspection is explicitly not shown
    // to the tenant it is about.
    const [st3] = await json(await get(env, "/api/jobs/job_out/trade-scope", "u_ten"));
    ck("a tenant is refused", st3 === 403, String(st3));
    const [st4] = await json(await get(env, "/api/jobs/job_out/trade-scope", "u_sub"));
    ck("and so is a contractor seat", st4 === 403, String(st4));
  }

  console.log("\n-- a job nobody walked --");
  {
    const { env } = seed();
    // NOT A 404. Most jobs were typed or arrived from a CRM, so a refusal on
    // the common case is a modal that has to decide whether a missing answer
    // is a fault.
    const [st, body] = await json(await get(env, "/api/jobs/job_plain/trade-scope"));
    ck("answers an empty map, not a refusal",
      st === 200 && JSON.stringify(body.scopes) === "{}", `${st} ${JSON.stringify(body)}`);
    // Another account's job is not readable at all, which the account scope on
    // the lookup is what makes true.
    const [st2, body2] = await json(await get(env, "/api/jobs/nope/trade-scope"));
    ck("and an id that is not this account's answers the same nothing",
      st2 === 200 && JSON.stringify(body2.scopes) === "{}", `${st2} ${JSON.stringify(body2)}`);
  }

  console.log("\n-- the browser seeds from it and never over typing --");
  {
    const src = readFileSync(join(app, "src", "App.tsx"), "utf8");
    // ONE FETCH FOR BOTH MODALS. Two mounts of one record is two requests for
    // it, which is the duplicate-state trap this project already refuses.
    //
    // THE DASHBOARD'S JOB DETAILS CALL IT TOO, and that is a different modal
    // rather than a second copy of these two: it closes before Assign opens,
    // so the two never hold the same record at once. So the count is the
    // definition, the one hoisted call the two Jobs-screen modals share, and
    // one inside JobPeek -- and a third call anywhere else still fails.
    const hooks = src.match(/useJobTradeScope\(/g) || [];
    const peekAt = src.indexOf("function JobPeek(");
    const peekEnd = src.indexOf("\nfunction ", peekAt + 10);
    const inPeek = (src.slice(peekAt, peekEnd).match(/useJobTradeScope\(/g) || []).length;
    ck("the hook is declared once and the two modals share one call",
      hooks.length === 3 && inPeek === 1, `${hooks.length} total, ${inPeek} in JobPeek`);
    ck("and both modals are handed the same answer",
      /<PickContractor[\s\S]{0,400}?tradeScopes=\{tradeScopes\}/.test(src)
      && /<AskQuotes[\s\S]{0,400}?tradeScopes=\{tradeScopes\}/.test(src));
    // THE SEED MUST NOT OVERWRITE WHAT SOMEBODY HAS TYPED, and the guard that
    // decides it is inside the EFFECT -- not the onChange that sets the flag.
    //
    // The first version of this assertion looked for the flag anywhere in the
    // file, so deleting the guard from the effect changed no outcome: the
    // onChange still sets it and the note still reads it. An assertion that
    // passes whether or not the thing it is about happened is this project's
    // own could-not-fail shape, caught here by the mutation that was written
    // to prove it. So each one reads its own block.
    const woEffect = (src.match(/useEffect\(\(\) => \{\s*setLines\(\(l\) => \{[\s\S]*?\}, \[tradeScopes\]\);/) || [""])[0];
    ck("the work order line's effect skips a typed scope",
      /typed\.current\[t\]/.test(woEffect) && /\(l\[t\]\?\.scope \|\| ""\)\.trim\(\)/.test(woEffect),
      woEffect ? "guard missing" : "effect not found");
    ck("and it is the press that marks it typed", /typed\.current\[t\] = true/.test(src));
    const qEffect = (src.match(/useEffect\(\(\) => \{\s*if \(seeded[\s\S]*?\}, \[seeded\]\);/) || [""])[0];
    ck("the quote ask's effect skips a typed scope",
      /!touched\.current/.test(qEffect), qEffect ? "guard missing" : "effect not found");
    ck("and it is the press that marks it typed there too", /touched\.current = true/.test(src));
    // SAID RATHER THAN CLAIMED: what a static check cannot see is the box
    // actually filling. The effect runs on an answer that arrives after the
    // modal opens, so the only real proof is a drawn modal -- which is a
    // browser suite this change does not add.
    // The quote ask previously seeded the WHOLE job scope. That stays as the
    // fallback for a job nobody walked and must not be what a walked job gets.
    ck("the quote ask prefers the trade's slice over the job's",
      /const seeded = tradeScopes\[trade\] \|\| "";/.test(src)
      && /useState\(seeded \|\| job\.scope \|\| ""\)/.test(src));
  }
} catch (e) {
  fail += 1;
  console.log("FAIL  threw --", e?.stack || e);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
