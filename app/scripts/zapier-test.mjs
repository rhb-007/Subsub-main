// The Zapier app and the route it calls are two records of one field list.
//
// `/api/v1/hooks/generic/<token>` already worked from a Webhooks-by-Zapier
// step, so this app buys no new capability. What it buys is a token that lives
// in a Zapier connection rather than in a URL somebody screenshots, a trades
// DROPDOWN instead of typing `windows_doors` from memory, and a door in
// Zapier's directory.
//
// Which makes it the same trap as every other pair in this repo: the field
// list is written twice, in two languages, by whoever last touched one of
// them. A Zapier field naming something the route does not accept fails at the
// worst moment -- somebody's first live Zap -- and a route field the app never
// offers is a capability nobody can reach.
//
// What this covers:
//
//   THE BODY THE APP BUILDS IS ONE THE ROUTE ACCEPTS. Not by comparing two
//   lists of strings: the body goes through `validateIngest`, the same
//   function the route uses.
//
//   AN UNFILLED OPTIONAL IS OMITTED, never sent as "". An empty string stored
//   where a column means "not given" is a lie a screen will read back.
//
//   THE DROPDOWN AND THE VALIDATOR READ ONE LIST. shared/trades.js, which is
//   why it exists: a hardcoded copy in the Zapier app would drift, and the
//   symptom is a job refused for naming a trade the dropdown offered.
//
//   AND A REFUSAL REACHES A PERSON. Left alone, Zapier shows "Got 400" and
//   buries which field was wrong -- so somebody rebuilds a working Zap looking
//   for a mistake that was reported and not shown. A 401 has to throw
//   RefreshAuthError or they go hunting in their fields instead of their token.
//
//   node --no-warnings scripts/zapier-test.mjs

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { REQUIRED_FIELDS, OPTIONAL_FIELDS, validateIngest } from "../shared/ingest.js";
import { TRADES, TRADE_IDS } from "../shared/trades.js";

const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const M048 = readFileSync(new URL("../worker/migrations/048_api.sql", import.meta.url), "utf8");

const jobCreate = require("../../zapier/src/creates/job.js");
const tradeTrigger = require("../../zapier/src/triggers/trade.js");
const auth = require("../../zapier/src/authentication.js");
const { handleError } = require("../../zapier/src/middleware.js");

// ---- what `zapier push` refuses ------------------------------------------
//
// Found by running `zapier validate` rather than by reasoning about it, which
// is the only reason it was found before the first push rather than by it.
console.log("\n-- the package is one Zapier will accept --");
{
  const pkg = JSON.parse(readFileSync(new URL("../../zapier/package.json", import.meta.url), "utf8"));
  const core = pkg.dependencies?.["zapier-platform-core"];
  ck("it depends on zapier-platform-core", !!core, String(core));
  // EXACT, not a range. `zapier validate` refuses "^15.5.1" outright, and its
  // reason is the better one: that version decides which Lambda runtime Zapier
  // runs the app on, so a range means "whatever npm resolved on the machine
  // that pushed".
  ck("pinned to an exact version, because a range is refused",
    /^\d+\.\d+\.\d+$/.test(core || ""), String(core));
  // index.js reports platformVersion from the installed core, so a lockfile
  // that disagrees with package.json would publish under a version nobody
  // declared.
  const lock = JSON.parse(readFileSync(new URL("../../zapier/package-lock.json", import.meta.url), "utf8"));
  const locked = lock.packages?.["node_modules/zapier-platform-core"]?.version;
  ck("and the lockfile agrees with it", locked === core, `${locked} vs ${core}`);

  // Without this committed, `zapier push` has no integration to push to and
  // the next deploy registers a SECOND one -- while customers stay connected
  // to the first. It is an identifier, not a secret.
  const ignore = readFileSync(new URL("../../zapier/.gitignore", import.meta.url), "utf8");
  ck("and .zapierapprc is not gitignored", !/\.zapierapprc/.test(ignore),
    ignore.split("\n").filter(Boolean).join(" "));
}

// ---- the two lists -------------------------------------------------------
console.log("\n-- the app offers what the route takes, and nothing else --");
{
  const keys = jobCreate.operation.inputFields.map((f) => f.key);
  const req = jobCreate.operation.inputFields.filter((f) => f.required).map((f) => f.key);

  // `source` is provenance the app sets itself, and `propertyId`/`address` are
  // the either-or pair, so the comparison is over what a PERSON fills in.
  const known = new Set([...REQUIRED_FIELDS, ...OPTIONAL_FIELDS]);
  const unknown = keys.filter((k) => !known.has(k));
  ck("every Zapier field is a field the route knows", unknown.length === 0, JSON.stringify(unknown));

  ck("the required ones are marked required",
    REQUIRED_FIELDS.every((f) => req.includes(f)),
    `route: ${REQUIRED_FIELDS} · app: ${req}`);
  // And no MORE than those, plus nothing: marking an optional field required
  // makes an integration fail over a value the route would have accepted.
  ck("and nothing else is", req.every((k) => REQUIRED_FIELDS.includes(k)), JSON.stringify(req));

  // A route field the app never offers is a capability nobody can reach.
  const missing = OPTIONAL_FIELDS.filter((f) => f !== "source" && !keys.includes(f));
  ck("every optional field is offered too", missing.length === 0, JSON.stringify(missing));
}

// ---- the body it builds --------------------------------------------------
const zStub = (answers = {}) => ({
  request: async (opts) => {
    zStub.last = opts;
    return { status: 200, data: answers[opts.url] || {}, json: answers[opts.url] || {} };
  },
  errors: {
    Error: class extends Error { constructor(m, c, s) { super(m); this.name = "ZapError"; this.code = c; this.status = s; } },
    RefreshAuthError: class extends Error { constructor(m) { super(m); this.name = "RefreshAuthError"; } },
  },
});

console.log("\n-- and the body it builds is one the route accepts --");
{
  const z = zStub({ "https://api.subsub.work/api/v1/jobs": { ok: true } });
  await jobCreate.operation.perform(z, {
    authData: { apiKey: "ssk_test" },
    inputData: {
      externalId: "CRM-1041", title: "Reroof — 14 Alder Way",
      trades: ["roofing", "gutters"],
      // Zapier hands a datetime field back as a full ISO timestamp.
      date: "2026-10-14T08:00:00-07:00",
      address: "14 Alder Way", area: "Seattle", zip: "98101",
      client: "M. Okafor", sqft: "2400",
      // Left blank on the form, which is the ordinary case.
      scope: "", notes: "   ", stories: "",
    },
  });
  const sent = zStub.last.body;
  ck("it posts to the header endpoint", zStub.last.url.endsWith("/v1/jobs"), zStub.last.url);
  ck("with the token in an Authorization header",
    zStub.last.headers.Authorization === "Bearer ssk_test", JSON.stringify(zStub.last.headers));

  const check = validateIngest(sent, { tradeIds: TRADE_IDS });
  ck("and validateIngest accepts it", check.ok, JSON.stringify(check.errors || []));

  // The one transformation the app makes, and the reason it makes it: asking
  // for a date-shaped string instead would force a Formatter step, which is
  // one more place to get a date wrong.
  ck("the timestamp is cut to the day", sent.date === "2026-10-14", String(sent.date));

  ck("a blank optional is omitted, not sent empty",
    !("scope" in sent) && !("notes" in sent) && !("stories" in sent),
    JSON.stringify(Object.keys(sent)));
  ck("a filled number is a number", sent.sqft === 2400, JSON.stringify(sent.sqft));
  ck("and the trades survive", (sent.trades || []).join(",") === "roofing,gutters");
}

// ---- the dropdown --------------------------------------------------------
console.log("\n-- the dropdown is filled from the list that validates the answer --");
{
  const z = zStub({ "https://api.subsub.work/api/v1/trades": { trades: TRADES } });
  const rows = await tradeTrigger.operation.perform(z, { authData: { apiKey: "ssk_test" } });
  ck("it lists every trade", rows.length === TRADES.length, `${rows.length} vs ${TRADES.length}`);
  ck("each with an id Zapier can key on", rows.every((r) => r.id && TRADE_IDS.has(r.id)));
  ck("and a label a person would recognise",
    rows.every((r) => typeof r.label === "string" && r.label.length > 1),
    rows.slice(0, 3).map((r) => r.label).join(" | "));
  // Hidden, because nobody builds a Zap that fires when a trade exists.
  ck("the trigger does not sit in the trigger list", tradeTrigger.display.hidden === true);
  // The create's dropdown has to point AT it, or the field is a text box.
  const tradesField = jobCreate.operation.inputFields.find((f) => f.key === "trades");
  ck("and the Trades field uses it", tradesField.dynamic === "trade.id.label", String(tradesField.dynamic));
  ck("as a list, because a job has more than one", tradesField.list === true);
}

// ---- what a person sees when it fails ------------------------------------
console.log("\n-- a refusal reaches a person, naming the field --");
{
  const z = zStub();
  let said = null;
  try {
    handleError({ status: 400, json: {
      error: "invalid_request", message: "Some fields were missing or not understood.",
      errors: [{ field: "externalId", code: "required", message: "externalId is missing" }],
    } }, z);
  } catch (e) { said = e; }
  ck("a 400 throws rather than returning", !!said);
  ck("and names the field", /externalId/.test(said.message), said.message);

  let authErr = null;
  try { handleError({ status: 401, json: { error: "invalid_token" } }, z); }
  catch (e) { authErr = e; }
  // RefreshAuthError is what tells Zapier the CONNECTION is the problem. A
  // plain error reports a broken Zap and sends somebody to their fields.
  ck("a 401 asks them to reconnect rather than reporting a broken Zap",
    authErr && authErr.name === "RefreshAuthError", String(authErr && authErr.name));

  let plan = null;
  try { handleError({ status: 403, json: { error: "scale_required",
    message: "The SubSub API is part of the Scale plan." } }, z); }
  catch (e) { plan = e; }
  ck("and a plan refusal says so in words", /Scale plan/.test(plan.message), plan.message);

  // A success must pass straight through, or every call fails.
  ck("anything under 400 is left alone",
    handleError({ status: 201, json: { ok: true } }, z).status === 201);
}

// ---- the two endpoints it depends on -------------------------------------
console.log("\n-- and the endpoints it depends on answer --");
{
  const db = freshDb({ base: SCHEMA, migrations: [M048] });
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind,plan) VALUES
      ('acc_gc','Outerhome','outerhome','general_contractor','scale'),
      ('acc_basic','Thrifty Builders','thrifty','general_contractor','basic');
    INSERT INTO users(id,name,email) VALUES ('u_ad','Rae','rae@outerhome.test');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES ('m_ad','u_ad','acc_gc','admin');
  `);
  const env = { DB: makeD1(db) };
  const minted = await worker.fetch(new Request("https://api.subsub.work/api/api-tokens", {
    method: "POST",
    headers: { "X-User-Id": "u_ad", "X-Account-Id": "acc_gc", "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Zapier" }),
  }), env).then((r) => r.json());

  const get = async (path, tok) => {
    const res = await worker.fetch(new Request(`https://api.subsub.work/api/v1/${path}`,
      { headers: tok ? { Authorization: `Bearer ${tok}` } : {} }), env);
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };

  const me = await get("me", minted.token);
  ck("/v1/me answers for a good token", me.status === 200, String(me.status));
  // This is what labels the Zapier connection: with two SubSub accounts
  // connected, "SubSub" twice is picked by guessing.
  ck("naming the account, so a connection can be labelled",
    me.body.account?.name === "Outerhome", JSON.stringify(me.body.account));
  ck("and never a person, because no person made the call",
    !JSON.stringify(me.body).includes("Rae"), JSON.stringify(me.body));

  const bad = await get("me", "ssk_made_up");
  ck("a made-up token is refused", bad.status === 401, String(bad.status));
  const none = await get("me", null);
  ck("and a missing one says how to send it", none.status === 401 && /Authorization/.test(none.body.message || ""),
    JSON.stringify(none.body));

  const tr = await get("trades", minted.token);
  ck("/v1/trades answers the whole list", (tr.body.trades || []).length === TRADES.length,
    String((tr.body.trades || []).length));
  ck("with labels", (tr.body.trades || []).every((t) => t.id && t.label));
  ck("and it is not public", (await get("trades", null)).status === 401);

  // A READ endpoint is not a lighter door. The plan gate is on every call,
  // not only on minting, or Scale is a thing you buy once and keep.
  const bTok = await worker.fetch(new Request("https://api.subsub.work/api/api-tokens", {
    method: "POST",
    headers: { "X-User-Id": "u_ad", "X-Account-Id": "acc_gc", "Content-Type": "application/json" },
    body: JSON.stringify({ name: "x" }),
  }), env).then((r) => r.json());
  db.exec(`UPDATE accounts SET plan='basic' WHERE id='acc_gc'`);
  const after = await get("me", bTok.token);
  ck("a downgraded account is refused on a read too",
    after.status === 403 && after.body.error === "scale_required",
    `${after.status} ${JSON.stringify(after.body)}`);
}

// ---- one trade list ------------------------------------------------------
console.log("\n-- and there is one trade list, not three --");
{
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  ck("the browser builds its chips from the shared list",
    /const CATEGORIES = TRADES\.map\(/.test(app));
  // A trade with no icon renders a blank square, which is cosmetic -- but it
  // is also the signal that somebody added a trade and stopped halfway.
  const iconBlock = app.slice(app.indexOf("const TRADE_ICON = {"), app.indexOf("const CATEGORIES = TRADES"));
  const without = TRADES.filter((t) => !new RegExp(`\\b${t.id}:`).test(iconBlock));
  ck("and every trade has an icon", without.length === 0, JSON.stringify(without.map((t) => t.id)));
  // The Worker must not have grown its own copy back.
  const w = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");
  ck("the Worker imports the list rather than restating it",
    /from "\.\.\/shared\/trades\.js"/.test(w) && !/const TRADE_IDS = new Set\(\[/.test(w));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
