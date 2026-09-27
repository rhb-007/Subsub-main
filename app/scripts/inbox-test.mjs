// Every pack one person has been sent, on one page.
//
// A general contractor asked three subcontractors for paperwork and got three
// unrelated links, each expiring on its own schedule. The value of those links
// grows with every new one and nothing was adding them up -- so the person with
// the most reason to want SubSub had the least reason to notice it existed.
//
// This is the demand side of the loop and the only half that PULLS: the
// subcontractors do the data entry, the recipient accumulates a roster they did
// not build, and claiming it lands them in an account already populated.
//
// The load-bearing part is not the page, it is what reaching it costs:
//
//   A SHARE TOKEN IS NOT PROOF OF THE MAILBOX. It proves somebody holds one
//   link that was emailed to an address. Certificates get forwarded -- that is
//   most of what they are for -- so without a second email a forwarded link
//   would open every pack ever sent to the forwarder.
//
//   NOTHING IN THE REQUEST NAMES AN ADDRESS. An endpoint that took one would
//   mail anybody's inbox to anybody.
//
//   node --no-warnings scripts/inbox-test.mjs

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { inboxState, rankInbox, inboxSummary, INBOX_DAYS } from "../shared/inbox.js";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const read = (f) => readFileSync(new URL(`../worker/migrations/${f}`, import.meta.url), "utf8");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const M031 = `ALTER TABLE accounts ADD COLUMN company_id TEXT REFERENCES companies(id);`;

const MAILPORT = 8959;
const inbox = [];
const mail = createServer((req, res) => {
  let b = ""; req.on("data", (d) => { b += d; });
  req.on("end", () => {
    try { inbox.push(JSON.parse(b || "{}")); } catch { /* ignore */ }
    res.writeHead(200, { "Content-Type": "application/json" }); res.end("{}");
  });
}).listen(MAILPORT);

const iso = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const ts = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 19).replace("T", " ");
const ENV = { RESEND_API_KEY: "k", MAIL_FROM: "SubSub <no@subsub.test>",
  RESEND_API_BASE: `http://127.0.0.1:${MAILPORT}` };
const hit = (env, path, method = "GET", body, seat) => worker.fetch(
  new Request(`https://api.subsub.work/api${path}`, {
    method,
    headers: { "Content-Type": "application/json",
      ...(seat ? { "X-User-Id": seat.u, "X-Account-Id": seat.a } : {}) },
    ...(method === "POST" ? { body: JSON.stringify(body || {}) } : {}),
  }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];
const one = (db, sql, ...b) => db.prepare(sql).get(...b);

// Priya at Cascade has been sent paperwork by three roofers. She has no
// account. Bo at Birch has been sent one, by one of the same roofers.
const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [M031,
    read("037_document_detail.sql"), read("041_doc_shares.sql"), read("045_inbox.sql")] });
  db.exec(`
    INSERT INTO companies(id,company,contact,city,state,insurance,bond) VALUES
      ('cmp_ridge','Ridge Roofing','Sam Ridge','Seattle','WA',1,1),
      ('cmp_bay','Bay Roofing','Rae Bay','Tacoma','WA',1,0),
      ('cmp_pine','Pine Roofing','Pip Pine','Everett','WA',1,0);
    INSERT INTO company_docs(id,company_id,kind,expires_on,uploaded_at) VALUES
      ('d1','cmp_ridge','insurance','${iso(200)}','${iso(-30)}'),
      ('d2','cmp_bay','insurance','${iso(-3)}','${iso(-400)}'),
      ('d3','cmp_pine','insurance','${iso(12)}','${iso(-350)}');
    INSERT INTO doc_shares(id,token,company_id,to_email,to_name,created_at,expires_at) VALUES
      ('s1','tok_ridge','cmp_ridge','pm@cascade.test','Priya','${ts(-9)}','${ts(5)}'),
      ('s2','tok_bay','cmp_bay','pm@cascade.test','Priya','${ts(-6)}','${ts(8)}'),
      ('s3','tok_pine','cmp_pine','pm@cascade.test','Priya','${ts(-2)}','${ts(12)}'),
      ('s4','tok_other','cmp_ridge','ops@birch.test','Bo','${ts(-3)}','${ts(11)}');`);
  return { db, env: { ...ENV, DB: makeD1(db) } };
};

console.log("\n-- the rules, before a database is involved --");
{
  ck("a live one is usable", inboxState({ token: "t", expiresAt: ts(2) }) === "active");
  ck("an expired one is not", inboxState({ token: "t", expiresAt: ts(-1) }) === "expired");
  ck("nor a revoked one",
    inboxState({ token: "t", expiresAt: ts(2), revokedAt: ts(-1) }) === "revoked");
  ck("nor one already claimed",
    inboxState({ token: "t", expiresAt: ts(2), claimedAt: ts(-1) }) === "claimed");
  ck("and a token that is not one reads unknown", inboxState({}) === "unknown");
  // Tighter than a share, because this opens all of them.
  ck("it lasts less time than a share", INBOX_DAYS < 14, String(INBOX_DAYS));
}

console.log("\n-- asking for it costs an email, and names no address --");
{
  inbox.length = 0;
  const { db, env } = seed();
  const [s, out] = await json(await hit(env, "/pack/tok_ridge/inbox", "POST"));
  ck("asking from a pack page works", s === 200 && out.sent === true, `${s} ${JSON.stringify(out)}`);
  ck("an email goes out", inbox.length === 1, String(inbox.length));
  ck("to the address on the share, which the caller never named",
    inbox[0]?.to?.[0] === "pm@cascade.test", JSON.stringify(inbox[0]?.to));
  // The reply must not confirm where it went: a forwarded token would
  // otherwise leak the forwarder's address.
  ck("the answer does not say where it went",
    !JSON.stringify(out).includes("cascade"), JSON.stringify(out));
  ck("and it says why it was emailed rather than just shown",
    /not proof you still read this mailbox/i.test(inbox[0]?.text || ""),
    (inbox[0]?.text || "").slice(0, 60));

  const tok = one(db, `SELECT token FROM doc_inboxes`).token;
  ck("a link is stored", !!tok);
  ck("which is not the share token", tok !== "tok_ridge");
  ck("and it is in the email", (inbox[0]?.text || "").includes(tok));

  // One live key per mailbox.
  inbox.length = 0;
  await json(await hit(env, "/pack/tok_bay/inbox", "POST"));
  ck("asking again replaces rather than adding a second key",
    one(db, `SELECT COUNT(*) AS n FROM doc_inboxes WHERE revoked_at IS NULL`).n === 1);
  ck("and the old one is revoked, not deleted",
    one(db, `SELECT COUNT(*) AS n FROM doc_inboxes`).n === 2);
  const [, dead] = await json(await hit(env, `/inbox/${tok}`));
  ck("the replaced link stops working", dead.error === "revoked", JSON.stringify(dead));
}

console.log("\n-- an unknown token gives nothing away --");
{
  inbox.length = 0;
  const { env } = seed();
  const [s, out] = await json(await hit(env, "/pack/not_a_token/inbox", "POST"));
  ck("it answers ok, like a real one", s === 200, String(s));
  ck("so a token cannot be tested with it", out.ok === true, JSON.stringify(out));
  ck("and no mail goes anywhere", inbox.length === 0, String(inbox.length));
  // A revoked share is a decision the subcontractor made.
  const { db, env: env2 } = seed();
  db.exec(`UPDATE doc_shares SET revoked_at='${ts(-1)}' WHERE token='tok_ridge'`);
  inbox.length = 0;
  await json(await hit(env2, "/pack/tok_ridge/inbox", "POST"));
  ck("nor does a revoked share open an inbox", inbox.length === 0, String(inbox.length));
}

console.log("\n-- what the page shows --");
{
  inbox.length = 0;
  const { db, env } = seed();
  await json(await hit(env, "/pack/tok_ridge/inbox", "POST"));
  const tok = one(db, `SELECT token FROM doc_inboxes WHERE revoked_at IS NULL`).token;
  const [s, box] = await json(await hit(env, `/inbox/${tok}`));
  ck("the inbox opens with no account", s === 200, String(s));
  ck("with all three subcontractors", box.rows.length === 3, String(box.rows.length));
  ck("named", box.rows.every((r) => !!r.company), JSON.stringify(box.rows.map((r) => r.company)));
  ck("and only the ones sent to THIS address",
    !JSON.stringify(box).includes("ops@birch"), "");

  // Sorted by what needs attention: that is why somebody opens this page.
  ck("the lapsed certificate is first", box.rows[0].company === "Bay Roofing",
    JSON.stringify(box.rows.map((r) => r.company)));
  ck("then the one expiring soonest", box.rows[1].company === "Pine Roofing");
  ck("the summary counts the problem", box.summary.expired === 1,
    JSON.stringify(box.summary));
  ck("and how many companies", box.summary.companies === 3);

  // Nothing about who else that subcontractor works for.
  ck("no sign of their other clients",
    !JSON.stringify(box).includes("birch") && !JSON.stringify(box).includes("Bo"));
  ck("each row carries a way into its own pack",
    box.rows.every((r) => !!r.token));

  const [bad] = await json(await hit(env, "/inbox/nope"));
  ck("an unknown inbox token is not found", bad === 404, String(bad));
}

console.log("\n-- claiming it builds the roster --");
{
  inbox.length = 0;
  const { db, env } = seed();
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind)
      VALUES ('acc_new','Cascade Management','cascade','property_manager');
    INSERT INTO users(id,name,email) VALUES ('u_priya','Priya','pm@cascade.test');
    INSERT INTO memberships(id,user_id,account_id,role)
      VALUES ('m1','u_priya','acc_new','admin');`);
  await json(await hit(env, "/pack/tok_ridge/inbox", "POST"));
  const tok = one(db, `SELECT token FROM doc_inboxes WHERE revoked_at IS NULL`).token;

  const [s, out] = await json(await hit(env, `/inbox/${tok}/claim`, "POST", {},
    { u: "u_priya", a: "acc_new" }));
  ck("claiming works", s === 200, `${s} ${JSON.stringify(out)}`);
  ck("all three land on the roster", out.added === 3, JSON.stringify(out));
  ck("as engagements on their account",
    one(db, `SELECT COUNT(*) AS n FROM engagements WHERE account_id='acc_new'`).n === 3);
  // A document share is agreement to be hireable by this person, not
  // agreement to have been hired.
  ck("invited, not active",
    one(db, `SELECT COUNT(*) AS n FROM engagements
              WHERE account_id='acc_new' AND status='invited'`).n === 3);
  ck("with a note saying where they came from",
    /already sent/i.test(one(db, `SELECT notes FROM engagements WHERE account_id='acc_new' LIMIT 1`).notes)
    || /sent you their documents/i.test(one(db, `SELECT notes FROM engagements WHERE account_id='acc_new' LIMIT 1`).notes),
    one(db, `SELECT notes FROM engagements WHERE account_id='acc_new' LIMIT 1`).notes);

  // The same link cannot populate a second account.
  const [again, body2] = await json(await hit(env, `/inbox/${tok}/claim`, "POST", {},
    { u: "u_priya", a: "acc_new" }));
  ck("and it cannot be claimed twice", again === 404 && body2.error === "claimed",
    `${again} ${JSON.stringify(body2)}`);
  ck("nor read afterwards",
    (await json(await hit(env, `/inbox/${tok}`)))[1].error === "claimed");
}

console.log("\n-- claiming is not something a stranger does --");
{
  const { db, env } = seed();
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind)
      VALUES ('acc_x','Somebody Else','somebody','general_contractor');
    INSERT INTO users(id,name,email) VALUES ('u_x','Ex','ex@x.test');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES ('mx','u_x','acc_x','pm');`);
  await json(await hit(env, "/pack/tok_ridge/inbox", "POST"));
  const tok = one(db, `SELECT token FROM doc_inboxes WHERE revoked_at IS NULL`).token;
  const [s] = await json(await hit(env, `/inbox/${tok}/claim`, "POST", {},
    { u: "u_x", a: "acc_x" }));
  // A project manager does not add contractors to an account's roster.
  ck("a project manager cannot claim one", s === 403, String(s));
  ck("and nothing was written",
    one(db, `SELECT COUNT(*) AS n FROM engagements`).n === 0);
}

mail.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
