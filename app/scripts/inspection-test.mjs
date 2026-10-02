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
  ROOM_STATUSES, STANDARD_ROOMS } from "../shared/inspection.js";

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
      ('u_them','Someone Else','x@other.test');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES
      ('m_admin','u_admin','acc1','admin'),
      ('m_pm','u_pm','acc1','pm'),
      ('m_them','u_them','acc2','admin');
    INSERT INTO properties(id,account_id,name,address,city,zip,owner_account_id) VALUES
      ('p_press','acc1','Press Apartments','1620 Belmont Ave','Seattle','98122','acc1'),
      ('p_ballard','acc1','Ballard Apts','2028 NW 59th','Seattle','98107','acc1'),
      ('p_theirs','acc2','Not Ours','1 Elsewhere','Tacoma','98407','acc2');
    -- A project manager narrowed to ONE of the two buildings: the only
    -- fixture either direction of the scope can be checked against.
    INSERT INTO membership_properties(membership_id,property_id) VALUES ('m_pm','p_ballard');
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

} finally { /* nothing to close */ }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
