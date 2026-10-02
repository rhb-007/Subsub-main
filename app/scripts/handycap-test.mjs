// WHAT A HANDYMAN MAY BE CHARGED FOR WITHOUT A LICENCE, and the fact that
// saying so is never a refusal.
//
// `engaged_as = 'handyman'` shipped with no value ceiling at all, which
// CLAUDE.md recorded as open: a handyman could be issued a $40,000 work order
// for painting. Every state's licence exemption for unlicensed work is a dollar
// figure, so the ceiling is what makes the relationship mean anything.
//
// What is pinned here is the handful of decisions a later pass would undo:
//
//   IT WARNS AND NEVER BLOCKS. The figures are secondary-source and thirteen of
//   the fifty-one say so about themselves, so refusing a work order on one would
//   stop real work over a number nobody has checked. The route answers 201 with
//   the warning on it, and that is asserted as a STATUS as well as a body:
//   turning it into a 409 is the mutation this is here to catch.
//
//   THE STATE IS THE PROPERTY'S, NOT THE CONTRACTOR'S, because licensing
//   follows where the work is. Only a fixture whose building and whose company
//   are in DIFFERENT states can tell those apart, so the handyman is registered
//   in Oregon and the building is in Washington -- and $700 is over one and
//   under the other.
//
//   IT COUNTS THE WHOLE JOB, because splitting one project across invoices to
//   stay under a cap is the thing the dataset explicitly prohibits -- and a
//   per-work-order comparison is a screen that teaches it. Two $300 work orders
//   on one job are over a $500 cap.
//
//   AND THE COLOUR FOLLOWS THE MONEY. An excluded trade on a small figure is
//   the tap washer this feature was asked for, so it is a note; over the
//   figure it leads the verdict. A warning on every tap washer is the badge
//   nobody reads.
//
//   node --no-warnings scripts/handycap-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { HANDYMAN_CAPS, HANDYCAP_AS_OF, HANDYCAP_DISCLAIMER, CAP_BASES, isCapBasis,
  NEVER_EXEMPT_TRADES, neverExempt, capFor, capCentsFor, capVerifyQueue,
  HANDYMAN_GLOBAL_RULES, handymanCapCheck, handymanCapText } from "../shared/handycap.js";
import { US_STATES, stateName } from "../shared/states.js";
import { TRADES } from "../shared/trades.js";
import { HANDYMAN_TRADES } from "../shared/engaged.js";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const SRC = readFileSync(new URL("../shared/handycap.js", import.meta.url), "utf8");
const APP = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const W = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");

console.log("\n-- the dataset itself --");
{
  const codes = US_STATES.map((s) => s[0]);
  const keys = Object.keys(HANDYMAN_CAPS);
  // ALL FIFTY-ONE, for the reason the licensing hubs publish all fifty-one: a
  // partial map reads as an abandoned one, and a state with no entry answers
  // `unknown_state` on a screen where the reader's own state is the only one
  // they care about.
  ck("every jurisdiction states.js knows has a figure",
    codes.every((c) => keys.includes(c)), JSON.stringify(codes.filter((c) => !keys.includes(c))));
  ck("and nothing is in it that states.js has never heard of",
    keys.every((k) => codes.includes(k)), JSON.stringify(keys.filter((k) => !codes.includes(k))));
  ck("which is fifty states and DC", keys.length === 51, String(keys.length));

  // NO STATE NAME IS STORED. `stateName` already holds those, and a second
  // copy is the two-records-of-one-fact shape this project keeps paying for.
  ck("no row carries a state name of its own",
    !Object.values(HANDYMAN_CAPS).some((r) => "name" in r || "state" in r));
  ck("the label comes from states.js", handymanCapCheck({ engagedAs: "handyman", state: "WA" })
    .stateLabel === stateName("WA"));

  // INTERNAL CONSISTENCY, because a basis and a figure that disagree is a
  // sentence that contradicts itself on screen.
  const bad = Object.entries(HANDYMAN_CAPS).filter(([, r]) => !isCapBasis(r.basis));
  ck("every basis is one of the four", bad.length === 0, JSON.stringify(bad.map((x) => x[0])));
  ck("the four are the documented four",
    CAP_BASES.join(",") === "per_job,annual,none,no_state_license");
  const noneWrong = Object.entries(HANDYMAN_CAPS)
    .filter(([, r]) => r.basis === "none" && r.cap !== 0);
  ck("a state with no exemption carries no figure", noneWrong.length === 0,
    JSON.stringify(noneWrong.map((x) => x[0])));
  const nslWrong = Object.entries(HANDYMAN_CAPS)
    .filter(([, r]) => r.basis === "no_state_license" && r.cap !== null);
  ck("a state that licenses nobody carries none either", nslWrong.length === 0,
    JSON.stringify(nslWrong.map((x) => x[0])));
  const measured = Object.entries(HANDYMAN_CAPS)
    .filter(([, r]) => r.basis === "per_job" || r.basis === "annual");
  ck("every measurable basis has a positive figure",
    measured.every(([, r]) => typeof r.cap === "number" && r.cap > 0), String(measured.length));
  ck("and names what it takes to go above it",
    measured.every(([, r]) => typeof r.aboveCap === "string" && r.aboveCap.length > 2));

  // DOLLARS IN, CENTS OUT, once. A comparison between a dollar figure and a
  // cents figure is wrong by a hundred with nothing looking odd.
  ck("cents are a hundred times the dollars", capCentsFor("WA") === 50000 && capFor("WA").cap === 500);
  ck("and a state with no figure has no cents", capCentsFor("TX") === null);
  ck("an unknown code answers nothing at all", capFor("ZZ") === null && capCentsFor("ZZ") === null);

  // WHAT IS STILL OWED A READ, printed as a work queue rather than counted --
  // the rule the licensing dataset runs on. A count is not something anybody
  // can act on.
  const q = capVerifyQueue();
  ck("the unconfirmed figures are a named list", q.length > 0 && q.length < 51, q.join(" "));
  console.log(`       still to check against a state board: ${q.join(", ")}`);
  ck("the dataset says so about itself too",
    /verify each state/i.test(HANDYCAP_DISCLAIMER) && /not legal advice/i.test(HANDYCAP_DISCLAIMER));
  ck("and it is dated", /^\d{4}-\d{2}-\d{2}$/.test(HANDYCAP_AS_OF));

  // THE GLOBAL RULES, and the first of them is the one that bears on this
  // product's own trade list.
  ck("the four global rules are carried", HANDYMAN_GLOBAL_RULES.length === 4);
  ck("including the one about splitting invoices",
    HANDYMAN_GLOBAL_RULES.some((r) => /splitting/i.test(r)));
  ck("and the one about permits", HANDYMAN_GLOBAL_RULES.some((r) => /permit/i.test(r)));
}

console.log("\n-- the trades no exemption covers --");
{
  const ids = new Set(TRADES.map((t) => t.id));
  ck("every excluded id is a real trade",
    NEVER_EXEMPT_TRADES.every((t) => ids.has(t)), JSON.stringify(NEVER_EXEMPT_TRADES));
  // THE TENSION IS DELIBERATE AND BOTH HALVES ARE PINNED. `HANDYMAN_TRADES`
  // includes plumbing and electrical because a dripping tap and a tripped
  // breaker are what this was asked for; the dataset says those trades sit
  // outside every exemption. Keeping both is the decision -- the screen says
  // so rather than the product refusing the examples it was built for.
  ck("plumbing is still handyman work here", HANDYMAN_TRADES.includes("plumbing"));
  ck("and so is electrical", HANDYMAN_TRADES.includes("electrical"));
  ck("while both are flagged as outside every exemption",
    neverExempt("plumbing") && neverExempt("electrical"));
  ck("hvac is flagged and was never handyman work anyway",
    neverExempt("hvac") && !HANDYMAN_TRADES.includes("hvac"));
  ck("painting is not flagged", !neverExempt("painting"));
}

console.log("\n-- one assignment, read four ways --");
{
  const H = (o) => handymanCapCheck({ engagedAs: "handyman", ...o });

  // NOT A HANDYMAN, NOTHING TO SAY. A licensed subcontractor holds the licence
  // the exemption exists to avoid needing.
  ck("a subcontractor gets no check at all",
    handymanCapCheck({ engagedAs: "subcontractor", state: "WA", jobDollars: 90000 }) === null);
  ck("and so does a row with nothing on it",
    handymanCapCheck({ state: "WA", jobDollars: 90000 }) === null);

  // PER JOB, both directions -- pinning one passes with the comparison
  // inverted.
  const over = H({ state: "WA", trades: ["painting"], jobDollars: 1200 });
  ck("over a per-job cap warns", over.level === "warn" && over.reason === "over_per_job");
  ck("and says by how much", over.overByDollars === 700, String(over.overByDollars));
  const under = H({ state: "WA", trades: ["painting"], jobDollars: 300 });
  ck("under it does not warn", under.level === "note" && under.reason === "under_cap");
  ck("but still answers", under.capDollars === 500 && under.over === false);
  // EXACTLY AT THE CAP IS UNDER IT. The figure is the most that may be
  // charged, so equal is allowed -- and a `>=` here would refuse the one
  // number people actually quote.
  ck("exactly at the cap is not over", H({ state: "WA", jobDollars: 500 }).over === false);
  ck("a penny past it is", H({ state: "WA", jobDollars: 500.01 }).over === true);

  // NO EXEMPTION AT ALL is a different sentence from exceeding a figure, and it
  // warns at any amount including none -- engaging somebody unlicensed there is
  // the thing worth saying.
  const md = H({ state: "MD", trades: ["painting"], jobDollars: 50 });
  ck("a state with no exemption warns on $50", md.level === "warn" && md.reason === "no_exemption");
  ck("and warns with nothing typed yet",
    H({ state: "MD", trades: ["painting"] }).level === "warn");

  // A STATE THAT LICENSES NOBODY says so once and never warns.
  const tx = H({ state: "TX", trades: ["painting"], jobDollars: 40000 });
  ck("a no-licence state does not warn at any figure",
    tx.level === "note" && tx.reason === "no_state_license");
  ck("and its note names local rules", /local|city|county/i.test(tx.note + handymanCapText(tx).why));

  // ANNUAL, AND IT IS NAMED AS THIS ACCOUNT'S SLICE. The cap counts the
  // handyman's whole business; SubSub sees one client's worth, so a figure
  // presented as the answer would be a floor pretending to be a total.
  const yr = H({ state: "PA", trades: ["painting"], jobDollars: 400, accountYearDollars: 6200 });
  ck("past an annual cap warns", yr.level === "warn" && yr.reason === "over_annual");
  ck("and the figure it used is the year's", yr.figureIs === "year");
  ck("the words say SubSub cannot see the rest",
    /cannot see their other clients/i.test(handymanCapText(yr).why), handymanCapText(yr).why);
  // A SINGLE JOB OVER AN ANNUAL CAP IS OVER IT, with no year figure at all --
  // without this the one case nobody can argue with goes unreported.
  const big = H({ state: "MN", trades: ["painting"], jobDollars: 40000 });
  ck("one job over the annual cap still warns", big.reason === "over_annual" && big.figureIs === "job");
  ck("and says it is this one job", /on this one job/i.test(handymanCapText(big).why));
  // And an annual row nobody measured says that rather than "under".
  const idle = H({ state: "IA", trades: ["painting"] });
  ck("an unmeasured annual cap is not reported as under it",
    idle.reason === "cap_unmeasured" && idle.level === "note");

  // AN UNKNOWN STATE IS ITS OWN ANSWER, never a figure invented to fill the
  // gap -- only one of the two means "go and look something up".
  for (const [what, st] of [["missing", null], ["empty", ""], ["nonsense", "ZZ"]]) {
    const u = H({ state: st, trades: ["painting"], jobDollars: 900 });
    ck(`a ${what} state answers unknown_state`, u.reason === "unknown_state", JSON.stringify(u.reason));
    ck(`and warns rather than reassuring (${what})`, u.level === "warn");
    ck(`with no figure invented (${what})`, u.capDollars === null && u.over === false);
  }

  // THE EXCLUDED TRADE: a note under the cap, the verdict over it. Both
  // directions, because pinning one passes with the precedence reversed.
  const tap = H({ state: "CA", trades: ["plumbing"], jobDollars: 200 });
  ck("plumbing on a small job is a note, not a warning",
    tap.level === "note" && tap.reason === "under_cap", `${tap.level}/${tap.reason}`);
  ck("and the exclusion is still said",
    /outside every state/i.test(handymanCapText(tap).note), handymanCapText(tap).note);
  const repipe = H({ state: "CA", trades: ["plumbing"], jobDollars: 8000 });
  ck("plumbing over the cap leads the verdict", repipe.reason === "trade_not_exempt");
  ck("and warns", repipe.level === "warn");
  ck("two excluded trades are both named",
    (H({ state: "CA", trades: ["plumbing", "electrical"], jobDollars: 8000 })
      .excludedLabels || []).length === 2);
}

console.log("\n-- the words --");
{
  // NO RAW TRADE IDS AND NO MANGLED PROPER NOUNS. `windows_doors` in a
  // sentence, or a lowercased "l&i contractor registration", is the screen
  // saying something nobody wrote.
  const all = [];
  for (const code of Object.keys(HANDYMAN_CAPS)) {
    for (const fig of [0, 100, 999999]) {
      for (const tr of [["painting"], ["plumbing"], ["windows_doors"]]) {
        const c = handymanCapCheck({ engagedAs: "handyman", state: code, trades: tr, jobDollars: fig });
        all.push({ code, fig, t: handymanCapText(c), c });
      }
    }
  }
  ck("every state and figure produces a verdict",
    all.every((x) => x.t.head.length > 0 && x.t.why.length > 0), String(all.length));
  const ids = TRADES.map((t) => t.id).filter((t) => t.includes("_"));
  const leaky = all.filter((x) => ids.some((id) =>
    `${x.t.head} ${x.t.why} ${x.t.note}`.includes(id)));
  ck("no raw trade id reaches the words", leaky.length === 0,
    JSON.stringify(leaky.slice(0, 2).map((x) => x.t.head)));
  const lowered = all.filter((x) => /needs l&i|needs mhic|needs hic|needs cslb/i.test(x.t.why));
  ck("the licensing authority is never lowercased into a sentence", lowered.length === 0,
    JSON.stringify(lowered.slice(0, 2).map((x) => x.t.why)));
  // A `${}` surviving into rendered prose is five literal characters in front
  // of a reader -- the same class as a \uXXXX escape in JSX text, which this
  // project has shipped twice.
  const interp = all.filter((x) => /\$\{/.test(`${x.t.head} ${x.t.why} ${x.t.note}`));
  ck("no interpolation survives into the words", interp.length === 0,
    JSON.stringify(interp.slice(0, 2)));
  // THE NOTE IS PART OF THE ANSWER. Tennessee reads "within the limit" at
  // $9,000 and is $3,000 in nine named counties -- the figure alone is wrong
  // for anybody in one of them.
  const tn = handymanCapText(handymanCapCheck({ engagedAs: "handyman", state: "TN", jobDollars: 9000 }));
  ck("Tennessee's county carve-out rides with the figure",
    /3,000 in 9 counties/.test(tn.note), tn.note);
  const withNote = Object.keys(HANDYMAN_CAPS).filter((k) => HANDYMAN_CAPS[k].note);
  const carried = withNote.filter((k) => {
    const t = handymanCapText(handymanCapCheck({ engagedAs: "handyman", state: k, jobDollars: 100 }));
    return t.note.length > 0;
  });
  ck("every stored note is rendered somewhere", carried.length === withNote.length,
    `${carried.length}/${withNote.length}`);
  // And an unconfirmed figure says it is unconfirmed, wherever it is drawn.
  const q = capVerifyQueue();
  const said = q.filter((k) => /not been checked/i.test(
    handymanCapText(handymanCapCheck({ engagedAs: "handyman", state: k, jobDollars: 100 })).note));
  ck("every unconfirmed figure says so on screen", said.length === q.length,
    `${said.length}/${q.length}`);
  ck("and a confirmed one does not", !/not been checked/i.test(
    handymanCapText(handymanCapCheck({ engagedAs: "handyman", state: "AZ", jobDollars: 100 })).note));
}

// ---------------------------------------------------------------------------
// THROUGH THE REAL ROUTE.
//
// The discriminating fixture: the handyman is registered in OREGON ($1,000 per
// job) and the building is in WASHINGTON ($500). $700 is under one and over
// the other, so this is the only shape that can tell which state the check
// reads -- and reading the contractor's would be wrong, because licensing
// follows where the work is.
const VERIFIED_NO_COVER = '{"contract":{"status":"verified"},"w9":{"status":"verified"}}';
const ALL_VERIFIED = '{"insurance":{"status":"verified"},"bond":{"status":"verified"},'
  + '"contract":{"status":"verified"},"w9":{"status":"verified"}}';

const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO companies(id,company,contact,email,city,state,zip,license,insurance,bond,contract,w9,doc_files) VALUES
      ('cmp_fix','Ray the Fixer','Ray','ray@fix.test','Portland','OR','97201',NULL,0,0,0,1,'{"w9":"w9.pdf"}'),
      ('cmp_roof','Bay Roofing Inc','Rae','rae@bay.test','Tacoma','WA','98402','BAYRR*222',1,1,1,1,
       '{"insurance":"coi.pdf","bond":"bond.pdf","contract":"agr.pdf","w9":"w9.pdf"}');
    INSERT INTO accounts(id,name,subdomain,kind,plan) VALUES
      ('acc_pm','Cascade Management','cascade','property_manager','scale');
    INSERT INTO engagements(id,account_id,company_id,status,categories,engaged_as,doc_review) VALUES
      ('en_fix','acc_pm','cmp_fix','active','["plumbing","painting","drywall"]','handyman','${VERIFIED_NO_COVER}'),
      ('en_roof','acc_pm','cmp_roof','active','["roofing","painting"]','subcontractor','${ALL_VERIFIED}');
    INSERT INTO properties(id,account_id,owner_account_id,name,address,city,state,zip) VALUES
      ('p_wa','acc_pm','acc_pm','Press Apartments','1620 Belmont','Seattle','WA','98122'),
      ('p_tx','acc_pm','acc_pm','Lamar Lofts','900 Lamar','Austin','TX','78703');
    INSERT INTO jobs(id,account_id,property_id,title,date,trades,status) VALUES
      ('j_wa','acc_pm','p_wa','Paint 3B','2026-11-02','["painting","drywall"]','active'),
      ('j_wa2','acc_pm','p_wa','Patch and paint 4A','2026-11-09','["painting","drywall"]','active'),
      ('j_tx','acc_pm','p_tx','Paint 12','2026-11-05','["painting"]','active'),
      ('j_tap','acc_pm','p_wa','Dripping tap','2026-11-06','["plumbing"]','active'),
      -- A job at NO building, which is the one case nothing but the company's
      -- own state can answer.
      ('j_none','acc_pm',NULL,'Odd jobs','2026-11-12','["painting"]','active');
    INSERT INTO users(id,name,email) VALUES ('u_pm','Chris Lane','chris@cascade.test');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES ('m_pm','u_pm','acc_pm','admin');
  `);
  return { db, env: { DB: makeD1(db), FILES: { put: async () => {}, get: async () => null } } };
};

const call = (env, path, { method = "GET", body } = {}) =>
  worker.fetch(new Request(`https://api.subsub.work${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json", "X-User-Id": "u_pm", "X-Account-Id": "acc_pm" },
  }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];
const assign = async (env, jobId, body) =>
  json(await call(env, `/api/jobs/${jobId}/assign`, { method: "POST", body }));

console.log("\n-- through the assign route --");
{
  const { db, env } = seed();

  // THE CENTRAL CLAIM: it is a 201 with a warning on it, not a refusal.
  const [st, got] = await assign(env, "j_wa",
    { trade: "painting", companyId: "cmp_fix", value: "700" });
  ck("a handyman over the cap is still issued the work order", st === 201, `${st} ${JSON.stringify(got).slice(0, 160)}`);
  ck("and it carries a warning", got.capWarning?.level === "warn", JSON.stringify(got.capWarning?.reason));
  // THE STATE IS THE BUILDING'S. $700 is over Washington's $500 and under
  // Oregon's $1,000, and the company is the Oregon one -- so this assertion
  // fails if the check reads the contractor's state.
  ck("read off the building's state, not the contractor's",
    got.capWarning?.state === "WA", JSON.stringify(got.capWarning?.state));
  ck("against the right figure", got.capWarning?.capDollars === 500);
  ck("and the reason names the per-job cap", got.capWarning?.reason === "over_per_job");
  ck("with words on it ready to render",
    typeof got.capWarning?.text?.head === "string" && got.capWarning.text.head.length > 0,
    JSON.stringify(got.capWarning?.text?.head));

  // AND IT IS RECORDED, because a warning on a screen is not a record: "they
  // were told and issued it anyway" has to survive.
  const ev = db.prepare(
    `SELECT payload FROM events WHERE kind = 'wo.issued' ORDER BY rowid DESC LIMIT 1`).get();
  const meta = JSON.parse(ev?.payload || "{}");
  ck("the event log carries the verdict", meta.handymanCap?.reason === "over_per_job",
    JSON.stringify(meta.handymanCap));
  ck("with the figures beside it",
    meta.handymanCap?.capDollars === 500 && meta.handymanCap?.figureDollars === 700,
    JSON.stringify(meta.handymanCap));
  // The prose is deliberately NOT in the log: the words change and the log is
  // read months later.
  ck("and not the prose", !("text" in (meta.handymanCap || {})));

  // SPLITTING IS WHAT THE SUM EXISTS FOR. Two $300 work orders on one job are
  // $600 against a $500 cap, and a per-work-order comparison would call each
  // of them fine.
  const [s1, w1] = await assign(env, "j_wa2",
    { trade: "painting", companyId: "cmp_fix", value: "300" });
  ck("the first $300 line is under the cap",
    s1 === 201 && w1.capWarning?.over === false, JSON.stringify(w1.capWarning?.reason));
  const [s2, w2] = await assign(env, "j_wa2",
    { trade: "drywall", companyId: "cmp_fix", value: "300" });
  ck("a second $300 line on the same job is over it",
    s2 === 201 && w2.capWarning?.over === true, JSON.stringify(w2.capWarning?.reason));
  ck("because the figure is the whole job", w2.capWarning?.figureDollars === 600,
    JSON.stringify(w2.capWarning?.figureDollars));

  // A STATE WITH NO LICENCE SAYS SO AND DOES NOT WARN.
  const [s3, w3] = await assign(env, "j_tx",
    { trade: "painting", companyId: "cmp_fix", value: "40000" });
  ck("a Texas building does not warn at $40,000",
    s3 === 201 && w3.capWarning?.level === "note", JSON.stringify(w3.capWarning));
  ck("and names Texas", w3.capWarning?.state === "TX" && w3.capWarning?.reason === "no_state_license");

  // THE FALLBACK, which is the only thing a job at no building can answer.
  const [s4, w4] = await assign(env, "j_none",
    { trade: "painting", companyId: "cmp_fix", value: "700" });
  ck("a job at no building falls back to the contractor's state",
    s4 === 201 && w4.capWarning?.state === "OR", JSON.stringify(w4.capWarning?.state));
  ck("where $700 is under the figure", w4.capWarning?.over === false);

  // AN EXCLUDED TRADE, through the route, on the small job it was asked for.
  const [s5, w5] = await assign(env, "j_tap",
    { trade: "plumbing", companyId: "cmp_fix", value: "180" });
  ck("a tap washer is issued and not warned about",
    s5 === 201 && w5.capWarning?.level === "note", JSON.stringify(w5.capWarning?.reason));
  ck("while the exclusion is still on the record",
    (w5.capWarning?.excluded || []).includes("plumbing"), JSON.stringify(w5.capWarning?.excluded));

  // A SUBCONTRACTOR GETS NO WARNING AT ALL, which is the other branch and has
  // to be asserted in the same place: a change that warned about everybody
  // would pass a suite that only drove the handyman.
  const [s6, w6] = await assign(env, "j_wa",
    { trade: "drywall", companyId: "cmp_roof", value: "90000" });
  ck("a subcontractor at $90,000 is not warned about",
    s6 === 201 && w6.capWarning === null, `${s6} ${JSON.stringify(w6.capWarning)}`);
}

console.log("\n-- the screen and the route read one rule --");
{
  ck("the Worker imports the shared module", /from "\.\.\/shared\/handycap\.js"/.test(W));
  ck("and so does the browser", /from "\.\.\/shared\/handycap\.js"/.test(APP));
  ck("the browser does not keep its own figures", !/HANDYMAN_CAPS\s*=/.test(APP));
  ck("nor does the Worker", !/HANDYMAN_CAPS\s*=/.test(W));
  // NEVER A GATE. The route must not refuse on it, and the button must not be
  // disabled by it -- both halves, because either alone turns a warning into a
  // refusal in one of the two places.
  ck("the route never answers an error for it",
    !/handyman_cap|cap_exceeded|over_cap/.test(W));
  const issueGate = /disabled=\{openLines\.some\(\(t\) => !lineReady\(t\)\)\}/.test(APP);
  ck("Issue is gated on the value being filled in and nothing else", issueGate);
  ck("and the cap never reaches a disabled attribute",
    !/disabled=\{[^}]*cap(Chk|Say|Warning)/.test(APP));
  // The sentence has to be drawn, and from the shared words rather than a
  // second copy written beside them.
  ck("the screen renders the shared words", /handymanCapText\(/.test(APP));
  ck("in both the places the decision is taken",
    (APP.match(/handymanCapCheck\(/g) || []).length >= 2,
    String((APP.match(/handymanCapCheck\(/g) || []).length));
  // The module is a template-literal-free zone like the rest of shared/, and
  // its own prose must not contain the trap.
  ck("the module parses with no stray backtick in a comment",
    (SRC.match(/`/g) || []).length % 2 === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
