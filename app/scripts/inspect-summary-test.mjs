// THE SUMMARY A WORK ORDER CARRIES, through the real Worker.
//
// Asked for as: *"A work order should also carry a summary of all of the
// comments from the follow up or flagged item to give as a summary for the
// subcontractor. Combine the comments and summarize automatically."*
//
// Stubbed at `fetch`, which is the boundary `ANTHROPIC_API_BASE` exists for:
// what gets asserted is the request SHAPE, which is the only place several of
// this feature's claims are checkable at all.
//
// What is pinned here is the handful of decisions a later pass would
// otherwise undo:
//
//   THE SUMMARY IS OF WHAT THE CONTRACTOR CAN ALREADY READ. The source goes
//   through `contractorInspectionShape`, so the model never sees a draft
//   nobody kept, a room that was fine, or the tenant's name -- and a field
//   added to that shape later cannot leak through a second path.
//
//   IT NEVER BLOCKS THE RAISE. By the time it runs the job exists, so a
//   failed call must leave a raised job and a named reason rather than a 500
//   over work that is already on the Jobs screen.
//
//   NOTHING TO COMBINE IS A REFUSAL, NOT A PROMPT. Two room names and a
//   status will produce a confident sentence about what is wrong with them,
//   and an invented fault on a document somebody is about to quote reads
//   exactly like a real one.
//
//   STALENESS IS A COMPARISON. A job can be raised from an unfinished
//   inspection, so the notes can move on; `source` is what was actually
//   summarised.
//
//   node --no-warnings scripts/inspect-summary-test.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { MAX_SUMMARY, SUMMARY_MODEL, SUMMARY_REFUSALS, SUMMARY_SCHEMA,
  countComments, readSummary, summaryShape, summarySource, summarySystem,
  summaryThinking, summaryUser, whyNotSummary } from "../shared/inspectsummary.js";
import { DRAFT_MODEL, knowsThinking } from "../shared/photodraft.js";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(join(app, "worker", "schema.sql"), "utf8");
const CHECK = readFileSync(join(app, "worker", "migrations", "CHECK.sql"), "utf8");

// ---- the stub ----
// Every call Anthropic would have answered, recorded. `reply` is what the next
// one gets, so an outage, a malformed answer and an empty paragraph are all
// drivable.
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
const PARA = "One repaint across the bathroom and the hallway walls, plus a cracked basin in the shower room.";
const answer = (summary = PARA) => ({
  content: [{ type: "text", text: JSON.stringify({ summary }) }],
  usage: { input_tokens: 400, output_tokens: 60 },
});
const resetStub = (r = answer()) => { sent.length = 0; reply = r; };

// THE FIXTURE IS THE TEST, and three of its rows are the only reason any of
// the redaction can be checked at all:
//
//   ph_wall carries a DRAFT and no caption. If the source read drafts,
//           "Scuffing to the painted wall" would be in it.
//   r_ok    is a room that was FINE, with a note on it. If the source read
//           every room, "Nothing to report" would be in it.
//   r_bare  is flagged with NO note and NO caption, which is what makes
//           `no_comments` checkable against a real inspection rather than
//           against a hand-made argument object.
const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,kind,subdomain,plan) VALUES
      ('acc_pm','Sound Property Management','property_manager','soundpm','scale');
    INSERT INTO users(id,name,email) VALUES
      ('u_mgr','Chris Lane','chris@soundpm.test'),
      ('u_own','Marion Oakes','marion@oakes.test'),
      ('u_sub','Juan Soto','juan@pacific.test');
    INSERT INTO companies(id,company,contact,email,state) VALUES
      ('cmp_pac','Pacific apartment maintenance','Juan Soto','juan@pacific.test','WA');
    INSERT INTO engagements(id,account_id,company_id,status,categories) VALUES
      ('en_pac','acc_pm','cmp_pac','active','["plumbing","painting"]');
    INSERT INTO properties(id,account_id,name,address,city,state,zip,owner_account_id) VALUES
      ('prop_1','acc_pm','Press Apartments','1620 Belmont','Seattle','WA','98122','acc_pm');
    INSERT INTO memberships(id,user_id,account_id,role,company_id,unit) VALUES
      ('m_mgr','u_mgr','acc_pm','admin',NULL,NULL),
      ('m_own','u_own','acc_pm','owner',NULL,NULL),
      ('m_sub','u_sub','acc_pm','contractor','cmp_pac',NULL);
    INSERT INTO membership_properties(membership_id,property_id) VALUES ('m_own','prop_1');

    -- A finished move-out walk with comments on it.
    INSERT INTO inspections(id,account_id,property_id,unit,kind,tenant_name,inspected_on,status,finished_at)
      VALUES ('ins_out','acc_pm','prop_1','3B','move_out','Ada Threeby','2026-10-01','finished','2026-10-01 12:00:00');
    -- A draft walk whose flagged rooms carry nothing written about them.
    INSERT INTO inspections(id,account_id,property_id,unit,kind,status)
      VALUES ('ins_bare','acc_pm','prop_1','4A','move_out','draft');

    INSERT INTO inspection_rooms(id,inspection_id,name,status,note,position) VALUES
      ('r_bath','ins_out','Shower and bath','fail','Cracked basin, chip to the enamel',0),
      ('r_wall','ins_out','Walls and floors','follow_up','Scuff to the wall by the door',1),
      ('r_ok','ins_out','Hall','ok','Nothing to report',2),
      ('r_bare','ins_bare','Kitchen','fail',NULL,0);
    INSERT INTO inspection_photos(id,room_id,file_key,name,content_type) VALUES
      ('ph_bath','r_bath','acc_pm/inspection-photo/a-basin.jpg','basin.jpg','image/jpeg'),
      ('ph_wall','r_wall','acc_pm/inspection-photo/b-wall.jpg','wall.jpg','image/jpeg'),
      ('ph_bare','r_bare','acc_pm/inspection-photo/d-kitchen.jpg','kitchen.jpg','image/jpeg');
    INSERT INTO inspection_photo_notes(photo_id,caption,draft,drafted_at) VALUES
      ('ph_bath','Hairline crack across the basin','A white basin with a crack','2026-10-01T10:00:00.000Z'),
      ('ph_wall',NULL,'Scuffing to the painted wall','2026-10-01T10:00:00.000Z');
  `);
  return { db, env: {
    DB: makeD1(db),
    FILES: { put: async () => {}, get: async () => ({ body: "x" }) },
    ANTHROPIC_API_KEY: "sk-test",
    ANTHROPIC_API_BASE: "https://claude.test/v1",
  } };
};

const call = (env, path, body, who = "u_mgr", method = "POST") => worker.fetch(
  new Request(`https://api.subsub.work${path}`, {
    method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json", "X-User-Id": who, "X-Account-Id": "acc_pm" },
  }), env);
const get = (env, path, who) => call(env, path, undefined, who, "GET");
const json = async (r) => [r.status, await r.json().catch(() => ({}))];
const raise = (env, id = "ins_out", extra = {}) =>
  call(env, `/api/inspections/${id}/job`, { trades: ["painting"], date: "2026-10-09", ...extra });
const issue = (db, jobId, wo = "WO-1", status = "accepted") =>
  db.prepare(`INSERT INTO work_orders(id,wo_number,job_id,trade,company_id,engagement_id,status,value_cents)
              VALUES (?,?,?,'painting','cmp_pac','en_pac',?,40000)`).run(`w_${wo}`, wo, jobId, status);
const stored = (db, id = "ins_out") =>
  db.prepare(`SELECT * FROM inspection_summaries WHERE inspection_id = ?`).get(id);
const bare = (s) => s.replace(/--[^\n]*/g, "");

// The shapes the shared module reads, assembled the way the Worker does.
const INS_OUT = { kind: "move_out", unit: "3B", inspectedOn: "2026-10-01", tenantName: "Ada Threeby" };
const ROOMS_OUT = [
  { id: "r_bath", name: "Shower and bath", status: "fail", note: "Cracked basin, chip to the enamel",
    photos: [{ id: "ph_bath", caption: "Hairline crack across the basin", draft: "A white basin with a crack" }] },
  { id: "r_wall", name: "Walls and floors", status: "follow_up", note: "Scuff to the wall by the door",
    photos: [{ id: "ph_wall", caption: "", draft: "Scuffing to the painted wall" }] },
  { id: "r_ok", name: "Hall", status: "ok", note: "Nothing to report",
    photos: [{ id: "ph_ok", caption: "", draft: "" }] },
];

try {
  console.log("\n-- the rules, before anything is driven --");
  {
    ck("a flagged inspection with comments on it may be summarised",
      whyNotSummary({ flagged: 2, comments: 3 }) === null);
    // NOT CONFIGURED IS FIRST. There is no key, so nothing else matters, and a
    // screen saying "nothing to combine" over a missing key would send
    // somebody looking in the wrong place.
    ck("no key is the first answer, ahead of everything else",
      whyNotSummary({ flagged: 0, comments: 0, configured: false }) === "ai_not_configured");
    ck("nothing flagged has nothing to summarise",
      whyNotSummary({ flagged: 0, comments: 0 }) === "nothing_flagged");
    // THE ONE THAT MATTERS. Flagged rooms with nothing written on them is a
    // model being asked to invent the fault.
    ck("flagged rooms with nothing written on them are refused, not guessed at",
      whyNotSummary({ flagged: 3, comments: 0 }) === "no_comments");
    const reasons = ["ai_not_configured", "nothing_flagged", "no_comments",
      "rate_limited", "ai_unavailable", "migration_needed"];
    const wordless = reasons.filter((r) => !SUMMARY_REFUSALS[r]);
    ck("every refusal has a sentence", wordless.length === 0, wordless.join(" "));

    ck("an answer is capped at the column's width",
      readSummary({ summary: "x".repeat(MAX_SUMMARY + 400) }).length === MAX_SUMMARY);
    ck("and an empty one reads as nothing rather than as a space",
      readSummary({ summary: "   " }) === "" && readSummary(null) === "");

    // THE MODEL AND THE THINKING SETTING ARE ONE FACT, which is why there is
    // no second model constant here. A model absent from the drafts' table has
    // no known way to turn thinking off, and this would then send a setting it
    // refuses -- a 400 on the first real press with nothing in the source
    // looking wrong.
    ck("the model is the drafts' model rather than a second constant",
      SUMMARY_MODEL === DRAFT_MODEL, `${SUMMARY_MODEL} vs ${DRAFT_MODEL}`);
    ck("and how to turn thinking off for it is known",
      knowsThinking(SUMMARY_MODEL), SUMMARY_MODEL);
  }

  console.log("\n-- what gets summarised, and what never does --");
  {
    const src = summarySource(INS_OUT, ROOMS_OUT);
    ck("the flagged rooms' own notes are in it",
      src.includes("Cracked basin, chip to the enamel") && src.includes("Scuff to the wall by the door"), src);
    ck("and the captions somebody kept", src.includes("Hairline crack across the basin"), src);
    // THE DRAFT NEVER TRAVELS. `ph_wall` has one and no caption, so this is
    // the only row either behaviour can be told apart on.
    ck("a draft nobody kept is NOT in it",
      !src.includes("Scuffing to the painted wall") && !src.includes("A white basin with a crack"), src);
    // A JOB IS A LIST OF THINGS TO DO, not a report. `r_ok` has a note on it.
    ck("nor is a room that was fine", !src.includes("Nothing to report"), src);
    ck("nor the tenant's name", !src.includes("Threeby"), src);
    ck("the room names and statuses are, so a reader can match it to the list",
      src.includes("Shower and bath") && src.includes("Fail")
      && src.includes("Walls and floors") && src.includes("Follow-up"), src);

    ck("a note and a kept caption each count as a comment",
      countComments(INS_OUT, ROOMS_OUT) === 3, String(countComments(INS_OUT, ROOMS_OUT)));
    ck("a photograph nobody wrote about does not",
      countComments(INS_OUT, [{ id: "x", name: "Kitchen", status: "fail", note: "",
        photos: [{ id: "p", caption: "", draft: "Tap dripping" }] }]) === 0);

    // STALENESS IS A COMPARISON AGAINST WHAT WAS READ.
    ck("no stored row reads as no summary", summaryShape(null, INS_OUT, ROOMS_OUT) === null);
    ck("an empty paragraph does too", summaryShape({ summary: "  ", source: src }, INS_OUT, ROOMS_OUT) === null);
    const fresh = summaryShape({ summary: PARA, source: src, model: SUMMARY_MODEL, written_at: "2026-10-02" },
      INS_OUT, ROOMS_OUT) || {};
    ck("one written from the current notes is not stale", fresh.stale === false, JSON.stringify(fresh));
    const old = summaryShape({ summary: PARA, source: "Kitchen — Fail\n  Note: tap drips" }, INS_OUT, ROOMS_OUT) || {};
    ck("and one written from different notes is", old.stale === true);
    ck("the source itself never travels", !("source" in fresh), Object.keys(fresh).join(" "));

    // THE PROMPT'S LOAD-BEARING INSTRUCTIONS. The reader is about to put a
    // price on this, so cause, blame, cost and priority are the hiring
    // account's to say and a model volunteering any of them has put words in
    // their mouth on a document going to a third party.
    const sys = summarySystem({ kindLabel: "Move-out" });
    ck("the prompt forbids a cause and a culprit", /what caused|who is responsible/i.test(sys));
    ck("and a price and a duration", /what it will cost|how long/i.test(sys));
    ck("and inventing anything the notes do not say", /[Nn]ever add a fault/.test(sys));
    ck("and it asks for the pattern rather than the list again",
      /Group by the KIND of work/.test(sys) && /listed in full directly below/.test(sys), "");
    const user = summaryUser(INS_OUT, ROOMS_OUT);
    ck("the material names which walk it was", /Move-out inspection, unit 3B/.test(user), user.split("\n")[0]);
    ck("and carries exactly what gets stored", user.includes(summarySource(INS_OUT, ROOMS_OUT)));
  }

  console.log("\n-- raising a job writes one, automatically --");
  {
    const { db, env } = seed();
    resetStub();
    const [s, b] = await json(await raise(env));
    ck("the raise succeeds", s === 201, String(s));
    ck("one call went out", sent.length === 1, String(sent.length));
    ck("the reply carries the summary", b.summary?.text === PARA, JSON.stringify(b.summary));
    ck("and says nothing went wrong", b.summaryError === null, String(b.summaryError));
    const row = stored(db);
    ck("it is stored", row?.summary === PARA, String(row?.summary));
    ck("with exactly what it was written from",
      row?.source === summarySource(INS_OUT, ROOMS_OUT), String(row?.source));
    ck("and the model that wrote it, stamped", row?.model === SUMMARY_MODEL, String(row?.model));
    ck("and who pressed it", row?.written_by === "u_mgr", String(row?.written_by));

    const req = sent[0].body;
    ck("the request names the model from the table", req.model === SUMMARY_MODEL, String(req.model));
    ck("thinking is off", JSON.stringify(req.thinking || null) === JSON.stringify(summaryThinking() || null),
      JSON.stringify(req.thinking));
    ck("and the answer is asked for as structured output",
      JSON.stringify(req.output_config?.format?.schema) === JSON.stringify(SUMMARY_SCHEMA));
    const asked = JSON.stringify(req.messages);
    ck("the notes and the captions were sent",
      asked.includes("Cracked basin") && asked.includes("Hairline crack across the basin"), "");
    // THE SAME REDACTION, ASSERTED ON THE WIRE. The shape is where the rule
    // lives; this is the only place it can be seen holding.
    ck("the drafts were not", !asked.includes("Scuffing to the painted wall"), "");
    ck("nor the room that was fine", !asked.includes("Nothing to report"), "");
    ck("nor the tenant's name", !asked.includes("Threeby"), "");

    const act = db.prepare(`SELECT * FROM activity WHERE kind = 'inspection_summary'`).get();
    ck("the trail records it", !!act && /2 flagged room/.test(act.text), String(act?.text));
  }

  console.log("\n-- and never blocks the raise --");
  {
    // THE WHOLE POINT OF THE CATCH. By the time this runs the job exists and
    // the inspection points at it, so a 500 here would report a failure over
    // work that is already on the Jobs screen.
    const { db, env } = seed();
    resetStub(() => new Response(JSON.stringify({ error: { type: "overloaded_error", message: "slow down" } }),
      { status: 529, headers: { "Content-Type": "application/json" } }));
    const [s, b] = await json(await raise(env));
    ck("a refused call still raises the job", s === 201 && !!b.jobId, `${s} ${b.jobId}`);
    ck("the job is really there", !!db.prepare(`SELECT 1 FROM jobs WHERE id = ?`).get(String(b.jobId || "-")));
    ck("no summary is claimed", b.summary === null, JSON.stringify(b.summary));
    // SAID RATHER THAN LEFT TO BE INFERRED FROM A NULL: a screen that cannot
    // tell "there was nothing to summarise" from "the call failed" cannot
    // offer the one of those that is worth a second press.
    ck("and the reason is named", b.summaryError === "ai_unavailable", String(b.summaryError));
    ck("nothing was written", !stored(db));
  }
  {
    // An empty paragraph is a failure, not a summary: a row with one in it
    // would draw a blank box over the list of rooms, and a blank there reads
    // as "nothing much wrong".
    const { db, env } = seed();
    resetStub(answer("   "));
    const [s, b] = await json(await raise(env));
    ck("an empty answer is a failure rather than a summary",
      s === 201 && b.summaryError === "ai_unavailable", `${s} ${b.summaryError}`);
    ck("and writes no row", !stored(db));
  }
  {
    const { db, env } = seed();
    delete env.ANTHROPIC_API_KEY;
    resetStub();
    const [s, b] = await json(await raise(env));
    ck("with no key the job is raised and the reason is named",
      s === 201 && b.summaryError === "ai_not_configured", `${s} ${b.summaryError}`);
    ck("and nothing was sent anywhere", sent.length === 0, String(sent.length));
    ck("and nothing was written", !stored(db));
  }
  {
    // NOTHING TO COMBINE. A flagged room with no note and no caption is a
    // real inspection rather than a hand-made argument object, which is the
    // only way this can be checked end to end.
    const { db, env } = seed();
    resetStub();
    const [s, b] = await json(await call(env, "/api/inspections/ins_bare/job",
      { trades: ["plumbing"], date: "2026-10-09" }));
    ck("a flagged room with nothing written on it still raises the job", s === 201, String(s));
    ck("and refuses to invent a summary from the room name",
      b.summaryError === "no_comments", String(b.summaryError));
    ck("with no call made at all", sent.length === 0, String(sent.length));
    ck("and no row", !stored(db, "ins_bare"));
  }

  console.log("\n-- what the work order carries --");
  {
    const { db, env } = seed();
    resetStub();
    const [, b] = await json(await raise(env));
    issue(db, b.jobId);
    const [s, d] = await json(await get(env, "/api/work-orders/w_WO-1/inspection", "u_sub"));
    ck("the company holding it reads the summary", s === 200 && d.summary?.text === PARA,
      `${s} ${JSON.stringify(d.summary)}`);
    ck("and it is not stale", d.summary?.stale === false);
    ck("the source does not travel to them either", !!d.summary && !("source" in d.summary),
      Object.keys(d.summary || {}).join(" "));
    ck("the rooms still come in full underneath it",
      (d.rooms || []).length === 2 && d.rooms[0].note === "Cracked basin, chip to the enamel",
      String((d.rooms || []).length));

    // A JOB CAN BE RAISED FROM AN UNFINISHED INSPECTION, so the notes can
    // change afterwards and a paragraph from the old ones must not read as
    // current.
    db.prepare(`UPDATE inspection_rooms SET note = 'Basin has been replaced; tap still drips' WHERE id = 'r_bath'`).run();
    const [, d2] = await json(await get(env, "/api/work-orders/w_WO-1/inspection", "u_sub"));
    ck("a note changing after it was written marks it stale", d2.summary?.stale === true,
      JSON.stringify(d2.summary));
    ck("and the paragraph is still shown rather than hidden", d2.summary?.text === PARA);
  }

  console.log("\n-- rewriting it --");
  {
    const { db, env } = seed();
    resetStub();
    const [, b] = await json(await raise(env));
    db.prepare(`UPDATE inspection_rooms SET note = 'Basin replaced, tap drips' WHERE id = 'r_bath'`).run();
    resetStub(answer("A dripping tap in the shower room and scuffed hallway walls."));
    const [s, out] = await json(await call(env, "/api/inspections/ins_out/summary"));
    ck("a rewrite is taken on a FINISHED inspection", s === 200, String(s));
    ck("and replaces the paragraph", out.summary?.text === "A dripping tap in the shower room and scuffed hallway walls.",
      JSON.stringify(out.summary));
    ck("and is not stale any more", out.summary?.stale === false);
    ck("one row, not two",
      db.prepare(`SELECT COUNT(*) AS n FROM inspection_summaries WHERE inspection_id = 'ins_out'`).get().n === 1);
    ck("and the stored source moved with it", !!stored(db)?.source?.includes("Basin replaced, tap drips"));
    ck("the job it was raised for is untouched",
      !!db.prepare(`SELECT 1 FROM jobs WHERE id = ?`).get(String(b.jobId || "-")));
  }
  {
    // WRITE ROLES ONLY, the same two every other write on an inspection takes.
    // An owner READS the report; a contractor reads their own work order.
    const { env } = seed();
    resetStub();
    const [so] = await json(await call(env, "/api/inspections/ins_out/summary", undefined, "u_own"));
    ck("an owner cannot rewrite it", so === 403, String(so));
    const [sc] = await json(await call(env, "/api/inspections/ins_out/summary", undefined, "u_sub"));
    ck("nor can the company doing the work", sc === 403, String(sc));
    ck("and neither press reached Anthropic", sent.length === 0, String(sent.length));
  }
  {
    const { env } = seed();
    resetStub();
    const [s, b] = await json(await call(env, "/api/inspections/ins_bare/summary"));
    ck("nothing to combine answers 409 rather than 502", s === 409, String(s));
    ck("by name", b.error === "no_comments", String(b.error));
  }

  console.log("\n-- who sees it --");
  {
    const { env } = seed();
    resetStub();
    await raise(env);
    const [s, d] = await json(await get(env, "/api/inspections/ins_out", "u_mgr"));
    ck("the team's own copy carries it", s === 200 && d.summary?.text === PARA, JSON.stringify(d.summary));
    // THE REPORT IS WHAT A DEPOSIT ARGUMENT IS RUN FROM. A model's paragraph
    // in it would read as a finding somebody made.
    const [so, own] = await json(await get(env, "/api/inspections/ins_out", "u_own"));
    ck("the owner's copy does not", so === 200 && !own.summary, `${so} ${JSON.stringify(own.summary)}`);
    ck("but still has the rooms and the captions", (own.rooms || []).length === 3);
  }

  console.log("\n-- the invariant, against real rows --");
  {
    // RUN AGAINST A REAL ROW, which is the lesson 057 paid for: every
    // invariant reads zero on an empty database, so one that is subtly wrong
    // passes for ever.
    const { db, env } = seed();
    resetStub();
    await raise(env);
    const clean = db.prepare(bare(CHECK)).get();
    ck("a real summary reads zero",
      clean.m063_inv_summary_empty === 0 && clean.m063_inspection_summary === 5,
      JSON.stringify([clean.m063_inspection_summary, clean.m063_inv_summary_empty]));
    db.prepare(`UPDATE inspection_summaries SET source = '  ' WHERE inspection_id = 'ins_out'`).run();
    ck("and a row that cannot say what it summarised is counted",
      db.prepare(bare(CHECK)).get().m063_inv_summary_empty === 1);
    db.prepare(`UPDATE inspection_summaries SET source = 'x', summary = '' WHERE inspection_id = 'ins_out'`).run();
    ck("so is one that says nothing",
      db.prepare(bare(CHECK)).get().m063_inv_summary_empty === 1);
  }

  console.log("\n-- the limit, because every press spends money --");
  {
    const { env } = seed();
    resetStub();
    let last = 200;
    for (let i = 0; i < 31; i += 1) {
      last = (await call(env, "/api/inspections/ins_out/summary")).status;
      if (last === 429) break;
    }
    ck("a loop is stopped rather than billed", last === 429, String(last));
  }
} finally {
  globalThis.fetch = realFetch;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
