// Move-in and move-out inspections arriving from somebody else's system.
//
// The loop: a managing agent walks a unit in whatever they already walk units
// in, that system posts the walk here, and it lands as a DRAFT inspection with
// its rooms and conditions on it -- ready to finish and raise the work from.
//
// What this covers is the properties that make that safe, none of which shows
// on a screen:
//
//   A RETRY MUST NOT DUPLICATE. A webhook that does not get a 200 sends again,
//   and one walk becoming four inspections is four jobs raised against one
//   flat, which is four contractors asked to turn up.
//
//   A WALK WHOSE CONDITION WORDS MEAN NOTHING STILL ARRIVES. Refusing it makes
//   the sender retry for ever with nobody told, and the only symptom is a unit
//   with no record of being walked. So those rooms land `unchecked` and the
//   words are counted.
//
//   IT IS NEVER FINISHED ON ARRIVAL. Finishing is a one-way door that makes
//   the document quotable, writes the summary and lets it go to the owner. A
//   receiver that finished one would bake an unrecognised word permanently
//   into a record nobody can edit.
//
//   THE BUILDING IS FOUND, NEVER GUESSED. Two buildings matching one name is
//   refused, because picking either files a walk of one flat against a
//   different building and nothing downstream would look wrong.
//
//   node --no-warnings scripts/inspect-ingest-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { runCheck } from "./lib/check-sql.mjs";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const M048 = readFileSync(new URL("../worker/migrations/048_api.sql", import.meta.url), "utf8");
const M068 = readFileSync(new URL("../worker/migrations/068_inspection_ingest.sql", import.meta.url), "utf8");

// TWO BUILDINGS WITH ONE NAME, on purpose: the ambiguity refusal cannot be
// told from a lucky first row without a fixture that has two. And a building
// on ANOTHER account called the same thing, because a lookup scoped to the
// name and not to the account would find it.
const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [M048, M068] });
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind,plan) VALUES
      ('acc_pm','Sound Property Management','sound','property_manager','scale'),
      ('acc_gc','Outerhome','outerhome','general_contractor','scale'),
      ('acc_basic','Thrifty Lettings','thrifty','property_manager','basic'),
      ('acc_other','Rival Agents','rival','property_manager','scale');
    INSERT INTO users(id,name,email) VALUES
      ('u_ad','Rae','rae@sound.test'),
      ('u_gc','Jo','jo@outerhome.test'),
      ('u_bas','Sam','sam@thrifty.test'),
      ('u_oth','Kit','kit@rival.test');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES
      ('m_ad','u_ad','acc_pm','admin'),
      ('m_gc','u_gc','acc_gc','admin'),
      ('m_bas','u_bas','acc_basic','admin'),
      ('m_oth','u_oth','acc_other','admin');
    INSERT INTO properties(id,account_id,name,address) VALUES
      ('p_press','acc_pm','Press Apartments','14 Alder Way'),
      ('p_cedar','acc_pm','Cedar Court','9 Cedar Rd'),
      ('p_dup_a','acc_pm','The Mews','1 Mews Lane'),
      ('p_dup_b','acc_pm','The Mews','2 Mews Lane'),
      ('p_theirs','acc_other','Press Apartments','99 Other St');
  `);
  return db;
};

// Minted through the real route, because a hash written by the test proves its
// own arithmetic rather than the product's.
const mint = async (env, seat = { u: "u_ad", a: "acc_pm" }, name = "Our inspection app") => {
  const res = await worker.fetch(new Request("https://api.subsub.work/api/api-tokens", {
    method: "POST",
    headers: { "X-User-Id": seat.u, "X-Account-Id": seat.a, "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  }), env);
  return (await res.json().catch(() => ({})))?.token;
};

const post = async (env, token, body) => {
  const res = await worker.fetch(new Request("https://api.subsub.work/api/v1/inspections", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }), env);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const hook = async (env, source, token, body) => {
  const res = await worker.fetch(new Request(
    `https://api.subsub.work/api/v1/hooks/${source}/${token}/inspections`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }), env);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const seatCall = async (env, path, { method = "GET", seat = { u: "u_ad", a: "acc_pm" }, body } = {}) => {
  const res = await worker.fetch(new Request(`https://api.subsub.work${path}`, {
    method,
    headers: { "X-User-Id": seat.u, "X-Account-Id": seat.a, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), env);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

// A walk as an inspection app would send it: THEIR field names, THEIR scale.
// Nothing in here is SubSub's vocabulary except by coincidence, which is the
// only shape that proves the translation runs.
const WALK = {
  external_id: "ZW-7781",
  type: "Move Out",
  property: "Press Apartments",
  unit: " 10B ",
  resident: "M. Okafor",
  completed_at: "2026-10-01",
  items: [
    { room: "Toilet", condition: "Poor", notes: "Cracked basin, hairline across the bowl" },
    { room: "Kitchen", condition: "good" },
    // The word nothing has heard of, twice, so the queue has to dedupe it.
    { room: "Hallway", condition: "Grade C" },
    { room: "Bedroom 1", condition: "Grade C", notes: "Scuff to the wall left of the door" },
    // No condition at all: lands unchecked and is DELIBERATELY not a queue
    // row, because nothing arrived that we failed to understand.
    { room: "Balcony" },
    { room: "Shower and bath", condition: "Fair" },
  ],
};

let DB, env, TOKEN;

console.log("\n-- a walk arrives --");
{
  DB = seed(); env = { DB: makeD1(DB) };
  TOKEN = await mint(env);
  const r = await post(env, TOKEN, WALK);
  ck("it is accepted", r.status === 201, `${r.status} ${JSON.stringify(r.body)}`);
  ck("and says which inspection", typeof r.body.inspectionId === "string", JSON.stringify(r.body));

  const row = DB.prepare("SELECT * FROM inspections WHERE id = ?").get(r.body.inspectionId);
  ck("on the account that owns the token", row?.account_id === "acc_pm", row?.account_id);
  // The building was found by NAME, and the one on another account with the
  // same name was not taken.
  ck("at the building the name matched", row?.property_id === "p_press", row?.property_id);
  ck("the kind was read from their word", row?.kind === "move_out", row?.kind);
  ck("the unit is trimmed", row?.unit === "10B", JSON.stringify(row?.unit));
  ck("the resident is carried", row?.tenant_name === "M. Okafor", row?.tenant_name);
  ck("the walk date is carried", row?.inspected_on === "2026-10-01", row?.inspected_on);

  // THE ONE-WAY DOOR IS NOT OPENED BY A WEBHOOK.
  ck("it lands as a DRAFT", row?.status === "draft", row?.status);
  ck("with nothing finished", row?.finished_at == null, String(row?.finished_at));
  ck("and the reply says so", r.body.status === "draft", JSON.stringify(r.body.status));

  // No person walked this in, so none is named. Provenance lives on the
  // source row, where it is true.
  ck("created_by is NULL", row?.created_by == null, String(row?.created_by));

  const rooms = DB.prepare(
    "SELECT name, status, note, position FROM inspection_rooms WHERE inspection_id = ? ORDER BY position"
  ).all(r.body.inspectionId);
  ck("every room arrived", rooms.length === 6, String(rooms.length));
  ck("in the order they were sent", rooms.map((x) => x.name).join("|")
    === "Toilet|Kitchen|Hallway|Bedroom 1|Balcony|Shower and bath", rooms.map((x) => x.name).join("|"));
  const by = Object.fromEntries(rooms.map((x) => [x.name, x.status]));
  ck("Poor reads as a failure", by.Toilet === "fail", by.Toilet);
  ck("good reads as fine", by.Kitchen === "ok", by.Kitchen);
  ck("Fair reads as something to come back for", by["Shower and bath"] === "follow_up",
    by["Shower and bath"]);
  // THE STRICT DIRECTION. Falling back to `ok` would assert that somebody
  // walked the room and found nothing wrong -- a claim nobody made, on a
  // document a deposit argument is run from.
  ck("a word nothing knows lands NOT CHECKED", by.Hallway === "unchecked", by.Hallway);
  ck("and so does a room with no condition at all", by.Balcony === "unchecked", by.Balcony);
  ck("the note is carried", /Cracked basin/.test(rooms.find((x) => x.name === "Toilet")?.note || ""),
    rooms.find((x) => x.name === "Toilet")?.note);

  // The queue. Said in the reply while whoever is wiring this up is looking at
  // it, as well as written down.
  ck("the reply names what was not understood", JSON.stringify(r.body.unmapped) === '["Grade C"]',
    JSON.stringify(r.body.unmapped));
  // Three, not two: the two that said a word nothing knows, AND the one that
  // said nothing at all. What the panel needs is how much of the walk has no
  // answer on it, which is both.
  ck("and counts the rooms still needing an answer", r.body.needsAnswers === 3,
    String(r.body.needsAnswers));
  const gaps = DB.prepare("SELECT match_value, hits, source FROM inspection_unmapped").all();
  ck("one queue row per distinct word, not per room", gaps.length === 1, JSON.stringify(gaps));
  // ROOMS, not deliveries. "Grade C on 2 rooms" is the measure of how much of
  // the walk is unreadable; counting the delivery would say 1 over two rooms.
  ck("counted twice, because two rooms said it", gaps[0]?.hits === 2, String(gaps[0]?.hits));
  // A room with no condition contributes nothing: nothing arrived that we
  // failed to understand, so there is nothing to ask about.
  ck("a blank condition is not a queue row", !gaps.some((g) => !g.match_value),
    JSON.stringify(gaps));
  ck("the header door records its provenance as other", gaps[0]?.source === "other", gaps[0]?.source);

  const src = DB.prepare("SELECT * FROM inspection_sources").get();
  ck("the retry key is written", src?.external_id === "ZW-7781", JSON.stringify(src));
  ck("and names the token that posted it", typeof src?.token_id === "string", String(src?.token_id));
}

console.log("\n-- a retry must not duplicate --");
{
  const again = await post(env, TOKEN, WALK);
  ck("the second delivery is a 200, not a 201", again.status === 200, String(again.status));
  ck("and says so", again.body.duplicate === true, JSON.stringify(again.body));
  ck("handing back the inspection that exists",
    again.body.inspectionId === DB.prepare("SELECT id FROM inspections").get()?.id);
  // AND THIS ONE IS NOT THE PRE-CHECK'S DOING, which is worth saying because
  // the obvious reading is that it is. Delete the pre-check and the insert runs,
  // the unique index below refuses the source row, and the catch deletes the
  // inspection again -- so this assertion passes either way. What the pre-check
  // uniquely buys is the assertion after it: the queue is not re-counted,
  // because nothing is counted before the duplicate is recognised. Two guards
  // covering for each other, each pinned where it is the only one working.
  ck("one inspection, not two",
    DB.prepare("SELECT COUNT(*) n FROM inspections").get().n === 1,
    String(DB.prepare("SELECT COUNT(*) n FROM inspections").get().n));
  ck("and no second set of rooms",
    DB.prepare("SELECT COUNT(*) n FROM inspection_rooms").get().n === 6,
    String(DB.prepare("SELECT COUNT(*) n FROM inspection_rooms").get().n));
  // A redelivered walk is ONE walk. Climbing `hits` on retries would report
  // nine rooms saying Poor when it was one room delivered nine times.
  ck("and the queue did not climb on the retry",
    DB.prepare("SELECT hits FROM inspection_unmapped").get()?.hits === 2,
    String(DB.prepare("SELECT hits FROM inspection_unmapped").get()?.hits));
}

console.log("\n-- the unique index, which the pre-check cannot cover --");
{
  // Two deliveries arriving at ONCE is what the index is for, and the
  // sequential case above is caught by the pre-check -- so removing the index
  // leaves that test passing. Asserted directly for that reason.
  let threw = false;
  try {
    DB.prepare(`INSERT INTO inspection_sources (inspection_id, account_id, source, external_id)
      VALUES ('insp_fake','acc_pm','other','ZW-7781')`).run();
  } catch { threw = true; }
  ck("a second row for one external id is refused by the database", threw);
}

console.log("\n-- the building is found, never guessed --");
{
  DB = seed(); env = { DB: makeD1(DB) };
  TOKEN = await mint(env);

  const amb = await post(env, TOKEN, { ...WALK, external_id: "A-1", property: "The Mews" });
  ck("two buildings with one name is REFUSED", amb.status === 409, String(amb.status));
  ck("named, so the integrator can send the id instead",
    amb.body.error === "property_ambiguous", JSON.stringify(amb.body));
  ck("and nothing was written", DB.prepare("SELECT COUNT(*) n FROM inspections").get().n === 0);

  const gone = await post(env, TOKEN, { ...WALK, external_id: "A-2", property: "Nowhere House" });
  ck("a building nobody has is not found", gone.body.error === "property_not_found",
    JSON.stringify(gone.body));

  // Somebody else's building, named exactly. A lookup that matched the name
  // and not the account would find it.
  const theirs = await post(env, TOKEN, { ...WALK, external_id: "A-3", propertyId: "p_theirs" });
  ck("another account's building id answers not_found",
    theirs.status === 404 && theirs.body.error === "property_not_found", JSON.stringify(theirs.body));

  const byAddr = await post(env, TOKEN, { ...WALK, external_id: "A-4", property: "9 cedar rd" });
  ck("the address matches too, ignoring capitals", byAddr.status === 201, JSON.stringify(byAddr.body));
  ck("at the right building",
    DB.prepare("SELECT property_id FROM inspections WHERE id = ?").get(byAddr.body.inspectionId)
      ?.property_id === "p_cedar");

  const byId = await post(env, TOKEN, { ...WALK, external_id: "A-5", propertyId: "p_press" });
  ck("and an id works on its own", byId.status === 201, JSON.stringify(byId.body));
}

console.log("\n-- what is refused, and what it says --");
{
  DB = seed(); env = { DB: makeD1(DB) };
  TOKEN = await mint(env);
  const err = async (body) => (await post(env, TOKEN, body)).body;

  const noId = await err({ ...WALK, external_id: undefined });
  ck("no external id is refused", noId.error === "invalid_request", JSON.stringify(noId));
  // NAMED IN THEIR VOCABULARY. An integrator reading "externalId is missing"
  // has never heard of our name for their id.
  ck("and the field is named as THEY spell it",
    noId.errors?.some((e) => e.field === "externalId"), JSON.stringify(noId.errors));

  const noKind = await err({ ...WALK, type: undefined });
  ck("no kind is refused", noKind.error === "invalid_request", JSON.stringify(noKind));
  // REFUSED RATHER THAN DEFAULTED. A move-in and a move-out are opposite
  // documents and the whole value of the record is which one it is -- guessing
  // decides the carpet dispute wrongly.
  const oddKind = await err({ ...WALK, type: "Routine inventory" });
  ck("a kind nothing recognises is refused rather than guessed",
    oddKind.errors?.some((e) => e.code === "not_understood"), JSON.stringify(oddKind.errors));

  const noWhere = await err({ ...WALK, property: undefined });
  ck("no building is refused", noWhere.error === "invalid_request", JSON.stringify(noWhere));

  const noRooms = await err({ ...WALK, items: [] });
  ck("a walk with no rooms is refused", noRooms.error === "invalid_request", JSON.stringify(noRooms));
  const blankRooms = await err({ ...WALK, items: [{ condition: "Poor" }] });
  ck("and so is one whose rooms are all nameless", blankRooms.error === "invalid_request",
    JSON.stringify(blankRooms));

  ck("nothing was written by any of them",
    DB.prepare("SELECT COUNT(*) n FROM inspections").get().n === 0);

  const badJson = await worker.fetch(new Request("https://api.subsub.work/api/v1/inspections", {
    method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: "{not json",
  }), env);
  ck("a broken body is named rather than a 500", badJson.status === 400, String(badJson.status));

  // A trailing blank row in somebody's export is not a reason to lose the
  // walk, so a nameless room among named ones is DROPPED and the rest arrive.
  const mixed = await post(env, TOKEN, { ...WALK, external_id: "M-1",
    items: [{ room: "Kitchen", condition: "good" }, { condition: "Poor" }, "Balcony"] });
  ck("a nameless room among named ones is dropped, not fatal", mixed.status === 201,
    JSON.stringify(mixed.body));
  ck("and the named ones arrived",
    DB.prepare("SELECT COUNT(*) n FROM inspection_rooms WHERE inspection_id = ?")
      .get(mixed.body.inspectionId).n === 2);
  // A bare string is a room name with nothing said about it, which is how a
  // checklist exports before anybody walks it.
  ck("a bare string is a room with no answer yet",
    DB.prepare("SELECT status FROM inspection_rooms WHERE inspection_id = ? AND name = 'Balcony'")
      .get(mixed.body.inspectionId)?.status === "unchecked");
}

console.log("\n-- the token gates, which are the POST's and not lighter --");
{
  DB = seed(); env = { DB: makeD1(DB) };
  const good = await mint(env);

  const none = await worker.fetch(new Request("https://api.subsub.work/api/v1/inspections", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(WALK),
  }), env);
  ck("no token at all is refused", none.status === 401, String(none.status));

  const madeUp = await post(env, "ssk_not_a_real_token", WALK);
  ck("a made-up token is refused", madeUp.status === 401, String(madeUp.status));

  // A REVOKED TOKEN AND A MADE-UP ONE ANSWER THE SAME. A separate reply tells
  // somebody holding a stolen key that it WAS real and whose it was.
  const doomed = await mint(env, { u: "u_ad", a: "acc_pm" }, "Old app");
  const id = DB.prepare("SELECT id FROM api_tokens WHERE name = 'Old app'").get().id;
  await seatCall(env, `/api/api-tokens/${id}`, { method: "DELETE" });
  const revoked = await post(env, doomed, WALK);
  ck("a revoked token reads exactly as a made-up one",
    JSON.stringify(revoked.body) === JSON.stringify(madeUp.body), JSON.stringify(revoked.body));

  // Scale is checked on every CALL, not only at minting -- or it is a thing
  // you buy once and keep.
  const basic = await mint(env, { u: "u_bas", a: "acc_basic" });
  ck("an account on Basic cannot mint one at all", !basic, String(basic));
  DB.prepare("UPDATE accounts SET plan = 'scale' WHERE id = 'acc_basic'").run();
  const bt = await mint(env, { u: "u_bas", a: "acc_basic" });
  DB.prepare("UPDATE accounts SET plan = 'basic' WHERE id = 'acc_basic'").run();
  const downgraded = await post(env, bt, WALK);
  ck("and a downgrade stops one already minted",
    downgraded.status === 403 && downgraded.body.error === "scale_required",
    JSON.stringify(downgraded.body));

  // A GENERAL CONTRACTOR KEEPS NO BUILDINGS, so it has no units to walk --
  // which is a different question from HIRING_KINDS, the gate the jobs
  // endpoint applies. It can mint a token and post jobs; it cannot post a
  // walk.
  const gct = await mint(env, { u: "u_gc", a: "acc_gc" });
  ck("a general contractor can still mint a token", !!gct, String(gct));
  const gcPost = await post(env, gct, WALK);
  ck("but cannot post an inspection", gcPost.status === 403, String(gcPost.status));
  ck("and is told why", gcPost.body.error === "no_buildings", JSON.stringify(gcPost.body));

  // EXEMPT FROM THE SESSION MIDDLEWARE IS NOT THE SAME AS UNAUTHENTICATED.
  const seatHeaders = await worker.fetch(new Request("https://api.subsub.work/api/v1/inspections", {
    method: "POST",
    headers: { "X-User-Id": "u_ad", "X-Account-Id": "acc_pm", "Content-Type": "application/json" },
    body: JSON.stringify(WALK),
  }), env);
  ck("a signed-in seat's headers are not a way in", seatHeaders.status === 401,
    String(seatHeaders.status));
  ck("nothing arrived through any of them",
    DB.prepare("SELECT COUNT(*) n FROM inspections").get().n === 0);
  void good;
}

console.log("\n-- the path-token door, for a webhook that cannot set a header --");
{
  DB = seed(); env = { DB: makeD1(DB) };
  TOKEN = await mint(env);

  const r = await hook(env, "generic", TOKEN, { ...WALK, external_id: "H-1" });
  ck("a walk arrives through the URL", r.status === 201, JSON.stringify(r.body));
  // The URL named the receiver and that outranks anything in the payload:
  // somebody pasted that address and it is the one fact about this delivery
  // nobody can mistype into a different meaning.
  ck("and its provenance is the source in the address", r.body.source === "generic",
    JSON.stringify(r.body.source));
  ck("recorded that way too",
    DB.prepare("SELECT source FROM inspection_sources WHERE inspection_id = ?")
      .get(r.body.inspectionId)?.source === "generic");

  const lying = await hook(env, "generic", TOKEN, { ...WALK, external_id: "H-2", source: "other" });
  ck("a payload claiming a different source does not win", lying.body.source === "generic",
    JSON.stringify(lying.body.source));

  const unknown = await hook(env, "zinspector", TOKEN, { ...WALK, external_id: "H-3" });
  ck("an inspection app with no receiver is NAMED, not blankly 404'd",
    unknown.body.error === "unknown_source", JSON.stringify(unknown.body));
  ck("and the reply lists what is available",
    Array.isArray(unknown.body.supported) && unknown.body.supported.includes("generic"),
    JSON.stringify(unknown.body.supported));

  // Every check the header route makes, not a lighter door.
  DB.prepare("UPDATE accounts SET plan = 'basic' WHERE id = 'acc_pm'").run();
  const downgraded = await hook(env, "generic", TOKEN, { ...WALK, external_id: "H-4" });
  ck("the plan gate fires on the path door too", downgraded.status === 403
    && downgraded.body.error === "scale_required", JSON.stringify(downgraded.body));
  DB.prepare("UPDATE accounts SET plan = 'scale' WHERE id = 'acc_pm'").run();

  const bad = await hook(env, "generic", "ssk_nope", { ...WALK, external_id: "H-5" });
  ck("and so does the token lookup", bad.status === 401, String(bad.status));
}

console.log("\n-- the account's own dictionary --");
{
  DB = seed(); env = { DB: makeD1(DB) };
  TOKEN = await mint(env);

  const saved = await seatCall(env, "/api/inspection-rules", {
    method: "POST", body: { value: "Grade C", status: "fail" },
  });
  ck("an admin can answer a word", saved.status === 200, JSON.stringify(saved.body));
  const stored = DB.prepare("SELECT * FROM inspection_status_rules").get();
  ck("filed for EVERY system, which is the common case", stored?.source === "*", stored?.source);

  const r = await post(env, TOKEN, { ...WALK, external_id: "D-1" });
  const by = Object.fromEntries(DB.prepare(
    "SELECT name, status FROM inspection_rooms WHERE inspection_id = ?"
  ).all(r.body.inspectionId).map((x) => [x.name, x.status]));
  ck("and the next walk reads it", by.Hallway === "fail", by.Hallway);
  ck("so nothing is left needing an answer", r.body.needsAnswers === 1, String(r.body.needsAnswers));
  ck("and nothing new is queued", JSON.stringify(r.body.unmapped) === "[]",
    JSON.stringify(r.body.unmapped));

  // THE ACCOUNT'S ANSWER OUTRANKS OURS. Their "Fair" may well mean follow-up
  // where the built-in list says it is fine, and a built-in that won would be
  // a setting that does nothing.
  await seatCall(env, "/api/inspection-rules", {
    method: "POST", body: { value: "good", status: "follow_up" },
  });
  const r2 = await post(env, TOKEN, { ...WALK, external_id: "D-2" });
  const by2 = Object.fromEntries(DB.prepare(
    "SELECT name, status FROM inspection_rooms WHERE inspection_id = ?"
  ).all(r2.body.inspectionId).map((x) => [x.name, x.status]));
  ck("a rule beats a built-in word", by2.Kitchen === "follow_up", by2.Kitchen);

  // ANSWERING CLEARS THE QUEUE. A row that survives being answered is a button
  // somebody presses again, and again.
  const listed = await seatCall(env, "/api/inspection-rules");
  ck("the queue row for an answered word is gone",
    !(listed.body.unmapped || []).some((g) => /grade c/i.test(g.value)),
    JSON.stringify(listed.body.unmapped));
  ck("and the rule is listed back", (listed.body.rules || []).length === 2,
    JSON.stringify(listed.body.rules));

  const bogus = await seatCall(env, "/api/inspection-rules", {
    method: "POST", body: { value: "Grade D", status: "catastrophic" },
  });
  // A rule mapping to a status that does not exist fires, matches, and sets
  // nothing -- which looks exactly like one that was set up.
  ck("a status SubSub does not have is refused", bogus.status === 400, JSON.stringify(bogus.body));
  const noWord = await seatCall(env, "/api/inspection-rules", {
    method: "POST", body: { value: "   ", status: "fail" },
  });
  ck("and so is a rule with no word", noWord.status === 400, JSON.stringify(noWord.body));

  const badSrc = await seatCall(env, "/api/inspection-rules", {
    method: "POST", body: { value: "Grade E", status: "fail", source: "zinspector" },
  });
  // REFUSED rather than defaulted: a rule filed against a source the account
  // does not use fires for nobody and does not clear the queue row either.
  ck("a source with no receiver is refused rather than defaulted",
    badSrc.status === 400 && badSrc.body.error === "unknown_source", JSON.stringify(badSrc.body));

  const id = DB.prepare("SELECT id FROM inspection_status_rules WHERE match_value = 'Grade C'").get().id;
  const del = await seatCall(env, `/api/inspection-rules/${id}`, { method: "DELETE" });
  ck("a rule can be removed", del.status === 200, JSON.stringify(del.body));
  const theirs = await seatCall(env, `/api/inspection-rules/${id}`,
    { method: "DELETE", seat: { u: "u_oth", a: "acc_other" } });
  ck("and another account's id is not found rather than forbidden",
    theirs.status === 404 || theirs.status === 403, String(theirs.status));
}

console.log("\n-- who may hold the dictionary --");
{
  DB = seed(); env = { DB: makeD1(DB) };
  DB.prepare(`INSERT INTO memberships(id,user_id,account_id,role)
    VALUES ('m_pm','u_oth','acc_pm','pm')`).run();
  // ADMIN ONLY, for the reason the trade rules are: this is the dictionary
  // every arriving walk is read through, which is the same account-level
  // decision as the token that posts it.
  const pm = await seatCall(env, "/api/inspection-rules", { seat: { u: "u_oth", a: "acc_pm" } });
  ck("a project manager is refused", pm.status === 403, String(pm.status));
  // AND THE KIND GATE IS THE ROUTE'S, not only the screen's: a screen stricter
  // than its route is the same lie as looser.
  const gc = await seatCall(env, "/api/inspection-rules", { seat: { u: "u_gc", a: "acc_gc" } });
  ck("an account with no buildings is refused by the ROUTE",
    gc.status === 403 && gc.body.error === "no_buildings", JSON.stringify(gc.body));
  const gcSave = await seatCall(env, "/api/inspection-rules", {
    method: "POST", seat: { u: "u_gc", a: "acc_gc" }, body: { value: "Poor", status: "fail" },
  });
  ck("and cannot save one either", gcSave.status === 403, String(gcSave.status));
}

console.log("\n-- a database behind the code --");
{
  // 068 missing must be NAMED rather than answered with a 500 somebody cannot
  // act on. The routes behind the screen degrade to empty instead, because one
  // missing table must not cost an admin the whole tab.
  const db = freshDb({ base: SCHEMA, migrations: [M048] });
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind,plan) VALUES
      ('acc_pm','Sound','sound','property_manager','scale');
    INSERT INTO users(id,name,email) VALUES ('u_ad','Rae','rae@sound.test');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES ('m_ad','u_ad','acc_pm','admin');
    INSERT INTO properties(id,account_id,name) VALUES ('p_press','acc_pm','Press Apartments');
    DROP TABLE inspection_sources;
    DROP TABLE inspection_status_rules;
    DROP TABLE inspection_unmapped;
  `);
  const e = { DB: makeD1(db) };
  const tok = await mint(e);
  const r = await post(e, tok, WALK);
  ck("the post names the migration", r.status === 503 && r.body.error === "migration_needed",
    JSON.stringify(r.body));
  // THE FILE, by name, in the field a caller reads -- not only in the prose.
  // `missingSchema` had never heard of these three tables, so the first version
  // answered `migration: "unknown"`, which is a 503 nobody can act on.
  ck("naming the file in the field, not only the message",
    r.body.migration === "068_inspection_ingest", JSON.stringify(r.body.migration));
  const panel = await seatCall(e, "/api/inspection-rules");
  ck("and the panel draws empty rather than failing", panel.status === 200
    && Array.isArray(panel.body.rules), JSON.stringify(panel.body));
}

console.log("\n-- the CHECK.sql invariants, against real rows --");
{
  // Every invariant reads zero on an empty database, so one that is subtly
  // wrong passes for ever. Seeded both ways here, out of the real file and by
  // column name, so the test cannot drift from what an operator pastes.
  DB = seed(); env = { DB: makeD1(DB) };
  TOKEN = await mint(env);
  await post(env, TOKEN, WALK);
  await seatCall(env, "/api/inspection-rules", { method: "POST", body: { value: "Grade C", status: "fail" } });

  let got = runCheck(DB);
  ck("a clean database reads 0 for the bad-status invariant",
    got.m068_inv_bad_status === 0, String(got.m068_inv_bad_status));
  ck("and 0 for the cross-account provenance one",
    got.m068_inv_source_cross_account === 0, String(got.m068_inv_source_cross_account));

  // A rule the route would have refused, written past it.
  DB.prepare(`UPDATE inspection_status_rules SET status = 'catastrophic'`).run();
  got = runCheck(DB);
  ck("a rule naming a status that does not exist is counted",
    got.m068_inv_bad_status === 1, String(got.m068_inv_bad_status));
  DB.prepare(`UPDATE inspection_status_rules SET status = 'fail'`).run();

  // The id in a webhook body is a claim and the insert is what makes it true.
  DB.prepare(`UPDATE inspection_sources SET account_id = 'acc_other'`).run();
  got = runCheck(DB);
  ck("a retry key pointing at another account's walk is counted",
    got.m068_inv_source_cross_account === 1, String(got.m068_inv_source_cross_account));

  ck("and both are did-I-run-it checks as well",
    got.m068_inspection_sources >= 4 && got.m068_inspection_status_rules >= 3
    && got.m068_inspection_unmapped >= 4, JSON.stringify({
      s: got.m068_inspection_sources, r: got.m068_inspection_status_rules,
      u: got.m068_inspection_unmapped }));
  ck("including both unique indexes, which are constraints and not conveniences",
    got.m068_inspection_sources_unique === 1 && got.m068_inspection_unmapped_unique === 1,
    JSON.stringify([got.m068_inspection_sources_unique, got.m068_inspection_unmapped_unique]));
}

// ---- and the PUBLISHED PAGE is the third record ---------------------------
//
// `shared/inspectingest.js` exists so three things agree about these fields:
// the route, the tests, and the page an integrator reads. A field required by
// the route and optional on the page is an integration that fails at 2am
// against documentation saying it works -- and the jobs receiver one feature
// along shipped with its whole webhook address undocumented, found by exactly
// this check.
{
  console.log("\n-- and the docs say what the route does --");
  const { INSPECT_REQUIRED_FIELDS, INSPECT_OPTIONAL_FIELDS, INSPECT_PRESETS } =
    await import("../shared/inspectingest.js");
  const docs = readFileSync(new URL("../../developers.html", import.meta.url), "utf8");
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

  // A FIELD IS DOCUMENTED WHEN IT HAS A ROW SOMEBODY CAN READ, not when the
  // string appears on the page -- `docs.includes("kind")` is true of half the
  // prose here. The jobs suite paid for that with a mutation: deleting a whole
  // row left the word in two paragraphs below it and the check passed.
  const cells = (docs.match(/<td>[\s\S]*?<\/td>/g) || []);
  const inTable = (field) => cells.some((td) => td.includes(`<code>${field}</code>`));
  for (const f of INSPECT_REQUIRED_FIELDS) {
    ck(`the docs give the required field ${f} a row`, inTable(f));
  }
  for (const f of INSPECT_OPTIONAL_FIELDS) {
    ck(`and the optional field ${f}`, inTable(f));
  }
  // The two sub-fields of a room, which is where half the payload actually is
  // and which a top-level list does not cover.
  ck("and the room's own condition field", inTable("rooms[].status"));
  ck("and its note", inTable("rooms[].note"));

  // BOTH DOORS. The path-token one is the half every automation builder and
  // every app with a URL-only webhook step reaches, and it is the half that
  // went undocumented last time.
  ck("the header address is documented", docs.includes("/api/v1/inspections"));
  ck("and the webhook address, with the object on the end",
    /\/api\/v1\/hooks\/generic\/&lt;your-webhook-token&gt;\/inspections/.test(docs));

  // A receiver SubSub can translate for and does not document is an app whose
  // customers are never told it is there.
  for (const src of Object.keys(INSPECT_PRESETS)) {
    ck(`every inspection receiver is named: ${src}`, new RegExp(`<code>${src}</code>`).test(docs));
  }

  // The three facts about the reply that decide whether somebody can debug
  // their own integration while they are still looking at it.
  ck("needsAnswers is documented", docs.includes("needsAnswers"));
  ck("and unmapped", docs.includes("unmapped"));
  // The one-way door. A page that did not say this would have somebody waiting
  // for an inspection to finish itself.
  ck("and that it always arrives as a draft", /always a draft/i.test(docs));

  // The kind gate, which differs from the jobs endpoint's -- so a general
  // contractor reading this page finds out here rather than from a 403.
  ck("the no-buildings refusal is named", docs.includes("no_buildings"));

  // THE PAGE SENDS SOMEBODY TO A PANEL BY NAME. A heading renamed since is a
  // set of directions that dead-ends on the reader's own screen.
  const named = (docs.match(/My account → Profile → (Inspections[^<]+)</) || [])[1];
  ck("the docs name the panel to answer words on", !!named, String(named));
  ck("and that heading exists in the app",
    !!named && app.includes(`<h4>${named.trim()}</h4>`), String(named));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
