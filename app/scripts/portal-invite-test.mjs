// Getting a contractor who is already on the roster a login.
//
// Being on a roster and being able to sign in are two different records, and
// there was no way to get from the first to the second. The Contractors screen
// drew a company with no seat behind it exactly like one with a seat; the only
// invite flow started from a blank form; and "Forgot password" could only
// resend an invite that already existed. A roofer an account had typed in had
// no path to a login at all -- not from their card, not from the sign-in page,
// not from the console.
//
// What this covers:
//
//   IT IS BOUND TO THE COMPANY. The invite carries company_id from the moment
//   it is made, so redeeming it attaches the seat to THAT record. Deduping by
//   licence or email only lands back on the right row if the applicant retypes
//   what the account already holds, and "close enough, usually" is how a roster
//   grows a second copy of somebody.
//
//   AN OPEN INVITE IS RESENT, NOT REPLACED -- two live tokens for one
//   contractor is two links in one inbox and a list that reads as two people.
//
//   AND IT IS THEIR OWN ROSTER ONLY, answering not_found rather than 403 so it
//   cannot be walked to find out which company ids are real.
//
//   node scripts/portal-invite-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");

const mails = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const body = (() => { try { return JSON.parse(opts.body || "{}"); } catch { return {}; } })();
  if (u.includes("api.resend.com")) {
    mails.push({ to: [].concat(body.to || []), html: body.html || body.text || "" });
    return new Response(JSON.stringify({ id: "m1" }), { status: 200 });
  }
  return realFetch(url, opts);
};

// Cascade typed San Juan Exteriors in and never invited them. Arrived Roofing
// went through the normal flow and has a seat.
const seed = () => {
  const db = freshDb({ base: SCHEMA,
    migrations: ["ALTER TABLE accounts ADD COLUMN hostname_status TEXT;"] });
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind,hostname_status) VALUES
      ('acc_pm','Cascade Management','cascadeexteriors','property_manager','active'),
      ('acc_other','Someone Else','elsewhere','general_contractor',NULL);
    INSERT INTO users(id,name,email,auth_id) VALUES
      ('u_priya','Priya Manager','priya@cascade.test','auth_priya'),
      ('u_ada','Ada','ada@arrived.test','auth_ada');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES
      ('m_priya','u_priya','acc_pm','admin');
    INSERT INTO companies(id,company,contact,email,phone) VALUES
      ('cmp_sj','San Juan Exteriors','Rob H','r.hb@outlook.com','2065550100'),
      ('cmp_ok','Arrived Roofing','Ada','ada@arrived.test','2065550111'),
      ('cmp_none','No Contact Ltd','Nobody',NULL,NULL),
      ('cmp_far','Not Ours Inc','Stranger','far@away.test','2065550122');
    INSERT INTO engagements(id,account_id,company_id,status) VALUES
      ('e_sj','acc_pm','cmp_sj','invited'),
      ('e_ok','acc_pm','cmp_ok','active'),
      ('e_none','acc_pm','cmp_none','active'),
      ('e_far','acc_other','cmp_far','active');
    INSERT INTO memberships(id,user_id,account_id,role,company_id) VALUES
      ('m_ada','u_ada','acc_pm','contractor','cmp_ok');
  `);
  return { db, env: { DB: makeD1(db), RESEND_API_KEY: "re_stub",
    MAIL_FROM: "SubSub <no-reply@subsub.work>", APP_DOMAIN: "subsub.work" } };
};

const call = (env, who, acct, path, opts = {}) => worker.fetch(
  new Request(`https://api.subsub.work/api${path}`, { method: "POST", ...opts,
    headers: { "Content-Type": "application/json", "X-User-Id": who,
      "X-Account-Id": acct, ...(opts.headers || {}) } }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];

try {
  console.log("\n-- inviting a contractor who is already on the roster --");
  let db, env, token;
  {
    ({ db, env } = seed()); mails.length = 0;
    const [s, b] = await json(await call(env, "u_priya", "acc_pm", "/subs/cmp_sj/invite"));
    ck("it works", s === 200, `${s} ${JSON.stringify(b).slice(0, 90)}`);
    // Nothing retyped: the address comes off the record.
    ck("addressed to what is on the record",
      mails[0]?.to?.[0] === "r.hb@outlook.com", JSON.stringify(mails[0]?.to));
    ck("naming them", /San Juan Exteriors/.test(mails[0]?.html || ""));
    ck("and it is a first send, not a resend", b.resent === false, String(b.resent));

    const row = db.prepare(`SELECT * FROM sub_invites WHERE account_id='acc_pm'`).get();
    // THE POINT.
    ck("the invite is bound to the company", row.company_id === "cmp_sj", String(row.company_id));
    ck("and carries their name and address",
      row.company_name === "San Juan Exteriors" && row.email === "r.hb@outlook.com");
    token = row.token;
  }

  console.log("\n-- and redeeming it lands on that record, not a copy --");
  {
    const before = db.prepare(`SELECT COUNT(*) AS n FROM companies`).get().n;
    // Deliberately a DIFFERENT email and no licence: without the binding this
    // would dedupe to nothing and mint a second San Juan Exteriors.
    const r = await worker.fetch(new Request(
      `https://api.subsub.work/api/invite/${token}`,
      { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company: "San Juan Exteriors LLC", contact: "Rob H",
          email: "rob.typed.something.else@gmail.com", phone: "2065550100",
          categories: ["roofing"], password: "hunter2hunter2" }) }), env);
    ck("the application is accepted", r.status < 300, String(r.status));

    const after = db.prepare(`SELECT COUNT(*) AS n FROM companies`).get().n;
    ck("no second company was created", after === before, `${before} -> ${after}`);

    const seats = db.prepare(
      `SELECT company_id FROM memberships WHERE account_id='acc_pm' AND role='contractor'`).all();
    ck("the seat is on the record they were invited from",
      seats.some((m) => m.company_id === "cmp_sj"),
      JSON.stringify(seats.map((m) => m.company_id)));
    ck("and the invite is spent",
      !!db.prepare(`SELECT used_at FROM sub_invites WHERE token=?`).get(token).used_at);
  }

  console.log("\n-- a second press resends rather than minting another --");
  {
    ({ db, env } = seed()); mails.length = 0;
    await call(env, "u_priya", "acc_pm", "/subs/cmp_sj/invite");
    const first = db.prepare(`SELECT token FROM sub_invites WHERE account_id='acc_pm'`).get().token;
    const [, b] = await json(await call(env, "u_priya", "acc_pm", "/subs/cmp_sj/invite"));
    const rows = db.prepare(`SELECT token FROM sub_invites WHERE account_id='acc_pm'`).all();
    // Two live tokens for one contractor is two links in one inbox.
    ck("still one invite", rows.length === 1, String(rows.length));
    ck("the same token", rows[0].token === first);
    ck("and it says it resent", b.resent === true, String(b.resent));
    ck("a second email went", mails.length === 2, String(mails.length));
  }

  console.log("\n-- an invite raised from the old blank form is found and adopted --");
{
  // Every invite made before this route existed carries NO company_id: that
  // column is only written on redemption. Matching on it alone would miss all
  // of them and mint a second live token for somebody who already has one --
  // two links in one inbox, which is the exact thing this refuses to do.
  ({ db, env } = seed()); mails.length = 0;
  const expires = new Date(Date.now() + 20 * 864e5).toISOString();
  db.prepare(
    `INSERT INTO sub_invites(id,account_id,token,label,email,company_name,created_by,sent_at,expires_at)
     VALUES ('inv_old','acc_pm',?, 'San Juan Exteriors','r.hb@outlook.com','San Juan Exteriors',
             'u_priya','2026-09-01 10:00:00',?)`
  ).run("f".repeat(64), expires);

  const [s, b] = await json(await call(env, "u_priya", "acc_pm", "/subs/cmp_sj/invite"));
  ck("it finds the one already out", s === 200 && b.resent === true, `${s} resent=${b.resent}`);

  const rows = db.prepare(`SELECT id, token, company_id FROM sub_invites WHERE account_id='acc_pm'`).all();
  ck("no second invite is minted", rows.length === 1, String(rows.length));
  ck("and the token they already hold still works",
    rows[0].token === "f".repeat(64), rows[0].token.slice(0, 8));
  // Adopted on the way past, so redeeming it now binds to the right record.
  ck("it is bound to the company from now on", rows[0].company_id === "cmp_sj",
    String(rows[0].company_id));
  ck("and it went again", mails.length === 1 && mails[0].to[0] === "r.hb@outlook.com",
    JSON.stringify(mails[0]?.to));
}

console.log("\n-- and the cases it refuses --");
  {
    ({ db, env } = seed()); mails.length = 0;
    const [s1, b1] = await json(await call(env, "u_priya", "acc_pm", "/subs/cmp_ok/invite"));
    ck("somebody who can already sign in", s1 === 409 && b1.error === "already_has_login",
      `${s1} ${b1.error}`);

    const [s2, b2] = await json(await call(env, "u_priya", "acc_pm", "/subs/cmp_none/invite"));
    ck("a record with nowhere to send", s2 === 400 && b2.error === "no_contact", `${s2} ${b2.error}`);

    // Another account's contractor, and a company id that does not exist, give
    // the same answer -- so this cannot confirm which ids are real.
    const [s3, b3] = await json(await call(env, "u_priya", "acc_pm", "/subs/cmp_far/invite"));
    const [s4, b4] = await json(await call(env, "u_priya", "acc_pm", "/subs/cmp_nope/invite"));
    ck("somebody else's contractor is not found", s3 === 404 && b3.error === "not_found",
      `${s3} ${b3.error}`);
    ck("and reads exactly like one that does not exist",
      s3 === s4 && b3.error === b4.error, `${s4} ${b4.error}`);
    ck("nothing was sent for any of them", mails.length === 0, String(mails.length));
  }
} finally {
  globalThis.fetch = realFetch;
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
