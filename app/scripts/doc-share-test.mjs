// "Send my documents to a contractor."
//
// A subcontractor is asked for the same four documents several times a month,
// nearly always by a general contractor who is not on SubSub, and answers with
// email attachments that start going stale the moment they are sent. This is
// that act done once and kept live -- and it is the only path in the product
// where the free side can bring the paying side in, because every other way in
// needs the hiring account to exist first.
//
// Which makes the rules load-bearing, and they are what this file is about:
//
//   The W-9 is not in the link. It carries a TIN, and for a sole proprietor
//   that is their social security number. The page says it is on file; the
//   document itself needs an account.
//
//   One token, one share, one company. A document id from another company, or
//   the W-9 from this one, gets the same nothing.
//
//   A link runs out and can be withdrawn, and both of those actually close it.
//
//   node scripts/doc-share-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { inLink, shareState, validRecipient, packRow, SHARE_DAYS } from "../shared/docshare.js";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const M030 = readFileSync(new URL("../worker/migrations/030_connect_requests.sql", import.meta.url), "utf8");
const M037 = readFileSync(new URL("../worker/migrations/037_document_detail.sql", import.meta.url), "utf8");
const M041 = readFileSync(new URL("../worker/migrations/041_doc_shares.sql", import.meta.url), "utf8");
const M031 = `ALTER TABLE accounts ADD COLUMN company_id TEXT REFERENCES companies(id);`;

// Ridge Roofing has a seat of their own and a full set of paperwork. Another
// company's documents exist too, because "can this token reach them" is the
// question that matters most here.
const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [M030, M031, M037, M041] });
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind) VALUES
      ('acc_gc','Outerhome','outerhome','general_contractor');
    INSERT INTO companies(id,company,contact,city,state,license) VALUES
      ('cmp_ridge','Ridge Roofing','Sam Ridge','Seattle','WA','RIDGERR891QZ'),
      ('cmp_other','Somebody Else','Nobody','Tacoma','WA',NULL);
    INSERT INTO users(id,name,email,auth_id) VALUES
      ('u_sam','Sam Ridge','sam@ridge.test','auth_sam');
    INSERT INTO memberships(id,user_id,account_id,role,company_id) VALUES
      ('m_sam','u_sam','acc_gc','contractor','cmp_ridge');
    INSERT INTO engagements(id,account_id,company_id,status,categories)
      VALUES ('en1','acc_gc','cmp_ridge','active','["roofing"]');
    INSERT INTO company_docs(id,company_id,kind,file_key,file_name,issuer,policy_no,coverage_cents,expires_on)
      VALUES
      ('d_ins','cmp_ridge','insurance','k/ins.pdf','coi.pdf','Cascade Mutual','POL-44812',200000000,'2027-03-14'),
      ('d_bond','cmp_ridge','bond','k/bond.pdf','bond.pdf','Western Surety','BND-991',3000000,NULL),
      ('d_w9','cmp_ridge','w9','k/w9.pdf','w9.pdf',NULL,NULL,NULL,NULL);
    -- Another company's certificate, to prove a token cannot reach it.
    INSERT INTO company_docs(id,company_id,kind,file_key,file_name)
      VALUES ('d_theirs','cmp_other','insurance','k/theirs.pdf','theirs.pdf');
  `);
  const files = new Map([["k/ins.pdf", "INSURANCE BYTES"], ["k/bond.pdf", "BOND BYTES"],
    ["k/w9.pdf", "W9 BYTES WITH A TIN"], ["k/theirs.pdf", "SOMEBODY ELSE BYTES"]]);
  const env = {
    DB: makeD1(db),
    FILES: { get: async (k) => files.has(k)
      ? { body: files.get(k), httpMetadata: { contentType: "application/pdf" } } : null },
  };
  return { db, env };
};

const call = (env, who, acct, path, opts = {}) => worker.fetch(
  new Request(`https://api.subsub.work/api${path}`, { ...opts,
    headers: { "Content-Type": "application/json", "X-User-Id": who,
               "X-Account-Id": acct, ...(opts.headers || {}) } }), env);
const open = (env, path) => worker.fetch(
  new Request(`https://api.subsub.work/api${path}`), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];
const one = (db, sql, ...b) => db.prepare(sql).get(...b);

console.log("\n-- the rules, before a database is involved --");
{
  ck("a link does not live forever", SHARE_DAYS > 0 && SHARE_DAYS <= 30, String(SHARE_DAYS));
  ck("insurance is in the link", inLink("insurance") === true);
  ck("so is the bond and the agreement", inLink("bond") && inLink("contract"));
  // THE RULE. A W-9 carries a TIN, and for a sole proprietor that is an SSN.
  ck("the W-9 is not", inLink("w9") === false);
  const w9 = packRow({ kind: "w9", uploadedAt: "x", policyNo: "SHOULD-NOT-SHOW", fileKey: "k" });
  ck("and its row says on file without saying what is on it",
    w9.onFile === true && w9.readable === false && w9.policyNo === null, JSON.stringify(w9));
  ck("it is marked as the gated one", w9.gated === true);

  ck("a whole address is required", validRecipient("sam@ridge.test") === true);
  ck("a pattern is not an address", validRecipient("%@ridge.test") === false);
  ck("neither is a bare name", validRecipient("sam") === false);

  ck("a revoked link is closed", shareState({ revokedAt: "x", expiresAt: "2099-01-01 00:00:00" }) === "revoked");
  ck("and an old one has run out", shareState({ expiresAt: "2020-01-01 00:00:00" }) === "expired");
  ck("a live one is live", shareState({ expiresAt: "2099-01-01 00:00:00" }) === "active");
}

console.log("\n-- sending one --");
{
  const { db, env } = seed();
  const [s, b] = await json(await call(env, "u_sam", "acc_gc", "/doc-shares",
    { method: "POST", body: JSON.stringify({
      toEmail: "PM@Cascade.test", toName: "Priya", note: "As asked on Tuesday." }) }));
  ck("the subcontractor can send their own pack", s === 201, `${s} ${JSON.stringify(b)}`);
  ck("addressed to the person they typed", b.toEmail === "pm@cascade.test", String(b.toEmail));
  ck("and it is live", b.state === "active", String(b.state));
  const row = one(db, `SELECT * FROM doc_shares WHERE id = ?`, b.id);
  ck("a token was minted", !!row.token && row.token.length >= 32, String(row.token || "").length + " chars");
  ck("it is not derived from anything the recipient knows",
    !/cascade|ridge|cmp_/i.test(row.token), row.token);
  ck("with an expiry", !!row.expires_at, String(row.expires_at));
  ck("and nobody has opened it", row.view_count === 0);

  // Sending again to the same address replaces the first rather than leaving
  // two ways in.
  const [s2, b2] = await json(await call(env, "u_sam", "acc_gc", "/doc-shares",
    { method: "POST", body: JSON.stringify({ toEmail: "pm@cascade.test" }) }));
  ck("re-sending to the same address works", s2 === 201, String(s2));
  ck("and takes the first link back",
    !!one(db, `SELECT revoked_at FROM doc_shares WHERE id = ?`, b.id).revoked_at);
  ck("leaving exactly one live link for that address",
    one(db, `SELECT COUNT(*) n FROM doc_shares WHERE to_email='pm@cascade.test' AND revoked_at IS NULL`).n === 1);

  // Rubbish in is refused rather than sent.
  const [s3, b3] = await json(await call(env, "u_sam", "acc_gc", "/doc-shares",
    { method: "POST", body: JSON.stringify({ toEmail: "not-an-address" }) }));
  ck("a bad address is refused", s3 === 400 && b3.error === "invalid_email", `${s3} ${b3.error}`);
}

console.log("\n-- and the page it sends them to --");
{
  const { db, env } = seed();
  const [, made] = await json(await call(env, "u_sam", "acc_gc", "/doc-shares",
    { method: "POST", body: JSON.stringify({ toEmail: "pm@cascade.test", toName: "Priya" }) }));
  const token = one(db, `SELECT token FROM doc_shares WHERE id = ?`, made.id).token;

  const [s, b] = await json(await open(env, `/pack/${encodeURIComponent(token)}`));
  ck("it opens with no account at all", s === 200, `${s} ${JSON.stringify(b).slice(0, 80)}`);
  ck("naming the company", b.company === "Ridge Roofing", String(b.company));
  ck("and who it was sent to", b.sentTo === "Priya", String(b.sentTo));

  const ins = b.docs.find((d) => d.kind === "insurance");
  // What a contractor writes into their own compliance file.
  ck("the certificate carries the carrier", ins.issuer === "Cascade Mutual", String(ins.issuer));
  ck("the policy number", ins.policyNo === "POL-44812", String(ins.policyNo));
  ck("the coverage", ins.coverageCents === 200000000, String(ins.coverageCents));
  ck("and the expiry, which is the whole point", ins.expiresOn === "2027-03-14", String(ins.expiresOn));
  ck("and it can be opened", ins.readable === true && !!ins.id);

  // THE W-9, over the wire.
  const w9 = b.docs.find((d) => d.kind === "w9");
  ck("the W-9 is said to be on file", w9.onFile === true);
  ck("but is not readable from the link", w9.readable === false);
  ck("and carries nothing off the form itself",
    w9.policyNo === null && w9.issuer === null, JSON.stringify(w9));

  // Nothing about who they already work for.
  const wire = JSON.stringify(b);
  ck("no account they work for is named", !/Outerhome|acc_gc/.test(wire), wire.slice(0, 120));
  ck("and no engagement of theirs", !/en1/.test(wire));

  // Opening it is counted, once for the page rather than once per document.
  ck("the sender is told it was opened",
    one(db, `SELECT view_count FROM doc_shares WHERE id = ?`, made.id).view_count === 1);
  await open(env, `/pack/${encodeURIComponent(token)}`);
  ck("and counted again on a second look",
    one(db, `SELECT view_count FROM doc_shares WHERE id = ?`, made.id).view_count === 2);

  // The files themselves.
  const f = await open(env, `/pack/${encodeURIComponent(token)}/file/d_ins`);
  ck("the certificate itself downloads", f.status === 200, String(f.status));
  ck("as a file rather than a page",
    /application\/pdf/.test(f.headers.get("content-type") || ""), f.headers.get("content-type"));
  ck("and is never cached by anything in between",
    /no-store/.test(f.headers.get("cache-control") || ""), f.headers.get("cache-control"));

  // THE NEGATIVES, and these are the ones that matter.
  const w9f = await open(env, `/pack/${encodeURIComponent(token)}/file/d_w9`);
  ck("the W-9 file is not reachable with the token", w9f.status === 404, String(w9f.status));
  const theirs = await open(env, `/pack/${encodeURIComponent(token)}/file/d_theirs`);
  ck("nor is another company's certificate", theirs.status === 404, String(theirs.status));
  const nope = await open(env, `/pack/${encodeURIComponent(token)}/file/made-up`);
  ck("nor a document id that does not exist", nope.status === 404, String(nope.status));
}

console.log("\n-- a link that is no longer good --");
{
  const { db, env } = seed();
  const [, made] = await json(await call(env, "u_sam", "acc_gc", "/doc-shares",
    { method: "POST", body: JSON.stringify({ toEmail: "pm@cascade.test" }) }));
  const token = one(db, `SELECT token FROM doc_shares WHERE id = ?`, made.id).token;

  const [sr] = await json(await call(env, "u_sam", "acc_gc", `/doc-shares/${made.id}/revoke`,
    { method: "POST" }));
  ck("it can be taken back", sr === 200, String(sr));
  const [s, b] = await json(await open(env, `/pack/${encodeURIComponent(token)}`));
  ck("and then the page is closed", s === 410 && b.error === "revoked", `${s} ${b.error}`);
  ck("the company is still named, so the holder knows whose it was",
    b.company === "Ridge Roofing", String(b.company));
  const f = await open(env, `/pack/${encodeURIComponent(token)}/file/d_ins`);
  ck("and the file goes with it", f.status === 404, String(f.status));

  // Expiry does the same.
  const { db: db2, env: env2 } = seed();
  const [, m2] = await json(await call(env2, "u_sam", "acc_gc", "/doc-shares",
    { method: "POST", body: JSON.stringify({ toEmail: "pm@cascade.test" }) }));
  db2.exec(`UPDATE doc_shares SET expires_at='2020-01-01 00:00:00' WHERE id='${m2.id}'`);
  const t2 = one(db2, `SELECT token FROM doc_shares WHERE id = ?`, m2.id).token;
  const [s2, b2] = await json(await open(env2, `/pack/${encodeURIComponent(t2)}`));
  ck("an expired link says so rather than pretending to be missing",
    s2 === 410 && b2.error === "expired", `${s2} ${b2.error}`);

  // A guessed token is the one case that stays vague.
  const [s3, b3] = await json(await open(env, "/pack/not-a-real-token"));
  ck("a guessed token learns nothing", s3 === 404 && !b3.company, `${s3} ${JSON.stringify(b3)}`);
}

console.log("\n-- and it is somebody's own paperwork, nobody else's --");
{
  const { db, env } = seed();
  // A seat at the hiring account is not a seat at the subcontractor. An admin
  // cannot send a contractor's documents out on their behalf.
  db.exec(`
    INSERT INTO users(id,name,email,auth_id) VALUES ('u_gc','GC Admin','gc@outerhome.test','auth_gc');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES ('m_gc','u_gc','acc_gc','admin');
  `);
  const [s, b] = await json(await call(env, "u_gc", "acc_gc", "/doc-shares",
    { method: "POST", body: JSON.stringify({ toEmail: "pm@cascade.test" }) }));
  // The GC has a company of their own since 031, so what they would send is
  // THEIR pack -- and they have no documents on file, so there is nothing.
  ck("a hiring account sends its own pack or nothing", s === 409 && b.error === "nothing_on_file",
    `${s} ${JSON.stringify(b)}`);
  ck("and never the subcontractor's",
    one(db, `SELECT COUNT(*) n FROM doc_shares WHERE company_id='cmp_ridge'`).n === 0);

  // Revoking is scoped the same way.
  const [, made] = await json(await call(env, "u_sam", "acc_gc", "/doc-shares",
    { method: "POST", body: JSON.stringify({ toEmail: "pm@cascade.test" }) }));
  const [sr] = await json(await call(env, "u_gc", "acc_gc", `/doc-shares/${made.id}/revoke`,
    { method: "POST" }));
  ck("and somebody else cannot withdraw your link", sr === 404, String(sr));
  ck("which is still live", !one(db, `SELECT revoked_at FROM doc_shares WHERE id = ?`, made.id).revoked_at);
}

console.log("\n-- and a connection has two ends --");
{
  // Accepting a request writes an engagement on the OTHER account and seats
  // this team over there. Every engagement read in the Worker is "contractors
  // I hire"; nothing read "accounts that hire me", so saying yes to somebody
  // showed up nowhere at all on this side.
  const { db, env } = seed();
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind) VALUES
      ('acc_pm','Cascade Management','cascade','property_manager'),
      ('acc_far','Sound PM','sound','property_manager');
    -- Cascade hires Ridge for roofing, and has issued work.
    INSERT INTO engagements(id,account_id,company_id,status,categories,invited_at)
      VALUES ('en_pm','acc_pm','cmp_ridge','active','["roofing","siding"]','2026-02-01 09:00:00');
    INSERT INTO jobs(id,account_id,title,status) VALUES ('j1','acc_pm','Roof','active');
    INSERT INTO work_orders(id,wo_number,job_id,trade,company_id,engagement_id,status)
      VALUES ('wo1','WO-1','j1','roofing','cmp_ridge','en_pm','accepted');
    -- An ended one, which is not a client any more.
    INSERT INTO engagements(id,account_id,company_id,status,categories)
      VALUES ('en_gone','acc_far','cmp_ridge','ended','["roofing"]');
    -- And somebody else's engagement entirely, to prove the scope.
    INSERT INTO engagements(id,account_id,company_id,status,categories)
      VALUES ('en_other','acc_pm','cmp_other','active','["siding"]');
  `);

  const [s, b] = await json(await call(env, "u_sam", "acc_gc", "/clients"));
  ck("the account can see who hires it", s === 200, `${s} ${JSON.stringify(b).slice(0, 80)}`);
  // Two of them: the general contractor from the base fixture and the
  // property manager added here. Both are real clients of this company.
  ck("naming every one of them", b.length === 2, JSON.stringify(b.map((x) => x.name)));
  const pm = b.find((x) => x.name === "Cascade Management");
  ck("and what they hire us for",
    JSON.stringify(pm.trades) === '["roofing","siding"]', JSON.stringify(pm.trades));
  ck("what kind of outfit they are", pm.kind === "property_manager", String(pm.kind));
  ck("how much work has come from them", pm.workOrders === 1, String(pm.workOrders));
  ck("and since when", /2026-02-01/.test(String(pm.since)), String(pm.since));
  // The work count is per client, not the company's total.
  ck("and the other client's count is their own",
    b.find((x) => x.name === "Outerhome").workOrders === 0,
    String(b.find((x) => x.name === "Outerhome").workOrders));

  // THE NEGATIVES.
  ck("a finished relationship is not a client",
    !b.some((x) => x.name === "Sound PM"), JSON.stringify(b.map((x) => x.name)));
  ck("and somebody else's contractor is not our client",
    !JSON.stringify(b).includes("cmp_other"), JSON.stringify(b));

  // And when nobody hires them any more, the list empties rather than
  // remembering.
  const { db: db2, env: env2 } = seed();
  db2.exec(`UPDATE engagements SET status='ended' WHERE company_id='cmp_ridge'`);
  const [, b2] = await json(await call(env2, "u_sam", "acc_gc", "/clients"));
  ck("a company nobody hires sees an empty list", b2.length === 0, JSON.stringify(b2));
}

console.log("\n-- and a hireable account can hold its own paperwork --");
{
  // The other half of the same gap. Uploading a document lived only in the
  // contractor portal, and ROLES.admin has no portal -- so an account that
  // could be hired had nowhere to put a certificate and nothing to send.
  const { db, env } = seed();
  db.exec(`
    INSERT INTO users(id,name,email,auth_id) VALUES ('u_gc','GC Admin','gc@outerhome.test','auth_gc');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES ('m_gc','u_gc','acc_gc','admin');
    INSERT INTO companies(id,company) VALUES ('cmp_oh','Outerhome');
    UPDATE accounts SET company_id='cmp_oh' WHERE id='acc_gc';
    INSERT INTO company_docs(id,company_id,kind,file_key,file_name,expires_on)
      VALUES ('d_oh','cmp_oh','insurance','k/oh.pdf','ours.pdf','2027-01-31');
  `);
  const [s, b] = await json(await call(env, "u_gc", "acc_gc", "/my-company"));
  ck("their own profile comes back", s === 200, String(s));
  ck("with their own documents on it", !!b.docs?.insurance, JSON.stringify(Object.keys(b.docs || {})));
  ck("including the expiry", b.docs.insurance.expiresOn === "2027-01-31",
    String(b.docs.insurance.expiresOn));
  // Which is what makes sending possible at all.
  const [s2] = await json(await call(env, "u_gc", "acc_gc", "/doc-shares",
    { method: "POST", body: JSON.stringify({ toEmail: "pm@cascade.test" }) }));
  ck("and with one on file they can send it", s2 === 201, String(s2));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
