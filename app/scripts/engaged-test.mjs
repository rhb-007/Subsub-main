// A HANDYMAN IS NOT A SUBCONTRACTOR, through the real Worker.
//
// A roofing company on a general contractor's roster holds a licence, carries
// its own cover and works under a prime contract. The person a managing agent
// calls to change a tap washer, reset a breaker and paint a bedroom wall is
// not that -- and treating them as one leaves a maintenance worker
// permanently short of compliance over a certificate nobody asked them for,
// which is `docs.js`'s permanently-amber failure pointed at a person.
//
// What is pinned here is the handful of decisions a later pass would undo:
//
//   IT IS PER-ENGAGEMENT AND NEVER ON `companies`. That row is shared: one
//   account's handyman is another account's contractor.
//
//   NULL READS AS SUBCONTRACTOR, which is what every row written before this
//   is -- so the migration changes nothing about any existing roster, and an
//   unrecognised word fails toward the stricter answer rather than quietly
//   excusing a certificate.
//
//   THE TRADE GATE IS ON THE SERVER. The roster not offering somebody is not
//   the same as the route refusing them, and here that difference is a
//   maintenance worker sent to a roof.
//
//   AND BOTH BRANCHES ARE ASSERTED IN THE SAME PLACE. A rule checked only on
//   the handyman is the diagonal coverage that left `hiresLabel` half-wired:
//   a change that excused EVERYBODY their insurance would pass it.
//
//   node --no-warnings scripts/engaged-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { ENGAGED_AS, engagedAs, isEngagedAs, isHandyman, mayEngageHandyman,
  HANDYMAN_ACCOUNT_KINDS, HANDYMAN_TRADES, handymanCovers, tradesAllowed,
  mayCover, requiredDocsFor, needsLicense, ENGAGED_REFUSALS } from "../shared/engaged.js";
import { DOC_KINDS } from "../shared/docs.js";
import { TRADES } from "../shared/trades.js";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");

const VERIFIED = '{"insurance":{"status":"verified"},"bond":{"status":"verified"},'
  + '"contract":{"status":"verified"},"w9":{"status":"verified"}}';
// A handyman nobody has given a certificate, which is the ordinary state and
// the only fixture the excusing can be checked against: one with everything
// verified passes whichever rule is in force.
// The signed agreement is deliberately NOT excused: the request was about
// insurance and a licence, and whether a hiring account wants its own form
// signed is their call -- the rule this project already recorded. So the
// handyman carries a verified agreement and no cover, which is the only
// fixture that isolates what actually changed.
const NO_COVER = '{"contract":{"status":"verified"},"w9":{"status":"verified"}}';

const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO companies(id,company,contact,email,city,state,zip,license,insurance,bond,contract,w9,doc_files) VALUES
      ('cmp_fix','Ray the Fixer','Ray','ray@fix.test','Seattle','WA','98101',NULL,0,0,0,1,'{"w9":"w9.pdf"}'),
      ('cmp_roof','Bay Roofing Inc','Rae','rae@bay.test','Tacoma','WA','98402','BAYRR*222',1,1,1,1,
       '{"insurance":"coi.pdf","bond":"bond.pdf","contract":"agr.pdf","w9":"w9.pdf"}');
    INSERT INTO accounts(id,name,subdomain,kind,plan) VALUES
      ('acc_pm','Cascade Management','cascade','property_manager','scale'),
      -- The discriminating fixture for the account-kind half: a general
      -- contractor has no buildings, so nothing for a handyman to maintain.
      ('acc_gc','Outerhome','outerhome','general_contractor','scale');
    INSERT INTO engagements(id,account_id,company_id,status,categories,engaged_as,doc_review) VALUES
      ('en_fix','acc_pm','cmp_fix','active','["plumbing","painting"]','handyman','${NO_COVER}'),
      -- The same account, the same documents rule, a subcontractor: the only
      -- row the two branches can be told apart on.
      ('en_roof','acc_pm','cmp_roof','active','["roofing","plumbing"]','subcontractor','${VERIFIED}');
    INSERT INTO engagements(id,account_id,company_id,status,categories,doc_review) VALUES
      -- NULL engaged_as, which is every row written before the column: it has
      -- to read as a subcontractor without anything having been backfilled.
      ('en_gc','acc_gc','cmp_roof','active','["roofing"]','${VERIFIED}');
    INSERT INTO properties(id,account_id,owner_account_id,name,address,city,state,zip) VALUES
      ('p1','acc_pm','acc_pm','Press Apartments','1620 Belmont','Seattle','WA','98122');
    INSERT INTO jobs(id,account_id,property_id,title,date,trades,status) VALUES
      ('j_tap','acc_pm','p1','Dripping tap in 3B','2026-11-02','["plumbing"]','active'),
      ('j_roof','acc_pm','p1','Reroof the east wing','2026-11-20','["roofing"]','active');
    INSERT INTO users(id,name,email) VALUES
      ('u_pm','Chris Lane','chris@cascade.test'),
      ('u_gc','Dana Ruiz','dana@outerhome.test');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES
      ('m_pm','u_pm','acc_pm','admin'),
      ('m_gc','u_gc','acc_gc','admin');
  `);
  return { db, env: { DB: makeD1(db), FILES: { put: async () => {}, get: async () => null } } };
};

const call = (env, path, { method = "GET", body, who = "u_pm", acct = "acc_pm" } = {}) =>
  worker.fetch(new Request(`https://api.subsub.work${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json", "X-User-Id": who, "X-Account-Id": acct },
  }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];

console.log("\n-- the rule, before anything is driven --");
{
  // NULL AND AN UNRECOGNISED WORD BOTH READ AS SUBCONTRACTOR. The direction
  // that fails open is the one that stops asking for a certificate, so the
  // default is the strict answer rather than the permissive one.
  ck("an absent value is a subcontractor", engagedAs(null) === "subcontractor");
  ck("and so is a word nothing recognises", engagedAs("mate") === "subcontractor");
  ck("which is not accepted as a value", !isEngagedAs("mate") && isEngagedAs("handyman"));

  // WHICH ACCOUNTS HAVE HANDYMAN WORK: the ones with buildings. Named rather
  // than derived as "not a subcontractor-hirer", because a filter that
  // excludes the obvious exception is not one that includes the intended set
  // -- the shape that let an owner and a tenant into a Team panel.
  ck("the three kinds with buildings may engage one",
    ["property_manager", "building_owner", "portfolio_manager"].every(mayEngageHandyman));
  ck("a general contractor may not", !mayEngageHandyman("general_contractor"));
  ck("nor may a subcontractor account", !mayEngageHandyman("subcontractor"));
  ck("nor a kind nobody has heard of", !mayEngageHandyman("something_new"));

  // THE NAMED EXAMPLES. "Simple sink leaks, fuse popped, painting a bedroom
  // wall" -- if any of those three is off the list the feature does not do
  // what it was asked for.
  ck("a sink leak is handyman work", handymanCovers("plumbing"));
  ck("so is a tripped breaker", handymanCovers("electrical"));
  ck("so is painting a wall", handymanCovers("painting"));
  // And the heavy end is not. Roofing is the one that costs most if wrong.
  ck("a roof is not", !handymanCovers("roofing"));
  ck("nor is framing, HVAC or a foundation",
    !["framing", "hvac", "foundation"].some(handymanCovers));
  // Every id has to be a real trade, or the list silently narrows to nothing
  // and nobody would see it.
  const ids = new Set(TRADES.map((t) => t.id));
  const bad = HANDYMAN_TRADES.filter((t) => !ids.has(t));
  ck("every allowed trade exists", bad.length === 0, JSON.stringify(bad));
  ck("and it is a restriction rather than the whole list",
    HANDYMAN_TRADES.length > 0 && HANDYMAN_TRADES.length < TRADES.length,
    `${HANDYMAN_TRADES.length} of ${TRADES.length}`);

  // NULL FOR A SUBCONTRACTOR, NEVER THE FULL LIST. `[]` would mean narrowed
  // to nothing and the full list would go stale the day a trade is added --
  // the same asymmetry `jobScopeFrom` uses.
  ck("a subcontractor is unrestricted rather than listed", tradesAllowed("subcontractor") === null);
  ck("and covers a trade nothing allows a handyman", mayCover("subcontractor", "roofing"));
  ck("where a handyman does not", !mayCover("handyman", "roofing"));

  // WHAT THEY ARE ASKED FOR. Insurance and a bond come off; a W-9 does NOT,
  // because it is not cover at all -- it is the ability to report the
  // payment, which is why paygate.js reads it.
  const hm = requiredDocsFor("handyman", DOC_KINDS);
  ck("a handyman is not asked for insurance", !hm.includes("insurance"), JSON.stringify(hm));
  ck("nor a bond", !hm.includes("bond"), JSON.stringify(hm));
  ck("but is still asked for a W-9", hm.includes("w9"), JSON.stringify(hm));
  ck("a subcontractor is asked for all of them",
    requiredDocsFor("subcontractor", DOC_KINDS).length === DOC_KINDS.length);
  ck("and a handyman needs no contractor licence", !needsLicense("handyman"));
  ck("where a subcontractor does", needsLicense("subcontractor"));

  // Every refusal carries its sentence, or a refused press is a dead end.
  const wordless = ["trade_not_handyman", "not_a_handyman_account", "bad_engaged_as"]
    .filter((r) => !ENGAGED_REFUSALS[r]);
  ck("every refusal has words", wordless.length === 0, wordless.join(" "));
  ck("and both relationships have a label and a note",
    Object.values(ENGAGED_AS).every((k) => k.label && k.note));
}

console.log("\n-- what the roster carries --");
{
  const { env } = seed();
  const [s, subs] = await json(await call(env, "/api/subs"));
  ck("the roster loads", s === 200 && subs.length === 2, `${s} ${subs.length}`);
  const fix = subs.find((x) => x.id === "cmp_fix");
  const roof = subs.find((x) => x.id === "cmp_roof");
  ck("a handyman says so", fix?.engagedAs === "handyman", JSON.stringify(fix?.engagedAs));
  ck("and a subcontractor says so", roof?.engagedAs === "subcontractor", JSON.stringify(roof?.engagedAs));

  // THE WHOLE POINT, as the roster draws it. Ray has no insurance, no bond
  // and no licence, and is not short of anything -- while Bay Roofing on the
  // same account is judged on all four.
  ck("a handyman with no certificate is still assignable",
    fix?.docAssignable === true, `${fix?.docState} ${fix?.docAssignable}`);
  ck("and reads as current rather than missing", fix?.docState === "current", String(fix?.docState));
  ck("while the subcontractor beside them is judged on everything",
    roof?.docAssignable === true && roof?.docState === "current",
    `${roof?.docState} ${roof?.docAssignable}`);

  // The NULL row, on the other account: every engagement that exists today.
  const [, gcSubs] = await json(await call(env, "/api/subs", { who: "u_gc", acct: "acc_gc" }));
  ck("a row written before the column reads as a subcontractor",
    gcSubs[0]?.engagedAs === "subcontractor", JSON.stringify(gcSubs[0]?.engagedAs));
}

console.log("\n-- and a subcontractor with no cover is still short --");
{
  // THE DIAGONAL-COVERAGE GUARD. Everything above would pass if the change
  // had excused EVERYBODY their insurance, so the same fixture is driven
  // with the word taken off.
  const { db, env } = seed();
  db.exec(`UPDATE engagements SET engaged_as = 'subcontractor' WHERE id = 'en_fix'`);
  const [, subs] = await json(await call(env, "/api/subs"));
  const fix = subs.find((x) => x.id === "cmp_fix");
  ck("the same company as a subcontractor is NOT assignable",
    fix?.docAssignable === false, `${fix?.docState} ${fix?.docAssignable}`);
  ck("and reads as missing", fix?.docState === "missing", String(fix?.docState));
}

console.log("\n-- setting it --");
{
  const { db, env } = seed();
  const [s] = await json(await call(env, "/api/subs/cmp_roof",
    { method: "PATCH", body: { engagedAs: "handyman" } }));
  ck("a managing agent may call somebody a handyman", s === 200, String(s));
  const row = db.prepare(`SELECT engaged_as FROM engagements WHERE id = 'en_roof'`).get();
  ck("and it is stored on the engagement", row.engaged_as === "handyman", row.engaged_as);
  // ON THE ENGAGEMENT AND NEVER ON THE COMPANY: that row is shared, so
  // writing the word there would say it for every other account too.
  const cols = db.prepare(`SELECT COUNT(*) AS n FROM pragma_table_info('companies')
    WHERE name IN ('engaged_as','handyman')`).get();
  ck("the shared company row carries no such column", cols.n === 0, String(cols.n));

  // The other account's view of the SAME company is untouched, which is the
  // property that makes it per-engagement rather than a fact about them.
  const [, gcSubs] = await json(await call(env, "/api/subs", { who: "u_gc", acct: "acc_gc" }));
  ck("the other account still has them as a subcontractor",
    gcSubs[0]?.engagedAs === "subcontractor", JSON.stringify(gcSubs[0]?.engagedAs));
}
{
  const { db, env } = seed();
  // A word the product does not produce, which CHECK.sql counts.
  const [s, out] = await json(await call(env, "/api/subs/cmp_roof",
    { method: "PATCH", body: { engagedAs: "mate" } }));
  ck("a word nothing recognises is refused", s === 400 && out.error === "bad_engaged_as", `${s} ${out.error}`);
  const row = db.prepare(`SELECT engaged_as FROM engagements WHERE id = 'en_roof'`).get();
  ck("and nothing was written", row.engaged_as === "subcontractor", String(row.engaged_as));
}
{
  const { db, env } = seed();
  // THE ACCOUNT-KIND HALF. Without it any account could relabel somebody and
  // walk the whole compliance gate -- so this is a permission, not a label.
  const [s, out] = await json(await call(env, "/api/subs/cmp_roof",
    { method: "PATCH", body: { engagedAs: "handyman" }, who: "u_gc", acct: "acc_gc" }));
  ck("a general contractor cannot engage a handyman",
    s === 409 && out.error === "not_a_handyman_account", `${s} ${out.error}`);
  const row = db.prepare(`SELECT engaged_as FROM engagements WHERE id = 'en_gc'`).get();
  ck("and nothing was written there either", !row.engaged_as, String(row.engaged_as));
}

console.log("\n-- what they may be sent to --");
{
  const { env } = seed();
  // THE GATE IS ON THE SERVER. The roster could simply not offer them and
  // this route would issue the work order anyway, which ends with a
  // maintenance worker on a roof.
  const [s, out] = await json(await call(env, "/api/jobs/j_roof/assign",
    { method: "POST", body: { trade: "roofing", companyId: "cmp_fix", value: 400 } }));
  ck("a handyman is refused a roof", s === 409 && out.error === "trade_not_handyman", `${s} ${out.error}`);
  ck("and the refusal names the trade", out.trade === "roofing", String(out.trade));

  // And the work they ARE engaged for goes through -- with no insurance, no
  // bond and no licence on the company, which is the whole feature.
  const [s2, out2] = await json(await call(env, "/api/jobs/j_tap/assign",
    { method: "POST", body: { trade: "plumbing", companyId: "cmp_fix", value: 180 } }));
  ck("a dripping tap goes through", s2 === 200 || s2 === 201, `${s2} ${JSON.stringify(out2).slice(0, 110)}`);
}
{
  // THE SAME TWO, ON A SUBCONTRACTOR, in the same place: a change that
  // refused everybody, or excused everybody, passes a one-branch suite.
  const { env } = seed();
  const [s] = await json(await call(env, "/api/jobs/j_roof/assign",
    { method: "POST", body: { trade: "roofing", companyId: "cmp_roof", value: 9000 } }));
  ck("a subcontractor is not refused the roof", s === 200 || s === 201, String(s));
}
{
  // AND THE DOCUMENT GATE FOLLOWS THE SAME RULE. A handyman with no
  // insurance verified must not be refused for want of one; a subcontractor
  // in the identical state must be.
  const { db, env } = seed();
  db.exec(`UPDATE engagements SET doc_review = '${NO_COVER}' WHERE id = 'en_roof'`);
  const [s, out] = await json(await call(env, "/api/jobs/j_tap/assign",
    { method: "POST", body: { trade: "plumbing", companyId: "cmp_roof", value: 180 } }));
  ck("a subcontractor with nothing verified is refused",
    s === 409 && out.error === "documents_incomplete", `${s} ${out.error}`);
  ck("and the refusal names what is missing",
    (out.missing || []).includes("insurance"), JSON.stringify(out.missing));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
