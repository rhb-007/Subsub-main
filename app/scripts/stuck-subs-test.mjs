// Subcontractors who were asked to join and never arrived.
//
// Being on a roster and being able to sign in are two different records. A
// `companies` row plus an `engagements` row is what an account gets the moment
// it adds or invites somebody, and it is what the Contractors screen draws. A
// login is a `users` row plus a `memberships` row with role 'contractor', and
// it is only written when somebody opens the invite link and fills the form in.
//
// So an account can have a roster of ten with nine unable to get in, and until
// this screen nothing said so -- not to the customer, and not to staff either,
// because the console reads accounts and their own users and has never carried
// sub invites at all. A roofer invited by a property manager fell down exactly
// that hole: never sent the link, told on the sign-in page that a reset was
// coming, and invisible from every screen in the product.
//
// What this covers:
//
//   THE THREE WAYS TO BE STUCK ARE TOLD APART, because they need different
//   actions: an unredeemed invite, a company with no seat behind it, and a seat
//   that has never been signed in to.
//
//   OURS IS SEPARATED FROM THEIRS. A send that failed, or one that never
//   happened, is SubSub owing somebody an email. An invite nobody has opened is
//   a customer nudging a contractor. They look identical from the outside.
//
//   ONE PERSON IS ONE ROW. An invite and a roster entry for the same company
//   are the same person stuck in the same place.
//
//   AND IT IS STAFF-ONLY, because it reads across every account.
//
//   node scripts/stuck-subs-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { inviteStage, dedupe, rank, summarise, isOurs, STAGES } from "../shared/stuck.js";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");

const ahead = (days) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 19).replace("T", " ");
const T = (n) => String(n).padStart(2, "0").repeat(32);

console.log("\n-- the rules, on their own --");
{
  ck("an accepted invite is not stuck",
    inviteStage({ usedAt: "2026-01-01", expiresAt: ahead(10) }) === null);
  ck("nor is one somebody revoked on purpose",
    inviteStage({ revokedAt: "2026-01-01", expiresAt: ahead(10) }) === null);
  ck("a lapsed one needs re-issuing, not resending",
    inviteStage({ sentAt: "2026-01-01", expiresAt: ahead(-1) }) === "invite_expired");
  // Two different nothings that look the same from outside.
  ck("one that was never sent says so",
    inviteStage({ sentAt: null, expiresAt: ahead(10) }) === "never_sent");
  ck("and one whose send failed says that instead",
    inviteStage({ sentAt: "2026-01-01", expiresAt: ahead(10),
      lastEmail: { status: "failed" } }) === "send_failed");
  ck("a live one nobody has opened is waiting on them",
    inviteStage({ sentAt: "2026-01-01", expiresAt: ahead(10),
      lastEmail: { status: "sent" } }) === "invite_open");

  ck("ours is ours", isOurs("send_failed") && isOurs("never_sent"));
  ck("and theirs is not", !isOurs("invite_open") && !isOurs("no_login"));

  // The ordering is the screen's whole argument: fix what is ours first.
  const ranked = rank([
    { stage: "invite_open", since: "2026-01-01", accountId: "a" },
    { stage: "send_failed", since: "2026-09-01", accountId: "a" },
    { stage: "no_login", since: "2026-02-01", accountId: "a" },
  ]);
  ck("ours floats to the top whatever its age", ranked[0].stage === "send_failed",
    ranked.map((r) => r.stage).join(","));

  const once = dedupe([
    { accountId: "a", email: "Same@x.test", stage: "no_login", company: "X" },
    { accountId: "a", email: "same@x.test", stage: "never_sent", company: "X" },
  ]);
  ck("one person is one row", once.length === 1, JSON.stringify(once.map((r) => r.stage)));
  ck("kept as the more actionable reading", once[0].stage === "never_sent", once[0].stage);
  ck("every stage has a label and a note",
    STAGES.every(([k, l, n]) => k && l && n), JSON.stringify(STAGES.map((x) => x[0])));
}

// ---- the route, through real staff auth -----------------------------------
const kid = "test-key-1";
const pair = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256" }, true, ["sign", "verify"]);
const jwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid, alg: "RS256" };
delete jwk.key_ops; delete jwk.ext;

const TEAM = "subsub-test.cloudflareaccess.com";
const AUD = "aud-for-the-console";
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input?.url || "";
  if (url === `https://${TEAM}/cdn-cgi/access/certs`) {
    return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
  }
  return realFetch(input, init);
};
const b64url = (bytes) => Buffer.from(bytes).toString("base64")
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const mint = async (claims) => {
  const head = b64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", kid })));
  const body = b64url(new TextEncoder().encode(JSON.stringify(claims)));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey,
    new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
};
const token = await mint({ email: "sam@subsub.work", aud: [AUD],
  iss: `https://${TEAM}`, exp: Math.floor(Date.now() / 1000) + 3600 });

// Cascade Management's roster, in every state it can be in.
const seed = () => {
  const db = freshDb({ base: SCHEMA,
    migrations: ["ALTER TABLE accounts ADD COLUMN hostname_status TEXT;"] });
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind) VALUES
      ('acc_pm','Cascade Management','cascadeexteriors','property_manager');
    INSERT INTO users(id,name,email) VALUES ('u_staff','Sam Staff','sam@subsub.work');
    INSERT INTO superadmins(user_id,role,finance,impersonate) VALUES ('u_staff','superadmin',1,1);

    INSERT INTO companies(id,company,contact,email) VALUES
      ('cmp_sj','San Juan Exteriors','Rob H','r.hb@outlook.com'),
      ('cmp_ok','Arrived Roofing','Ada','ada@arrived.test'),
      ('cmp_typed','Typed In Ltd','Nobody',NULL),
      ('cmp_seat','Seat Made Co','Sam','sam@seatmade.test');
    INSERT INTO engagements(id,account_id,company_id,status,invited_at) VALUES
      ('e_sj','acc_pm','cmp_sj','invited','2026-09-01 09:00:00'),
      ('e_ok','acc_pm','cmp_ok','active','2026-05-01 09:00:00'),
      ('e_typed','acc_pm','cmp_typed','active','2026-06-01 09:00:00'),
      ('e_seat','acc_pm','cmp_seat','active','2026-07-01 09:00:00');

    -- Arrived Roofing signed in; Seat Made Co never has.
    INSERT INTO users(id,name,email,auth_id) VALUES
      ('u_ada','Ada','ada@arrived.test','auth_ada'),
      ('u_sam2','Sam','sam@seatmade.test',NULL);
    INSERT INTO memberships(id,user_id,account_id,role,company_id) VALUES
      ('m_ada','u_ada','acc_pm','contractor','cmp_ok'),
      ('m_sam2','u_sam2','acc_pm','contractor','cmp_seat');

    -- The invite that never went anywhere.
    INSERT INTO sub_invites(id,account_id,token,label,email,contact,company_name,created_at,expires_at)
      VALUES ('inv_sj','acc_pm','${T(1)}','San Juan Exteriors','r.hb@outlook.com','Rob H',
              'San Juan Exteriors','2026-09-01 09:00:00','${ahead(20)}');
    -- Sent, still open, nobody has clicked it.
    INSERT INTO sub_invites(id,account_id,token,label,email,company_name,created_at,sent_at,expires_at)
      VALUES ('inv_wait','acc_pm','${T(2)}','Waiting Ltd','wait@x.test','Waiting Ltd',
              '2026-09-10 09:00:00','2026-09-10 09:01:00','${ahead(20)}');
    -- Sent and bounced.
    INSERT INTO sub_invites(id,account_id,token,label,email,company_name,created_at,sent_at,expires_at)
      VALUES ('inv_bad','acc_pm','${T(3)}','Bounced Ltd','bad@x.test','Bounced Ltd',
              '2026-09-11 09:00:00','2026-09-11 09:01:00','${ahead(20)}');
    -- Lapsed.
    INSERT INTO sub_invites(id,account_id,token,label,email,company_name,created_at,sent_at,expires_at)
      VALUES ('inv_old','acc_pm','${T(4)}','Lapsed Ltd','old@x.test','Lapsed Ltd',
              '2026-01-01 09:00:00','2026-01-01 09:01:00','${ahead(-3)}');
    -- Accepted, and revoked: neither is stuck.
    INSERT INTO sub_invites(id,account_id,token,label,email,company_name,created_at,sent_at,expires_at,used_at)
      VALUES ('inv_done','acc_pm','${T(5)}','Arrived Roofing','ada@arrived.test','Arrived Roofing',
              '2026-05-01 09:00:00','2026-05-01 09:01:00','${ahead(20)}','2026-05-02 09:00:00');
    INSERT INTO sub_invites(id,account_id,token,label,email,company_name,created_at,sent_at,expires_at,revoked_at)
      VALUES ('inv_rev','acc_pm','${T(6)}','Gone Away','gone@x.test','Gone Away',
              '2026-06-01 09:00:00','2026-06-01 09:01:00','${ahead(20)}','2026-06-02 09:00:00');

    INSERT INTO email_log(id,account_id,to_email,kind,subject,status,error,at) VALUES
      ('el1','acc_pm','wait@x.test','sub_invite','You are invited','sent',NULL,'2026-09-10 09:01:00'),
      ('el2','acc_pm','bad@x.test','sub_invite','You are invited','failed','domain not verified','2026-09-11 09:01:00'),
      ('el3','acc_pm','ada@arrived.test','sub_invite','You are invited','sent',NULL,'2026-05-01 09:01:00');
  `);
  // Supabase set as well, so a call with no Access token takes the production
  // fall-through (no session -> 401) rather than the "auth not configured"
  // branch, which would make the refusal look like a misconfiguration.
  return { db, env: { DB: makeD1(db), ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD,
    STAFF_EMAIL_DOMAIN: "subsub.work",
    SUPABASE_URL: "https://stub.supabase.co", SUPABASE_ANON_KEY: "anon" } };
};

const call = (env, opts = {}) => worker.fetch(
  new Request("https://api.subsub.work/api/platform/stuck-subs", { ...opts,
    headers: { "Content-Type": "application/json",
      "Cf-Access-Jwt-Assertion": token, ...(opts.headers || {}) } }), env);

try {
  console.log("\n-- the console can finally see them --");
  const { env } = seed();
  const res = await call(env);
  const body = await res.json();
  const by = Object.fromEntries((body.rows || []).map((r) => [r.company, r]));

  ck("it answers staff", res.status === 200, String(res.status));
  ck("San Juan Exteriors is on the list", !!by["San Juan Exteriors"],
    JSON.stringify(Object.keys(by)));
  // The whole point: SubSub never tried, so this is not theirs to chase.
  ck("and it is ours, not theirs", by["San Juan Exteriors"]?.stage === "never_sent",
    String(by["San Juan Exteriors"]?.stage));
  ck("named with the account that invited them",
    by["San Juan Exteriors"]?.account === "Cascade Management",
    String(by["San Juan Exteriors"]?.account));
  ck("carrying the address to chase", by["San Juan Exteriors"]?.email === "r.hb@outlook.com");
  ck("and saying no mail was ever attempted",
    by["San Juan Exteriors"]?.lastEmail === null,
    JSON.stringify(by["San Juan Exteriors"]?.lastEmail));

  ck("a bounced invite reads as a failed send", by["Bounced Ltd"]?.stage === "send_failed",
    String(by["Bounced Ltd"]?.stage));
  ck("with the provider's reason on the row",
    /domain not verified/.test(by["Bounced Ltd"]?.lastEmail?.error || ""),
    JSON.stringify(by["Bounced Ltd"]?.lastEmail));
  ck("one that went and was ignored is waiting on them",
    by["Waiting Ltd"]?.stage === "invite_open", String(by["Waiting Ltd"]?.stage));
  ck("a lapsed one needs re-issuing", by["Lapsed Ltd"]?.stage === "invite_expired",
    String(by["Lapsed Ltd"]?.stage));

  // The two states that are not invites at all.
  ck("a company typed in with no seat behind it shows up",
    by["Typed In Ltd"]?.stage === "no_login", String(by["Typed In Ltd"]?.stage));
  ck("and a seat nobody has ever signed in to",
    by["Seat Made Co"]?.stage === "never_signed_in", String(by["Seat Made Co"]?.stage));

  console.log("\n-- and it leaves alone the ones who are fine --");
  ck("somebody who arrived is not listed", !by["Arrived Roofing"],
    JSON.stringify(Object.keys(by)));
  ck("nor is a revoked invite", !by["Gone Away"], JSON.stringify(Object.keys(by)));

  console.log("\n-- one person, one row --");
  // San Juan has BOTH an open invite and an 'invited' engagement. Listing both
  // reads as two problems and doubles every count on the screen.
  const sanJuan = (body.rows || []).filter((r) => /San Juan/.test(r.company));
  ck("not listed twice", sanJuan.length === 1, String(sanJuan.length));

  console.log("\n-- the summary is what the screen leads with --");
  ck("it counts them", body.summary?.total === (body.rows || []).length,
    `${body.summary?.total} vs ${body.rows?.length}`);
  ck("and says how many are ours", body.summary?.ours === 2, String(body.summary?.ours));
  ck("mail configuration is reported, since one cause explains many rows",
    body.mailConfigured === false, String(body.mailConfigured));

  console.log("\n-- it is staff-only --");
  {
    const { env: e2 } = seed();
    const anon = await worker.fetch(
      new Request("https://api.subsub.work/api/platform/stuck-subs"), e2);
    ck("no token, no list", anon.status === 401 || anon.status === 403, String(anon.status));
    const wrong = await mint({ email: "someone@gmail.com", aud: [AUD],
      iss: `https://${TEAM}`, exp: Math.floor(Date.now() / 1000) + 3600 });
    const outsider = await worker.fetch(
      new Request("https://api.subsub.work/api/platform/stuck-subs",
        { headers: { "Cf-Access-Jwt-Assertion": wrong } }), e2);
    ck("and a real token off the staff domain is refused", outsider.status === 403,
      String(outsider.status));
  }
} finally {
  globalThis.fetch = realFetch;
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
