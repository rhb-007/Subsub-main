// THE PEOPLE ASKED TO PRICE IT SEE WHAT THEY ARE PRICING.
//
// 062 carried the flagged rooms, the kept captions and the photographs to the
// company that WON -- `GET /api/work-orders/:id/inspection`. A quote request is
// PRE-AWARD and there is no work order yet, so the two or three companies
// actually being asked for a number were the ones who could not see the mark.
// A price given off a line of text is a price that changes when somebody gets
// there.
//
// `quoteInspectionShape` in `app/shared/inspection.js`,
// `GET /api/quotes/:inviteId/inspection` and its photo route. What this pins:
//
//   NARROWED TO THE TRADE'S OWN ROOMS, through the one `roomTrades` the chip
//   grid and the per-trade scope already read -- so the words a company is
//   given and the pictures beside them cannot name different rooms. A plumber
//   asked to price plumbing gets the toilet, not eleven rooms with the toilet
//   somewhere in them.
//
//   AND THE PHOTO ROUTE IS NARROWED THE SAME WAY, which is the assertion that
//   discriminates: the work-order route checks `isFlagged`, and a copy of that
//   check here would serve the painter's wall to the plumber while every other
//   assertion in this file passed.
//
//   KEYED BY THE INVITE. An invite that is not this company's, one that was
//   withdrawn, and an id that is not a row all answer the SAME 404 -- a
//   different reply would say which invite ids are real.
//
//   DRAFTS DECIDE NOTHING AND APPEAR NOWHERE. A sentence a model wrote and
//   nobody kept is the team's working note.
//
//   AND NO SUMMARY. It is written from every flagged room, so carrying it here
//   would put back in one paragraph exactly what narrowing takes out.
//
// The second half of the same change is in `scopeFrom`: every room line now
// carries what was written about its photographs, which is pinned at the
// bottom of this file because the composer is shared with the job's own scope.
//
//   node --no-warnings scripts/quote-inspection-test.mjs

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { quoteInspectionShape, contractorInspectionShape, inspectionTradeScopes,
  inspectionJobScope } from "../shared/inspection.js";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(join(app, "worker", "schema.sql"), "utf8");

// THE FIXTURE IS THE TEST. Four rooms, and each exists to tell one rule from
// another:
//
//   `r_bath`  plumbing by its ROOM NAME, with a captioned photograph.
//   `r_wall`  painting by its NOTE and nothing else, with a captioned
//             photograph. This is the row that discriminates the photo route:
//             it is FLAGGED, so a check copied from the work-order route would
//             serve its picture to the plumber.
//   `r_store` flagged, naming no trade in either field, with a photograph
//             whose only words are an unkept DRAFT saying "dripping tap". It
//             is the one room that tells drafts-in from drafts-out.
//   `r_hall`  fine, with a photograph. In nobody's shape, ever.
//
// A fixture where every flagged room matched every trade would pass whichever
// narrowing was in force, which is the shape this project keeps recording.
const KEYS = {
  "acc_pm/inspection-photo/bath.jpg": "JPEG-BATH",
  "acc_pm/inspection-photo/wall.jpg": "JPEG-WALL",
  "acc_pm/inspection-photo/store.jpg": "JPEG-STORE",
  "acc_pm/inspection-photo/hall.jpg": "JPEG-HALL",
  "acc_pm/inspection-photo/other.jpg": "JPEG-OTHER",
};
const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,kind,subdomain,plan) VALUES
      ('acc_pm','Sound Property Management','property_manager','soundpm','scale');
    INSERT INTO users(id,name,email) VALUES
      ('u_mgr','Chris Lane','chris@soundpm.test'),
      ('u_pac','Juan Soto','juan@pacific.test'),
      ('u_oth','Dee Brush','dee@brush.test');
    INSERT INTO companies(id,company,contact,email,state) VALUES
      ('cmp_pac','Pacific apartment maintenance','Juan Soto','juan@pacific.test','WA'),
      ('cmp_oth','Brush and Roller','Dee Brush','dee@brush.test','WA');
    INSERT INTO engagements(id,account_id,company_id,status,categories) VALUES
      ('en_pac','acc_pm','cmp_pac','active','["plumbing"]'),
      ('en_oth','acc_pm','cmp_oth','active','["painting"]');
    INSERT INTO properties(id,account_id,name,address,city,state,zip) VALUES
      ('prop_1','acc_pm','Press Apartments','1620 Belmont','Seattle','WA','98122');
    INSERT INTO memberships(id,user_id,account_id,role,company_id,unit) VALUES
      ('m_mgr','u_mgr','acc_pm','admin',NULL,NULL),
      ('m_pac','u_pac','acc_pm','contractor','cmp_pac',NULL),
      ('m_oth','u_oth','acc_pm','contractor','cmp_oth',NULL);

    INSERT INTO jobs(id,account_id,property_id,title,trades,status,created_at)
      VALUES ('job_out','acc_pm','prop_1','Move-out work — unit 3B','["plumbing","painting"]','active','2026-10-01');
    -- A job nobody walked, which is the ordinary case: its invite must answer
    -- the same 404 as an invite that is not theirs.
    INSERT INTO jobs(id,account_id,property_id,title,trades,status,created_at)
      VALUES ('job_plain','acc_pm','prop_1','Repaint hallway','["painting"]','active','2026-10-01');

    INSERT INTO inspections(id,account_id,property_id,unit,kind,inspected_on,status,finished_at,job_id,tenant_name)
      VALUES ('ins_out','acc_pm','prop_1','3B','move_out','2026-10-01','finished','2026-10-01 12:00:00','job_out','Ada Three');
    INSERT INTO inspection_rooms(id,inspection_id,name,status,note,position) VALUES
      ('r_bath','ins_out','Shower and bath','fail','Cracked basin',0),
      ('r_wall','ins_out','Walls and floors','follow_up','Scuff to the wall left of the door',1),
      ('r_store','ins_out','Store room','fail','Will not shut properly',2),
      ('r_hall','ins_out','Hall','ok','Nothing to report',3);
    INSERT INTO inspection_photos(id,room_id,file_key,name,content_type) VALUES
      ('ph_bath','r_bath','acc_pm/inspection-photo/bath.jpg','bath.jpg','image/jpeg'),
      ('ph_wall','r_wall','acc_pm/inspection-photo/wall.jpg','wall.jpg','image/jpeg'),
      ('ph_store','r_store','acc_pm/inspection-photo/store.jpg','store.jpg','image/jpeg'),
      ('ph_hall','r_hall','acc_pm/inspection-photo/hall.jpg','hall.jpg','image/jpeg');
    INSERT INTO inspection_photo_notes(photo_id,caption,drafted_at) VALUES
      ('ph_bath','Hairline crack right of the tap','2026-10-01T10:00:00.000Z'),
      ('ph_wall','Scuff about a foot across','2026-10-01T10:00:00.000Z');
    -- A DRAFT AND NO CAPTION. With drafts read, this room is plumbing and its
    -- picture reaches the plumber; with them out, it names no trade at all.
    INSERT INTO inspection_photo_notes(photo_id,caption,draft,drafted_at) VALUES
      ('ph_store',NULL,'A dripping tap in the corner','2026-10-01T10:00:00.000Z');

    -- Another account's inspection, to pin that a photo id from somewhere else
    -- is refused even when the invite is real.
    INSERT INTO inspections(id,account_id,property_id,unit,kind,inspected_on,status,job_id)
      VALUES ('ins_two','acc_pm','prop_1','9C','move_in','2026-09-01','finished',NULL);
    INSERT INTO inspection_rooms(id,inspection_id,name,status,note,position) VALUES
      ('r_two','ins_two','Shower and bath','fail','Tap dripping',0);
    INSERT INTO inspection_photos(id,room_id,file_key,name,content_type) VALUES
      ('ph_other','r_two','acc_pm/inspection-photo/other.jpg','other.jpg','image/jpeg');

    INSERT INTO quote_requests(id,account_id,job_id,trade,scope,status,created_by) VALUES
      ('qr_plumb','acc_pm','job_out','plumbing',NULL,'open','u_mgr'),
      ('qr_paint','acc_pm','job_out','painting',NULL,'open','u_mgr'),
      ('qr_plain','acc_pm','job_plain','painting',NULL,'open','u_mgr');
    INSERT INTO quote_invites(id,request_id,company_id,status) VALUES
      ('qi_plumb','qr_plumb','cmp_pac','invited'),
      ('qi_paint','qr_paint','cmp_oth','invited'),
      ('qi_gone','qr_plain','cmp_pac','withdrawn'),
      ('qi_plain','qr_plain','cmp_oth','invited');
  `);
  return { db, env: { DB: makeD1(db),
    FILES: { put: async () => {},
      get: async (k) => (KEYS[k] ? { body: KEYS[k] } : null) } } };
};

const WHO = { u_pac: "acc_pm", u_oth: "acc_pm", u_mgr: "acc_pm" };
const get = (env, path, who = "u_pac") => worker.fetch(
  new Request(`https://api.subsub.work${path}`, {
    method: "GET",
    headers: { "Content-Type": "application/json", "X-User-Id": who, "X-Account-Id": WHO[who] },
  }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];

const INSP = { kind: "move_out", unit: "3B", inspectedOn: "2026-10-01", tenantName: "Ada Three" };
const ROOMS = [
  { id: "r_bath", name: "Shower and bath", status: "fail", note: "Cracked basin",
    photos: [{ id: "ph_bath", name: "bath.jpg", caption: "Hairline crack right of the tap" }] },
  { id: "r_wall", name: "Walls and floors", status: "follow_up", note: "Scuff to the wall left of the door",
    photos: [{ id: "ph_wall", name: "wall.jpg", caption: "Scuff about a foot across" }] },
  { id: "r_hall", name: "Hall", status: "ok", note: "Nothing to report",
    photos: [{ id: "ph_hall", name: "hall.jpg", caption: "Clean" }] },
];
const names = (sh) => (sh.rooms || []).map((r) => r.name).sort();

try {
  console.log("\n-- the shape itself --");
  {
    const plumb = quoteInspectionShape(INSP, ROOMS, "plumbing");
    const paint = quoteInspectionShape(INSP, ROOMS, "painting");

    ck("plumbing is shown the bathroom",
      names(plumb).includes("Shower and bath"), JSON.stringify(names(plumb)));
    // THE HALF THAT MATTERS: not that its own room is there, but that the
    // other trade's room is NOT. A shape returning the whole walk to everybody
    // passes the assertion above and fails this one.
    ck("and NOT the walls, which are somebody else's to price",
      !names(plumb).includes("Walls and floors"), JSON.stringify(names(plumb)));
    ck("painting is shown the walls",
      names(paint).includes("Walls and floors"), JSON.stringify(names(paint)));
    ck("and NOT the bathroom",
      !names(paint).includes("Shower and bath"), JSON.stringify(names(paint)));

    // THE PROPERTY, asserted against the per-trade SCOPE rather than against a
    // literal: a shape with its own matching could be internally consistent
    // and still show rooms the text never mentioned. The contractor reads
    // both, side by side.
    const sc = inspectionTradeScopes(INSP, ROOMS);
    for (const trade of ["plumbing", "painting"]) {
      const shown = names(quoteInspectionShape(INSP, ROOMS, trade));
      ck(`the pictures and the ${trade} scope name the same rooms`,
        shown.every((n) => (sc[trade] || "").includes(n))
          && shown.length === (sc[trade] || "").split("\n").filter((l) => l.startsWith("•")).length,
        `${JSON.stringify(shown)} vs ${JSON.stringify(sc[trade])}`);
    }

    ck("a room that was fine is in nobody's shape",
      !names(plumb).includes("Hall") && !names(paint).includes("Hall"));
    // A TRADE NOTHING MATCHED GETS NOTHING, never the whole walk as a
    // fallback: the manager typed that scope by hand, so which rooms it was
    // about is not something this can know.
    ck("a trade nothing matched is shown no rooms at all",
      (quoteInspectionShape(INSP, ROOMS, "concrete").rooms || []).length === 0,
      JSON.stringify(names(quoteInspectionShape(INSP, ROOMS, "concrete"))));
    ck("and so is no trade at all",
      (quoteInspectionShape(INSP, ROOMS, null).rooms || []).length === 0);

    ck("the caption comes with the picture",
      plumb.rooms[0]?.photos?.[0]?.caption === "Hairline crack right of the tap",
      JSON.stringify(plumb.rooms[0]?.photos));
    // Who was moving out is not a contractor's business, and the file key is
    // an R2 path -- the same two the work-order shape withholds.
    const flat = JSON.stringify(plumb);
    ck("the tenant is not named", !/Ada Three/.test(flat) && !("tenantName" in plumb));
    ck("and no file key travels", !/inspection-photo/.test(flat));
    // The summary is written from EVERY flagged room, so carrying it would put
    // back in one paragraph what the narrowing takes out.
    ck("there is no summary on it", !("summary" in plumb));

    // The work-order shape is UNCHANGED by any of this: a holder of a work
    // order has the job, and the whole walk is context for work they are
    // committed to. The two are deliberately not harmonised.
    const whole = contractorInspectionShape(INSP, ROOMS);
    ck("the work-order shape still carries every flagged room",
      names(whole).join("|") === "Shower and bath|Walls and floors",
      JSON.stringify(names(whole)));
  }

  console.log("\n-- the route --");
  {
    const { env } = seed();
    const [st, body] = await json(await get(env, "/api/quotes/qi_plumb/inspection"));
    ck("the invited company gets the panel", st === 200 && !!body.rooms, `${st} ${JSON.stringify(body).slice(0, 140)}`);
    ck("it says which trade it was narrowed for", body.trade === "plumbing", String(body.trade));
    ck("the bathroom is in it", names(body).includes("Shower and bath"), JSON.stringify(names(body)));
    ck("the painter's wall is not", !names(body).includes("Walls and floors"), JSON.stringify(names(body)));
    ck("nor the room that was fine", !names(body).includes("Hall"));
    // DRAFTS DECIDE NOTHING. `r_store`'s only trade signal is an unkept draft
    // saying "dripping tap", so with drafts read it would join the plumbing
    // shape. Mutating the route to `drafts: true` is what this catches.
    ck("a room whose only signal is an unkept draft is left out",
      !names(body).includes("Store room"), JSON.stringify(names(body)));
    ck("and no draft text travels", !/dripping tap/i.test(JSON.stringify(body)));

    const [st2, body2] = await json(await get(env, "/api/quotes/qi_paint/inspection", "u_oth"));
    ck("the painter gets their own rooms and not the plumber's",
      st2 === 200 && names(body2).join("|") === "Walls and floors",
      `${st2} ${JSON.stringify(names(body2))}`);
  }

  console.log("\n-- an invite that is not theirs, and one that is not a row --");
  {
    const { env } = seed();
    // KEYED BY THE INVITE. These three must answer the same, or the reply says
    // which invite ids are real.
    const [mine] = await json(await get(env, "/api/quotes/qi_paint/inspection", "u_pac"));
    const [nope] = await json(await get(env, "/api/quotes/qi_nothing/inspection", "u_pac"));
    const [gone] = await json(await get(env, "/api/quotes/qi_gone/inspection", "u_pac"));
    ck("somebody else's invite answers 404", mine === 404, String(mine));
    ck("an id that is not a row answers the same", nope === mine, `${nope} vs ${mine}`);
    ck("and a withdrawn invite of their own answers the same",
      gone === mine, `${gone} vs ${mine}`);
    // A job nobody walked is the ORDINARY case -- most were typed or arrived
    // from a CRM -- and it answers the same nothing rather than a third code.
    const [plain] = await json(await get(env, "/api/quotes/qi_plain/inspection", "u_oth"));
    ck("a job with no inspection behind it answers the same nothing",
      plain === mine, `${plain} vs ${mine}`);
    // The hiring side reads the walk through its own Inspections tab, which
    // applies its property scope. It holds no invite, so this door gives it
    // nothing -- the same 404 again.
    const [mgr] = await json(await get(env, "/api/quotes/qi_plumb/inspection", "u_mgr"));
    ck("and an admin of the hiring account holds no invite, so nor do they",
      mgr === mine, `${mgr} vs ${mine}`);
  }

  console.log("\n-- the bytes --");
  {
    const { env } = seed();
    const ok = await get(env, "/api/quotes/qi_plumb/inspection/photo/ph_bath");
    ck("their own trade's photograph is served",
      ok.status === 200 && (await ok.text()) === "JPEG-BATH", String(ok.status));
    ck("with the stored content type",
      ok.headers.get("Content-Type") === "image/jpeg", ok.headers.get("Content-Type"));

    // THE ASSERTION THAT DISCRIMINATES. `ph_wall` is a photograph of a FLAGGED
    // room on the same inspection, so a check copied from the work-order route
    // -- which asks only `isFlagged` -- serves it, and every other assertion in
    // this file still passes.
    const other = await get(env, "/api/quotes/qi_plumb/inspection/photo/ph_wall");
    ck("another trade's flagged room is refused", other.status === 404, String(other.status));
    const fine = await get(env, "/api/quotes/qi_plumb/inspection/photo/ph_hall");
    ck("a room that was fine is refused", fine.status === 404, String(fine.status));
    const draft = await get(env, "/api/quotes/qi_plumb/inspection/photo/ph_store");
    ck("and a room only an unkept draft put in play is refused",
      draft.status === 404, String(draft.status));
    const away = await get(env, "/api/quotes/qi_plumb/inspection/photo/ph_other");
    ck("a photograph from another inspection is refused", away.status === 404, String(away.status));
    const theirs = await get(env, "/api/quotes/qi_paint/inspection/photo/ph_bath", "u_oth");
    ck("and the painter cannot read the plumber's", theirs.status === 404, String(theirs.status));
    const notmine = await get(env, "/api/quotes/qi_paint/inspection/photo/ph_wall", "u_pac");
    ck("nor can anybody read bytes through an invite that is not theirs",
      notmine.status === 404, String(notmine.status));
  }

  // -----------------------------------------------------------------------
  console.log("\n-- and every room line carries what was written about its photographs --");
  {
    // Asked for in the same breath: *"describe it by room, give the issue,
    // image, and summary or what the issue is"*. The note is very often the
    // shorter half -- "Scuffing" in the room box, a sentence per mark on the
    // pictures -- and the captions were in the record and not on the document
    // the price is given off.
    const sc = inspectionJobScope(INSP, ROOMS);
    ck("a caption reaches the job's own scope",
      /Hairline crack right of the tap/.test(sc), JSON.stringify(sc));
    ck("named as a photograph rather than run in with the note",
      /- photo: Hairline crack/.test(sc), JSON.stringify(sc));
    ck("and it sits under its own room",
      sc.indexOf("Hairline crack") > sc.indexOf("Cracked basin")
        && sc.indexOf("Hairline crack") < sc.indexOf("Walls and floors"),
      JSON.stringify(sc));
    // A room that was fine is still in nobody's scope, captions or not.
    ck("a room that was fine brings no caption with it", !/Clean/.test(sc));
    // The per-trade scope renders through the same composer, so the captions
    // are on the text each company actually receives.
    ck("and the trade's own scope carries it too",
      /Hairline crack/.test(inspectionTradeScopes(INSP, ROOMS).plumbing || ""),
      JSON.stringify(inspectionTradeScopes(INSP, ROOMS).plumbing));

    // THE DEDUPE. The commonest caption on a one-photograph room is the note
    // again, and a document that says it twice reads as two faults.
    const twice = [{ id: "a", name: "Bedroom 1", status: "fail", note: "Scuffing",
      photos: [{ id: "p", caption: "Scuffing" }, { id: "q", caption: " scuffing " }] }];
    const dd = inspectionJobScope(INSP, twice);
    ck("a caption that repeats the note is not printed again",
      (dd.match(/Scuffing/gi) || []).length === 1, JSON.stringify(dd));

    // THE KEPT CAPTION AND NEVER THE DRAFT, and this is read off the FIELD
    // rather than from which rooms were passed in: `inspectionJobScope` is
    // called at raise time with the WRITABLE shape, drafts included, so a
    // composer reading `draft` would stamp a model's unkept sentence into
    // `jobs.scope` where it reads as a finding somebody made.
    const drafted = [{ id: "a", name: "Shower and bath", status: "fail", note: "Basin",
      photos: [{ id: "p", caption: "", draft: "MODEL SENTENCE", draftUnclear: false },
               { id: "q", caption: "Chip to the rim", draft: "ANOTHER ONE" }] }];
    const dr = inspectionJobScope(INSP, drafted);
    ck("an unkept draft never reaches the scope, even with drafts in the rooms",
      !/MODEL SENTENCE/.test(dr) && !/ANOTHER ONE/.test(dr), JSON.stringify(dr));
    ck("while the kept caption beside it does",
      /- photo: Chip to the rim/.test(dr), JSON.stringify(dr));
    // A blank caption is not a blank line on the document.
    ck("and a photograph nobody wrote about adds nothing",
      dr.split("\n").filter((l) => /- photo:/.test(l)).length === 1, JSON.stringify(dr));
  }
} catch (err) {
  fail++;
  console.log("FAIL  threw: " + (err?.stack || err));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
