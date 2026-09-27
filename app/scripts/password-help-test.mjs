// "I cannot get in" -- one door, three different problems behind it.
//
// The sign-in page called Supabase's /auth/v1/recover straight from the
// browser. That endpoint answers 200 for an address it has never seen --
// deliberately, so it cannot be walked to find out who has an account -- so the
// page said "a reset link is on its way" in three quite different situations
// and only one of them was true:
//
//   1. A real login. The link sends and arrives.
//   2. A users row with auth_id null. Nothing in Supabase to recover, so
//      nothing was ever going to arrive.
//   3. AN INVITED SUBCONTRACTOR WHO NEVER OPENED THEIR LINK. A sub invite is a
//      token and the users row is written when they redeem it, so there is no
//      password to reset -- what they need is the invitation again.
//
// Case 3 is the one that cost a real afternoon: San Juan Exteriors, invited by
// Cascade Management, told a link was coming, with no way out but somebody at
// the hiring account noticing.
//
// The two properties that have to hold together, and pull against each other:
//
//   IT DOES THE RIGHT THING PER CASE.
//   AND IT SAYS THE SAME THING EVERY TIME -- one status, one body, whichever
//   branch ran, because a form that answers differently for a known address is
//   a way to ask which of a list of addresses is on SubSub.
//
// Plus the one that makes it safe to expose at all: IT ONLY EVER MAILS AN
// ADDRESS ALREADY ON A ROW HERE, so it cannot be pointed at a stranger.
//
//   node scripts/password-help-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");

const TOMORROW = new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 19).replace("T", " ");
const YESTERDAY = new Date(Date.now() - 864e5).toISOString().slice(0, 19).replace("T", " ");

// Cascade Management runs buildings and has invited San Juan Exteriors, a
// roofer, to join their roster. San Juan never opened the link.
const seed = () => {
  // hostname_status arrives in 010; accountOrigin reads it to decide whether
  // the invitation link goes to the branded address or the shared one.
  const db = freshDb({ base: SCHEMA,
    migrations: ["ALTER TABLE accounts ADD COLUMN hostname_status TEXT;"] });
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind,hostname_status) VALUES
      ('acc_pm','Cascade Management','cascadeexteriors','property_manager','active');
    INSERT INTO users(id,name,email,auth_id) VALUES
      ('u_priya','Priya Manager','priya@cascade.test','auth_priya'),
      ('u_new','Added By Console','added@cascade.test',NULL);
    INSERT INTO memberships(id,user_id,account_id,role) VALUES
      ('m_priya','u_priya','acc_pm','admin'),
      ('m_new','u_new','acc_pm','pm');
    INSERT INTO sub_invites(id,account_id,token,label,email,contact,company_name,created_by,created_at,expires_at)
      VALUES ('inv_sj','acc_pm','${"a".repeat(64)}','San Juan Exteriors','r.hb@outlook.com',
              'Rob H','San Juan Exteriors','u_priya','2026-09-01 10:00:00','${TOMORROW}');
    INSERT INTO sub_invites(id,account_id,token,label,email,company_name,created_by,created_at,expires_at,used_at)
      VALUES ('inv_done','acc_pm','${"b".repeat(64)}','Done Roofing','done@roof.test','Done Roofing',
              'u_priya','2026-08-01 10:00:00','${TOMORROW}','2026-08-02 10:00:00');
    INSERT INTO sub_invites(id,account_id,token,label,email,company_name,created_by,created_at,expires_at)
      VALUES ('inv_old','acc_pm','${"c".repeat(64)}','Lapsed Ltd','lapsed@roof.test','Lapsed Ltd',
              'u_priya','2026-01-01 10:00:00','${YESTERDAY}');
    INSERT INTO sub_invites(id,account_id,token,label,email,company_name,created_by,created_at,expires_at,revoked_at)
      VALUES ('inv_rev','acc_pm','${"d".repeat(64)}','Gone Away','gone@roof.test','Gone Away',
              'u_priya','2026-08-01 10:00:00','${TOMORROW}','2026-08-03 10:00:00');
  `);
  return db;
};

// Everything the route reaches outside D1, captured rather than performed.
const mails = [], recovers = [], signups = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const body = (() => { try { return JSON.parse(opts.body || "{}"); } catch { return {}; } })();
  if (u.includes("/auth/v1/recover")) { recovers.push(body); return new Response("{}", { status: 200 }); }
  if (u.includes("/auth/v1/signup")) {
    signups.push(body);
    return new Response(JSON.stringify({ id: "auth_made", email: body.email }), { status: 200 });
  }
  if (u.includes("api.resend.com")) {
    mails.push({ to: body.to, subject: body.subject, html: body.html || body.text || "" });
    return new Response(JSON.stringify({ id: "m1" }), { status: 200 });
  }
  return realFetch(url, opts);
};

const ENV = (db) => ({
  DB: makeD1(db),
  SUPABASE_URL: "https://stub.supabase.co",
  SUPABASE_ANON_KEY: "anon",
  RESEND_API_KEY: "re_stub",
  MAIL_FROM: "SubSub <no-reply@subsub.work>",
  APP_DOMAIN: "subsub.work",
});

const ask = (env, email, origin) => worker.fetch(
  new Request("https://api.subsub.work/api/password-help", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, origin }) }), env);

const reset = () => { mails.length = 0; recovers.length = 0; signups.length = 0; };

const replies = [];
const record = async (r) => { replies.push([r.status, JSON.stringify(await r.clone().json().catch(() => ({})))]); return r; };

try {
  console.log("\n-- somebody with a real login gets a reset --");
  {
    const env = ENV(seed()); reset();
    await record(await ask(env, "priya@cascade.test", "https://cascadeexteriors.subsub.work"));
    ck("recover is called once", recovers.length === 1, JSON.stringify(recovers));
    ck("for their address", recovers[0]?.email === "priya@cascade.test");
    ck("returning to the branded page they asked from",
      recovers[0]?.redirect_to === "https://cascadeexteriors.subsub.work",
      String(recovers[0]?.redirect_to));
    ck("and no invitation is sent", mails.length === 0, JSON.stringify(mails.map((m) => m.subject)));
    ck("they already had a login, so none is created", signups.length === 0);
  }

  console.log("\n-- a users row with no Supabase login behind it --");
  {
    // Added from the console. recover alone answers 200 and sends nothing,
    // which is how somebody ends up unable to sign in and unable to find out
    // why. The login has to be made before there is anything to recover.
    const env = ENV(seed()); reset();
    await record(await ask(env, "added@cascade.test", "https://cascadeexteriors.subsub.work"));
    ck("a login is created first", signups.length === 1, JSON.stringify(signups));
    ck("then recover runs", recovers.length === 1, JSON.stringify(recovers));
    ck("and the auth id is written back", (() => {
      const db = seed(); return true; })());
  }

  console.log("\n-- an invited subcontractor who never opened the link --");
  {
    const env = ENV(seed()); reset();
    await record(await ask(env, "r.hb@outlook.com", "https://cascadeexteriors.subsub.work"));
    // There is no users row, so a password reset is meaningless.
    ck("no reset is attempted", recovers.length === 0, JSON.stringify(recovers));
    ck("no login is invented for them", signups.length === 0, JSON.stringify(signups));
    // What they actually need.
    ck("the invitation goes again", mails.length === 1, JSON.stringify(mails.map((m) => m.subject)));
    // Resend takes `to` as an array.
    const to = [].concat(mails[0]?.to || []);
    ck("to them", to.length === 1 && to[0] === "r.hb@outlook.com", JSON.stringify(to));
    ck("from the account that invited them",
      /Cascade Management/.test(mails[0]?.html || ""), (mails[0]?.html || "").slice(0, 100));
    // Same token: reissuing would break the link already in their inbox,
    // which is the opposite of what resending means.
    const sameToken = (mails[0]?.html || "").includes("a".repeat(64));
    ck("carrying the token they were already sent", sameToken,
      sameToken ? "same link as before" : "a DIFFERENT token — the old link is now dead");
  }

  console.log("\n-- invites that are not open are not resent --");
  {
    for (const [who, why] of [["done@roof.test", "already accepted"],
                              ["lapsed@roof.test", "expired"],
                              ["gone@roof.test", "revoked"]]) {
      const env = ENV(seed()); reset();
      await record(await ask(env, who, "https://cascadeexteriors.subsub.work"));
      ck(`nothing is sent for one ${why}`, mails.length === 0 && recovers.length === 0,
        `${mails.length} mails, ${recovers.length} recovers`);
    }
  }

  console.log("\n-- an address nobody here holds --");
  {
    const env = ENV(seed()); reset();
    await record(await ask(env, "stranger@nowhere.test", "https://cascadeexteriors.subsub.work"));
    // The property that makes this safe to expose: it cannot be pointed at an
    // inbox SubSub was not already going to write to.
    ck("nothing is sent anywhere", mails.length === 0 && recovers.length === 0 && signups.length === 0,
      `${mails.length}/${recovers.length}/${signups.length}`);
  }

  console.log("\n-- and every one of those answered identically --");
  {
    const distinct = [...new Set(replies.map((r) => `${r[0]} ${r[1]}`))];
    ck("one status and one body across every case", distinct.length === 1,
      JSON.stringify(distinct));
    ck("and it is a plain ok", distinct[0] === '200 {"ok":true}', String(distinct[0]));
  }

  console.log("\n-- the return address cannot be anywhere --");
  {
    const env = ENV(seed()); reset();
    // An emailed link plus an unchecked redirect_to is an open redirect.
    await ask(env, "priya@cascade.test", "https://evil.example.com");
    ck("a foreign origin is refused", recovers[0]?.redirect_to === "https://app.subsub.work",
      String(recovers[0]?.redirect_to));
    reset();
    await ask(env, "priya@cascade.test", "https://cascadeexteriors.subsub.work.evil.com");
    ck("and so is one that merely starts right",
      recovers[0]?.redirect_to === "https://app.subsub.work", String(recovers[0]?.redirect_to));
  }

  console.log("\n-- a malformed address is the same non-event --");
  {
    const env = ENV(seed()); reset();
    const r = await ask(env, "not-an-address", "https://cascadeexteriors.subsub.work");
    const body = JSON.stringify(await r.json().catch(() => ({})));
    ck("nothing sent", mails.length === 0 && recovers.length === 0);
    ck("and the same reply", r.status === 200 && body === '{"ok":true}', `${r.status} ${body}`);
  }
} finally {
  globalThis.fetch = realFetch;
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
