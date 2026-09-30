// Whose record is a roster entry?
//
// `companies` is a SHARED row -- one name, one contact, one licence, one set
// of crews, read by every account that engages them. `engagements` is this
// account's own. The server has enforced that since the PATCH back door was
// closed: `companyAnswersForItself` refuses the company half whenever anybody
// answers for the company, and it is deliberately UNSCOPED -- "does anybody
// answer for this at all", not "is there somebody *I* can ask".
//
// THE SCREEN ASKED THE OTHER QUESTION. `SubForm`'s lock read `hasPortal`,
// which /api/subs computes scoped to this account, so a roofer whose only
// login is on ANOTHER general contractor's account opened a fully editable
// three-step form over a record the server would refuse from anybody here.
// The exact hole the unscoped predicate was written to close, left open on
// the screen in front of it.
//
// AND THE REFUSAL VANISHED. updateSub patched optimistically and closed the
// modal; `persist` console.errors. So the edit showed as applied over a write
// that never happened -- "a save that reports success and writes nothing is
// how somebody re-types the same correction three times", which the server
// side refuses by construction and the browser reintroduced.
//
// What stays editable, deliberately: a contractor this account TYPED IN, with
// no login anywhere and no account of their own. Nobody else can correct that
// record, so refusing would leave a phone number nobody can fix.
//
//   node --no-warnings scripts/sub-edit-guard-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const APP = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

const GC = "acc_gc";
const TYPED = "cmp_typed";     // this account typed them in; nobody answers
const ELSEWHERE = "cmp_else";  // their only seat is on ANOTHER account
const OWNACCT = "cmp_own";     // they have a SubSub account of their own
const HERE = "cmp_here";       // they have a seat on THIS account

const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO companies(id,company,contact,email,phone,city,state,zip,license) VALUES
      ('cmp_gc','Outerhome LLC','Dana','dana@outerhome.test','2065550001','Seattle','WA','98101','OUTERH*111'),
      ('${TYPED}','Typed In Roofing','Pat','pat@typed.test','2065550002','Tacoma','WA','98402','TYPEDR*222'),
      ('${ELSEWHERE}','Elsewhere Siding','Kit','kit@else.test','2065550003','Olympia','WA','98501','ELSEWH*333'),
      ('${OWNACCT}','Own Account Gutters','Rae','rae@own.test','2065550004','Everett','WA','98201','OWNACC*444'),
      ('${HERE}','Seated Here Glass','Sam','sam@here.test','2065550005','Kent','WA','98032','SEATED*555');
    INSERT INTO accounts(id,name,subdomain,kind,plan,company_id) VALUES
      ('${GC}','Outerhome','outerhome','general_contractor','scale','cmp_gc'),
      ('acc_rival','Rival Builders','rival','general_contractor','basic',NULL),
      ('acc_theirs','Own Account Gutters','owngutters','subcontractor','basic','${OWNACCT}');
    INSERT INTO engagements(id,account_id,company_id,status,categories) VALUES
      ('en_t','${GC}','${TYPED}','active','["roofing"]'),
      ('en_e','${GC}','${ELSEWHERE}','active','["siding"]'),
      ('en_o','${GC}','${OWNACCT}','active','["gutters"]'),
      ('en_h','${GC}','${HERE}','active','["windows_doors"]'),
      ('en_rival','acc_rival','${ELSEWHERE}','active','["siding"]');
    INSERT INTO users(id,name,email) VALUES
      ('u_gc','Dana Ruiz','dana@outerhome.test'),
      ('u_else','Kit Ng','kit@else.test'),
      ('u_here','Sam Ojo','sam@here.test');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES ('m_gc','u_gc','${GC}','admin');
    -- THE CASE THAT WAS WRONG: their only contractor seat is on the rival's
    -- account, so this account's scoped count sees nothing.
    INSERT INTO memberships(id,user_id,account_id,role,company_id) VALUES
      ('m_else','u_else','acc_rival','contractor','${ELSEWHERE}'),
      ('m_here','u_here','${GC}','contractor','${HERE}');
  `);
  return db;
};

const ENV = (db) => ({ DB: makeD1(db) });
const call = async (env, path, { method = "GET", body } = {}) => {
  const res = await worker.fetch(new Request(`https://api.subsub.work${path}`, {
    method,
    headers: { "X-User-Id": "u_gc", "X-Account-Id": GC, "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }), env);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const rosterBy = async (env) => {
  const r = await call(env, "/api/subs");
  const out = {};
  for (const s of (r.body.subs || r.body || [])) out[s.id] = s;
  return out;
};

// ---------------------------------------------------------------------------
console.log("-- the roster says whose record each row is --");
{
  const db = seed(); const env = ENV(db);
  const by = await rosterBy(env);
  ck("a contractor this account typed in answers for nobody",
    by[TYPED]?.answersForItself === false, JSON.stringify(by[TYPED]?.answersForItself));
  ck("one with a seat on THIS account answers for themselves",
    by[HERE]?.answersForItself === true);
  ck("one with a SubSub account of their own does too",
    by[OWNACCT]?.answersForItself === true);
  // THE ONE THAT WAS WRONG. Scoped, this account sees no seat at all.
  ck("and so does one whose only seat is on ANOTHER account",
    by[ELSEWHERE]?.answersForItself === true, JSON.stringify(by[ELSEWHERE]?.answersForItself));

  // The scoped field still answers its own question, because the
  // auto-schedule switch asks "is there somebody I can ask?" on purpose.
  ck("hasPortal stays SCOPED -- it is a different question and both are needed",
    by[ELSEWHERE]?.hasPortal === false && by[HERE]?.hasPortal === true,
    `elsewhere ${by[ELSEWHERE]?.hasPortal} / here ${by[HERE]?.hasPortal}`);
  ck("so the two fields disagree on exactly the row that was the bug",
    by[ELSEWHERE].answersForItself !== by[ELSEWHERE].hasPortal);
}

console.log("\n-- and it is a YES/NO, never a count of who else hires them --");
{
  const db = seed(); const env = ENV(db);
  const by = await rosterBy(env);
  ck("answersForItself is a boolean", typeof by[ELSEWHERE].answersForItself === "boolean");
  // A count of seats across every account is a count of how many other people
  // hire them, which is their book and nobody else's to collect.
  const raw = JSON.stringify(by[ELSEWHERE]);
  ck("and the row carries no count of the other accounts that hire them",
    !/"seats"\s*:\s*[1-9]/.test(raw) && !/"clients"\s*:/.test(raw), raw.slice(0, 200));
}

console.log("\n-- what the server does with each, which is what the screen has to match --");
{
  const db = seed(); const env = ENV(db);
  const nameIt = (id) => call(env, `/api/subs/${id}`, { method: "PATCH", body: { company: "Renamed By Outerhome" } });

  const typed = await nameIt(TYPED);
  ck("a typed-in record IS this account's to correct",
    typed.status < 300, `${typed.status} ${JSON.stringify(typed.body)}`);
  ck("and the name really changed",
    db.prepare(`SELECT company AS c FROM companies WHERE id=?`).get(TYPED).c === "Renamed By Outerhome");

  for (const [id, label] of [[ELSEWHERE, "seated on another account"],
                             [OWNACCT, "with an account of their own"],
                             [HERE, "seated here"]]) {
    const r = await nameIt(id);
    ck(`a contractor ${label} is refused`,
      r.status === 409 && r.body.error === "company_not_yours",
      `${r.status} ${JSON.stringify(r.body)}`);
    ck(`  and their name is untouched`,
      db.prepare(`SELECT company AS c FROM companies WHERE id=?`).get(id).c !== "Renamed By Outerhome");
  }
}

console.log("\n-- the engagement half stays this account's, whoever they are --");
{
  const db = seed(); const env = ENV(db);
  // What you use them for, your notes and your rating are yours about them,
  // not facts about their business -- so they are editable on every row.
  const r = await call(env, `/api/subs/${ELSEWHERE}`, {
    method: "PATCH", body: { categories: ["roofing", "siding"], notes: "Good on steep pitches" } });
  ck("trades and notes save against a contractor who answers for themselves",
    r.status < 300, `${r.status} ${JSON.stringify(r.body)}`);
  const en = db.prepare(`SELECT categories, notes FROM engagements WHERE id='en_e'`).get();
  ck("and they land on the engagement",
    /roofing/.test(en.categories) && en.notes === "Good on steep pitches");
  ck("the rival's engagement with the same company is untouched",
    !/roofing/.test(db.prepare(`SELECT categories AS c FROM engagements WHERE id='en_rival'`).get().c));
}

console.log("\n-- the form reads the predicate the server enforces --");
{
  ck("the lock is on answersForItself", /const locked = !!existing\?\.answersForItself;/.test(APP));
  // The scoped one is the auto-schedule question and using it here is the bug.
  ck("and no longer on the scoped hasPortal",
    !/const locked = !!existing\?\.hasPortal;/.test(APP));
  // hasPortal must still be read where it belongs, or this "fix" deleted a
  // working rule instead of correcting one.
  ck("hasPortal still drives the things it is the right question for",
    /!sub\.hasPortal/.test(APP) && /portal=\{portal\}|portal: !!sub\.hasPortal|hasPortal/.test(APP));
  ck("a locked form collapses to the engagement half and says whose it is",
    /<h2>\{locked \? `How you work with \$\{existing\.company\}`/.test(APP));
}

console.log("\n-- a refused save does not read as a save --");
{
  // It awaits, THEN patches. The optimistic version closed the modal over a
  // write that never happened.
  ck("the save awaits the server before touching local state",
    /await api\.patchSub\(sub\.id, rest\);[\s\S]{0,300}\/\/ Only once the server has taken it\./.test(APP));
  ck("and says why when the server refuses",
    /company_not_yours[\s\S]{0,200}theirs to change, not yours/.test(APP));
  {
    const fn = (APP.match(/const updateSub = async \(sub\) => \{[\s\S]*?\n  \};/) || [""])[0];
    const body = fn.slice(fn.indexOf("} catch (err) {"));
    ck("the reason is drawn on the modal the form is in",
      /\{subSaveErr && <div className="form-err"/.test(APP));
    ck("and the modal is closed ONLY on success -- the catch never closes it",
      fn.includes("setEditing(null)") && !body.includes("setEditing(null)"),
      body.slice(0, 120));
  }
  // A stale message about a form that is no longer on screen is the sign-in
  // page's two-messages-at-once failure; closing clears it.
  ck("and closing the modal clears it",
    /onClose=\{\(\) => \{ setEditing\(null\); setSubSaveErr\(""\); \}\}/.test(APP));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
