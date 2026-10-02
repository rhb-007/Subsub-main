// AI DRAFT DESCRIPTIONS OF AN INSPECTION PHOTOGRAPH, through the real Worker.
//
// Stubbed at `fetch`, which is the boundary `ANTHROPIC_API_BASE` exists for:
// what gets asserted is the request SHAPE, which is the only place several
// of the claims this feature makes are checkable at all. `STRIPE_API_BASE`
// was added for exactly this and sat unused for years; this one is spent
// from the day it ships.
//
// What is pinned here is the handful of decisions a later pass would
// otherwise undo:
//
//   A DRAFT IS NOT THE RECORD. It is written to `draft`, never to `caption`,
//   the report carries captions only, and a re-draft must not overwrite a
//   sentence somebody already kept.
//
//   THE IDS AND THE BYTES ARE CHECKED, NEVER TRUSTED. A photograph on
//   another room is not captioned, and the size cap is the whole of what
//   stops a hand-made request costing more than a press.
//
//   THINKING IS OFF AND THE PICTURE IS SMALL, because both are what the
//   quoted price assumes. Either one changing silently multiplies the bill.
//
//   node --no-warnings scripts/photo-draft-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { whyNotDraft, readDrafts, draftSystem, draftContext, DRAFT_MODEL,
  DRAFT_SCHEMA, DRAFT_LONG_EDGE, MAX_DRAFT_BYTES, MAX_DRAFT_PHOTOS,
  MAX_CAPTION, DRAFT_REFUSALS } from "../shared/photodraft.js";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const BASE = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");

// ---- the stub ----
// Every call Anthropic would have answered, recorded. `reply` is what the
// next call gets, so a malformed answer and an outage are both drivable.
const sent = [];
let reply = null;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (!u.startsWith("https://claude.test")) return realFetch(url, init);
  sent.push({ url: u, body: JSON.parse(init.body), headers: init.headers });
  if (typeof reply === "function") return reply();
  return new Response(JSON.stringify(reply), { status: 200, headers: { "Content-Type": "application/json" } });
};
// What a well-behaved answer looks like: structured output arrives as JSON
// inside a text block.
const answer = (photos) => ({
  content: [{ type: "text", text: JSON.stringify({ photos }) }],
  usage: { input_tokens: 1200, output_tokens: 70 },
});

const seed = () => {
  const db = freshDb({ base: BASE, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,kind,subdomain) VALUES
      ('acc1','Sound Property Management','property_manager','soundpm');
    INSERT INTO users(id,name,email) VALUES
      ('u_admin','Christopher Lane','chris@soundpm.test'),
      ('u_own','Marion Oakes','marion@oakes.test');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES
      ('m_admin','u_admin','acc1','admin'),
      ('m_own','u_own','acc1','owner');
    INSERT INTO properties(id,account_id,name,address,city,zip,owner_account_id) VALUES
      ('p_press','acc1','Press Apartments','1620 Belmont Ave','Seattle','98122','acc1');
    INSERT INTO membership_properties(membership_id,property_id) VALUES ('m_own','p_press');
  `);
  return { db, env: {
    DB: makeD1(db),
    FILES: { put: async () => {}, get: async () => ({ body: "x" }) },
    ANTHROPIC_API_KEY: "sk-test",
    ANTHROPIC_API_BASE: "https://claude.test/v1",
  } };
};

const call = (env, path, { method = "GET", body, who = "u_admin", acct = "acc1" } = {}) =>
  worker.fetch(new Request(`https://api.subsub.work${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json", "X-User-Id": who, "X-Account-Id": acct },
  }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];

// A room with N photographs on it, ready to draft.
const walkedRoom = async (env, { photos = 2, name = "Bathroom 1", note = "" } = {}) => {
  const [, insp] = await json(await call(env, "/api/inspections", { method: "POST",
    body: { kind: "move_out", propertyId: "p_press", unit: "3B" } }));
  const [, r1] = await json(await call(env, `/api/inspections/${insp.id}/rooms`, { method: "POST", body: { name } }));
  const room = r1.rooms[0];
  if (note) await call(env, `/api/inspections/${insp.id}/rooms/${room.id}`, { method: "PATCH", body: { note } });
  const [, withPhotos] = await json(await call(env, `/api/inspections/${insp.id}/rooms/${room.id}/photos`,
    { method: "POST", body: { photos: Array.from({ length: photos }, (_, i) => (
      { key: `acc1/report-photo/shot-${i}.jpg`, type: "image/jpeg", name: `shot-${i}.jpg` })) } }));
  return { id: insp.id, roomId: room.id, photos: withPhotos.rooms[0].photos };
};
const px = (n = 1000) => "A".repeat(n);

try {
  console.log("\n-- the rules, before anything is driven --");
  {
    ck("a room with photos and nothing drafted may be drafted",
      whyNotDraft({ photos: 3, undrafted: 3 }) === null);
    // NOT CONFIGURED IS FIRST. There is no key, so nothing else matters --
    // and a screen that said "no photos" over a missing key would send
    // somebody looking in the wrong place.
    ck("no key is the first answer, ahead of everything else",
      whyNotDraft({ photos: 0, undrafted: 0, finished: true, configured: false }) === "ai_not_configured");
    ck("a finished inspection is refused",
      whyNotDraft({ photos: 3, undrafted: 3, finished: true }) === "already_finished");
    ck("a room with no photos has nothing to draft",
      whyNotDraft({ photos: 0, undrafted: 0 }) === "no_photos");
    ck("and one already done says so rather than spending again",
      whyNotDraft({ photos: 3, undrafted: 0 }) === "all_drafted");
    // Every reason carries its words, or a refused press is a dead end --
    // the shape this project records about a disabled control with no
    // explanation beside it.
    const reasons = ["ai_not_configured", "already_finished", "no_photos", "all_drafted",
      "too_big", "rate_limited", "ai_unavailable"];
    const wordless = reasons.filter((r) => !DRAFT_REFUSALS[r]);
    ck("every refusal has a sentence", wordless.length === 0, wordless.join(" "));

    // KEYED BY REF, NEVER BY POSITION. A model that answers out of order or
    // skips one would otherwise caption the wrong photograph, which on a
    // condition record is not a cosmetic error.
    const out = readDrafts({ photos: [
      { ref: 2, draft: "Scuff to the wall", unclear: false },
      { ref: 1, draft: "Cracked basin", unclear: false },
    ] }, 2);
    ck("the answers are read by ref rather than by order",
      out.find((d) => d.ref === 1).draft === "Cracked basin"
      && out.find((d) => d.ref === 2).draft === "Scuff to the wall",
      JSON.stringify(out));
    ck("a ref outside the request is dropped",
      readDrafts({ photos: [{ ref: 9, draft: "x", unclear: false }] }, 2).length === 0);
    ck("so is a repeated one",
      readDrafts({ photos: [
        { ref: 1, draft: "first", unclear: false },
        { ref: 1, draft: "second", unclear: false }] }, 2).length === 1);
    ck("and an empty draft", readDrafts({ photos: [{ ref: 1, draft: "   ", unclear: false }] }, 1).length === 0);
    ck("a caption is capped at the column's width",
      readDrafts({ photos: [{ ref: 1, draft: "x".repeat(MAX_CAPTION + 500), unclear: false }] }, 1)[0]
        .draft.length === MAX_CAPTION);
    ck("unclear is carried rather than flattened into the text",
      readDrafts({ photos: [{ ref: 1, draft: "Too dark", unclear: true }] }, 1)[0].unclear === true);

    // THE PROMPT SAYS THE THREE THINGS THAT MAKE IT A CONDITION RECORD
    // rather than a description of a picture. A later pass trimming these as
    // padding is what this asserts against.
    const sys = draftSystem({ kindLabel: "Move-out" });
    ck("it asks about condition rather than contents", /CONDITION, not the contents/.test(sys));
    ck("it refuses to apportion blame",
      /what caused it, who is responsible/.test(sys), sys.slice(0, 40));
    ck("it refuses to invent", /Never state anything the photograph does not show/.test(sys));
    ck("it will not describe a person", /not describe or identify any person/i.test(sys));
    ck("and it says the manager edits every line", /edit every line/.test(sys));
    ck("the walk is named, so a move-out does not read as a move-in",
      /move-out inspection/.test(sys), sys.slice(0, 110));

    const ctx = draftContext({ roomName: "Bathroom 1", note: "Basin cracked", count: 3 });
    ck("the room is named", /Bathroom 1/.test(ctx));
    ck("the manager's own note is passed as context", /Basin cracked/.test(ctx));
    // Handing somebody their own sentence back is not a draft.
    ck("and the model is told not to repeat it back", /Do not repeat it back/.test(ctx));
    ck("the count is named so every photograph gets an entry", /each of the 3 photographs/.test(ctx));

    // The schema has to be strict or the API refuses it.
    ck("the schema closes additionalProperties, which the API requires",
      DRAFT_SCHEMA.additionalProperties === false
      && DRAFT_SCHEMA.properties.photos.items.additionalProperties === false);
    ck("and requires all three fields of an entry",
      JSON.stringify(DRAFT_SCHEMA.properties.photos.items.required) === '["ref","draft","unclear"]');
  }

  console.log("\n-- the request Anthropic actually receives --");
  {
    const { env } = seed();
    const { id, roomId, photos } = await walkedRoom(env, { photos: 2, name: "Bathroom 1", note: "Basin cracked" });
    sent.length = 0;
    reply = answer([
      { ref: 1, draft: "Hairline crack across the basin, front left.", unclear: false },
      { ref: 2, draft: "Scuff to the wall left of the door, roughly 150mm.", unclear: false },
    ]);
    const [s, out] = await json(await call(env, `/api/inspections/${id}/rooms/${roomId}/drafts`,
      { method: "POST", body: { photos: photos.map((p) => ({ id: p.id, data: px() })) } }));
    ck("it drafts", s === 200 && out.drafted === 2, `${s} ${JSON.stringify(out).slice(0, 120)}`);
    ck("and called out exactly once for the room", sent.length === 1, String(sent.length));

    const req = sent[0].body;
    ck("the model is the one that was priced", req.model === DRAFT_MODEL, req.model);
    // THINKING OFF. Thinking is billed as output, so turning it on would
    // multiply what a one-line caption costs -- and the price quoted for
    // this feature assumes it is off. `between_tools` rather than
    // `disabled`, which this model answers 400 to.
    ck("thinking is off", req.thinking?.type === "between_tools", JSON.stringify(req.thinking));
    ck("and not by the spelling this model refuses",
      req.thinking?.type !== "disabled", JSON.stringify(req.thinking));
    ck("structured output, so a caption with an apostrophe in it still parses",
      req.output_config?.format?.type === "json_schema"
      && req.output_config.format.schema.required.includes("photos"),
      JSON.stringify(req.output_config?.format?.type));
    ck("the system prompt is the shared one, not a second copy",
      req.system === draftSystem({ kindLabel: "Move-out" }));

    const blocks = req.messages[0].content;
    const images = blocks.filter((b) => b.type === "image");
    ck("both photographs went", images.length === 2, String(images.length));
    ck("as base64 jpeg, which is what the downscale produces",
      images.every((b) => b.source.type === "base64" && b.source.media_type === "image/jpeg"));
    // Each labelled, because that is what makes `ref` mean a photograph
    // rather than a position in an array.
    ck("each is introduced by the label the answer refers back to",
      blocks[0].type === "text" && blocks[0].text === "Photo 1:"
      && blocks[2].text === "Photo 2:", JSON.stringify(blocks.map((b) => b.type)));
    ck("the pictures come before the question", blocks[blocks.length - 1].type === "text");
    ck("the room and its note travel", /Bathroom 1/.test(blocks[blocks.length - 1].text)
      && /Basin cracked/.test(blocks[blocks.length - 1].text));
    // WHAT DOES NOT TRAVEL. Named individually, because the screen promises
    // exactly this and a field added to the prompt later would quietly break
    // the promise rather than the build.
    const whole = JSON.stringify({ system: req.system, messages: req.messages });
    ck("the tenant's name does not", !/Tess|Nguyen/.test(whole));
    ck("nor the address", !/Belmont|98122/.test(whole));
    ck("nor the building or the account", !/Press Apartments|Sound Property/.test(whole));
    ck("nor anybody's email", !/@/.test(whole.replace(/[A-Za-z0-9+/=]{40,}/g, "")));
    ck("the key is a header rather than a query parameter",
      sent[0].headers["x-api-key"] === "sk-test" && !/sk-test/.test(sent[0].url));
    ck("and the API version is pinned", sent[0].headers["anthropic-version"] === "2023-06-01");
  }

  console.log("\n-- a draft is not the record --");
  {
    const { db, env } = seed();
    const { id, roomId, photos } = await walkedRoom(env, { photos: 1 });
    reply = answer([{ ref: 1, draft: "Cracked basin.", unclear: false }]);
    await call(env, `/api/inspections/${id}/rooms/${roomId}/drafts`,
      { method: "POST", body: { photos: [{ id: photos[0].id, data: px() }] } });

    const row = db.prepare(`SELECT * FROM inspection_photo_notes WHERE photo_id = ?`).get(photos[0].id);
    ck("the draft is stored", row.draft === "Cracked basin.", JSON.stringify(row));
    // THE WHOLE RULE, in one assertion. A draft that wrote itself into
    // `caption` would appear in the owner's report as something this account
    // had said about somebody's home, with nobody having read it.
    ck("and the caption is still empty, because nobody kept it",
      row.caption === null || row.caption === "", JSON.stringify(row.caption));
    ck("who drafted it is recorded", row.drafted_by === "u_admin", row.drafted_by);

    let [, insp] = await json(await call(env, `/api/inspections/${id}`));
    let ph = insp.rooms[0].photos[0];
    ck("the team sees the draft on the row", ph.draft === "Cracked basin.", JSON.stringify(ph));
    ck("and the caption reads empty", ph.caption === "", JSON.stringify(ph.caption));

    // Keeping it is a separate act, through the only route that can do it.
    const [s2] = await json(await call(env, `/api/inspections/${id}/rooms/${roomId}/photos/${ph.id}`,
      { method: "PATCH", body: { caption: "Hairline crack across the basin." } }));
    ck("keeping it is a press of its own", s2 === 200, String(s2));
    const kept = db.prepare(`SELECT * FROM inspection_photo_notes WHERE photo_id = ?`).get(ph.id);
    ck("the caption is now the record", kept.caption === "Hairline crack across the basin.", kept.caption);
    // "What did the model say" is worth being able to answer after somebody
    // has edited it.
    ck("and the draft is left beside it rather than consumed", kept.draft === "Cracked basin.", kept.draft);

    // RE-DRAFTING MUST NOT CLOBBER A KEPT SENTENCE. The one way this feature
    // could destroy the record it exists to help write.
    reply = answer([{ ref: 1, draft: "Something else entirely.", unclear: false }]);
    await call(env, `/api/inspections/${id}/rooms/${roomId}/drafts`,
      { method: "POST", body: { photos: [{ id: ph.id, data: px() }] } });
    const after = db.prepare(`SELECT * FROM inspection_photo_notes WHERE photo_id = ?`).get(ph.id);
    ck("a re-draft leaves the kept caption alone",
      after.caption === "Hairline crack across the basin.", after.caption);
    ck("and only replaces the draft", after.draft === "Something else entirely.", after.draft);
  }

  console.log("\n-- what the building's owner reads --");
  {
    const { env } = seed();
    const { id, roomId, photos } = await walkedRoom(env, { photos: 1 });
    reply = answer([{ ref: 1, draft: "A draft nobody kept.", unclear: false }]);
    await call(env, `/api/inspections/${id}/rooms/${roomId}/drafts`,
      { method: "POST", body: { photos: [{ id: photos[0].id, data: px() }] } });
    await call(env, `/api/inspections/${id}/rooms/${roomId}/photos/${photos[0].id}`,
      { method: "PATCH", body: { caption: "Hairline crack across the basin." } });
    await call(env, `/api/inspections/${id}/rooms/${roomId}`, { method: "PATCH", body: { status: "fail" } });
    await call(env, `/api/inspections/${id}`, { method: "PATCH", body: { finish: true } });

    const [s, mine] = await json(await call(env, `/api/inspections/${id}`, { who: "u_own" }));
    ck("the owner can read the finished report", s === 200, String(s));
    // Read through, because the block exists to catch this one going
    // missing -- an unguarded index here throws and takes every assertion
    // after it down, which is one failure reported where there are eight.
    const ph = mine.rooms?.[0]?.photos?.[0] || {};
    ck("and gets the caption, which is the record", ph.caption === "Hairline crack across the basin.", ph.caption);
    // THE DRAFT IS THE TEAM'S WORKING NOTE. Handing it over would make a
    // sentence nobody kept read like a finding -- the same line that keeps
    // `recipients` and `sends` off a reading seat's copy.
    ck("the draft does not travel to them", ph.draft === undefined, JSON.stringify(ph));
    ck("nor whether the model found it unclear", ph.draftUnclear === undefined, JSON.stringify(ph));
    ck("nor whether drafting is even available here", mine.aiDrafts === undefined, JSON.stringify(mine.aiDrafts));

    // And an owner cannot draft or caption, which is both lists refusing:
    // the role and the path allowlist.
    const [sd] = await json(await call(env, `/api/inspections/${id}/rooms/${roomId}/drafts`,
      { method: "POST", who: "u_own", body: { photos: [] } }));
    ck("an owner cannot draft", sd === 403 || sd === 404, String(sd));
    const [sc] = await json(await call(env, `/api/inspections/${id}/rooms/${roomId}/photos/${ph.id}`,
      { method: "PATCH", who: "u_own", body: { caption: "mine now" } }));
    ck("nor write a caption", sc === 403 || sc === 404, String(sc));
  }

  console.log("\n-- nothing from the browser is trusted --");
  {
    const { db, env } = seed();
    const a = await walkedRoom(env, { photos: 1, name: "Bathroom 1" });
    // A second room on the SAME inspection, which is the discriminating
    // fixture: a check that only compared account ids would pass over it.
    const [, r2] = await json(await call(env, `/api/inspections/${a.id}/rooms`,
      { method: "POST", body: { name: "Kitchen" } }));
    const other = r2.rooms.find((r) => r.name === "Kitchen");
    const [, withPhoto] = await json(await call(env, `/api/inspections/${a.id}/rooms/${other.id}/photos`,
      { method: "POST", body: { photos: [{ key: "acc1/report-photo/kitchen.jpg", type: "image/jpeg", name: "k.jpg" }] } }));
    const kitchenPhoto = withPhoto.rooms.find((r) => r.id === other.id).photos[0];

    sent.length = 0;
    reply = answer([{ ref: 1, draft: "Should never happen.", unclear: false }]);
    // Naming the kitchen's photograph while asking about the bathroom.
    const [s, out] = await json(await call(env, `/api/inspections/${a.id}/rooms/${a.roomId}/drafts`,
      { method: "POST", body: { photos: [{ id: kitchenPhoto.id, data: px() }] } }));
    ck("a photograph on another room is not drafted", s === 400 && out.error === "no_photos", `${s} ${out.error}`);
    ck("and nothing was sent to be read", sent.length === 0, String(sent.length));
    const stray = db.prepare(`SELECT COUNT(*) AS n FROM inspection_photo_notes WHERE photo_id = ?`)
      .get(kitchenPhoto.id);
    ck("nor was anything written about it", stray.n === 0, String(stray.n));

    // THE SIZE CAP IS THE WHOLE OF WHAT BOUNDS THE BILL, because the bytes
    // are the browser's to produce. Without it a hand-made request costs
    // whatever the caller feels like spending.
    sent.length = 0;
    const huge = "A".repeat(Math.ceil(MAX_DRAFT_BYTES * 4 / 3) + 1000);
    const [sb, ob] = await json(await call(env, `/api/inspections/${a.id}/rooms/${a.roomId}/drafts`,
      { method: "POST", body: { photos: [{ id: a.photos[0].id, data: huge }] } }));
    ck("a picture over the cap is refused", sb === 413 && ob.error === "too_big", `${sb} ${ob.error}`);
    ck("before it reaches Anthropic", sent.length === 0, String(sent.length));

    // And no press can cost more than a room.
    sent.length = 0;
    reply = answer(Array.from({ length: 1 }, (_, i) => ({ ref: i + 1, draft: "x", unclear: false })));
    await call(env, `/api/inspections/${a.id}/rooms/${a.roomId}/drafts`,
      { method: "POST", body: { photos: Array.from({ length: MAX_DRAFT_PHOTOS + 8 },
        () => ({ id: a.photos[0].id, data: px() })) } });
    const imgs = sent[0].body.messages[0].content.filter((b) => b.type === "image").length;
    ck("one press never carries more than the cap", imgs <= MAX_DRAFT_PHOTOS, String(imgs));

    // A caption from the browser is capped too: a prompt is a request and a
    // column is a guarantee.
    const [, long] = await json(await call(env, `/api/inspections/${a.id}/rooms/${a.roomId}/photos/${a.photos[0].id}`,
      { method: "PATCH", body: { caption: "y".repeat(MAX_CAPTION + 400) } }));
    const cap = db.prepare(`SELECT caption FROM inspection_photo_notes WHERE photo_id = ?`).get(a.photos[0].id);
    ck("a long caption is cut to the column", cap.caption.length === MAX_CAPTION,
      `${cap.caption.length} ${JSON.stringify(long).slice(0, 40)}`);
  }

  console.log("\n-- the gates --");
  {
    const { env } = seed();
    const { id, roomId, photos } = await walkedRoom(env, { photos: 1 });
    await call(env, `/api/inspections/${id}/rooms/${roomId}`, { method: "PATCH", body: { status: "ok" } });
    await call(env, `/api/inspections/${id}`, { method: "PATCH", body: { finish: true } });
    sent.length = 0;
    // FINISHED IS A ONE-WAY DOOR. Drafting is a write, so it is refused for
    // the same reason adding a room is -- and CHECK.sql counts a draft dated
    // after the finish.
    const [s, out] = await json(await call(env, `/api/inspections/${id}/rooms/${roomId}/drafts`,
      { method: "POST", body: { photos: [{ id: photos[0].id, data: px() }] } }));
    ck("a finished inspection cannot be drafted", s === 409 && out.error === "already_finished", `${s} ${out.error}`);
    ck("and nothing was spent finding out", sent.length === 0, String(sent.length));
    const [sc, oc] = await json(await call(env, `/api/inspections/${id}/rooms/${roomId}/photos/${photos[0].id}`,
      { method: "PATCH", body: { caption: "after the fact" } }));
    ck("nor captioned afterwards", sc === 409 && oc.error === "already_finished", `${sc} ${oc.error}`);
  }
  {
    // NO KEY IS A NAMED REFUSAL AND NOT A 500, because the screen has to say
    // something other than "that didn't work" -- and `aiDrafts` is what
    // keeps the button off that screen in the first place.
    const { env } = seed();
    delete env.ANTHROPIC_API_KEY;
    const { id, roomId, photos } = await walkedRoom(env, { photos: 1 });
    const [, insp] = await json(await call(env, `/api/inspections/${id}`));
    ck("the screen is told drafting is unavailable", insp.aiDrafts === false, JSON.stringify(insp.aiDrafts));
    const [s, out] = await json(await call(env, `/api/inspections/${id}/rooms/${roomId}/drafts`,
      { method: "POST", body: { photos: [{ id: photos[0].id, data: px() }] } }));
    ck("and the route names the reason", s === 503 && out.error === "ai_not_configured", `${s} ${out.error}`);
  }
  {
    const { env } = seed();
    const { id, roomId, photos } = await walkedRoom(env, { photos: 1 });
    const [, insp] = await json(await call(env, `/api/inspections/${id}`));
    ck("with a key it is told the opposite", insp.aiDrafts === true, JSON.stringify(insp.aiDrafts));

    // PER ACCOUNT, because every press spends money and the one thing a
    // rate limit has to stop is a loop.
    reply = answer([{ ref: 1, draft: "x", unclear: false }]);
    let limited = 0;
    for (let i = 0; i < 44; i++) {
      const [s] = await json(await call(env, `/api/inspections/${id}/rooms/${roomId}/drafts`,
        { method: "POST", body: { photos: [{ id: photos[0].id, data: px() }] } }));
      if (s === 429) limited++;
    }
    ck("a loop is rate-limited rather than billed", limited > 0, `${limited} of 44 refused`);
  }

  console.log("\n-- when Anthropic does not answer --");
  {
    const { db, env } = seed();
    const { id, roomId, photos } = await walkedRoom(env, { photos: 1 });
    const body = { photos: [{ id: photos[0].id, data: px() }] };

    reply = () => new Response(JSON.stringify({ error: { type: "overloaded_error", message: "Overloaded" } }),
      { status: 529, headers: { "Content-Type": "application/json" } });
    let [s, out] = await json(await call(env, `/api/inspections/${id}/rooms/${roomId}/drafts`, { method: "POST", body }));
    ck("an outage is a named refusal rather than a 500", s === 502 && out.error === "ai_unavailable", `${s} ${out.error}`);
    // NOTHING WAS WRITTEN, which is what makes "try again" true -- the
    // sentence the screen shows.
    let n = db.prepare(`SELECT COUNT(*) AS n FROM inspection_photo_notes`).get();
    ck("and nothing was written, so trying again is honest", n.n === 0, String(n.n));

    // A malformed answer is the same outcome. Structured outputs make this
    // unlikely rather than impossible, and a throw inside the parse must not
    // become a 500 on the screen.
    reply = { content: [{ type: "text", text: "not json at all" }] };
    [s, out] = await json(await call(env, `/api/inspections/${id}/rooms/${roomId}/drafts`, { method: "POST", body }));
    ck("so is an answer that will not parse", s === 502 && out.error === "ai_unavailable", `${s} ${out.error}`);

    // An answer about no photographs is not a success with zero drafts: a
    // press that reported "done" having written nothing is the
    // save-that-reports-success shape this project refuses.
    reply = answer([]);
    [s, out] = await json(await call(env, `/api/inspections/${id}/rooms/${roomId}/drafts`, { method: "POST", body }));
    ck("and an empty answer is not reported as done", s === 502 && out.error === "ai_unavailable", `${s} ${out.error}`);

    // READ BY BLOCK TYPE, NOT POSITION. A reply that opens with a thinking
    // block is what `content[0]` gets wrong, and it would break the day
    // somebody changed a thinking setting with nothing in the request
    // looking different.
    reply = {
      content: [
        { type: "thinking", thinking: "" },
        { type: "text", text: JSON.stringify({ photos: [{ ref: 1, draft: "Found it anyway.", unclear: false }] }) },
      ],
    };
    [s, out] = await json(await call(env, `/api/inspections/${id}/rooms/${roomId}/drafts`, { method: "POST", body }));
    ck("a reply that opens with a thinking block is still read", s === 200 && out.drafted === 1,
      `${s} ${JSON.stringify(out).slice(0, 80)}`);
  }

  console.log("\n-- the size the browser is told to send --");
  {
    // A COST CONSTANT, not a quality one, and it is the number the quoted
    // price was worked out from: ceil(1120/28) * ceil(840/28) = 1200 visual
    // tokens. At 2576px -- what Anthropic downscales a phone photograph to
    // on its own -- it is 4,784, which is four times the bill for detail
    // nobody needs in order to see a scuffed wall.
    const tokens = (w, h) => Math.ceil(w / 28) * Math.ceil(h / 28);
    ck("1120 on the long edge is about 1,200 visual tokens",
      tokens(DRAFT_LONG_EDGE, Math.round(DRAFT_LONG_EDGE * 0.75)) <= 1250, String(tokens(1120, 840)));
    // Under the smaller models' cap as well, so moving the model down later
    // cannot quietly change what a photograph costs.
    ck("and under the standard resolution tier's own cap, so the model can move",
      tokens(DRAFT_LONG_EDGE, Math.round(DRAFT_LONG_EDGE * 0.75)) <= 1568);
    ck("a full-size phone photograph would cost four times as much",
      tokens(2576, 1932) > 3 * tokens(1120, 840), `${tokens(2576, 1932)} vs ${tokens(1120, 840)}`);
  }
} finally {
  globalThis.fetch = realFetch;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
