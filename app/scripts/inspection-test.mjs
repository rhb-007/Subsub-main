// Move-in and move-out unit inspections, through the real Worker.
//
// A managing agent walks a unit when somebody moves in and again when they
// move out, room by room, with photographs — and then raises the work from
// what they found. "The carpet was like that when I moved in" is the
// commonest dispute in the business and two dated records are the only answer
// to it.
//
// What is pinned here is the handful of decisions a later pass would
// otherwise undo:
//
//   FOUR STATUSES, NOT THREE. A room nobody has walked and a room walked and
//   found fine must not look the same, which is the ambiguity `doccheck.js`
//   was written to remove one feature along. So `unchecked` is a real answer
//   and it is what stops an inspection being finished.
//
//   FINISHED IS A ONE-WAY DOOR. An inspection is evidence months later, and a
//   record that can be edited afterwards is one the other side can say was
//   edited afterwards.
//
//   RAISING THE WORK CREATES A JOB AND STOPS. Issuing a work order is a price
//   and a date committed to a company; this product's own rule is that the
//   side paying cannot commit the side doing the work without them answering.
//
//   node --no-warnings scripts/inspection-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { inspectionTally, whyNotFinish, inspectionJobScope, flaggedRooms,
  ROOM_STATUSES, STANDARD_ROOMS, INSPECTION_READ_ROLES,
  mayWriteInspection, suggestTrades, TRADE_HINTS, ROOM_TRADES,
  inspectionStep } from "../shared/inspection.js";
import { TRADES } from "../shared/trades.js";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");

console.log("\n-- the rules, before anything is driven --");
{
  // THE FOURTH STATE IS THE POINT. Without it an inspection half walked and
  // an inspection walked and found perfect are the same document.
  ck("not checked is a status of its own",
    !!ROOM_STATUSES.unchecked && ROOM_STATUSES.unchecked.done === false);
  ck("and it is not flagged either — it is a to-do, not a problem",
    ROOM_STATUSES.unchecked.flagged === false);
  ck("both fail and follow-up are flagged, because the same thing happens next",
    ROOM_STATUSES.fail.flagged && ROOM_STATUSES.follow_up.flagged);
  ck("and OK is not", ROOM_STATUSES.ok.flagged === false);

  const rooms = [{ status: "ok" }, { status: "follow_up" }, { status: "unchecked" }];
  ck("the tally counts all three separately",
    JSON.stringify(inspectionTally(rooms)) ===
      JSON.stringify({ rooms: 3, checked: 2, unchecked: 1, flagged: 1, ok: 1, photos: 0 }),
    JSON.stringify(inspectionTally(rooms)));
  ck("an unwalked room stops it being finished", whyNotFinish(rooms) === "rooms_unchecked");
  ck("so does having no rooms at all", whyNotFinish([]) === "no_rooms");
  ck("and a fully marked one may finish",
    whyNotFinish([{ status: "ok" }, { status: "fail" }]) === null);
  // PHOTOS ARE NUDGED AND NEVER DEMANDED: a room with nothing wrong needs no
  // picture, and a gate that insists is answered with a photo of the floor.
  ck("photos are not required to finish",
    whyNotFinish([{ status: "ok", photos: [] }]) === null);

  // The scope carries the flagged rooms and nothing else: an inspection is a
  // record of the whole unit, a job is a list of things to do.
  const scope = inspectionJobScope({ kind: "move_out", unit: "3B" },
    [{ name: "Kitchen", status: "ok" }, { name: "Bath", status: "fail", note: "Cracked basin" }]);
  ck("the job scope names what was flagged", /Bath/.test(scope) && /Cracked basin/.test(scope), scope);
  ck("and leaves out what was fine", !/Kitchen/.test(scope), scope);

  ck("the standard room list is a list and not a constraint",
    STANDARD_ROOMS.length > 10 && STANDARD_ROOMS.includes("Walls and floors"));
}

const BASE = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");

const seed = () => {
  const db = freshDb({ base: BASE, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,kind,subdomain) VALUES
      ('acc1','Sound Property Management','property_manager','soundpm'),
      ('acc2','Other Agent','property_manager','other');
    INSERT INTO users(id,name,email) VALUES
      ('u_admin','Christopher Lane','chris@soundpm.test'),
      ('u_pm','Dana Pine','dana@soundpm.test'),
      ('u_them','Someone Else','x@other.test'),
      -- Two owners, one per building. The ONLY fixture either direction of
      -- "who may be sent this" can be checked against: an owner of the other
      -- building passes every check except the one that matters.
      ('u_own','Marion Oakes','marion@oakes.test'),
      ('u_own2','Rhys Vance','rhys@vance.test'),
      -- And one with no address at all, which is what a seat added from the
      -- console without an email looks like. The send has to record that the
      -- mail did not go rather than that the button was pressed.
      ('u_own3','Pat Reyes','u_own3@no-email.invalid');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES
      ('m_admin','u_admin','acc1','admin'),
      ('m_pm','u_pm','acc1','pm'),
      ('m_them','u_them','acc2','admin'),
      ('m_own','u_own','acc1','owner'),
      ('m_own2','u_own2','acc1','owner'),
      ('m_own3','u_own3','acc1','owner');
    INSERT INTO properties(id,account_id,name,address,city,zip,owner_account_id) VALUES
      ('p_press','acc1','Press Apartments','1620 Belmont Ave','Seattle','98122','acc1'),
      ('p_ballard','acc1','Ballard Apts','2028 NW 59th','Seattle','98107','acc1'),
      ('p_theirs','acc2','Not Ours','1 Elsewhere','Tacoma','98407','acc2');
    -- A project manager narrowed to ONE of the two buildings: the only
    -- fixture either direction of the scope can be checked against.
    INSERT INTO membership_properties(membership_id,property_id) VALUES
      ('m_pm','p_ballard'),
      ('m_own','p_press'), ('m_own3','p_press'),
      ('m_own2','p_ballard');
  `);
  return { db, env: { DB: makeD1(db), FILES: fakeR2() } };
};

// Enough R2 that a photo can be put and got back.
function fakeR2() {
  const store = new Map();
  return {
    put: async (k, body) => { store.set(k, body); },
    get: async (k) => (store.has(k) ? { body: store.get(k) } : null),
  };
}

const call = (env, path, { method = "GET", body, who = "u_admin", acct = "acc1", type } = {}) =>
  worker.fetch(new Request(`https://api.subsub.work${path}`, {
    method,
    body: body === undefined ? undefined : (typeof body === "string" ? body : JSON.stringify(body)),
    headers: { "Content-Type": type || "application/json", "X-User-Id": who, "X-Account-Id": acct },
  }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];

try {
  console.log("\n-- walking a unit --");
  {
    const { db, env } = seed();
    let [s, insp] = await json(await call(env, "/api/inspections", { method: "POST",
      body: { kind: "move_out", propertyId: "p_press", unit: "3B",
        tenantName: "Tess Nguyen", inspectedOn: "2026-10-02" } }));
    ck("it starts", s === 201 && !!insp.id, `${s} ${JSON.stringify(insp)}`);
    ck("as a draft", insp.status === "draft", insp.status);
    ck("with no rooms yet", (insp.rooms || []).length === 0);
    const id = insp.id;

    [s] = await json(await call(env, `/api/inspections/${id}/rooms`, { method: "POST", body: { name: "Kitchen" } }));
    ck("a room can be added", s === 201, String(s));
    let [, after] = await json(await call(env, `/api/inspections/${id}/rooms`, { method: "POST", body: { name: "Walls and floors" } }));
    ck("and another", after.rooms.length === 2, JSON.stringify(after.rooms.map((r) => r.name)));
    // THE NAME IS FREE TEXT. The standard list is a suggestion on the screen,
    // not a constraint here -- every building has a room it has not heard of.
    [, after] = await json(await call(env, `/api/inspections/${id}/rooms`, { method: "POST", body: { name: "Boat shed" } }));
    ck("including one the standard list has never heard of",
      after.rooms.some((r) => r.name === "Boat shed"), JSON.stringify(after.rooms.map((r) => r.name)));
    ck("and every one starts unchecked rather than OK",
      after.rooms.every((r) => r.status === "unchecked"), JSON.stringify(after.rooms.map((r) => r.status)));
    ck("in the order they were added",
      after.rooms.map((r) => r.name).join("|") === "Kitchen|Walls and floors|Boat shed",
      JSON.stringify(after.rooms.map((r) => r.name)));

    const kitchen = after.rooms[0].id, walls = after.rooms[1].id, shed = after.rooms[2].id;
    [s, after] = await json(await call(env, `/api/inspections/${id}/rooms/${kitchen}`,
      { method: "PATCH", body: { status: "ok" } }));
    ck("a room can be marked", s === 200 && after.rooms[0].status === "ok", `${s} ${after.rooms?.[0]?.status}`);
    [, after] = await json(await call(env, `/api/inspections/${id}/rooms/${walls}`,
      { method: "PATCH", body: { status: "follow_up", note: "Nail hole repair and paint" } }));
    ck("with a note", after.rooms[1].note === "Nail hole repair and paint", after.rooms[1].note);
    // ONLY WHAT WAS SENT: a patch that knows about status must not blank the
    // note beside it -- the shape that deleted a W-9 through SubForm.
    [, after] = await json(await call(env, `/api/inspections/${id}/rooms/${walls}`,
      { method: "PATCH", body: { status: "fail" } }));
    ck("and changing the verdict does not blank the note",
      after.rooms[1].note === "Nail hole repair and paint" && after.rooms[1].status === "fail",
      JSON.stringify(after.rooms[1]));

    [s, after] = await json(await call(env, `/api/inspections/${id}`, { method: "PATCH", body: { finish: true } }));
    ck("it will not finish with a room unwalked",
      s === 409 && after.error === "rooms_unchecked", `${s} ${after.error}`);
    ck("and says how many", after.unchecked === 1, String(after.unchecked));

    await call(env, `/api/inspections/${id}/rooms/${shed}`, { method: "PATCH", body: { status: "ok" } });
    [s, after] = await json(await call(env, `/api/inspections/${id}`, { method: "PATCH", body: { finish: true } }));
    ck("once every room is marked it finishes", s === 200 && after.status === "finished",
      `${s} ${after.status}`);

    // ONE-WAY. This is the half that makes it worth anything in an argument.
    [s, after] = await json(await call(env, `/api/inspections/${id}/rooms/${kitchen}`,
      { method: "PATCH", body: { status: "fail" } }));
    ck("and then nothing on it can be changed", s === 409 && after.error === "already_finished",
      `${s} ${after.error}`);
    [s, after] = await json(await call(env, `/api/inspections/${id}/rooms`,
      { method: "POST", body: { name: "Afterthought" } }));
    ck("no room can be added to it", s === 409, `${s} ${after.error}`);
    [s, after] = await json(await call(env, `/api/inspections/${id}`, { method: "DELETE" }));
    ck("and it cannot be deleted", s === 409 && after.error === "already_finished", `${s} ${after.error}`);
    ck("but it is still readable",
      (await json(await call(env, `/api/inspections/${id}`)))[1].rooms.length === 3);
  }

  console.log("\n-- photographs --");
  {
    const { env } = seed();
    const [, insp] = await json(await call(env, "/api/inspections", { method: "POST",
      body: { kind: "move_in", propertyId: "p_press", unit: "1A" } }));
    const [, withRoom] = await json(await call(env, `/api/inspections/${insp.id}/rooms`,
      { method: "POST", body: { name: "Bathroom 1" } }));
    const roomId = withRoom.rooms[0].id;

    // Through the same checked upload kind a tenant's report photo uses --
    // one set of type and size limits, not two.
    const up = await json(await call(env, "/api/uploads/report-photo/sink.png",
      { method: "PUT", body: "not-really-a-png", type: "image/png" }));
    ck("the upload is accepted", up[0] === 200 && !!up[1].key, JSON.stringify(up));

    let [s, after] = await json(await call(env, `/api/inspections/${insp.id}/rooms/${roomId}/photos`,
      { method: "POST", body: { photos: [{ key: up[1].key, name: "sink.png", type: "image/png" }] } }));
    ck("and attaches to the room", s === 200 && after.rooms[0].photos.length === 1,
      `${s} ${JSON.stringify(after.rooms?.[0]?.photos)}`);
    // Ids and names only: the key is an R2 path and handing it to the browser
    // invites somebody to ask for a different one.
    ck("the key never reaches the browser",
      !JSON.stringify(after.rooms[0].photos).includes("report-photo"),
      JSON.stringify(after.rooms[0].photos));

    const photoId = after.rooms[0].photos[0].id;
    const got = await call(env, `/api/inspections/${insp.id}/photos/${photoId}`);
    ck("and the bytes come back", got.status === 200, String(got.status));
    ck("as the type they went up as", got.headers.get("Content-Type") === "image/png",
      String(got.headers.get("Content-Type")));

    // A KEY FROM THE BODY IS A CLAIM. Without this check, a key under another
    // account's prefix would be attached and then served back by the route
    // above.
    [s, after] = await json(await call(env, `/api/inspections/${insp.id}/rooms/${roomId}/photos`,
      { method: "POST", body: { photos: [{ key: "acc2/report-photo/stolen.png" }] } }));
    ck("a key from another account's space is refused",
      s === 400 && after.error === "nothing_to_add", `${s} ${after.error}`);
    [s] = await json(await call(env, `/api/inspections/${insp.id}/rooms/${roomId}/photos`,
      { method: "POST", body: { photos: [{ key: "acc1/report-photo/../../etc" }] } }));
    ck("and so is one that tries to climb out", s === 400, String(s));

    [s, after] = await json(await call(env, `/api/inspections/${insp.id}/rooms/${roomId}/photos/${photoId}`,
      { method: "DELETE" }));
    ck("a photo can be taken off", s === 200 && after.rooms[0].photos.length === 0, String(s));
    ck("and the object stays in R2, because it is still evidence",
      (await call(env, `/api/inspections/${insp.id}/photos/${photoId}`)).status === 404);
  }

  console.log("\n-- whose inspection it is --");
  {
    const { env } = seed();
    const [, mine] = await json(await call(env, "/api/inspections", { method: "POST",
      body: { kind: "move_out", propertyId: "p_press", unit: "3B" } }));

    // Another account cannot read it, and gets the same answer an id that
    // does not exist gets -- so this cannot be walked to find real ids.
    const [s1, b1] = await json(await call(env, `/api/inspections/${mine.id}`,
      { who: "u_them", acct: "acc2" }));
    const [s2, b2] = await json(await call(env, "/api/inspections/does-not-exist",
      { who: "u_them", acct: "acc2" }));
    ck("another account is refused", s1 === 404 && b1.error === "not_found", `${s1} ${b1.error}`);
    ck("identically to an id that does not exist",
      JSON.stringify([s1, b1]) === JSON.stringify([s2, b2]));

    // A building on another account cannot be inspected by naming it.
    const [s3, b3] = await json(await call(env, "/api/inspections", { method: "POST",
      body: { kind: "move_out", propertyId: "p_theirs" } }));
    ck("and a building that is not this account's is not inspectable",
      s3 === 404 && b3.error === "property_not_found", `${s3} ${b3.error}`);
    const [s4, b4] = await json(await call(env, "/api/inspections", { method: "POST",
      body: { kind: "haunting", propertyId: "p_press" } }));
    ck("an invented kind is refused", s4 === 400 && b4.error === "bad_kind", `${s4} ${b4.error}`);
  }

  console.log("\n-- and a project manager sees the buildings they were given --");
  {
    // THE SCOPE IS IN THE SQL, not after it: a list filtered in the browser is
    // a list the API sent. Both directions, against a fixture where the two
    // disagree.
    const { env } = seed();
    await call(env, "/api/inspections", { method: "POST", body: { kind: "move_out", propertyId: "p_press" } });
    await call(env, "/api/inspections", { method: "POST", body: { kind: "move_in", propertyId: "p_ballard" } });
    const [, all] = await json(await call(env, "/api/inspections"));
    ck("an unnarrowed admin sees both", all.length === 2, String(all.length));
    const [, theirs] = await json(await call(env, "/api/inspections", { who: "u_pm" }));
    ck("a narrowed manager sees only their building", theirs.length === 1, JSON.stringify(theirs.map((i) => i.propertyId)));
    ck("and it is the right one", theirs[0]?.propertyId === "p_ballard", String(theirs[0]?.propertyId));
    // And cannot reach the other one by naming it.
    const press = all.find((i) => i.propertyId === "p_press");
    const [s] = await json(await call(env, `/api/inspections/${press.id}`, { who: "u_pm" }));
    ck("nor open it by id", s === 404, String(s));
    // But may start one at the building they DO have, or the scope would be a
    // read-only seat on a job that is theirs to do.
    const [s2] = await json(await call(env, "/api/inspections", { who: "u_pm", method: "POST",
      body: { kind: "move_in", propertyId: "p_ballard", unit: "2" } }));
    ck("and may start one of their own", s2 === 201, String(s2));
  }

  console.log("\n-- raising the work, which is what the walk is for --");
  {
    const { db, env } = seed();
    const [, insp] = await json(await call(env, "/api/inspections", { method: "POST",
      body: { kind: "move_out", propertyId: "p_press", unit: "3B", inspectedOn: "2026-10-02" } }));
    const mk = async (name, status, note) => {
      const [, r] = await json(await call(env, `/api/inspections/${insp.id}/rooms`, { method: "POST", body: { name } }));
      const room = r.rooms[r.rooms.length - 1];
      await call(env, `/api/inspections/${insp.id}/rooms/${room.id}`, { method: "PATCH", body: { status, note } });
      return room.id;
    };
    await mk("Kitchen", "ok");
    await mk("Walls and floors", "follow_up", "Nail hole repair and paint");
    await mk("Bathroom 1", "fail", "Cracked basin");

    let [s, b] = await json(await call(env, `/api/inspections/${insp.id}/job`, { method: "POST", body: {} }));
    ck("it refuses without a trade", s === 400 && b.error === "trades_required", `${s} ${b.error}`);

    [s, b] = await json(await call(env, `/api/inspections/${insp.id}/job`,
      { method: "POST", body: { trades: ["plumbing", "painting"], date: "2026-10-09" } }));
    ck("the job is raised", s === 201 && !!b.jobId, `${s} ${JSON.stringify(b)}`);
    ck("and says how many rooms it is for", b.flagged === 2, String(b.flagged));

    const job = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(b.jobId);
    ck("it lands on this account at the right building",
      job.account_id === "acc1" && job.property_id === "p_press", JSON.stringify({ a: job.account_id, p: job.property_id }));
    ck("carrying the building's address, so nobody retypes it",
      job.address === "1620 Belmont Ave" && job.zip === "98122", job.address);
    // THE SCOPE IS THE FLAGGED ROOMS AND NOTHING ELSE. Carrying the rooms
    // that were fine would hand a contractor a document to read rather than
    // work to price.
    ck("the scope names what was wrong",
      /Walls and floors/.test(job.scope) && /Cracked basin/.test(job.scope), job.scope);
    ck("and leaves out what was fine", !/Kitchen/.test(job.scope), job.scope);
    ck("the title says which walk it came from", /Move-out/.test(job.title) && /3B/.test(job.title), job.title);
    // CREATED AND NOT ASSIGNED. Issuing a work order is a price and a date
    // committed to a company, and the side paying cannot commit the side
    // doing the work -- so the slots are open and Assign is one tap on the
    // job, with every gate it carries.
    ck("it has the trades as open slots", JSON.parse(job.trades).length === 2, job.trades);
    ck("and nobody has been committed to it",
      db.prepare(`SELECT COUNT(*) n FROM work_orders WHERE job_id = ?`).get(b.jobId).n === 0);
    // It is a JOB rather than a request: a manager raising work at their own
    // building is not asking themselves for permission.
    ck("and it is approved, not waiting on somebody", !!job.approved_at && !job.requested_by,
      JSON.stringify({ a: job.approved_at, r: job.requested_by }));

    // ONE JOB PER INSPECTION. A second would be two contractors asked for the
    // same work, found out when both turn up.
    [s, b] = await json(await call(env, `/api/inspections/${insp.id}/job`,
      { method: "POST", body: { trades: ["plumbing"] } }));
    ck("a second cannot be raised", s === 409 && b.error === "already_raised", `${s} ${b.error}`);
    ck("and it names the one that exists", !!b.jobId, String(b.jobId));
    ck("only one job was ever written",
      db.prepare(`SELECT COUNT(*) n FROM jobs WHERE property_id = 'p_press'`).get().n === 1);

    // Nothing flagged means nothing to do, said rather than creating an empty
    // job somebody then has to find and close.
    const [, clean] = await json(await call(env, "/api/inspections", { method: "POST",
      body: { kind: "move_in", propertyId: "p_press" } }));
    const [, cr] = await json(await call(env, `/api/inspections/${clean.id}/rooms`, { method: "POST", body: { name: "Kitchen" } }));
    await call(env, `/api/inspections/${clean.id}/rooms/${cr.rooms[0].id}`, { method: "PATCH", body: { status: "ok" } });
    [s, b] = await json(await call(env, `/api/inspections/${clean.id}/job`,
      { method: "POST", body: { trades: ["plumbing"] } }));
    ck("an all-clear inspection raises nothing", s === 409 && b.error === "nothing_flagged", `${s} ${b.error}`);
  }

  console.log("\n-- who may do any of it --");
  {
    const { env } = seed();
    // A contractor seat and a tenant are not inspectors. Driven rather than
    // asserted off the route's decorator, because the decorator is the thing
    // that could be wrong.
    const db2 = seed();
    db2.db.exec(`INSERT INTO memberships(id,user_id,account_id,role) VALUES ('m_t','u_them','acc1','tenant')`);
    const [s] = await json(await call(db2.env, "/api/inspections", { who: "u_them" }));
    ck("a tenant seat is refused", s === 403, String(s));
    const [s2] = await json(await call(env, "/api/inspections", { who: "nobody", acct: "acc1" }));
    ck("and so is somebody with no seat here", s2 === 403, String(s2));
  }

  console.log("\n-- the trades the notes are asking for --");
{
  const of = (rooms) => suggestTrades(rooms).trades;

  // THE REPORTED NOTE, verbatim. A fixture written to flatter the rule is a
  // test of its own fixture; this is the sentence off the screenshot.
  const real = [{ name: "Dining room", status: "follow_up",
    note: "Messy a lot of people, dirt floors, trim needs to be repaired..." }];
  const got = suggestTrades(real);
  ck("it reads the reported note", got.trades.sort().join(",") === "cleaning,flooring,trim_carpentry",
    JSON.stringify(got.trades));
  // AND IT SAYS WHICH WORD, because a tick nobody can account for is one
  // nobody will trust enough to leave on.
  ck("and names the word each came from",
    got.why.trim_carpentry.includes("trim") && got.why.flooring.includes("floors")
      && got.why.cleaning.includes("dirt"), JSON.stringify(got.why));

  // ONLY WHAT IS FLAGGED. The scope the job carries is the flagged rooms, so
  // a trade suggested off a room that was fine would put somebody on site for
  // work that is not in the job.
  ck("an OK room contributes nothing", of([{ name: "Kitchen", status: "ok", note: "tap drips" }]).length === 0);
  ck("nor does one nobody has walked",
    of([{ name: "Kitchen", status: "unchecked", note: "tap drips" }]).length === 0);
  ck("while the same words flagged do",
    of([{ name: "Kitchen", status: "fail", note: "tap drips" }]).includes("plumbing"));

  // A ROOM THAT NAMES A SYSTEM SAYS WHICH TRADE; A ROOM THAT NAMES A SPACE
  // DOES NOT. Getting this backwards ticks plumbing on every bathroom in the
  // building, whatever is actually wrong in it.
  ck("a space says nothing on its own",
    of([{ name: "Bathroom 1", status: "fail", note: "Mirror cracked" }]).includes("plumbing") === false,
    JSON.stringify(of([{ name: "Bathroom 1", status: "fail", note: "Mirror cracked" }])));
  ck("a system does, whatever is wrong with it",
    of([{ name: "Shower and bath", status: "fail", note: "Mirror cracked" }]).includes("plumbing"));
  ck("and the room list's spaces are deliberately absent",
    !ROOM_TRADES["kitchen"] && !ROOM_TRADES["bathroom 1"] && !ROOM_TRADES["bedroom 1"]
      && !ROOM_TRADES["walls and floors"],
    JSON.stringify(Object.keys(ROOM_TRADES)));

  // WHOLE WORDS, NEVER SUBSTRINGS -- the rule `crmmap.js` records for a
  // different reason, and the same failure: a trade on a job nobody is doing.
  ck("ac inside crack is not air conditioning",
    !of([{ name: "Ceilings", status: "fail", note: "A crack above the window" }]).includes("hvac"),
    JSON.stringify(of([{ name: "Ceilings", status: "fail", note: "A crack above the window" }])));
  ck("pane inside panel is not glazing",
    !of([{ name: "Hallway", status: "fail", note: "The panel is loose" }]).includes("windows_doors"));
  ck("tile inside ventilation is not tiling",
    !of([{ name: "Hallway", status: "fail", note: "ventilation poor" }]).includes("tile_stone"));
  ck("but the word itself matches with punctuation on it",
    of([{ name: "Bedroom 2", status: "fail", note: "Carpet, stained." }]).includes("flooring"));
  ck("and in any case",
    of([{ name: "Bedroom 2", status: "fail", note: "CARPET RUINED" }]).includes("flooring"));

  // NOTHING RECOGNISED SUGGESTS NOTHING. A guess over a sentence this does
  // not understand is worse than an empty grid, because it reads as a
  // reading.
  ck("an unrecognised note suggests nothing",
    of([{ name: "Hallway", status: "fail", note: "needs attention" }]).length === 0);
  ck("and no rooms at all suggests nothing", of([]).length === 0 && of().length === 0);

  // Several rooms fold into one set rather than one list per room.
  const many = of([
    { name: "Bathroom 2", status: "fail", note: "Tap drips" },
    { name: "Living room", status: "follow_up", note: "Scuffed walls" },
    { name: "Bedroom 1", status: "fail", note: "Carpet stained" },
  ]);
  ck("several rooms fold into one set",
    many.includes("plumbing") && many.includes("painting") && many.includes("flooring"),
    JSON.stringify(many));
  ck("with no duplicates", new Set(many).size === many.length, JSON.stringify(many));

  // EVERY HINT NAMES A REAL TRADE. A map keyed on an id that does not exist
  // is a suggestion that silently ticks nothing -- and nothing on the screen
  // would say so, which is the misspelt-capability shape this file records.
  const ids = new Set(TRADES.map((t) => t.id));
  const badHint = Object.keys(TRADE_HINTS).filter((k) => !ids.has(k));
  const badRoom = Object.values(ROOM_TRADES).filter((v) => !ids.has(v));
  ck("every hint names a trade that exists", badHint.length === 0, JSON.stringify(badHint));
  ck("and so does every room mapping", badRoom.length === 0, JSON.stringify(badRoom));

  // IT READS WHAT IS WRITTEN ABOUT A PHOTOGRAPH, NOT THE PHOTOGRAPH.
  //
  // This block used to pin the opposite -- "photographs are not read, and
  // this says so" -- which was the honest limit when the only inputs were
  // the room name and the note. The photo drafts removed it: a caption is a
  // sentence about the picture's condition, written to the row, so the
  // pictures reach this transitively and at no extra cost. The assertion is
  // rewritten rather than deleted, because what survives is the real limit:
  // a photograph nobody has written about still contributes nothing.
  ck("a photograph with nothing written about it contributes nothing",
    of([{ name: "Hallway", status: "fail", note: "",
      photos: [{ id: "p1" }, { id: "p2" }] }]).length === 0);

  // AND THE CAPTION IS READ, which is what "based on the photos" means here.
  const shot = suggestTrades([{ name: "Bathroom 1", status: "fail", note: "",
    photos: [{ id: "p1", caption: "Hairline crack across the basin." }] }]);
  ck("a kept caption names the trade", shot.trades.includes("plumbing"), JSON.stringify(shot.trades));
  // A DRAFT COUNTS TOO, and that is deliberate: it is the commonest state --
  // the model has written it and nobody has pressed Keep yet. Suggesting
  // from it is why the screen says which words came from a photograph.
  const dr = suggestTrades([{ name: "Hall", status: "fail", note: "",
    photos: [{ id: "p1", draft: "Scuff across the plasterboard." }] }]);
  ck("so does an unkept draft", dr.trades.includes("drywall"), JSON.stringify(dr.trades));
  // Every word it read off the picture, not a count of them: that caption
  // names two trades, and asserting "one" was a fact about the fixture.
  ck("and every word it read there is marked as second-hand",
    dr.trades.every((t) => dr.why[t].some((w) => dr.fromPhoto.has(w))),
    `${JSON.stringify(dr.why)} / ${[...dr.fromPhoto].join(",")}`);
  // A word they TYPED is never marked, or the screen would call their own
  // note a photo and they would go looking for a picture that says it.
  const typed = suggestTrades([{ name: "Hall", status: "fail", note: "Scuff across the plasterboard.", photos: [] }]);
  ck("a word they typed is not", typed.fromPhoto.size === 0, [...typed.fromPhoto].join(","));

  // WHAT HAS NOT BEEN READ IS COUNTED, because a screen saying "suggested
  // from your photos" over three unread ones is claiming the pictures were
  // looked at.
  const mixed = suggestTrades([{ name: "Bathroom 1", status: "fail", note: "",
    photos: [{ id: "p1", caption: "Cracked basin." }, { id: "p2" }, { id: "p3" }] }]);
  ck("photographs with no note are counted", mixed.unread === 2, String(mixed.unread));
  ck("and a read one is not", suggestTrades([{ name: "Hall", status: "fail",
    photos: [{ id: "p1", caption: "Cracked basin." }] }]).unread === 0);
  // Only flagged rooms, the same rule the trades follow: an OK room's photos
  // are not work anybody is being sent to do.
  ck("an OK room's unread photos are not counted",
    suggestTrades([{ name: "Hall", status: "ok", photos: [{ id: "p1" }] }]).unread === 0);

  // A NOUN IS NOT A FAULT, AND A PHOTOGRAPH HAS NO STATUS OF ITS OWN.
  //
  // Reported against a move-out with ONE flagged hallway and four pictures.
  // The only fault in the unit was a chipped door panel; the grid came back
  // with seven trades ticked, every extra one earned by a noun inside a
  // sentence saying that thing was FINE.
  //
  // THE FIXTURE IS THE REPORTED CAPTIONS, verbatim, because a tidied-up one
  // proves nothing: the whole difficulty is that three of these are fluent,
  // correct condition statements that happen to contain trade nouns.
  const REAL = { name: "Hallway", status: "follow_up", note: "", photos: [
    { id: "p1", draft: "Polished concrete floor, clean with no visible cracking or staining." },
    { id: "p2", draft: "Timber handrail on a steel bracket, intact and secure. No damage." },
    { id: "p3", draft: "Carpet runner is clean and in good order." },
    { id: "p4", caption: "Wood-grain door panel needs to be repaired - chipped and scratched. "
      + "Black rubber base trim intact with no visible damage or separation from flooring." },
  ] };
  const real2 = suggestTrades([REAL]);
  // The door is the fault, so the door earns its trade.
  ck("the one thing that needs fixing still earns its trade",
    real2.trades.includes("windows_doors"), JSON.stringify(real2.why));
  // And the five that were earned by things reported as FINE do not. Named
  // one at a time rather than by a count: a count passes if the right number
  // of wrong trades comes back.
  for (const gone of ["electrical", "concrete", "flooring", "final_clean", "finish_carpentry"]) {
    ck(`a thing reported as fine earns nothing: ${gone}`,
      !real2.trades.includes(gone), JSON.stringify(real2.trades));
  }
  // CLAUSE BY CLAUSE, NEVER CAPTION BY CAPTION. That last caption is two
  // clauses -- a chipped door and an intact trim -- so dropping the whole
  // caption loses the door and keeping it calls the floor layer. Both halves
  // are asserted, because either one alone passes with the other broken.
  ck("the fault clause of a mixed caption is kept",
    real2.why.windows_doors?.includes("door"), JSON.stringify(real2.why));
  // AND THE PICTURES THAT WERE READ AND SAID NOTHING WRONG ARE COUNTED, or
  // four photographs producing one chip reads as four nobody looked at.
  ck("photographs recording nothing wrong are counted", real2.noFault === 3, String(real2.noFault));
  ck("and are not counted as unread", real2.unread === 0, String(real2.unread));
  ck("while a photograph with no words at all still is",
    suggestTrades([{ ...REAL, photos: [...REAL.photos, { id: "p5" }] }]).unread === 1);

  // NEGATION IS SCOPED TO THE END OF ITS CLAUSE, which is the construction
  // the reported caption actually used: "no visible damage or separation from
  // flooring" has to negate BOTH, or the second noun walks through.
  const neg = suggestTrades([{ name: "Hall", status: "fail", photos: [
    { id: "p1", caption: "Trim intact with no visible damage or separation from the flooring." }] }]);
  ck("a negator carries across an `or` to the end of its clause",
    neg.trades.length === 0, JSON.stringify(neg.why));
  // And stops at the clause boundary, or one fine thing in a sentence would
  // silence a real fault later in the same caption.
  const after = suggestTrades([{ name: "Hall", status: "fail", photos: [
    { id: "p1", caption: "No damage to the walls. The carpet is badly stained." }] }]);
  ck("and not past it", after.trades.includes("flooring"), JSON.stringify(after.why));
  // CONTRAST SPLITS A CLAUSE; A COMMA DOES NOT. "Door panel, chipped" is one
  // thought with the noun on one side of the comma and the fault on the
  // other, so splitting there would drop the door -- which is the thing being
  // reported.
  const comma = suggestTrades([{ name: "Hall", status: "fail", photos: [
    { id: "p1", caption: "Door panel, chipped." }] }]);
  ck("a comma does not separate a noun from its fault",
    comma.trades.includes("windows_doors"), JSON.stringify(comma.why));
  const but = suggestTrades([{ name: "Hall", status: "fail", photos: [
    { id: "p1", caption: "The carpet is stained but the door is undamaged." }] }]);
  ck("a contrast does", but.trades.includes("flooring") && !but.trades.includes("windows_doors"),
    JSON.stringify(but.why));

  // READ PER FIELD, NEVER AS ONE BLOB. A caption naming a fault would
  // otherwise keep a draft saying the carpet is fine, and every noun in it.
  // NO FULL STOP ON THE CAPTION, deliberately: a manager typing into a box
  // does not add one, and with one the clause splitter separates the fields by
  // itself -- so a fixture that has one cannot tell per-field reading from a
  // blob, and the mutation for it survives. Found exactly that way.
  const twoFields = suggestTrades([{ name: "Hall", status: "fail", photos: [
    { id: "p1", caption: "Door panel chipped", draft: "Carpet is clean and in good order" }] }]);
  ck("a fault in the caption does not rescue the draft beside it",
    twoFields.trades.includes("windows_doors") && !twoFields.trades.includes("flooring"),
    JSON.stringify(twoFields.why));

  // THE NOTE IS NOT SUBJECT TO THIS, and that is the asymmetry rather than an
  // exemption: a room carries a STATUS and a photograph does not. A note sits
  // on a room somebody flagged, so it is already established as being about a
  // problem; a caption inherits nothing. Terse notes have to keep working --
  // "Carpet" on a flagged room is somebody saying the carpet is the problem.
  const terse = suggestTrades([{ name: "Hall", status: "fail", note: "Carpet.", photos: [] }]);
  ck("a terse note on a flagged room still names its trade",
    terse.trades.includes("flooring"), JSON.stringify(terse.why));
  // The same words in a CAPTION, with no fault in them, earn nothing.
  ck("the same word in a caption does not",
    suggestTrades([{ name: "Hall", status: "fail", photos: [{ id: "p1", caption: "Carpet." }] }])
      .trades.length === 0);

  // A WORD THAT ONLY SAYS WHERE THE DAMAGE IS, IS NOT THE DAMAGED THING.
  // "Scuff to the wall left of the door" is painting, and read whole-word it
  // also says `door` -- which called a glazier. Not a rare phrasing either:
  // it is the one the photo-draft prompt explicitly asks for.
  const where = suggestTrades([{ name: "Hall", status: "fail", note: "",
    photos: [{ id: "p1", draft: "Scuff to the wall left of the door." }] }]);
  ck("the thing the damage is NEXT TO does not earn a trade",
    !where.trades.includes("windows_doors"), JSON.stringify(where.trades));
  ck("while the damage itself still does", where.trades.includes("painting"), JSON.stringify(where.trades));
  // And the guard must not swallow the real case, which is the direction
  // that would quietly stop a glazier ever being suggested.
  ck("a door that IS the problem still counts",
    of([{ name: "Hall", status: "fail", note: "Front door will not latch" }]).includes("windows_doors"));
  ck("and so does one in a caption",
    suggestTrades([{ name: "Hall", status: "fail",
      photos: [{ id: "p1", caption: "Door frame split at the latch." }] }]).trades.includes("windows_doors"));
  // The same rule on a note, because a manager writes the same sentence and
  // two rules for one fact is how the two come to disagree.
  ck("a typed note gets the same treatment",
    !of([{ name: "Hall", status: "fail", note: "Scuff to the wall left of the door" }]).includes("windows_doors"));
}

console.log("\n-- sending the finished report to the building's owner --");
{
  // One walk, finished, so every assertion below is about the SEND rather
  // than about getting an inspection into a sendable state.
  const walk = async (env, propertyId, { finish = true, kind = "move_out" } = {}) => {
    const [, insp] = await json(await call(env, "/api/inspections", { method: "POST",
      body: { kind, propertyId, unit: "3B", tenantName: "Tess Nguyen", inspectedOn: "2026-10-02" } }));
    const [, r1] = await json(await call(env, `/api/inspections/${insp.id}/rooms`,
      { method: "POST", body: { name: "Kitchen" } }));
    await call(env, `/api/inspections/${insp.id}/rooms/${r1.rooms[0].id}`,
      { method: "PATCH", body: { status: "fail", note: "Cracked basin" } });
    if (finish) await call(env, `/api/inspections/${insp.id}`, { method: "PATCH", body: { finish: true } });
    return insp.id;
  };

  {
    const { env } = seed();
    const id = await walk(env, "p_press", { finish: false });

    // FINISHED ONLY, and it is the shared gate rather than a second one. A
    // half-walked document says nothing while looking like it says
    // everything, which is the whole reason `whyNotFinish` refuses an
    // unmarked room -- sending one would undo that by a different door.
    let [s, b] = await json(await call(env, `/api/inspections/${id}/send`,
      { method: "POST", body: { userIds: ["u_own"] } }));
    ck("a draft cannot be sent", s === 409 && b.error === "not_finished", `${s} ${b.error}`);

    await call(env, `/api/inspections/${id}`, { method: "PATCH", body: { finish: true } });
    [s, b] = await json(await call(env, `/api/inspections/${id}`));
    ck("once finished the team's read carries who it can go to", s === 200 && Array.isArray(b.recipients),
      JSON.stringify(b.recipients));
    // WHO IS OFFERED IS THE OWNERS OF *THIS* BUILDING. u_own2 owns Ballard
    // and holds a seat on the same account, so a check that merely asked for
    // owners would have offered them a unit they have nothing to do with.
    const ids = (b.recipients || []).map((u) => u.id).sort().join(",");
    ck("the owners of this building, and only them", ids === "u_own,u_own3", ids);
    ck("an owner of another building on the same account is not offered",
      !ids.includes("u_own2"), ids);
    ck("and neither is the manager who walked it", !ids.includes("u_pm"), ids);
    ck("nobody has been sent it yet", (b.sends || []).length === 0, JSON.stringify(b.sends));
  }

  {
    const { db, env } = seed();
    const id = await walk(env, "p_press");

    // AN ID IN THE BODY IS A CLAIM. u_own2 is a real user, a real owner, on
    // this very account -- and not an owner of this building. Trusting the
    // body would mail somebody else's client a unit's move-out.
    let [s, b] = await json(await call(env, `/api/inspections/${id}/send`,
      { method: "POST", body: { userIds: ["u_own2"] } }));
    ck("an owner of another building cannot be named into it",
      s === 400 && b.error === "no_recipients", `${s} ${b.error}`);
    ck("and nothing was written for them",
      db.prepare(`SELECT COUNT(*) n FROM inspection_sends`).get().n === 0);

    // The manager themselves, and somebody with no seat here at all.
    [s, b] = await json(await call(env, `/api/inspections/${id}/send`,
      { method: "POST", body: { userIds: ["u_pm", "u_them", "nobody-at-all"] } }));
    ck("nor can a staff seat or a stranger", s === 400 && b.error === "no_recipients", `${s} ${b.error}`);
    ck("still nothing written",
      db.prepare(`SELECT COUNT(*) n FROM inspection_sends`).get().n === 0);

    // An empty body is not a send to everybody. Defaulting to the whole
    // audience would make a stray press mail every owner on the building.
    [s, b] = await json(await call(env, `/api/inspections/${id}/send`, { method: "POST", body: {} }));
    ck("an empty list sends nobody anything", s === 400 && b.error === "no_recipients", `${s} ${b.error}`);
  }

  {
    const { db, env } = seed();
    const id = await walk(env, "p_press");
    // With no mail configured nothing can leave the building, and the row has
    // to say so. A send marked true over a mail failure is the lie `sent_at`
    // exists to refuse -- and it is exactly how an owner says they never got
    // it while the screen says they did.
    let [s, b] = await json(await call(env, `/api/inspections/${id}/send`,
      { method: "POST", body: { userIds: ["u_own"] } }));
    ck("a send is recorded even when the mail cannot go", s === 200 && b.ok === true, `${s} ${JSON.stringify(b)}`);
    ck("and it says the mail did not go", b.sent?.[0]?.emailed === false, JSON.stringify(b.sent));
    const row = db.prepare(`SELECT * FROM inspection_sends`).get();
    ck("one row, for the owner that was picked", !!row && row.user_id === "u_own", JSON.stringify(row));
    ck("stamped with who sent it", row.sent_by === "u_admin", String(row.sent_by));
    ck("and emailed is 0 rather than 1", row.emailed === 0, String(row.emailed));
    // The reply is the panel's own next state, so the screen does not have to
    // derive a second answer to "who has it".
    ck("the reply carries the history back", (b.sends || []).length === 1, JSON.stringify(b.sends));
    ck("and it names it as not emailed", b.sends?.[0]?.emailed === false, JSON.stringify(b.sends));
  }

  {
    // The same send with mail working. Stubbed at `fetch`, which is the
    // boundary `sendEmail` crosses -- so what is asserted is the message that
    // would actually leave rather than an intention to send one.
    const { db, env } = seed();
    const sentMail = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (String(url).includes("/emails")) {
        sentMail.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ id: "mail_1" }), { status: 200 });
      }
      return realFetch(url, init);
    };
    try {
      const env2 = { ...env, RESEND_API_KEY: "k", MAIL_FROM: "SubSub <no-reply@subsub.work>",
        RESEND_API_BASE: "https://mail.test" };
      const id = await walk(env2, "p_press");
      const [s, b] = await json(await call(env2, `/api/inspections/${id}/send`,
        { method: "POST", body: { userIds: ["u_own", "u_own3"] } }));
      ck("both owners of the building can go at once", s === 200 && b.sent?.length === 2,
        `${s} ${JSON.stringify(b.sent)}`);
      ck("one mail per owner with an address", sentMail.length === 1, String(sentMail.length));
      ck("and it went to them", sentMail[0]?.to?.[0] === "marion@oakes.test", JSON.stringify(sentMail[0]?.to));
      ck("recorded as emailed", b.sent.find((d) => d.userId === "u_own")?.emailed === true,
        JSON.stringify(b.sent));
      // AN OWNER WITH NO ADDRESS IS STILL A SEAT, and the row says the mail
      // did not go rather than quietly not existing: "we never told them" is
      // the fact somebody needs months later.
      ck("the one with no address is recorded, not emailed",
        b.sent.find((d) => d.userId === "u_own3")?.emailed === false, JSON.stringify(b.sent));
      ck("two rows either way", db.prepare(`SELECT COUNT(*) n FROM inspection_sends`).get().n === 2);

      const mail = sentMail[0];
      ck("the subject names the account and the place",
        /Sound Property Management/.test(mail.subject) && /Press Apartments/.test(mail.subject), mail.subject);
      ck("and which walk it was", /Move-out/i.test(mail.subject), mail.subject);
      // A LINK, NOT AN ATTACHMENT. The owner reads it through their own seat,
      // where it stays live -- a copy starts going stale the moment it is
      // sent, which is the same reason the compliance pack is a link.
      ck("the body is a link rather than an attachment",
        /https:\/\/app\.subsub\.work\//.test(mail.text) && !/attach/i.test(mail.text),
        mail.text.slice(0, 400));
      ck("it says what was found", /1 of the 1 rooms/.test(mail.text), mail.text);
      // It does not carry the photographs or the room-by-room notes: those
      // are on the screen behind the link, where the permission is checked
      // every time rather than once at the moment of sending.
      ck("and not the room notes themselves", !/Cracked basin/.test(mail.text), mail.text);

      // SENDING AGAIN IS A SECOND ROW, not an edit to the first. "We told them
      // on the 2nd and again on the 9th" is the record; one row overwritten
      // loses the first send entirely.
      // AND IT FOLLOWS THE ACCOUNT'S OWN ADDRESS once there is one. The
      // branded host is Scale and only resolves when Cloudflare has actually
      // issued the certificate, which is why `accountOrigin` asks
      // `hostname_status` rather than building a URL from the subdomain -- a
      // link that does not load is worse than one that says SubSub.
      db.prepare(`UPDATE accounts SET hostname_status = 'active' WHERE id = 'acc1'`).run();
      const [, again] = await json(await call(env2, `/api/inspections/${id}/send`,
        { method: "POST", body: { userIds: ["u_own"] } }));
      ck("and it lands on the account's own address once that resolves",
        /https:\/\/soundpm\.subsub\.work\//.test(sentMail[sentMail.length - 1].text),
        sentMail[sentMail.length - 1].text.slice(0, 260));
      ck("sending again appends rather than overwriting", (again.sends || []).length === 3,
        JSON.stringify((again.sends || []).map((x) => x.userId)));
      ck("it is logged on the account",
        db.prepare(`SELECT COUNT(*) n FROM activity WHERE kind = 'inspection_sent'`).get().n === 2);
    } finally { globalThis.fetch = realFetch; }
  }

  {
    // THE OWNER'S OWN SIDE. They were invited onto this building, so reading a
    // finished report needs no token and no send -- the email is the telling
    // and not the access.
    const { env } = seed();
    const draft = await walk(env, "p_press", { finish: false });
    const done = await walk(env, "p_press", { kind: "move_in" });

    let [s, b] = await json(await call(env, `/api/inspections/${done}`, { who: "u_own" }));
    ck("an owner can read a finished report of their building", s === 200 && b.id === done, `${s} ${b.error || ""}`);
    ck("rooms and all", (b.rooms || []).length === 1, JSON.stringify((b.rooms || []).map((r) => r.name)));
    // A DRAFT IS NOT THEIRS TO READ, and the refusal is `not_found` rather
    // than `forbidden`: a 403 over a real id and a 404 over an invented one
    // is how somebody walks the account's inspection list one guess at a
    // time, which is the leak `jobscope.js` already records.
    [s, b] = await json(await call(env, `/api/inspections/${draft}`, { who: "u_own" }));
    ck("a draft reads as not there", s === 404 && b.error === "not_found", `${s} ${b.error}`);
    const [, nope] = await json(await call(env, `/api/inspections/does-not-exist`, { who: "u_own" }));
    ck("and so does one that does not exist", nope.error === "not_found", nope.error);

    // WHO ELSE WAS TOLD IS THE TEAM'S OWN RECORD. The audience is the other
    // owners' names and addresses, which is not this owner's to collect --
    // the same rule that keeps an overflow distribution list server-side.
    [, b] = await json(await call(env, `/api/inspections/${done}`, { who: "u_own" }));
    ck("an owner is not shown the audience", b.recipients === undefined && b.sends === undefined,
      JSON.stringify({ r: b.recipients, s: b.sends }));

    // The list is finished ones only. A draft on their own building is a
    // half-walked document and would read as a report.
    [, b] = await json(await call(env, "/api/inspections", { who: "u_own" }));
    const mine = Array.isArray(b) ? b : [];
    ck("their list holds the finished one", mine.some((i) => i.id === done),
      JSON.stringify(mine.map((i) => i.status)));
    ck("and not the draft", !mine.some((i) => i.id === draft),
      JSON.stringify(mine.map((i) => i.status)));
    // The other building's owner sees neither, because their seat is scoped
    // to Ballard and this walk is at Press.
    const [, other] = await json(await call(env, "/api/inspections", { who: "u_own2" }));
    ck("the other building's owner sees none of it", Array.isArray(other) && other.length === 0,
      JSON.stringify(other));
    // And the manager's own list still carries the draft, so the owner's
    // filter is the owner's rather than the row having gone anywhere.
    const [, teamList] = await json(await call(env, "/api/inspections"));
    ck("the team still sees the draft", teamList.some((i) => i.id === draft),
      JSON.stringify(teamList.map((i) => i.status)));

    // AND EVERY WRITE IS REFUSED. The screen draws none of them for an owner;
    // this is the half that holds whether or not it does.
    const refusals = [
      ["finish it again", `/api/inspections/${done}`, "PATCH", { unit: "9Z" }],
      ["add a room", `/api/inspections/${done}/rooms`, "POST", { name: "Boat shed" }],
      ["delete it", `/api/inspections/${done}`, "DELETE", undefined],
      ["raise a job from it", `/api/inspections/${done}/job`, "POST", { trades: ["plumbing"] }],
      ["send it on", `/api/inspections/${done}/send`, "POST", { userIds: ["u_own"] }],
      ["start a new one", "/api/inspections", "POST", { kind: "move_in", propertyId: "p_press" }],
    ];
    for (const [what, path, method, body] of refusals) {
      const [st] = await json(await call(env, path, { method, body, who: "u_own" }));
      ck(`an owner cannot ${what}`, st === 403, String(st));
    }
  }

  {
    // Another account's inspection is not reachable at all, by the send route
    // any more than by the read -- and it answers `not_found`, so this cannot
    // be walked to find out which ids are real.
    const { env } = seed();
    const id = await walk(env, "p_press");
    const [s, b] = await json(await call(env, `/api/inspections/${id}/send`,
      { method: "POST", body: { userIds: ["u_own"] }, who: "u_them", acct: "acc2" }));
    ck("another account cannot send ours", s === 404 && b.error === "not_found", `${s} ${b.error}`);
  }

  {
    // A SCOPED MANAGER IS SCOPED HERE TOO. u_pm is narrowed to Ballard, so a
    // walk at Press is not theirs to send -- the scope is applied in the one
    // place that resolves an inspection rather than per route.
    const { env } = seed();
    const id = await walk(env, "p_press");
    const [s, b] = await json(await call(env, `/api/inspections/${id}/send`,
      { method: "POST", body: { userIds: ["u_own"] }, who: "u_pm" }));
    ck("a manager narrowed to another building cannot send it",
      s === 404 && b.error === "not_found", `${s} ${b.error}`);
    // And one at their own building is.
    const mine = await walk(env, "p_ballard");
    const [s2, b2] = await json(await call(env, `/api/inspections/${mine}/send`,
      { method: "POST", body: { userIds: ["u_own2"] }, who: "u_pm" }));
    ck("and one at their own building is", s2 === 200 && b2.sent?.length === 1,
      `${s2} ${JSON.stringify(b2.sent || b2)}`);
  }

  {
    // BOTH KINDS SEND. The move-in report is the one that answers "it was
    // like that when I moved in" and the move-out report is the one that
    // raises the question; an owner with one and not the other has half a
    // record, so neither kind is special-cased anywhere.
    const { env } = seed();
    for (const kind of ["move_in", "move_out"]) {
      const id = await walk(env, "p_press", { kind });
      const [s, b] = await json(await call(env, `/api/inspections/${id}/send`,
        { method: "POST", body: { userIds: ["u_own"] } }));
      ck(`a ${kind} report sends`, s === 200 && b.sent?.length === 1, `${s} ${JSON.stringify(b.sent || b)}`);
    }
  }
}

console.log("\n-- the roles are one list, not thirteen --");
{
  const W = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");
  const APP = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  // A SCREEN STRICTER THAN THE ROUTE IS THE SAME LIE AS ONE THAT IS LOOSER,
  // and the way both happen is a role list written twice. Every inspection
  // route reads the shared list, and the screen's `canEdit` is the same
  // predicate rather than a hand-kept copy.
  const routes = [...W.matchAll(/app\.(get|post|patch|put|delete)\("\/api\/inspections[^"]*",\s*([^,]+),/g)];
  ck("there are inspection routes to check", routes.length >= 12, String(routes.length));
  ck("and every one of them takes its roles from the shared list",
    routes.every((m) => /INSPECTION_(READ|WRITE)_ROLES/.test(m[2])),
    JSON.stringify(routes.filter((m) => !/INSPECTION_(READ|WRITE)_ROLES/.test(m[2])).map((m) => m[2])));
  ck("the writes are the write list and the reads the read one",
    routes.filter((m) => m[1] === "get").every((m) => /READ/.test(m[2]))
    && routes.filter((m) => m[1] !== "get").every((m) => /WRITE/.test(m[2])));
  ck("an owner reads and does not write",
    INSPECTION_READ_ROLES.includes("owner") && !mayWriteInspection("owner"));
  ck("a manager and an admin write", mayWriteInspection("pm") && mayWriteInspection("admin"));
  ck("and a tenant or a contractor does neither",
    !mayWriteInspection("tenant") && !INSPECTION_READ_ROLES.includes("tenant")
    && !INSPECTION_READ_ROLES.includes("contractor"));
  // The screen asks the shared question rather than defaulting true, which is
  // what this feature was one edit away from shipping: an owner's seat gained
  // the tab and every write button was still drawn.
  // AND THE GUEST PATH ALLOWLIST IS THE OTHER RECORD OF THE SAME FACT, which
  // is what refused an owner's reads for a while: the role said yes, the path
  // list had never heard of the feature. Both halves have to say GET, and
  // NEITHER may say anything else -- the role guard would refuse a write
  // today, so a write method here is two guards covering for each other with
  // nothing reporting it, the shape this file keeps catching.
  for (const [name, list] of [["an owner", "OWNER_ALLOWED"], ["a tenant", "TENANT_ALLOWED"]]) {
    const block = W.slice(W.indexOf(`const ${list} = [`));
    const body = block.slice(0, block.indexOf("\n];"));
    const lines = body.split("\n").filter((l) => /inspections/.test(l) && !/^\s*\/\//.test(l));
    if (list === "OWNER_ALLOWED") {
      ck("the owner's three reads are on the path allowlist", lines.length === 3,
        JSON.stringify(lines));
    } else {
      ck("a tenant reaches none of it at all", lines.length === 0, JSON.stringify(lines));
    }
    ck(`and nothing but GET is open to ${name}`,
      lines.every((l) => /\[\s*"GET"\s*\]/.test(l)), JSON.stringify(lines));
  }
  ck("the screen reads the shared predicate", /mayWriteInspection\(role\)/.test(APP));
  ck("and does not keep its own list of who may write",
    !/INSPECTION_WRITE_ROLES\s*=/.test(APP));
}

console.log("\n-- the shared rule is the one the routes read --");
  {
    const W = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");
    const APP = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    ck("the Worker imports it", /from "\.\.\/shared\/inspection\.js"/.test(W));
    ck("and so does the browser", /from "\.\.\/shared\/inspection\.js"/.test(APP));
    // The finish gate specifically: a route that restated it would be a
    // second answer to what a finished inspection is.
    ck("the finish gate is the shared predicate", /whyNotFinish\(rooms\)/.test(W));
    ck("and the screen asks the same one", /whyNotFinish\(rooms\)/.test(APP));
    // And the statuses are not spelled out a second time in SQL beyond the
    // one list query that counts them.
    ck("the browser does not keep its own status list",
      !/const ROOM_STATUSES\s*=/.test(APP));
  }

console.log("\n-- where the walk has got to, as steps --");
  {
    const APP = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    const R = (status, extra = {}) => ({ id: `r${Math.random()}`, name: "Kitchen", status, photos: [], ...extra });
    const at = (o) => inspectionStep(o).at;

    // THE FIRST STEP IS ADDING A ROOM, which is the sentence the request
    // asked for: "get started by adding your first room here".
    ck("an empty inspection is on rooms", at({ inspection: { status: "draft" }, rooms: [] }) === "rooms");
    // AN UNMARKED ROOM IS THE WALK, not the finish. A strip saying "finish"
    // over a room nobody has looked at would be telling somebody to sign a
    // document with a blank in it, which is exactly what whyNotFinish refuses.
    ck("a room nobody has marked is the walk",
      at({ inspection: { status: "draft" }, rooms: [R(null)] }) === "walk");
    ck("and the unchecked count comes with it",
      inspectionStep({ inspection: { status: "draft" }, rooms: [R(null), R("ok")] }).unchecked === 1);

    // WORK COMES BEFORE FINISH, because this product offers Raise a job the
    // moment something is flagged, finished or not -- the leak does not wait
    // for the paperwork. A strip that put the paperwork first would be
    // telling somebody to do the opposite of what the screen does.
    ck("a flagged room with no job raised is the work",
      at({ inspection: { status: "draft" }, rooms: [R("fail")] }) === "work");
    ck("and once a job is raised it moves on to finishing",
      at({ inspection: { status: "draft", jobId: "job_1" }, rooms: [R("fail")] }) === "finish");

    // NOTHING FLAGGED IS NOT AN UNFINISHED STEP, IT IS THE BEST ANSWER TO
    // ONE. An all-clear walk sitting for ever on "raise the work" over a unit
    // with nothing wrong in it is the permanently-amber failure docs.js
    // exists to prevent, wearing a step number.
    ck("an all-clear walk skips the work step",
      at({ inspection: { status: "draft" }, rooms: [R("ok")] }) === "finish");
    ck("and it is marked done rather than merely skipped",
      inspectionStep({ inspection: { status: "draft" }, rooms: [R("ok")] })
        .steps.find((x) => x.id === "work").done === true);

    // SEND IS A STEP ONLY WHEN THERE IS SOMEBODY TO SEND TO. A building the
    // account owns itself has no owner seat and never will, so listing it
    // would leave a step that can never be ticked on every inspection of it.
    const noOwner = inspectionStep({ inspection: { status: "finished", jobId: "j" }, rooms: [R("fail")] });
    ck("with no owner on the building there is no send step",
      !noOwner.steps.some((x) => x.id === "send"), JSON.stringify(noOwner.steps.map((x) => x.id)));
    ck("and a finished walk then has nothing left at all", noOwner.at === null);
    const withOwner = inspectionStep({ inspection: { status: "finished", jobId: "j" }, rooms: [R("fail")],
      recipients: [{ id: "usr_o", name: "Dana" }] });
    ck("with one, send is the last step", withOwner.at === "send");
    ck("and it names who is still waiting",
      withOwner.waiting.length === 1 && withOwner.waiting[0].id === "usr_o");
    ck("once they have had it there is nothing left",
      inspectionStep({ inspection: { status: "finished", jobId: "j" }, rooms: [R("fail")],
        recipients: [{ id: "usr_o" }], sends: [{ userId: "usr_o" }] }).at === null);

    // THE ASSIGN NUDGE IS NOT A STEP, and that is the "or later" in the
    // request taken at its word. The job exists and leaving it on the Jobs
    // screen is a real answer, so it must not hold the strip open.
    const raised = inspectionStep({ inspection: { status: "draft", jobId: "job_1" }, rooms: [R("fail")] });
    ck("a raised job offers the assign nudge", raised.nudge === "assign");
    ck("and the work step still reads done under it",
      raised.steps.find((x) => x.id === "work").done === true);
    ck("nothing raised, nothing nudged",
      inspectionStep({ inspection: { status: "draft" }, rooms: [R("fail")] }).nudge === null);

    // EXACTLY ONE STEP IS CURRENT, which is what lets the card draw one set
    // of words. Two would be two sentences claiming to be next.
    for (const [what, arg] of [
      ["empty", { inspection: { status: "draft" }, rooms: [] }],
      ["mid-walk", { inspection: { status: "draft" }, rooms: [R(null), R("fail")] }],
      ["finished with an owner", { inspection: { status: "finished", jobId: "j" }, rooms: [R("fail")],
        recipients: [{ id: "u" }] }],
    ]) {
      const got = inspectionStep(arg);
      ck(`exactly one step is current (${what})`,
        got.steps.filter((x) => x.now).length === 1, JSON.stringify(got.steps));
    }
    ck("and none is, once there is nothing left",
      noOwner.steps.filter((x) => x.now).length === 0);

    // THE SCREEN READS THIS RULE RATHER THAN DERIVING A SECOND ONE.
    ck("the walkthrough is drawn from the shared step", /inspectionStep\(/.test(APP));
    ck("and the browser does not keep its own step list",
      !/const INSPECTION_STEPS\s*=/.test(APP));
  }

} finally { /* nothing to close */ }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
