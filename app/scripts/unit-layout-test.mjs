// A unit's layout writes its rooms, through the real Worker.
//
// Asked for as: pick the unit type (studio, 1 BR x 1 BA, ...) and every room
// it implies is added, so the manager only changes what is different. What is
// pinned here is what a later pass would otherwise undo:
//
//   the list holds the combinations people have and not every arithmetic one;
//   rooms are numbered, so a 1 BR -> 2 BR adds Bedroom 2 beside Bedroom 1;
//   changing the layout takes off only rooms nobody has recorded anything in;
//   a database without 095 still gets the rooms and is told the type was not
//   kept.
//
//   node --no-warnings scripts/unit-layout-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { UNIT_LAYOUTS, isUnitLayout, layoutRooms, layoutChange, layoutLabel,
  layoutChangeText } from "../shared/unitlayout.js";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");

console.log("\n-- the layouts --");
{
  const ids = UNIT_LAYOUTS.map((l) => l.id);
  ck("a studio is offered", isUnitLayout("studio"));
  ck("each combination the request named is offered",
    ["1br-1ba", "1br-2ba", "2br-1ba", "2br-2ba", "2br-3ba"].every(isUnitLayout), ids.join(","));
  ck("half baths are offered", isUnitLayout("2br-1.5ba") && isUnitLayout("3br-2.5ba"));
  ck("up to five bedrooms", isUnitLayout("5br-3ba") && !isUnitLayout("6br-3ba"));
  ck("never more than one bathroom past the bedrooms",
    !isUnitLayout("1br-2.5ba") && !isUnitLayout("1br-3ba") && isUnitLayout("2br-3ba"));
  ck("ids are unique", new Set(ids).size === ids.length);
  ck("a label reads as asked", layoutLabel("2br-1.5ba") === "2 BR × 1.5 BA", layoutLabel("2br-1.5ba"));

  const two = layoutRooms("2br-1.5ba");
  ck("a 2 BR x 1.5 BA is the entry, the shared spaces, both bedrooms and both baths",
    JSON.stringify(two) === JSON.stringify(["Entry", "Living room", "Kitchen", "Hallway",
      "Bedroom 1", "Bedroom 2", "Bathroom 1", "Half bath"]), JSON.stringify(two));
  ck("one bedroom is still numbered, so a second can sit beside it",
    layoutRooms("1br-1ba").includes("Bedroom 1") && !layoutRooms("1br-1ba").includes("Bedroom"));
  ck("a studio has no bedroom and one bathroom",
    !layoutRooms("studio").some((n) => /^Bedroom/.test(n)) && layoutRooms("studio").includes("Bathroom 1"));
  ck("an unknown layout has no rooms", layoutRooms("7br-9ba").length === 0);

  // THE REMOVAL RULE, in the pure function, both directions.
  const rooms = [
    { id: "a", name: "Bedroom 3", status: "unchecked", note: "", photos: [] },
    { id: "b", name: "Bathroom 2", status: "ok", note: "", photos: [] },
    { id: "c", name: "Balcony", status: "unchecked", note: "", photos: [] },
  ];
  const plan = layoutChange(rooms, "3br-2ba", "1br-1ba");
  ck("an untouched room the new layout lacks is taken off", plan.remove.includes("a"));
  ck("a room somebody walked is kept", !plan.remove.includes("b") && plan.kept.includes("Bathroom 2"));
  ck("a room nobody's layout put there is left alone", !plan.remove.includes("c"));
  ck("with no previous layout nothing is removed",
    layoutChange(rooms, null, "1br-1ba").remove.length === 0);
  ck("a photo alone is enough to keep a room",
    layoutChange([{ id: "p", name: "Bedroom 3", status: "unchecked", photoCount: 2 }], "3br-1ba", "1br-1ba").remove.length === 0);
  ck("the room limit is respected and said",
    layoutChange([], null, "5br-4ba", { max: 3 }).add.length === 3
      && layoutChange([], null, "5br-4ba", { max: 3 }).skipped > 0);
  ck("the sentence names what was taken off and kept",
    /Bedroom 3/.test(layoutChangeText({ removed: ["Bedroom 3"], kept: ["Bathroom 2"], added: [] }))
      && /Bathroom 2/.test(layoutChangeText({ removed: ["Bedroom 3"], kept: ["Bathroom 2"], added: [] })));
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
const names = (rooms) => (rooms || []).map((r) => r.name);

try {
  console.log("\n-- starting one with a layout --");
  {
    const { env } = seed();
    const [s, insp] = await json(await call(env, "/api/inspections", { method: "POST",
      body: { kind: "move_out", propertyId: "p_press", unit: "10B", unitLayout: "2br-1ba" } }));
    ck("it starts", s === 201, String(s));
    ck("with the layout's rooms already on it, in walking order",
      JSON.stringify(names(insp.rooms)) === JSON.stringify(layoutRooms("2br-1ba")), JSON.stringify(names(insp.rooms)));
    ck("every one unchecked", insp.rooms.every((r) => r.status === "unchecked"));
    ck("the layout is kept on the inspection", insp.unitLayout === "2br-1ba");
    ck("and the reply says what was added", insp.layout?.added?.length === layoutRooms("2br-1ba").length);

    const [s2] = await json(await call(env, "/api/inspections", { method: "POST",
      body: { kind: "move_out", propertyId: "p_press", unitLayout: "9br-9ba" } }));
    ck("a layout SubSub does not know is refused", s2 === 400, String(s2));

    const [, plain] = await json(await call(env, "/api/inspections", { method: "POST",
      body: { kind: "move_in", propertyId: "p_press", unit: "3A" } }));
    ck("and with none, it starts empty as before", (plain.rooms || []).length === 0 && plain.unitLayout === null);
  }

  console.log("\n-- changing it --");
  {
    const { env } = seed();
    const [, insp] = await json(await call(env, "/api/inspections", { method: "POST",
      body: { kind: "move_out", propertyId: "p_press", unit: "10B", unitLayout: "3br-2ba" } }));
    const byName = Object.fromEntries(insp.rooms.map((r) => [r.name, r.id]));
    // Walk Bedroom 3, leave Bathroom 2 untouched, and add a room by hand.
    await call(env, `/api/inspections/${insp.id}/rooms/${byName["Bedroom 3"]}`, { method: "PATCH", body: { status: "ok" } });
    await call(env, `/api/inspections/${insp.id}/rooms`, { method: "POST", body: { name: "Balcony" } });

    const [s, after] = await json(await call(env, `/api/inspections/${insp.id}`, { method: "PATCH",
      body: { unitLayout: "1br-1ba" } }));
    ck("the change goes through", s === 200, String(s));
    const now = names(after.rooms);
    ck("an untouched room the new layout lacks is gone", !now.includes("Bathroom 2") && !now.includes("Bedroom 2"), now.join(","));
    ck("a room somebody walked stays", now.includes("Bedroom 3"));
    ck("a room added by hand stays", now.includes("Balcony"));
    ck("the reply names both", after.layout.removed.includes("Bathroom 2") && after.layout.kept.includes("Bedroom 3"),
      JSON.stringify(after.layout));
    ck("the layout's rooms lead, in walking order",
      JSON.stringify(now.slice(0, 5)) === JSON.stringify(layoutRooms("1br-1ba")), now.join(","));

    const [, up] = await json(await call(env, `/api/inspections/${insp.id}`, { method: "PATCH",
      body: { unitLayout: "2br-1ba" } }));
    const up2 = names(up.rooms);
    ck("going up adds only what is missing", up.layout.added.join(",") === "Hallway,Bedroom 2", up.layout.added.join(","));
    ck("and no room appears twice", new Set(up2.map((n) => n.toLowerCase())).size === up2.length, up2.join(","));

    const [s3] = await json(await call(env, `/api/inspections/${insp.id}`, { method: "PATCH", body: { unitLayout: "nope" } }));
    ck("a bad layout on a change is refused", s3 === 400);

    const [, cleared] = await json(await call(env, `/api/inspections/${insp.id}`, { method: "PATCH", body: { unitLayout: null } }));
    ck("clearing it keeps every room somebody touched", names(cleared.rooms).includes("Bedroom 3") && cleared.unitLayout === null);
  }

  console.log("\n-- a finished one does not move --");
  {
    const { db, env } = seed();
    const [, insp] = await json(await call(env, "/api/inspections", { method: "POST",
      body: { kind: "move_out", propertyId: "p_press", unitLayout: "studio" } }));
    db.prepare(`UPDATE inspections SET status = 'finished' WHERE id = ?`).run(insp.id);
    const [s] = await json(await call(env, `/api/inspections/${insp.id}`, { method: "PATCH", body: { unitLayout: "1br-1ba" } }));
    ck("changing the layout of a finished inspection is refused", s === 409, String(s));
  }

  console.log("\n-- a database without 095 --");
  {
    const { db, env } = seed();
    db.exec(`ALTER TABLE inspections DROP COLUMN unit_layout`);
    const [s, insp] = await json(await call(env, "/api/inspections", { method: "POST",
      body: { kind: "move_out", propertyId: "p_press", unitLayout: "1br-1ba" } }));
    ck("it still starts", s === 201, String(s));
    ck("and the rooms are still added", names(insp.rooms).length === layoutRooms("1br-1ba").length);
    ck("and it says the type was not kept, naming the file",
      insp.layout?.stored === false && insp.layout?.migration === "095_unit_layout", JSON.stringify(insp.layout));
  }
} catch (e) {
  console.error(e); fail++;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
