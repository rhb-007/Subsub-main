// A room's status is worked out from its checklist; photos belong to items;
// and a checkup is a third kind of walk. Through the real Worker.
//
// Asked for as: "the top 3 status should be automatically selected by the
// system if anything within the checklist specifies one of these (it's a
// summary of the room), they should not be selectable", "allow you to take
// photos within each checklist item and automate the description", and "an
// inspection that is neither a move in or move out, just a 1 off". Pinned:
//
//   repair or replace makes Damage, any other issue makes Needs work, all good
//   makes OK, part-way and all good so far stays not checked;
//   taking the last mark off puts the room back to not checked;
//   once the checklist has said anything, a picked status is refused;
//   a photo can be filed under an item on the room's own list and no other;
//   a database without 097 keeps the photo, on the room, and says so;
//   the drafting call names the item a photo was taken of;
//   a checkup is created, raises a job that says it is a checkup, and suggests
//   the tenant lets the crew in; a move-in raises one too;
//   the job's scope names the checklist items that flagged each room.
//
//   node --no-warnings scripts/room-status-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { derivedRoomStatus, flaggedItems, checklistTally, itemChanged, ITEM_CONDITION_ORDER } from "../shared/roomchecklist.js";
import { runCheck } from "./lib/check-sql.mjs";
import { INSPECTION_KINDS, suggestedAccessForInspection, inspectionJobTitle } from "../shared/inspection.js";
import { inspectKindFor } from "../shared/inspectingest.js";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (!u.startsWith("https://claude.test")) return realFetch(url, init);
  const body = JSON.parse(init.body);
  sent.push(body);
  const n = body.messages[0].content.filter((x) => x.type === "image").length;
  return new Response(JSON.stringify({
    content: [{ type: "text", text: JSON.stringify({ photos: Array.from({ length: n }, (_, i) => ({ ref: i + 1, draft: "Scuff on the wall.", unclear: false })) }) }],
    usage: { input_tokens: 10, output_tokens: 10 },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
};

const { default: worker } = await import("../worker/index.js");

console.log("\n-- the rule --");
{
  const row = (condition) => ({ key: Math.random().toString(36), condition });
  ck("nothing marked decides nothing", derivedRoomStatus([row(null), row(null)]) === null);
  ck("needs repair is damage", derivedRoomStatus([row("nr"), row(null)]) === "fail");
  ck("needs replacing is damage, even beside a cleaning issue", derivedRoomStatus([row("nc"), row("rp")]) === "fail");
  ck("painting or cleaning is needs work", derivedRoomStatus([row("np"), row("ok")]) === "follow_up"
    && derivedRoomStatus([row("nsc")]) === "follow_up");
  ck("every item good is OK", derivedRoomStatus([row("ok"), row("ok")]) === "ok");
  ck("part-way and all good so far is still not checked", derivedRoomStatus([row("ok"), row(null)]) === "unchecked");
  ck("doesn't apply is offered last", ITEM_CONDITION_ORDER.at(-1) === "na");
  ck("doesn't apply counts as checked: good plus not-there is OK", derivedRoomStatus([row("ok"), row("na")]) === "ok");
  ck("doesn't apply alone never flags a room", derivedRoomStatus([row("na"), row(null)]) === "unchecked"
    && derivedRoomStatus([row("na"), row("na")]) === "ok");
  ck("doesn't apply beside an issue leaves the issue deciding", derivedRoomStatus([row("na"), row("np")]) === "follow_up");
  ck("doesn't apply is not a flagged item", flaggedItems([row("na"), row("nr")]).length === 1);
  ck("doesn't apply is answered and not flagged in the tally",
    (() => { const t = checklistTally([{ checklist: [row("na"), row(null)] }]); return t.answered === 1 && t.flagged === 0; })());
  ck("doesn't apply on a move-out is not a change", itemChanged({ condition: "na", moveIn: { condition: "ok" } }) === false);
  ck("a checkup is a third kind with its own tenant label",
    INSPECTION_KINDS.checkup?.label === "Checkup" && INSPECTION_KINDS.checkup.who === "Tenant");
  ck("a checkup suggests the tenant lets the crew in", suggestedAccessForInspection("checkup") === "tenant");
  ck("a job title says which inspection it came from",
    inspectionJobTitle({ kind: "checkup", unit: "4" }) === "Checkup inspection work — unit 4"
      && inspectionJobTitle({ kind: "move_in", unit: "4" }).startsWith("Move-in inspection"));
  ck("an inspection app's routine walk is a checkup, and a bare 'inspection' is not",
    inspectKindFor("Routine") === "checkup" && inspectKindFor("check-up") === "checkup" && inspectKindFor("inspection") === null);
}

const BASE = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const seed = () => {
  const db = freshDb({ base: BASE, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,kind,subdomain) VALUES ('acc1','Sound Property Management','property_manager','soundpm');
    INSERT INTO users(id,name,email) VALUES ('u_admin','Christopher Lane','chris@soundpm.test');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES ('m_admin','u_admin','acc1','admin');
    INSERT INTO properties(id,account_id,name,address,city,zip,owner_account_id) VALUES
      ('p_press','acc1','Press Apartments','1620 Belmont Ave','Seattle','98122','acc1');
  `);
  return { db, env: { DB: makeD1(db), FILES: { put: async () => {}, get: async () => ({ body: "x" }) },
    ANTHROPIC_API_KEY: "sk-test", ANTHROPIC_API_BASE: "https://claude.test/v1" } };
};
const call = (env, path, { method = "GET", body } = {}) =>
  worker.fetch(new Request(`https://api.subsub.work${path}`, {
    method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json", "X-User-Id": "u_admin", "X-Account-Id": "acc1" },
  }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];
const byName = (rooms, n) => (rooms || []).find((r) => r.name === n);
const mark = (env, id, room, key, condition) =>
  call(env, `/api/inspections/${id}/rooms/${room.id}/items/${key}`, { method: "PUT", body: { condition } }).then(json);

try {
  const { db, env } = seed();
  const [st, ins] = await json(await call(env, "/api/inspections", { method: "POST",
    body: { kind: "checkup", propertyId: "p_press", unit: "4", tenantName: "Ricard Bond" } }));
  ck("a checkup is created", st === 201 && ins.kind === "checkup", `${st} ${JSON.stringify(ins).slice(0, 120)}`);
  const id = ins.id;
  const [, a1] = await json(await call(env, `/api/inspections/${id}/rooms`, { method: "POST", body: { name: "Bedroom 1" } }));
  const [, a2] = await json(await call(env, `/api/inspections/${id}/rooms`, { method: "POST", body: { name: "Keys handed over" } }));
  const bed = byName(a2.rooms, "Bedroom 1"), keys = byName(a2.rooms, "Keys handed over");
  void a1;

  console.log("\n-- the status follows the items --");
  let [, r] = await mark(env, id, bed, "walls", "np");
  ck("needs painting makes the room Needs work", byName(r.rooms, "Bedroom 1").status === "follow_up",
    byName(r.rooms, "Bedroom 1").status);
  [, r] = await mark(env, id, bed, "floor", "nr");
  ck("needs repair makes it Damage", byName(r.rooms, "Bedroom 1").status === "fail");
  [, r] = await mark(env, id, bed, "floor", null);
  ck("taking the repair off brings it back to Needs work", byName(r.rooms, "Bedroom 1").status === "follow_up");
  [, r] = await mark(env, id, bed, "walls", null);
  ck("taking the last mark off puts it back to not checked", byName(r.rooms, "Bedroom 1").status === "unchecked",
    byName(r.rooms, "Bedroom 1").status);
  [, r] = await mark(env, id, bed, "walls", "ok");
  ck("one item good of many is still not checked", byName(r.rooms, "Bedroom 1").status === "unchecked");
  [, r] = await json(await call(env, `/api/inspections/${id}/rooms/${bed.id}/items/all-good`, { method: "POST" }));
  ck("marking the rest good makes it OK", byName(r.rooms, "Bedroom 1").status === "ok");

  console.log("\n-- a picked status --");
  let [s1, p1] = await json(await call(env, `/api/inspections/${id}/rooms/${bed.id}`, { method: "PATCH", body: { status: "fail" } }));
  ck("refused once the checklist has said anything", s1 === 409 && p1.error === "status_from_checklist", `${s1} ${p1.error}`);
  [s1] = await json(await call(env, `/api/inspections/${id}/rooms/${keys.id}`, { method: "PATCH", body: { status: "ok" } }));
  ck("taken on a room with no checklist", s1 === 200);

  console.log("\n-- photos on items --");
  const pkey = (n) => `acc1/report-photo/${n}.jpg`;
  let [s2, ph] = await json(await call(env, `/api/inspections/${id}/rooms/${bed.id}/photos`, { method: "POST",
    body: { itemKey: "walls", photos: [{ key: pkey("a"), type: "image/jpeg", name: "a.jpg" }, { key: pkey("b"), type: "image/jpeg", name: "b.jpg" }] } }));
  const bp = byName(ph.rooms, "Bedroom 1").photos;
  ck("photos are filed under the item", s2 === 200 && bp.length === 2 && bp.every((p) => p.itemKey === "walls"), JSON.stringify(bp));
  ck("the reply names the new photos, in the order chosen", JSON.stringify(ph.added) === JSON.stringify(bp.map((p) => p.id)),
    `${ph.added} vs ${bp.map((p) => p.id)}`);
  [s2, ph] = await json(await call(env, `/api/inspections/${id}/rooms/${bed.id}/photos`, { method: "POST",
    body: { itemKey: "dishwasher-controls", photos: [{ key: pkey("c"), type: "image/jpeg" }] } }));
  ck("an item the room does not have is refused", s2 === 400 && ph.error === "not_on_checklist");
  [s2, ph] = await json(await call(env, `/api/inspections/${id}/rooms/${bed.id}/photos`, { method: "POST",
    body: { photos: [{ key: pkey("d"), type: "image/jpeg" }] } }));
  ck("a photo with no item is the room's", byName(ph.rooms, "Bedroom 1").photos.some((p) => p.itemKey === null));

  sent.length = 0;
  const [s3] = await json(await call(env, `/api/inspections/${id}/rooms/${bed.id}/drafts`, { method: "POST",
    body: { photos: [{ id: bp[0].id, data: "QUJD" }, { id: ph.added[0], data: "QUJD" }] } }));
  const texts = (sent[0]?.messages?.[0]?.content || []).filter((x) => x.type === "text").map((x) => x.text);
  ck("drafting names the item a photo was taken of", s3 === 200 && texts[0] === "Photo 1 (of: Walls):" && texts[1] === "Photo 2:",
    `${s3} ${JSON.stringify(texts.slice(0, 2))}`);

  console.log("\n-- a database without 097 --");
  db.exec(`ALTER TABLE inspection_photos DROP COLUMN item_key`);
  [s2, ph] = await json(await call(env, `/api/inspections/${id}/rooms/${bed.id}/photos`, { method: "POST",
    body: { itemKey: "walls", photos: [{ key: pkey("e"), type: "image/jpeg" }] } }));
  ck("the photo is kept on the room and the file is named",
    s2 === 200 && ph.itemMigration === "097_item_photos" && ph.added?.length === 1, `${s2} ${JSON.stringify(ph).slice(0, 160)}`);
  db.exec(`ALTER TABLE inspection_photos ADD COLUMN item_key TEXT`);

  console.log("\n-- raising work from a checkup and a move-in --");
  [, r] = await mark(env, id, bed, "walls", "np");
  await call(env, `/api/inspections/${id}/rooms/${bed.id}/items/walls`, { method: "PUT", body: { note: "scuffed by the door" } });
  const [s4, job] = await json(await call(env, `/api/inspections/${id}/job`, { method: "POST", body: { trades: ["painting"] } }));
  const jrow = db.prepare(`SELECT title, scope, access FROM jobs WHERE id = ?`).get(job.jobId || job.job?.id || "");
  ck("a checkup raises a job", s4 === 201 || s4 === 200, `${s4} ${JSON.stringify(job).slice(0, 160)}`);
  ck("the job says it came from a checkup", /^Checkup inspection work — unit 4/.test(jrow?.title || ""), jrow?.title);
  ck("its scope names the item that flagged the room",
    /From the checkup inspection of unit 4/.test(jrow?.scope || "") && /- Walls: Needs painting — scuffed by the door/.test(jrow?.scope || ""),
    jrow?.scope);
  ck("the tenant is suggested to let the crew in", jrow?.access === "tenant", jrow?.access);

  const [, mi] = await json(await call(env, "/api/inspections", { method: "POST",
    body: { kind: "move_in", propertyId: "p_press", unit: "7" } }));
  const [, mr] = await json(await call(env, `/api/inspections/${mi.id}/rooms`, { method: "POST", body: { name: "Kitchen" } }));
  const kit = byName(mr.rooms, "Kitchen");
  await mark(env, mi.id, kit, "sink-plumbing", "nr");
  const [s5] = await json(await call(env, `/api/inspections/${mi.id}/job`, { method: "POST", body: { trades: ["plumbing"] } }));
  const mrow = db.prepare(`SELECT title FROM jobs WHERE title LIKE 'Move-in%'`).get();
  ck("a move-in raises a job that says so", (s5 === 201 || s5 === 200) && /^Move-in inspection work — unit 7/.test(mrow?.title || ""), mrow?.title);
} catch (e) {
  fail++; console.log("FAIL  threw --", e?.stack || e);
}

console.log("\n-- doesn't apply --");
try {
  const { db, env } = seed();
  const [, mo] = await json(await call(env, "/api/inspections", { method: "POST",
    body: { kind: "move_out", propertyId: "p_press", unit: "9" } }));
  const [, rr] = await json(await call(env, `/api/inspections/${mo.id}/rooms`, { method: "POST", body: { name: "Bedroom 1" } }));
  const bed = byName(rr.rooms, "Bedroom 1");
  let [s, r] = await mark(env, mo.id, bed, "walls", "na");
  ck("it is taken", s === 200 && byName(r.rooms, "Bedroom 1").checklist.find((i) => i.key === "walls")?.condition === "na", s);
  ck("on its own it does not flag the room", byName(r.rooms, "Bedroom 1").status === "unchecked", byName(r.rooms, "Bedroom 1").status);
  [s, r] = await json(await call(env, `/api/inspections/${mo.id}/rooms/${bed.id}/items/walls`, { method: "PUT", body: { costCents: 5000 } }));
  ck("a cost on it is refused", s === 400 && r.error === "cost_not_applicable", `${s} ${r.error}`);
  await mark(env, mo.id, bed, "floor", "nr");
  await call(env, `/api/inspections/${mo.id}/rooms/${bed.id}/items/floor`, { method: "PUT", body: { costCents: 12000 } });
  [s, r] = await mark(env, mo.id, bed, "floor", "na");
  const floor = byName(r.rooms, "Bedroom 1").checklist.find((i) => i.key === "floor");
  ck("marking an item that had a cost doesn't apply takes the cost off", floor?.condition === "na" && floor?.costCents == null,
    JSON.stringify(floor));
  [, r] = await json(await call(env, `/api/inspections/${mo.id}/rooms/${bed.id}/items/all-good`, { method: "POST" }));
  const room = byName(r.rooms, "Bedroom 1");
  ck("mark the rest good leaves it alone", room.checklist.find((i) => i.key === "walls")?.condition === "na");
  ck("good plus doesn't apply makes the room OK", room.status === "ok", room.status);
  ck("the invariant accepts it", Number(runCheck(db).m096_inv_bad_item) === 0, runCheck(db).m096_inv_bad_item);
  db.prepare(`UPDATE inspection_items SET cost_cents = 100 WHERE item_key = 'walls'`).run();
  ck("the invariant counts one carrying a cost", Number(runCheck(db).m096_inv_bad_item) === 1, runCheck(db).m096_inv_bad_item);
} catch (e) {
  fail++; console.log("FAIL  threw --", e?.stack || e);
}

globalThis.fetch = realFetch;
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
