// Who may write to a company's documents.
//
// `companies` is a SHARED row: one certificate, one set of booleans, read by
// every account that engages them. These two routes checked the contractor
// and nobody else, so an admin or a project manager could upload against --
// and DELETE from -- any company id at all.
//
// Reachable rather than theoretical:
//
//   GET /api/account-by-subdomain/<sub>   public, no auth, answers the account id
//   ownCompanyId                          derives cmp_own_<accountId> from it
//   DELETE /api/subs/<that>/documents/insurance   from any admin seat
//
// which runs `UPDATE companies SET insurance = 0`. missingDocs and docsComplete
// read that boolean, so it takes a general contractor off every roster they are
// on, and their clients are told they cannot be assigned work. On the POST side
// supersedeDoc retires the row that answers "were they insured on the day of
// that job" -- the record CLAUDE.md keeps for exactly that dispute.
//
// What this covers:
//
//   AN ENGAGEMENT IS REQUIRED to write another company's documents, which is
//   the check the review route three functions up already does.
//
//   AN ENDED ONE IS NOT ENOUGH. A finished relationship does not carry the
//   right to edit their paperwork afterwards.
//
//   A REFUSAL LOOKS LIKE A MISSING COMPANY, so a derived id cannot be probed
//   for whether it is real.
//
//   AND NOTHING LEGITIMATE BREAKS: a contractor still writes their own, and an
//   account still writes for a contractor they typed in themselves.
//
//   node --no-warnings scripts/docwrite-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const M031 = `ALTER TABLE accounts ADD COLUMN company_id TEXT REFERENCES companies(id);`;

// Alder hires Bay Roofing. Sound PM hires nobody in common with them, and its
// admin is the attacker: an ordinary customer account, no relationship at all.
const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [M031] });
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind) VALUES
      ('acc_a','Alder Construction','alder','general_contractor'),
      ('acc_s','Sound PM','sound','property_manager'),
      ('acc_out','Outerhome','outerhome','general_contractor');
    INSERT INTO companies(id,company,insurance,bond,doc_files) VALUES
      ('cmp_bay','Bay Roofing',1,1,'{"insurance":"bay-coi-2026.pdf","bond":"bay-bond.pdf"}'),
      ('cmp_typed','Typed In Plumbing',0,0,'{}'),
      ('cmp_own_acc_out','Outerhome',1,1,'{"insurance":"outerhome-coi.pdf"}');
    UPDATE accounts SET company_id = 'cmp_own_acc_out' WHERE id = 'acc_out';
    INSERT INTO users(id,name,email) VALUES
      ('u_alder','Pat Alder','pat@alder.test'),
      ('u_sound','Sam Sound','sam@sound.test'),
      ('u_bay','Rae Bay','rae@bayroofing.test');
    INSERT INTO memberships(id,user_id,account_id,role,company_id) VALUES
      ('m1','u_alder','acc_a','admin',NULL),
      ('m2','u_sound','acc_s','admin',NULL),
      ('m3','u_bay','acc_a','contractor','cmp_bay');
    INSERT INTO engagements(id,account_id,company_id,status) VALUES
      ('en_bay','acc_a','cmp_bay','active'),
      -- A contractor Alder typed in themselves. 'invited', never accepted, and
      -- uploading their certificate on their behalf is the documented case.
      ('en_typed','acc_a','cmp_typed','invited'),
      -- A relationship that is over.
      ('en_done','acc_s','cmp_bay','ended');`);
  return { db, env: { DB: makeD1(db) } };
};

const call = (env, who, acct, path, method, body) => worker.fetch(
  new Request(`https://api.subsub.work/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-User-Id": who, "X-Account-Id": acct },
    ...(method === "POST" ? { body: JSON.stringify(body || {}) } : {}),
  }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];
const one = (db, sql, ...b) => db.prepare(sql).get(...b);

console.log("\n-- the reported attack, end to end --");
{
  const { db, env } = seed();
  // Step 1 is public and needs no seat at all.
  const [ps, pub] = await json(await worker.fetch(
    new Request("https://api.subsub.work/api/account-by-subdomain/outerhome"), env));
  ck("the subdomain lookup is public", ps === 200, String(ps));
  ck("and answers with the account id", pub.id === "acc_out", String(pub.id));
  // Step 2 needs no call: the id is derived.
  const derived = `cmp_own_${pub.id}`;
  ck("from which the company id is derived", derived === "cmp_own_acc_out", derived);

  // Step 3, from an ordinary customer account with no relationship at all.
  const [ds, dbody] = await json(await call(env, "u_sound", "acc_s",
    `/subs/${derived}/documents/insurance`, "DELETE"));
  ck("deleting their certificate is refused", ds === 404, `${ds} ${JSON.stringify(dbody)}`);
  ck("their insurance flag is untouched",
    one(db, `SELECT insurance FROM companies WHERE id = ?`, derived).insurance === 1);
  ck("and the filename is still there",
    one(db, `SELECT doc_files FROM companies WHERE id = ?`, derived).doc_files
      .includes("outerhome-coi.pdf"));

  const [us] = await json(await call(env, "u_sound", "acc_s",
    `/subs/${derived}/documents/insurance`, "POST", { fileKey: "k", fileName: "forged.pdf" }));
  ck("uploading over it is refused too", us === 404, String(us));
  ck("nothing was written",
    !one(db, `SELECT doc_files FROM companies WHERE id = ?`, derived).doc_files
      .includes("forged.pdf"));
}

console.log("\n-- a refusal is indistinguishable from a company that is not there --");
{
  const { env } = seed();
  const [real] = await json(await call(env, "u_sound", "acc_s",
    "/subs/cmp_bay/documents/insurance", "DELETE"));
  const [fake] = await json(await call(env, "u_sound", "acc_s",
    "/subs/cmp_does_not_exist/documents/insurance", "DELETE"));
  ck("a real company they may not touch answers 404", real === 404, String(real));
  ck("an id that is not a company answers the same", fake === real, `${fake} vs ${real}`);
  // A 403 would say "this one is real, you just cannot have it", which is a
  // yes/no oracle over every derived id.
  ck("so a derived id cannot be probed for being real", real === fake);
}

console.log("\n-- an ended relationship is not a key they keep --");
{
  const { db, env } = seed();
  const [s] = await json(await call(env, "u_sound", "acc_s",
    "/subs/cmp_bay/documents/bond", "DELETE"));
  ck("Sound PM did engage Bay once", !!one(db,
    `SELECT 1 AS yes FROM engagements WHERE account_id='acc_s' AND company_id='cmp_bay'`));
  ck("but that is over, so the write is refused", s === 404, String(s));
  ck("Bay's bond survives",
    one(db, `SELECT bond FROM companies WHERE id='cmp_bay'`).bond === 1);
}

console.log("\n-- and everything legitimate still works --");
{
  const { db, env } = seed();
  // The account that actually hires them.
  const [s1] = await json(await call(env, "u_alder", "acc_a",
    "/subs/cmp_bay/documents/insurance", "POST",
    { fileKey: "k1", fileName: "bay-coi-2027.pdf", issuer: "Cascade Mutual" }));
  ck("their own contractor's certificate uploads", s1 === 200 || s1 === 201, String(s1));
  ck("and lands on the row",
    one(db, `SELECT doc_files FROM companies WHERE id='cmp_bay'`).doc_files
      .includes("bay-coi-2027.pdf"));

  // A contractor typed in by hand, never accepted: engagement is 'invited'.
  const [s2] = await json(await call(env, "u_alder", "acc_a",
    "/subs/cmp_typed/documents/insurance", "POST", { fileKey: "k2", fileName: "typed-coi.pdf" }));
  ck("so does one they typed in themselves", s2 === 200 || s2 === 201, String(s2));
  ck("which is the whole point of 'add one myself'",
    one(db, `SELECT insurance FROM companies WHERE id='cmp_typed'`).insurance === 1);

  // The subcontractor, on their own.
  const [s3] = await json(await call(env, "u_bay", "acc_a",
    "/subs/cmp_bay/documents/bond", "POST", { fileKey: "k3", fileName: "bay-bond-2027.pdf" }));
  ck("a contractor still writes their own", s3 === 200 || s3 === 201, String(s3));
  ck("but not somebody else's",
    (await json(await call(env, "u_bay", "acc_a",
      "/subs/cmp_typed/documents/bond", "POST", { fileKey: "k", fileName: "x.pdf" })))[0] === 404);

  // And deleting, from the account that hires them.
  const [s4] = await json(await call(env, "u_alder", "acc_a",
    "/subs/cmp_bay/documents/bond", "DELETE"));
  ck("an account may still remove their own contractor's document",
    s4 === 200, String(s4));
  ck("which really clears it",
    one(db, `SELECT bond FROM companies WHERE id='cmp_bay'`).bond === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
