// Scheduled jobs arriving from somebody else's CRM.
//
// The loop: a job is scheduled in JobNimbus, their webhook posts it here, and
// it lands in SubSub with unassigned trade slots for somebody to fill. What
// this covers is the three properties that make that safe, each of which is
// easy to destroy by accident and none of which shows on a screen:
//
//   A RETRY MUST NOT DUPLICATE. A webhook that does not get a 200 sends
//   again. One scheduled job becoming four is four contractors asked to show
//   up on a Tuesday, and nobody finds out until they do.
//
//   THE PLAN IS CHECKED ON EVERY CALL, not only when the token is minted.
//   Otherwise Scale is a thing you buy once and keep.
//
//   A REVOKED TOKEN AND A MADE-UP ONE ANSWER THE SAME. A separate "revoked"
//   reply tells somebody holding a stolen key that it was real and whose it
//   was.
//
// And the token is never stored: what is in the database is a SHA-256, so a
// copy of that table is not a working key to every customer's integration.
//
//   node --no-warnings scripts/api-ingest-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const M048 = readFileSync(new URL("../worker/migrations/048_api.sql", import.meta.url), "utf8");

const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [M048] });
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind,plan) VALUES
      ('acc_gc','Outerhome','outerhome','general_contractor','scale'),
      ('acc_basic','Thrifty Builders','thrifty','general_contractor','basic'),
      ('acc_sub','Bay Roofing','bay','subcontractor','scale'),
      ('acc_other','Someone Else','other','general_contractor','scale');
    INSERT INTO users(id,name,email) VALUES ('u_ad','Rae','rae@outerhome.test');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES ('m_ad','u_ad','acc_gc','admin');
    INSERT INTO properties(id,account_id,name) VALUES
      ('p_ours','acc_gc','Rainier Apartments'),
      ('p_theirs','acc_other','Not Ours');
  `);
  return db;
};

// Tokens are minted through the real route, because a hash written by the
// test is a test that proves its own arithmetic rather than the product's.
const mint = async (env, name = "JobNimbus", seat = { u: "u_ad", a: "acc_gc" }) => {
  const res = await worker.fetch(new Request("https://api.subsub.work/api/api-tokens", {
    method: "POST",
    headers: { "X-User-Id": seat.u, "X-Account-Id": seat.a, "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  }), env);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const post = async (env, token, body) => {
  const res = await worker.fetch(new Request("https://api.subsub.work/api/v1/jobs", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }), env);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const JOB = {
  externalId: "JN-1041", source: "jobnimbus", title: "Reroof — 14 Alder Way",
  trades: ["roofing", "gutters"], date: "2026-10-14", address: "14 Alder Way",
  area: "Seattle", zip: "98101", client: "M. Okafor", time: "08:00",
  sqft: 2400, stories: 2, scope: "Tear off and replace, 30yr architectural.",
};

console.log("\n-- minting a token --");
let DB, env, TOKEN;
{
  DB = seed(); env = { DB: makeD1(DB) };
  const r = await mint(env);
  ck("an admin on Scale gets one", r.status === 201, `${r.status} ${JSON.stringify(r.body)}`);
  ck("and it is returned exactly once", typeof r.body.token === "string" && r.body.token.length > 20);
  ck("prefixed so it is recognisable", r.body.token.startsWith("ssk_"), r.body.token?.slice(0, 8));
  TOKEN = r.body.token;

  // The whole point of hashing: the database must not hold anything that
  // could be used as a key.
  const row = DB.prepare("SELECT token_hash, prefix FROM api_tokens").get();
  ck("the token itself is NOT in the database", row.token_hash !== TOKEN, row.token_hash.slice(0, 12));
  ck("what is stored is a sha-256", /^[0-9a-f]{64}$/.test(row.token_hash), row.token_hash.slice(0, 16));
  ck("and the stored hash is of THAT token",
    row.token_hash === [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(TOKEN)))]
      .map((b) => b.toString(16).padStart(2, "0")).join(""));
  ck("a prefix is kept so three tokens can be told apart", TOKEN.startsWith(row.prefix), row.prefix);

  // Listing never returns it, because nothing stored could answer.
  const list = await worker.fetch(new Request("https://api.subsub.work/api/api-tokens",
    { headers: { "X-User-Id": "u_ad", "X-Account-Id": "acc_gc" } }), env);
  const rows = await list.json();
  ck("the list names it", rows.length === 1 && rows[0].name === "JobNimbus", JSON.stringify(rows));
  ck("and carries no token", !JSON.stringify(rows).includes(TOKEN));
}

console.log("\n-- a scheduled job arrives --");
{
  const r = await post(env, TOKEN, JOB);
  ck("it is created", r.status === 201, `${r.status} ${JSON.stringify(r.body)}`);
  ck("and says it is not a duplicate", r.body.duplicate === false, JSON.stringify(r.body));
  ck("naming the job", typeof r.body.jobId === "string" && r.body.jobId.length > 0);

  const job = DB.prepare("SELECT * FROM jobs WHERE id = ?").get(r.body.jobId);
  ck("on the right account", job.account_id === "acc_gc", job.account_id);
  ck("with the title", job.title === JOB.title, job.title);
  ck("the date", job.date === "2026-10-14", job.date);
  ck("the time it was given", job.time === "08:00", job.time);
  // The trades are the whole point: they are what becomes an unassigned slot,
  // which is the tile the account opens SubSub to clear.
  ck("and both trades", JSON.parse(job.trades).join(",") === "roofing,gutters", job.trades);
  ck("the address", job.address === "14 Alder Way", job.address);
  ck("the client", job.client === "M. Okafor", job.client);
  ck("and the numbers", job.sqft === 2400 && job.stories === 2, `${job.sqft}/${job.stories}`);

  // It is a JOB, not a request: nothing about this needs approving, because
  // the account's own CRM sent it.
  ck("it is not a request awaiting approval", job.requested_by === null, String(job.requested_by));
  ck("and nobody is credited with creating it", job.created_by === null, String(job.created_by));

  const src = DB.prepare("SELECT * FROM job_sources WHERE job_id = ?").get(r.body.jobId);
  ck("where it came from is recorded", src.source === "jobnimbus" && src.external_id === "JN-1041",
    JSON.stringify(src));
  ck("with the token that sent it", !!src.token_id);
}

console.log("\n-- and the webhook retries, as webhooks do --");
{
  const again = await post(env, TOKEN, JOB);
  ck("the second delivery is accepted", again.status === 200, String(again.status));
  ck("and says so rather than reporting a creation", again.body.duplicate === true,
    JSON.stringify(again.body));
  const n = DB.prepare("SELECT COUNT(*) AS n FROM jobs WHERE account_id='acc_gc'").get().n;
  ck("THERE IS STILL ONE JOB", n === 1, String(n));

  // Five more, the way a webhook with a broken listener actually behaves.
  for (let i = 0; i < 5; i++) await post(env, TOKEN, JOB);
  const after = DB.prepare("SELECT COUNT(*) AS n FROM jobs WHERE account_id='acc_gc'").get().n;
  ck("and still one after five more", after === 1, String(after));

  // Two mechanisms hold this, and they are not interchangeable. The route
  // asks before inserting, which makes the ordinary retry cheap; the UNIQUE
  // INDEX is what is correct when two deliveries arrive at once, and the
  // pre-check cannot cover that case by construction. Removing either alone
  // leaves the sequential test above passing, so the constraint is asserted
  // directly -- otherwise the half that matters under load could go without
  // anything noticing.
  const uniq = DB.prepare(
    `SELECT sql FROM sqlite_master WHERE type='index' AND name='ux_job_sources_external'`).get();
  ck("the dedupe index exists", !!uniq, JSON.stringify(uniq));
  ck("and it is UNIQUE, which is the half that survives a race",
    /CREATE\s+UNIQUE\s+INDEX/i.test(uniq?.sql || ""), uniq?.sql);
  let raced = null;
  try {
    DB.prepare(`INSERT INTO job_sources (job_id, account_id, source, external_id)
                VALUES ('j_race','acc_gc','jobnimbus','JN-1041')`).run();
  } catch (err) { raced = String(err.message || err); }
  ck("so a second row for one external id is refused by the database",
    raced !== null && /UNIQUE/i.test(raced), String(raced));

  // A different job from the same CRM is a different job.
  const other = await post(env, TOKEN, { ...JOB, externalId: "JN-1042", title: "Gutters — 9 Pine" });
  ck("a new external id creates a new job", other.status === 201 && other.body.duplicate === false);
  ck("so now there are two",
    DB.prepare("SELECT COUNT(*) AS n FROM jobs WHERE account_id='acc_gc'").get().n === 2);
}

console.log("\n-- what it refuses, and what it says --");
{
  const empty = await post(env, TOKEN, {});
  ck("an empty body is refused", empty.status === 400, String(empty.status));
  const fields = (empty.body.errors || []).map((e) => e.field);
  // Per field, because the caller is a program. "invalid request" sends an
  // integrator back to read their whole payload again.
  ck("naming every missing field",
    ["externalId", "title", "trades", "date", "address"].every((f) => fields.includes(f)),
    fields.join(","));
  ck("each with a code a program can branch on",
    (empty.body.errors || []).every((e) => typeof e.code === "string" && e.code));
  ck("and a link to the documentation", typeof empty.body.docs === "string" && /developers/.test(empty.body.docs),
    empty.body.docs);

  const trade = await post(env, TOKEN, { ...JOB, externalId: "x1", trades: ["roofing", "juggling"] });
  ck("an unknown trade is refused", trade.status === 400);
  ck("and named", (trade.body.errors || [])[0]?.code === "unknown_trade",
    JSON.stringify(trade.body.errors));

  const date = await post(env, TOKEN, { ...JOB, externalId: "x2", date: "2026-02-31" });
  ck("a date that is not a day is refused", date.status === 400,
    JSON.stringify(date.body.errors));

  const junk = await post(env, TOKEN, "not json at all");
  ck("a body that is not JSON is refused", junk.status === 400 && junk.body.error === "invalid_json",
    JSON.stringify(junk.body));

  // Nothing refused may have been written.
  ck("and none of those created anything",
    DB.prepare("SELECT COUNT(*) AS n FROM jobs WHERE account_id='acc_gc'").get().n === 2);
}

console.log("\n-- a building has to be one of theirs --");
{
  const ours = await post(env, TOKEN, { ...JOB, externalId: "p1", propertyId: "p_ours", address: "" });
  ck("their own building is accepted", ours.status === 201, JSON.stringify(ours.body));
  ck("and the job is attached to it",
    DB.prepare("SELECT property_id FROM jobs WHERE id = ?").get(ours.body.jobId).property_id === "p_ours");

  const theirs = await post(env, TOKEN, { ...JOB, externalId: "p2", propertyId: "p_theirs" });
  const nowhere = await post(env, TOKEN, { ...JOB, externalId: "p3", propertyId: "p_nope" });
  ck("somebody else's building is not found", theirs.status === 404, String(theirs.status));
  // The same answer for both, so this cannot be walked to find out which
  // property ids are real.
  ck("and a made-up one answers identically",
    nowhere.status === theirs.status && nowhere.body.error === theirs.body.error,
    `${theirs.body.error} vs ${nowhere.body.error}`);
}

console.log("\n-- the token is the whole of the auth --");
{
  const none = await worker.fetch(new Request("https://api.subsub.work/api/v1/jobs",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }), env);
  ck("no token at all is 401", none.status === 401, String(none.status));
  ck("and says how to send one", /Bearer/.test(JSON.stringify(await none.json())));

  const made = await post(env, "ssk_totallymadeup", JOB);
  ck("a made-up token is 401", made.status === 401, String(made.status));

  // A session header is not a way in. The API path is exempt from the
  // session middleware, and "exempt" must not mean "unauthenticated".
  const session = await worker.fetch(new Request("https://api.subsub.work/api/v1/jobs", {
    method: "POST",
    headers: { "X-User-Id": "u_ad", "X-Account-Id": "acc_gc", "Content-Type": "application/json" },
    body: JSON.stringify({ ...JOB, externalId: "sess" }),
  }), env);
  ck("a signed-in seat's headers are not a token", session.status === 401, String(session.status));
}

console.log("\n-- revoking one stops it, and gives nothing away --");
{
  const r = await mint(env, "To be revoked");
  const doomed = r.body.token;
  const ok = await post(env, doomed, { ...JOB, externalId: "rev-1" });
  ck("it works before revoking", ok.status === 201, String(ok.status));

  const del = await worker.fetch(new Request(`https://api.subsub.work/api/api-tokens/${r.body.id}`,
    { method: "DELETE", headers: { "X-User-Id": "u_ad", "X-Account-Id": "acc_gc" } }), env);
  ck("revoking answers ok", del.status === 200, String(del.status));

  const after = await post(env, doomed, { ...JOB, externalId: "rev-2" });
  ck("and it stops working", after.status === 401, String(after.status));
  // The reply must not say "this was real". A separate `revoked` answer tells
  // somebody holding a stolen key that it was a key, and whose.
  const made = await post(env, "ssk_totallymadeup", JOB);
  ck("answering exactly as a made-up one does",
    after.status === made.status && after.body.error === made.body.error,
    `${after.body.error} vs ${made.body.error}`);

  // Revoked, not deleted: the jobs it made are real work.
  const row = DB.prepare("SELECT revoked_at FROM api_tokens WHERE id = ?").get(r.body.id);
  ck("the row is kept, so provenance survives", !!row && !!row.revoked_at);
  ck("and the job it created is still there",
    DB.prepare("SELECT COUNT(*) AS n FROM job_sources WHERE external_id='rev-1'").get().n === 1);
}

console.log("\n-- Scale, checked on every call and not only at minting --");
{
  const db2 = seed(); const env2 = { DB: makeD1(db2) };
  db2.exec(`INSERT INTO users(id,name,email) VALUES ('u_b','B','b@thrifty.test');
            INSERT INTO memberships(id,user_id,account_id,role) VALUES ('m_b','u_b','acc_basic','admin');`);
  const basic = await mint(env2, "Nope", { u: "u_b", a: "acc_basic" });
  ck("a Basic account cannot mint one", basic.status === 403 && basic.body.error === "scale_required",
    `${basic.status} ${JSON.stringify(basic.body)}`);

  // The one that matters: minted on Scale, then the account downgrades.
  const good = await mint(env2, "JobNimbus");
  ck("Scale mints fine", good.status === 201, String(good.status));
  ck("and posts fine", (await post(env2, good.body.token, JOB)).status === 201);
  db2.exec(`UPDATE accounts SET plan = 'basic' WHERE id = 'acc_gc'`);
  const down = await post(env2, good.body.token, { ...JOB, externalId: "after-downgrade" });
  ck("after a downgrade the same token is refused",
    down.status === 403 && down.body.error === "scale_required",
    `${down.status} ${JSON.stringify(down.body)}`);
  ck("and it says what to do about it", /Scale/.test(down.body.message || ""), down.body.message);

  // Comped outranks Stripe, which is what that column is for.
  db2.exec(`UPDATE accounts SET plan = 'basic', comped = 1 WHERE id = 'acc_gc'`);
  ck("a comped account keeps it",
    (await post(env2, good.body.token, { ...JOB, externalId: "comped" })).status === 201);
}

console.log("\n-- and a subcontractor account has nobody to assign --");
{
  const db3 = seed(); const env3 = { DB: makeD1(db3) };
  db3.exec(`INSERT INTO users(id,name,email) VALUES ('u_s','S','s@bay.test');
            INSERT INTO memberships(id,user_id,account_id,role) VALUES ('m_s','u_s','acc_sub','admin');`);
  const r = await mint(env3, "Nope", { u: "u_s", a: "acc_sub" });
  ck("a subcontractor account cannot mint one",
    r.status === 403 && r.body.error === "not_a_hiring_account", `${r.status} ${JSON.stringify(r.body)}`);
}

console.log("\n-- a token reaches its own account and no other --");
{
  const db4 = seed(); const env4 = { DB: makeD1(db4) };
  db4.exec(`INSERT INTO users(id,name,email) VALUES ('u_o','O','o@other.test');
            INSERT INTO memberships(id,user_id,account_id,role) VALUES ('m_o','u_o','acc_other','admin');`);
  const mine = await mint(env4, "Mine");
  const theirs = await mint(env4, "Theirs", { u: "u_o", a: "acc_other" });
  await post(env4, mine.body.token, { ...JOB, externalId: "SAME-ID" });
  await post(env4, theirs.body.token, { ...JOB, externalId: "SAME-ID" });
  // Two customers both on JobNimbus will both have a job numbered 1041, and
  // they are different jobs. Scoping the index to the account is what keeps
  // the second one from being swallowed as a duplicate of the first.
  ck("the same external id on two accounts is two jobs",
    db4.prepare("SELECT COUNT(*) AS n FROM jobs").get().n === 2);
  ck("one on each",
    db4.prepare("SELECT COUNT(*) AS n FROM jobs WHERE account_id='acc_gc'").get().n === 1
    && db4.prepare("SELECT COUNT(*) AS n FROM jobs WHERE account_id='acc_other'").get().n === 1);

  // And revoking somebody else's is not found rather than forbidden.
  const cross = await worker.fetch(new Request(`https://api.subsub.work/api/api-tokens/${theirs.body.id}`,
    { method: "DELETE", headers: { "X-User-Id": "u_ad", "X-Account-Id": "acc_gc" } }), env4);
  ck("and another account's token cannot be revoked", cross.status === 404, String(cross.status));
}

// ---- the published page is the third record -------------------------------
//
// `shared/ingest.js` exists because three things have to agree about the
// fields and they get written by different hands at different times: the
// route, the tests, and the DOCUMENTATION. Two of those were checked. A field
// required by the route and optional on the page is an integration that fails
// at 2am against a page saying it should work -- and nothing was reading the
// page.
//
// It found one immediately: the page documented the header endpoint and not
// the webhook address at all, which is the half every CRM and every automation
// builder actually uses.
{
  console.log("\n-- and the docs say what the route does --");
  const { readFileSync } = await import("node:fs");
  const { SOURCE_PRESETS } = await import("../shared/crmsources.js");
  const { REQUIRED_FIELDS, OPTIONAL_FIELDS } = await import("../shared/ingest.js");
  const docs = readFileSync(new URL("../../developers.html", import.meta.url), "utf8");
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

  // `docs.includes(f)` is not this assertion, and proving that took a
  // mutation: deleting the whole `generic` ROW from the receivers table left
  // the word in two paragraphs of prose below it, and the check passed. A
  // field or a source is documented when it has an entry SOMEBODY CAN READ
  // OFF A TABLE, not when the string appears on the page -- and "date" appears
  // on this page a dozen times.
  //
  // Read off the CELLS rather than pattern-matching the shapes a row can take.
  // The first version matched three of them and missed
  // `<code>address</code> <em>or</em> <code>propertyId</code>` -- documented
  // perfectly well, reported as missing. A test that is wrong about where a
  // thing is documented sends somebody to add a row that is already there.
  const cells = (docs.match(/<td>[\s\S]*?<\/td>/g) || []);
  const inTable = (field) => cells.some((td) => td.includes(`<code>${field}</code>`));
  for (const f of REQUIRED_FIELDS) {
    ck(`the docs give the required field ${f} a row`, inTable(f));
  }
  for (const f of OPTIONAL_FIELDS) {
    ck(`and the optional field ${f}`, inTable(f));
  }

  // A source SubSub can translate for and does not document is a CRM whose
  // customers are told to use `generic` and map fields by hand for nothing.
  // Scoped to the receivers table: prose mentioning a source is not a row
  // saying what it is for.
  const sec = docs.slice(docs.indexOf("<h2>No header?"));
  const recvTable = sec.slice(0, sec.indexOf("</table>") + 8);
  for (const src of Object.keys(SOURCE_PRESETS)) {
    ck(`every receiver has a row of its own: ${src}`,
      new RegExp(`<td><code>${src}</code></td>`).test(recvTable));
  }

  // The route a CRM's webhook step can actually reach, with the token in the
  // path because there is no field for a header.
  ck("the webhook address is documented",
    /\/api\/v1\/hooks\/generic\//.test(docs));
  ck("and it says why it exists rather than just showing it",
    /Authorization/.test(docs) && /header/i.test(docs));
  // Its reply is the only place somebody setting up sees the mapping fail
  // while they are still looking at it.
  ck("needsTrades is documented", docs.includes("needsTrades"));

  // The docs send somebody to a panel by name. A heading that has been
  // renamed since is a set of directions that dead-ends on their own screen.
  const named = (docs.match(/My account → Profile → ([^<]+)</) || [])[1];
  ck("the docs name the panel to make a token on", !!named, String(named));
  ck("and that heading exists in the app", !!named && app.includes(`<h4>${named.trim()}</h4>`), String(named));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
