// One account's subcontractors, from the admin console.
//
// The console already held every piece of this -- engagements, companies,
// memberships and users all come down whole in the bootstrap -- and the
// account screen showed a single number: "Subcontractors 4". So the question
// "who does this customer actually use?" could not be answered from the
// admin. The Team panel filters contractors out on purpose, and the Companies
// screen is organised by company rather than by customer, so finding one
// account's roster meant reading every company on the platform and checking
// which accounts each served.
//
// This covers the data half -- that the staff bootstrap carries what the
// panel needs, correctly scoped -- plus one thing the console was quietly
// getting wrong: `doc_review` was not selected at all, so "docs pending
// review" was structurally zero on every account and every screen that
// reported it was reporting nothing.
//
//   node --no-warnings scripts/console-roster-test.mjs

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");

// Supabase, enough that the real staff auth path gets an answer.
const supa = createServer((req, res) => {
  const who = String(req.headers.authorization || "").replace("Bearer ", "");
  if (!who || who === "nobody") { res.writeHead(401); return res.end("{}"); }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ id: `auth_${who}`, email: `${who}@subsub.test` }));
}).listen(8923);

const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const M031 = `ALTER TABLE accounts ADD COLUMN company_id TEXT REFERENCES companies(id);`;

const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [M031] });
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind,plan,billing) VALUES
      ('acc1','Cascade Management','cascade','property_manager','scale','monthly'),
      ('acc2','Sound PM','sound','property_manager','basic','monthly');
    INSERT INTO companies(id,company,contact,email,phone,city,state,license) VALUES
      ('cmp_sj','San Juan Exteriors','Richard Braun','rb@sanjuan.test','2065550100','Seattle','WA','SJ123'),
      ('cmp_ace','Ace Gutters','Danny Ace','danny@ace.test','2065550200','Tacoma','WA',NULL),
      ('cmp_far','Skagit Framing','Jo Skagit','jo@skagit.test','2065550300','Burlington','WA',NULL);
    INSERT INTO users(id,name,email,auth_id) VALUES
      ('u_staff','Staff Person','staff@subsub.test','auth_staff'),
      ('u_admin','Account Admin','admin@cascade.test',NULL),
      ('u_sj','Richard Braun','rb@sanjuan.test',NULL),
      ('u_jo','Jo Skagit','jo@skagit.test',NULL);
    INSERT INTO superadmins(user_id,role,finance,impersonate) VALUES ('u_staff','superadmin',1,1);
    INSERT INTO memberships(id,user_id,account_id,role,company_id) VALUES
      ('m1','u_admin','acc1','admin',NULL),
      ('m2','u_sj','acc1','contractor','cmp_sj'),
      -- Jo's seat is on acc2, not acc1. acc1 typed Skagit in separately.
      ('m3','u_jo','acc2','contractor','cmp_far');
    INSERT INTO engagements(id,account_id,company_id,status,categories,rating,rated_jobs,doc_review) VALUES
      ('en_sj','acc1','cmp_sj','active','["roofing"]',4.6,5,
        '{"insurance":{"status":"pending"},"bond":{"status":"verified"}}'),
      ('en_ace','acc1','cmp_ace','active','["gutters"]',0,0,
        '{"contract":{"status":"rejected","note":"not countersigned"}}'),
      ('en_far','acc1','cmp_far','paused','[]',0,0,'{}'),
      ('en_other','acc2','cmp_far','active','["framing"]',5,2,'{}');
  `);
  return { db, env: { DB: makeD1(db),
    SUPABASE_URL: "http://127.0.0.1:8923", SUPABASE_ANON_KEY: "stub",
    STAFF_ALLOW_PASSWORD: "1" } };
};

const boot = (env, who) => worker.fetch(
  new Request("https://api.subsub.work/api/platform/bootstrap",
    { headers: { Authorization: `Bearer ${who}` } }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];

try {
  console.log("\n-- the console is handed what the panel needs --");
  const { env } = seed();
  const [s, b] = await json(await boot(env, "staff"));
  ck("the bootstrap loads", s === 200 && !!b.engagements, String(s));

  const mine = (b.engagements || []).filter((e) => e.accountId === "acc1");
  ck("this account's three engagements are there", mine.length === 3,
    JSON.stringify(mine.map((e) => e.companyId)));
  ck("and the other account's is not among them",
    !mine.some((e) => e.id === "en_other"), JSON.stringify(mine.map((e) => e.id)));

  const co = Object.fromEntries((b.companies || []).map((c) => [c.id, c]));
  ck("every engaged company can be named", mine.every((e) => !!co[e.companyId]));
  // Without these the panel can show a name and nothing a support person
  // could act on -- no one to call, nowhere they are.
  ck("a company carries who to contact", co.cmp_sj?.contact === "Richard Braun", String(co.cmp_sj?.contact));
  ck("and how to reach them", co.cmp_sj?.email === "rb@sanjuan.test" && !!co.cmp_sj?.phone,
    `${co.cmp_sj?.email} ${co.cmp_sj?.phone}`);
  ck("and where they are", co.cmp_sj?.city === "Seattle" && co.cmp_sj?.state === "WA");

  console.log("\n-- the number that could only ever be zero --");
  {
    const sj = mine.find((e) => e.companyId === "cmp_sj");
    ck("doc_review arrives at all", !!sj.docReview, JSON.stringify(sj.docReview));
    ck("and it is parsed, not a string", typeof sj.docReview === "object");
    ck("a pending document is visible", sj.docReview?.insurance?.status === "pending",
      JSON.stringify(sj.docReview));
    ck("so is a verified one", sj.docReview?.bond?.status === "verified");
    const ace = mine.find((e) => e.companyId === "cmp_ace");
    ck("and a rejected one", ace.docReview?.contract?.status === "rejected",
      JSON.stringify(ace.docReview));
    // The count the account screen reports, computed the way the console does.
    const pending = mine.reduce((n, e) => n + ["insurance", "bond", "contract", "w9"]
      .filter((k) => e.docReview?.[k]?.status === "pending").length, 0);
    ck("the account's pending-docs count is now a real number", pending === 1, String(pending));
  }

  console.log("\n-- the roster and the ratings survive the trip --");
  {
    const sj = mine.find((e) => e.companyId === "cmp_sj");
    ck("trades come through as a list", Array.isArray(sj.categories) && sj.categories[0] === "roofing",
      JSON.stringify(sj.categories));
    ck("so does the rating", Number(sj.rating) === 4.6 && sj.ratedJobs === 5, `${sj.rating} ${sj.ratedJobs}`);
    const far = mine.find((e) => e.companyId === "cmp_far");
    ck("a paused engagement is still listed, and says so", far.status === "paused", far.status);
  }

  console.log("\n-- whose seat belongs to whom --");
  {
    const seatsFor = (companyId, accountId) => (b.memberships || [])
      .filter((m) => m.companyId === companyId && m.role === "contractor" && m.accountId === accountId);
    ck("a contractor with a seat here is found", seatsFor("cmp_sj", "acc1").length === 1);
    ck("a company this account typed in has none", seatsFor("cmp_ace", "acc1").length === 0);
    // The one that matters: Skagit has a login, but on acc2. Offering it on
    // acc1's screen would put a button there that opens somebody else's
    // customer's seat.
    ck("a seat held on another account is not this account's",
      seatsFor("cmp_far", "acc1").length === 0, JSON.stringify(seatsFor("cmp_far", "acc1")));
    ck("but it is still theirs on the account that has it",
      seatsFor("cmp_far", "acc2").length === 1);
  }

  console.log("\n-- and it is still staff only --");
  {
    ck("no session is refused", (await boot(env, "nobody")).status === 401);
    ck("a customer login is refused", (await boot(env, "admin@cascade")).status === 403);
  }
} finally {
  supa.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
