// JobNimbus, specifically.
//
// `/api/v1/jobs` is for somebody writing code. JobNimbus is not somebody
// writing code, and three things stop it calling that endpoint:
//
//   Its automation Webhook action takes a URL and nothing else -- no field
//   for a header, so `Authorization: Bearer` cannot be set.
//   It sends its own field names: jnid, date_start, address_line1.
//   It has NO CONCEPT OF A TRADE. Nothing in the payload says `roofing`.
//
// The third needs an account decision rather than a rename, which is what
// crm_trade_rules is. And the decision that matters most is what happens
// when a word maps to NOTHING:
//
//   THE JOB STILL ARRIVES. Refusing it is the worst answer available -- the
//   webhook does not get a 200, so it retries, so it keeps not getting one,
//   and nobody is told. The work simply is not in SubSub and the only way to
//   find out is to notice. So it lands with no trades and the unrecognised
//   words are counted, which is a question somebody can answer in one tap.
//
//   node --no-warnings scripts/jobnimbus-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const M048 = readFileSync(new URL("../worker/migrations/048_api.sql", import.meta.url), "utf8");
const M049 = readFileSync(new URL("../worker/migrations/049_crm_mapping.sql", import.meta.url), "utf8");

const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [M048, M049] });
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind,plan) VALUES
      ('acc_gc','Outerhome','outerhome','general_contractor','scale');
    INSERT INTO users(id,name,email) VALUES ('u_ad','Rae','rae@outerhome.test');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES ('m_ad','u_ad','acc_gc','admin');
  `);
  return db;
};

const seat = { "X-User-Id": "u_ad", "X-Account-Id": "acc_gc", "Content-Type": "application/json" };

const mint = async (env) => {
  const r = await worker.fetch(new Request("https://api.subsub.work/api/api-tokens", {
    method: "POST", headers: seat, body: JSON.stringify({ name: "JobNimbus" }),
  }), env);
  return (await r.json()).token;
};

const hook = async (env, token, payload) => {
  const res = await worker.fetch(new Request(
    `https://api.subsub.work/api/v1/hooks/jobnimbus/${encodeURIComponent(token)}`,
    { method: "POST", headers: { "Content-Type": "application/json" },
      body: typeof payload === "string" ? payload : JSON.stringify(payload) }), env);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const rule = async (env, body) => {
  const res = await worker.fetch(new Request("https://api.subsub.work/api/crm-rules",
    { method: "POST", headers: seat, body: JSON.stringify(body) }), env);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const rules = async (env) => {
  const res = await worker.fetch(new Request("https://api.subsub.work/api/crm-rules",
    { headers: seat }), env);
  return await res.json();
};

// A real-shaped JobNimbus job record: their field names, their date format.
const JN = {
  jnid: "abc123xyz",
  number: "1041",
  name: "Okafor — Reroof",
  record_type_name: "Job",
  type: "Roof Replacement",
  status_name: "Scheduled",
  tags: ["insurance", "steep"],
  date_start: 1791936000,          // epoch SECONDS = 2026-10-14
  date_created: 1791849600,
  address_line1: "14 Alder Way",
  address_line2: "Unit B",
  city: "Seattle",
  state_text: "WA",
  zip: "98101",
  display_name: "M. Okafor",
  first_name: "Mo", last_name: "Okafor",
  description: "Tear off and replace, 30yr architectural.",
};

let DB, env, TOKEN;

console.log("\n-- their field names become ours --");
{
  DB = seed(); env = { DB: makeD1(DB) }; TOKEN = await mint(env);
  await rule(env, { source: "jobnimbus", match: "type", value: "Roof Replacement", trades: ["roofing"] });

  const r = await hook(env, TOKEN, JN);
  ck("the job is created", r.status === 201, `${r.status} ${JSON.stringify(r.body)}`);
  const job = DB.prepare("SELECT * FROM jobs WHERE id = ?").get(r.body.jobId);
  ck("jnid becomes the external id",
    DB.prepare("SELECT external_id FROM job_sources WHERE job_id = ?").get(r.body.jobId).external_id === "abc123xyz");
  ck("name becomes the title", job.title === "Okafor — Reroof", job.title);
  // Epoch seconds, not milliseconds. Read as ms this lands in 1970 and the
  // job sits in a calendar nobody will ever scroll to.
  ck("date_start (epoch seconds) becomes a real day", job.date === "2026-10-14", job.date);
  ck("both address lines are kept", job.address === "14 Alder Way, Unit B", job.address);
  ck("city becomes the area", job.area === "Seattle", job.area);
  ck("zip comes across", job.zip === "98101", job.zip);
  ck("display_name becomes the client", job.client === "M. Okafor", job.client);
  ck("description becomes the scope", /Tear off/.test(job.scope || ""), job.scope);
}

console.log("\n-- and their words become trades --");
{
  const r = await hook(env, TOKEN, { ...JN, jnid: "b2" });
  ck("the mapped trade is on the job", r.body.trades.join(",") === "roofing", JSON.stringify(r.body.trades));
  ck("and it is not flagged as needing one", r.body.needsTrades === false, JSON.stringify(r.body));
  const job = DB.prepare("SELECT trades FROM jobs WHERE id = ?").get(r.body.jobId);
  ck("written to the job itself", JSON.parse(job.trades).join(",") === "roofing", job.trades);

  // Two rules matching one job give BOTH trades. Picking one would silently
  // drop a slot, discovered when the gutter crew never turned up.
  await rule(env, { source: "jobnimbus", match: "tag", value: "steep", trades: ["gutters"] });
  const both = await hook(env, TOKEN, { ...JN, jnid: "b3" });
  ck("two matching rules union rather than compete",
    both.body.trades.sort().join(",") === "gutters,roofing", JSON.stringify(both.body.trades));
}

console.log("\n-- a word that means nothing STILL ARRIVES --");
{
  // The whole point. Refusing would make the webhook retry forever with
  // nobody told, and the work would simply not be in SubSub.
  const r = await hook(env, TOKEN, {
    ...JN, jnid: "unmapped-1", type: "Siding Job", status_name: "Approved", tags: [],
  });
  ck("it is still created", r.status === 201, `${r.status} ${JSON.stringify(r.body)}`);
  ck("with no trades", r.body.trades.length === 0, JSON.stringify(r.body.trades));
  // Said in the reply, so whoever is setting this up sees it fail while they
  // are still looking at it rather than a week later.
  ck("and the reply says so", r.body.needsTrades === true, JSON.stringify(r.body));
  ck("naming what it did not understand",
    (r.body.unmapped || []).includes("type:Siding Job"), JSON.stringify(r.body.unmapped));

  const gaps = DB.prepare("SELECT * FROM crm_unmapped WHERE account_id='acc_gc'").all();
  ck("the word is recorded as a gap", gaps.some((g) => g.match_value === "Siding Job"),
    JSON.stringify(gaps.map((g) => g.match_value)));

  // Counted, not listed: a busy account would otherwise get one row per job
  // and the screen becomes the thing it was meant to summarise.
  await hook(env, TOKEN, { ...JN, jnid: "unmapped-2", type: "Siding Job", tags: [] });
  await hook(env, TOKEN, { ...JN, jnid: "unmapped-3", type: "Siding Job", tags: [] });
  const one = DB.prepare(
    "SELECT hits FROM crm_unmapped WHERE match_value='Siding Job' AND match_kind='type'").all();
  ck("three jobs make one row, not three", one.length === 1, String(one.length));
  ck("with a count on it", one[0].hits === 3, String(one[0].hits));
}

console.log("\n-- and answering it clears the queue --");
{
  const before = await rules(env);
  ck("the gap is listed for somebody to answer",
    before.unmapped.some((u) => u.value === "Siding Job"), JSON.stringify(before.unmapped));
  // Commonest first: the busiest gap is the one worth answering.
  ck("commonest first", before.unmapped[0].hits >= (before.unmapped[1]?.hits ?? 0),
    JSON.stringify(before.unmapped.map((u) => u.hits)));

  await rule(env, { source: "jobnimbus", match: "type", value: "Siding Job", trades: ["siding"] });
  const after = await rules(env);
  // Leaving it would make the list read as work still to do, which is how a
  // queue stops meaning anything.
  ck("answering removes it from the queue",
    !after.unmapped.some((u) => u.value === "Siding Job"), JSON.stringify(after.unmapped));
  ck("and the rule is listed", after.rules.some((r) => r.value === "Siding Job"));

  const next = await hook(env, TOKEN, { ...JN, jnid: "siding-now", type: "Siding Job", tags: [] });
  ck("the next job of that type maps", next.body.trades.join(",") === "siding",
    JSON.stringify(next.body.trades));
}

console.log("\n-- matching is whole-value and case-insensitive --");
{
  const db = seed(); const e = { DB: makeD1(db) }; const t = await mint(e);
  await worker.fetch(new Request("https://api.subsub.work/api/crm-rules",
    { method: "POST", headers: seat, body: JSON.stringify({ match: "type", value: "Roofing", trades: ["roofing"] }) }), e);

  const exact = await hook(e, t, { ...JN, jnid: "c1", type: "roofing", tags: [] });
  ck("a different case still matches", exact.body.trades.join(",") === "roofing",
    JSON.stringify(exact.body.trades));

  // A prefix rule silently catching "Roofing Inspection - no work" is how a
  // roofer ends up on a job nobody is roofing.
  const prefix = await hook(e, t, { ...JN, jnid: "c2", type: "Roofing Inspection", tags: [] });
  ck("but a longer word does NOT match the shorter rule",
    prefix.body.trades.length === 0, JSON.stringify(prefix.body.trades));
}

console.log("\n-- the token is in the path, and it is still a real token --");
{
  const made = await hook(env, "ssk_totallymadeup", JN);
  ck("a made-up token is 401", made.status === 401, String(made.status));
  const none = await worker.fetch(new Request("https://api.subsub.work/api/v1/hooks/jobnimbus/",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }), env);
  ck("no token at all does not reach the route", none.status === 401 || none.status === 404,
    String(none.status));

  // Everything the header route checks, the path route checks.
  const db2 = seed(); const e2 = { DB: makeD1(db2) }; const t2 = await mint(e2);
  db2.exec(`UPDATE accounts SET plan = 'basic' WHERE id = 'acc_gc'`);
  const down = await hook(e2, t2, JN);
  ck("a downgraded account is refused here too",
    down.status === 403 && down.body.error === "scale_required", `${down.status} ${down.body.error}`);
}

console.log("\n-- what it cannot recover from, it refuses and names --");
{
  const noId = await hook(env, TOKEN, { ...JN, jnid: "", number: "", external_id: "" });
  ck("no jnid is refused", noId.status === 400, String(noId.status));
  ck("and named", /jnid/.test(JSON.stringify(noId.body)), JSON.stringify(noId.body.errors));

  const noDate = await hook(env, TOKEN, { ...JN, jnid: "nd", date_start: null, date_created: null });
  ck("no date is refused", noDate.status === 400, String(noDate.status));
  const noWhere = await hook(env, TOKEN, { ...JN, jnid: "nw", address_line1: "", address_line2: "", city: "" });
  // A unit number with no street is not an address either.
  const unitOnly = await hook(env, TOKEN, { ...JN, jnid: "nw2", address_line1: "", city: "" });
  ck("nowhere to send anybody is refused", noWhere.status === 400, String(noWhere.status));
  ck("and a unit number on its own is nowhere", unitOnly.status === 400, String(unitOnly.status));

  // Trades are deliberately NOT in that list.
  ck("but a missing trade mapping is not a refusal",
    (await hook(env, TOKEN, { ...JN, jnid: "nt", type: "Whatever", tags: [] })).status === 201);
}

console.log("\n-- retries are safe here too --");
{
  const db = seed(); const e = { DB: makeD1(db) }; const t = await mint(e);
  const first = await hook(e, t, JN);
  const again = await hook(e, t, JN);
  ck("the second delivery is not a second job", again.status === 200 && again.body.duplicate === true,
    `${again.status} ${JSON.stringify(again.body)}`);
  ck("and names the same job", again.body.jobId === first.body.jobId);
  for (let i = 0; i < 4; i++) await hook(e, t, JN);
  ck("still one job after six deliveries",
    db.prepare("SELECT COUNT(*) AS n FROM jobs").get().n === 1,
    String(db.prepare("SELECT COUNT(*) AS n FROM jobs").get().n));
}

console.log("\n-- a wrapped payload and a bare one are both read --");
{
  const db = seed(); const e = { DB: makeD1(db) }; const t = await mint(e);
  const wrapped = await hook(e, t, { event: "job.updated", data: { ...JN, jnid: "w1" } });
  ck("a record under `data` is found", wrapped.status === 201, JSON.stringify(wrapped.body));
  ck("with the right title",
    db.prepare("SELECT title FROM jobs WHERE id = ?").get(wrapped.body.jobId).title === "Okafor — Reroof");
}

console.log("\n-- rules belong to one account --");
{
  const db = seed(); const e = { DB: makeD1(db) };
  db.exec(`INSERT INTO accounts(id,name,subdomain,kind,plan) VALUES ('acc_b','Other','other','general_contractor','scale');
           INSERT INTO users(id,name,email) VALUES ('u_b','B','b@other.test');
           INSERT INTO memberships(id,user_id,account_id,role) VALUES ('m_b','u_b','acc_b','admin');`);
  await worker.fetch(new Request("https://api.subsub.work/api/crm-rules", { method: "POST",
    headers: { "X-User-Id": "u_b", "X-Account-Id": "acc_b", "Content-Type": "application/json" },
    body: JSON.stringify({ match: "type", value: "Roof Replacement", trades: ["roofing"] }) }), e);
  const t = await mint(e);
  const r = await hook(e, t, { ...JN, jnid: "x1", tags: [] });
  ck("another account's rule does not map our job", r.body.trades.length === 0,
    JSON.stringify(r.body.trades));
  ck("and our gap is recorded on our account, not theirs",
    db.prepare("SELECT COUNT(*) AS n FROM crm_unmapped WHERE account_id='acc_gc'").get().n > 0
    && db.prepare("SELECT COUNT(*) AS n FROM crm_unmapped WHERE account_id='acc_b'").get().n === 0);
}

console.log("\n-- a rule that does nothing is not saved --");
{
  const db = seed(); const e = { DB: makeD1(db) };
  ck("no trades is refused", (await rule(e, { match: "type", value: "X", trades: [] })).status === 400);
  ck("an unknown trade is refused",
    (await rule(e, { match: "type", value: "X", trades: ["juggling"] })).status === 400);
  ck("an unknown match kind is refused",
    (await rule(e, { match: "colour", value: "X", trades: ["roofing"] })).status === 400);
  ck("and none of them were written",
    db.prepare("SELECT COUNT(*) AS n FROM crm_trade_rules").get().n === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
