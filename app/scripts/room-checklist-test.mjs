// The checklist inside each inspection room, and the move-in compared with
// the move-out, through the real Worker.
//
// Asked for as: every room carries the industry checklist (the Zillow move-in /
// move-out form), the move-in is kept as a living document, and the move-out
// records what changed and what it costs. What is pinned here is what a later
// pass would otherwise undo:
//
//   each room's list follows its name, and the keys match across inspections;
//   a cost is a move-out thing and is refused on a move-in;
//   the move-out reads the move-in LIVE while it is a draft, and the reading is
//   STAMPED when it is finished, so editing the move-in afterwards moves nothing;
//   "changed" means worse than the move-in said, not merely not good;
//   a move-out starts with the move-in's rooms, hand-added ones included;
//   a database without 096 still opens and names the file.
//
//   node --no-warnings scripts/room-checklist-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { CHECKLISTS, checklistFor, checklistKind, checklistRows, itemChanged, checklistTally,
  parseCost, ITEM_CONDITION_ORDER } from "../shared/roomchecklist.js";
import { runCheck } from "./lib/check-sql.mjs";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");

console.log("\n-- the lists --");
{
  ck("a bathroom carries the toilet's three parts",
    ["toilet-bowl", "toilet-seat", "toilet-flush"].every((k) => checklistFor("Bathroom 2").some((i) => i.key === k)));
  ck("a half bath has no tub", !checklistFor("Half bath").some((i) => i.key === "tub-shower")
    && checklistFor("Bathroom 1").some((i) => i.key === "tub-shower"));
  ck("the kitchen carries the stove, the fridge and the dishwasher",
    ["stove-oven-burners", "refrigerator-interior-parts", "dishwasher-controls"]
      .every((k) => checklistFor("Kitchen").some((i) => i.key === k)));
  ck("bedrooms, living rooms and entries follow their names",
    checklistKind("Bedroom 3") === "bedroom" && checklistKind("Living and sleeping area") === "living"
      && checklistKind("Hallway") === "entry" && checklistKind("Walk-in closet") === "closet");
  ck("a room that is one thing already gets no list", checklistFor("Walls and floors").length === 0);
  ck("an unknown room still gets floor, walls and ceiling",
    checklistFor("Sunroom").map((i) => i.label).slice(0, 3).join() === "Floor,Walls,Ceiling");
  ck("keys are unique within every list",
    Object.values(CHECKLISTS).every((l) => new Set(l.map((i) => i.key)).size === l.length));
  ck("seven conditions, good first", ITEM_CONDITION_ORDER.length === 7 && ITEM_CONDITION_ORDER[0] === "ok");

  const rows = checklistRows("Bedroom 1", [{ key: "floor", condition: "nr" }, { key: "old-thing", label: "Old thing", condition: "nc" }],
    { floor: { condition: "nr" } });
  ck("a recorded item the list no longer has is kept", rows.some((r) => r.key === "old-thing"));
  ck("damage the move-in already recorded is not a change", !itemChanged(rows.find((r) => r.key === "floor")));
  ck("damage the move-in did not record is a change",
    itemChanged({ condition: "nr", moveIn: { condition: "ok" } }) && itemChanged({ condition: "nc", moveIn: null }));
  ck("good is never a change", !itemChanged({ condition: "ok", moveIn: { condition: "nr" } }));
  ck("a tally adds the costs", checklistTally([{ checklist: [{ condition: "nr", costCents: 1500 }, { condition: null, costCents: 250 }] }]).costCents === 1750);
  ck("a cost is read as dollars, blank is none and junk is refused",
    parseCost("$1,250.50") === 125050 && parseCost("") === null && parseCost("12.345") === undefined);
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
  return { db, env: { DB: makeD1(db) } };
};
const call = (env, path, { method = "GET", body } = {}) =>
  worker.fetch(new Request(`https://api.subsub.work${path}`, {
    method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json", "X-User-Id": "u_admin", "X-Account-Id": "acc1" },
  }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];
const room = (rooms, name) => (rooms || []).find((r) => r.name === name);
const item = (r, key) => (r?.checklist || []).find((i) => i.key === key);
const finish = async (env, id, rooms) => {
  for (const r of rooms) await call(env, `/api/inspections/${id}/rooms/${r.id}`, { method: "PATCH", body: { status: "ok" } });
  return json(await call(env, `/api/inspections/${id}`, { method: "PATCH", body: { finish: true } }));
};

try {
  console.log("\n-- recording an item --");
  const { db, env } = seed();
  const [, mi] = await json(await call(env, "/api/inspections", { method: "POST",
    body: { kind: "move_in", propertyId: "p_press", unit: "10B", unitLayout: "1br-1ba" } }));
  ck("every room arrives with its list", mi.rooms.every((r) => Array.isArray(r.checklist))
    && item(room(mi.rooms, "Bathroom 1"), "toilet-seat"), JSON.stringify(mi.rooms.map((r) => r.checklist?.length)));
  const bed = room(mi.rooms, "Bedroom 1");
  // A hand-added room the layout would not put back.
  await call(env, `/api/inspections/${mi.id}/rooms`, { method: "POST", body: { name: "Balcony" } });

  let [s, r] = await json(await call(env, `/api/inspections/${mi.id}/rooms/${bed.id}/items/floor`, { method: "PUT",
    body: { condition: "nsc", note: "Small stain by the window" } }));
  ck("a condition and a note are kept", s === 200 && item(room(r.rooms, "Bedroom 1"), "floor")?.condition === "nsc"
    && /stain/.test(item(room(r.rooms, "Bedroom 1"), "floor").note), String(s));
  [s] = await json(await call(env, `/api/inspections/${mi.id}/rooms/${bed.id}/items/floor`, { method: "PUT", body: { costCents: 500 } }));
  ck("a cost on a move-in is refused", s === 400);
  [s] = await json(await call(env, `/api/inspections/${mi.id}/rooms/${bed.id}/items/tub-shower`, { method: "PUT", body: { condition: "ok" } }));
  ck("an item the room's list does not have is refused", s === 400);
  [s] = await json(await call(env, `/api/inspections/${mi.id}/rooms/${bed.id}/items/walls`, { method: "PUT", body: { condition: "gross" } }));
  ck("a condition the screen cannot draw is refused", s === 400);
  [, r] = await json(await call(env, `/api/inspections/${mi.id}/rooms/${bed.id}/items/all-good`, { method: "POST" }));
  const bedNow = room(r.rooms, "Bedroom 1");
  ck("all good marks only what nobody answered", item(bedNow, "floor").condition === "nsc"
    && item(bedNow, "walls").condition === "ok" && bedNow.checklist.every((i) => i.condition));
  [, r] = await json(await call(env, `/api/inspections/${mi.id}/rooms/${bed.id}/items/ceiling`, { method: "PUT", body: { condition: null } }));
  const gone = db.prepare(`SELECT COUNT(*) n FROM inspection_items WHERE room_id = ? AND item_key = 'ceiling'`).get(bed.id).n;
  ck("clearing an item leaves no empty row behind", gone === 0 && item(room(r.rooms, "Bedroom 1"), "ceiling").condition === null);
  const kit = room(mi.rooms, "Kitchen");
  await call(env, `/api/inspections/${mi.id}/rooms/${kit.id}/items/stove-oven-burners`, { method: "PUT", body: { condition: "nr", note: "Back left burner dead" } });

  console.log("\n-- the move-out --");
  const [, mo] = await json(await call(env, "/api/inspections", { method: "POST",
    body: { kind: "move_out", propertyId: "p_press", unit: "10b", unitLayout: "1br-1ba" } }));
  ck("it starts with the move-in's rooms, the hand-added one included",
    !!room(mo.rooms, "Balcony") && mo.carried.includes("Balcony"), JSON.stringify(mo.carried));
  ck("it knows which move-in it is compared with", mo.rooms.every((x) => x.comparedTo === mi.id));
  const obed = room(mo.rooms, "Bedroom 1");
  ck("each item carries what the move-in said", item(obed, "floor").moveIn?.condition === "nsc"
    && /stain/.test(item(obed, "floor").moveIn.note));
  ck("and an item the move-in did not answer says so", item(obed, "ceiling").moveIn === null);

  [, r] = await json(await call(env, `/api/inspections/${mo.id}/rooms/${obed.id}/items/walls`, { method: "PUT",
    body: { condition: "np", note: "Two large scuffs", costCents: 18000 } }));
  ck("a move-out keeps a cost", item(room(r.rooms, "Bedroom 1"), "walls").costCents === 18000);
  ck("and that is a change, because the move-in said good", itemChanged(item(room(r.rooms, "Bedroom 1"), "walls")));
  [, r] = await json(await call(env, `/api/inspections/${mo.id}/rooms/${obed.id}/items/floor`, { method: "PUT", body: { condition: "nsc" } }));
  ck("the stain the move-in recorded is not a change", !itemChanged(item(room(r.rooms, "Bedroom 1"), "floor")));

  // THE MOVE-IN IS A LIVING DOCUMENT: an edit to it shows on the draft move-out.
  await call(env, `/api/inspections/${mi.id}/rooms/${bed.id}/items/walls`, { method: "PUT", body: { condition: "nsp" } });
  [, r] = await json(await call(env, `/api/inspections/${mo.id}`));
  ck("an edit to the move-in shows on the draft move-out", item(room(r.rooms, "Bedroom 1"), "walls").moveIn?.condition === "nsp");

  console.log("\n-- finished, it stops moving --");
  const [fs] = await finish(env, mo.id, mo.rooms);
  ck("the move-out finishes", fs === 200, String(fs));
  const stamped = db.prepare(`SELECT COUNT(*) n FROM inspection_items WHERE movein_from = ?`).get(mi.id).n;
  ck("the move-in's reading is stamped onto it", stamped >= 3, String(stamped));
  // Edit the move-in AFTER the move-out was finished.
  await call(env, `/api/inspections/${mi.id}/rooms/${bed.id}/items/walls`, { method: "PUT", body: { condition: "rp" } });
  await call(env, `/api/inspections/${mi.id}/rooms/${kit.id}/items/fan`, { method: "PUT", body: { condition: "nr" } });
  [, r] = await json(await call(env, `/api/inspections/${mo.id}`));
  ck("a later edit to the move-in does not move the finished move-out",
    item(room(r.rooms, "Bedroom 1"), "walls").moveIn?.condition === "nsp"
      && item(room(r.rooms, "Kitchen"), "fan").moveIn === null,
    JSON.stringify(item(room(r.rooms, "Bedroom 1"), "walls")));
  ck("and the burner the move-in recorded is still there",
    item(room(r.rooms, "Kitchen"), "stove-oven-burners").moveIn?.condition === "nr");
  [s] = await json(await call(env, `/api/inspections/${mo.id}/rooms/${obed.id}/items/walls`, { method: "PUT", body: { condition: "ok" } }));
  ck("a finished move-out cannot be written to", s === 409);

  console.log("\n-- another unit is not this one --");
  const [, other] = await json(await call(env, "/api/inspections", { method: "POST",
    body: { kind: "move_out", propertyId: "p_press", unit: "3A", unitLayout: "1br-1ba" } }));
  ck("a move-out of another unit has nothing to compare with",
    other.rooms.every((x) => x.comparedTo === null && x.checklist.every((i) => !("moveIn" in i) || i.moveIn === null))
      && other.carried.length === 0);

  console.log("\n-- the invariant --");
  const ok = runCheck(db).m096_inv_bad_item;
  db.prepare(`INSERT INTO inspection_items (id, room_id, item_key, condition) VALUES ('bad1', ?, 'floor-x', 'gross')`).run(bed.id);
  const bad = runCheck(db).m096_inv_bad_item;
  ck("m096_inv_bad_item reads 0 on good rows and counts a bad one", ok === 0 && bad === 1, `${ok} -> ${bad}`);
  ck("and the did-I-run-it check sees the table", runCheck(db).m096_inspection_items >= 1);

  console.log("\n-- a database without 096 --");
  {
    const { db: db2, env: env2 } = seed();
    db2.exec(`DROP TABLE inspection_items`);
    const [s2, x] = await json(await call(env2, "/api/inspections", { method: "POST",
      body: { kind: "move_in", propertyId: "p_press", unit: "1", unitLayout: "studio" } }));
    ck("it still starts, with the lists drawn and the file named",
      s2 === 201 && x.rooms[0].checklistMigration === "096_inspection_items" && x.rooms[0].checklist.length > 0, String(s2));
    const [s3, y] = await json(await call(env2, `/api/inspections/${x.id}/rooms/${x.rooms[0].id}/items/floor`, { method: "PUT", body: { condition: "ok" } }));
    ck("and saving an item names the file", s3 === 503 && y.migration === "096_inspection_items");
    const [s4] = await finish(env2, x.id, x.rooms);
    ck("and it still finishes", s4 === 200);
  }
} catch (e) {
  console.error(e); fail++;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
