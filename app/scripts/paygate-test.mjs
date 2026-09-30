// Money does not leave against work nobody was insured for.
//
// `settle` checked the waiver chain and nothing else, so "we refuse to pay a
// subcontractor whose insurance lapsed" -- a named reason to route payment
// through SubSub at all -- was enforced by nothing. A release against a
// company with no certificate on file went out exactly like one against a
// company fully covered.
//
// The properties worth pinning, and every one of them is easy to destroy by
// accident:
//
//   THE DATE ASKED ABOUT IS THE JOB'S, NOT TODAY'S. Both directions matter
//   and they are asserted separately: cover that lapsed BEFORE the work
//   blocks, cover that lapsed AFTER it does not. Testing only one of the two
//   passes with the date swapped for `today`.
//
//   THE W-9 IS IN THE GATE AND THE AGREEMENT IS NOT. One is the ability to
//   report the payment; the other is the hiring account's own form, which
//   plenty of them never send.
//
//   TWO GATES, TWO REASONS. A reason typed about the waiver must not stand
//   as the recorded justification for paying against lapsed cover, so each
//   is refused on its own and each writes its own event.
//
//   AN OVERRIDE IS RECORDED. "We always override it" has to be a visible
//   fact rather than a habit nobody can see.
//
//   node --no-warnings scripts/paygate-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { coverState, coverProblemText, fixableByUpload,
         PAY_GATE_KINDS, PAY_COVER_KINDS, payGateKindsAreRequired } from "../shared/paygate.js";
import { DOC_KINDS, OPTIONAL_KINDS } from "../shared/docs.js";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");

// ---------------------------------------------------------------------------
// The rules module on its own
// ---------------------------------------------------------------------------
const VERIFIED = { insurance: { status: "verified" }, bond: { status: "verified" },
  w9: { status: "verified" }, contract: { status: "verified" } };
const FULL = {
  insurance: { fileName: "coi.pdf", expiresOn: "2026-06-30" },
  bond: { fileName: "bond.pdf", expiresOn: "2027-01-31" },
  w9: { fileName: "w9.pdf", expiresOn: null },
  contract: { fileName: "msa.pdf", expiresOn: null },
};

console.log("\n-- which documents are in the gate, and why --");
{
  ck("insurance, bond and a W-9 are", PAY_GATE_KINDS.join(",") === "insurance,bond,w9", PAY_GATE_KINDS.join(","));
  ck("the signed agreement is NOT", !PAY_GATE_KINDS.includes("contract"));
  // And it is out because it is optional, not because somebody remembered.
  ck("and it is out because OPTIONAL_KINDS says so",
    OPTIONAL_KINDS.includes("contract") && payGateKindsAreRequired());
  ck("every gated kind is a real kind", PAY_GATE_KINDS.every((k) => DOC_KINDS.includes(k)));
  // A W-9 has no shelf life, so its date is never the question.
  ck("only insurance and a bond are asked about a date",
    PAY_COVER_KINDS.join(",") === "insurance,bond", PAY_COVER_KINDS.join(","));
}

console.log("\n-- the date is the job's, and BOTH directions matter --");
{
  const clear = coverState({ docs: FULL, docReview: VERIFIED, jobDate: "2026-03-01", asOf: "2026-03-02" });
  ck("cover in force on the day is clear", clear.clear, JSON.stringify(clear.problems));

  // Lapsed BEFORE the work: the work was uninsured, so it blocks.
  const before = coverState({ docs: FULL, docReview: VERIFIED, jobDate: "2026-08-01", asOf: "2026-08-02" });
  ck("cover that had already lapsed on the day of the work blocks", !before.clear);
  ck("and the reason names the lapse",
    before.problems.some((p) => p.kind === "insurance" && p.reason === "lapsed"),
    JSON.stringify(before.problems));

  // Lapsed AFTER the work: the work WAS covered, so it does not block. This
  // is the assertion that fails if the gate reads `today`.
  const after = coverState({ docs: FULL, docReview: VERIFIED, jobDate: "2026-03-01", asOf: "2026-09-29" });
  ck("cover that lapsed AFTER the work does not block", after.clear, JSON.stringify(after.problems));
  ck("but it is said out loud as an advisory",
    after.advisories.some((a) => a.kind === "insurance" && a.reason === "lapsed_since"),
    JSON.stringify(after.advisories));
  // An advisory that could block would be the same bug wearing a hat.
  ck("and an advisory never reaches `problems`", after.problems.length === 0);

  // A blank expiry is cover, not doubt -- docs.js has said so since it was
  // written, and money is the worst place to disagree with it.
  const noExpiry = coverState({
    docs: { insurance: { fileName: "coi.pdf", expiresOn: null },
      bond: { fileName: "bond.pdf", expiresOn: null }, w9: FULL.w9 },
    docReview: VERIFIED, jobDate: "2030-01-01", asOf: "2030-01-02" });
  ck("a document with no expiry covers any day", noExpiry.clear, JSON.stringify(noExpiry.problems));
}

console.log("\n-- missing, unread, and the difference between them --");
{
  const none = coverState({ docs: { bond: FULL.bond, w9: FULL.w9 }, docReview: VERIFIED,
    jobDate: "2026-03-01", asOf: "2026-03-02" });
  ck("no certificate at all blocks", !none.clear);
  ck("and says it is missing rather than lapsed",
    none.problems.some((p) => p.kind === "insurance" && p.reason === "missing"),
    JSON.stringify(none.problems));

  // The hiring account's own verdict, because this is the hiring account's
  // own money. Presence is the send gate's question, not this one.
  const unread = coverState({ docs: FULL,
    docReview: { ...VERIFIED, insurance: { status: "pending" } },
    jobDate: "2026-03-01", asOf: "2026-03-02" });
  ck("a certificate nobody here has reviewed blocks", !unread.clear);
  ck("and says so", unread.problems.some((p) => p.reason === "unverified"), JSON.stringify(unread.problems));
  const rejected = coverState({ docs: FULL,
    docReview: { ...VERIFIED, insurance: { status: "rejected" } },
    jobDate: "2026-03-01", asOf: "2026-03-02" });
  ck("a rejected one blocks too", !rejected.clear);

  // A missing agreement must not block, whatever its review says.
  const noMsa = coverState({ docs: { insurance: FULL.insurance, bond: FULL.bond, w9: FULL.w9 },
    docReview: { insurance: { status: "verified" }, bond: { status: "verified" }, w9: { status: "verified" } },
    jobDate: "2026-03-01", asOf: "2026-03-02" });
  ck("no signed agreement does NOT block", noMsa.clear, JSON.stringify(noMsa.problems));

  // No W-9 is its own bar, and for a different reason from cover.
  const noW9 = coverState({ docs: { insurance: FULL.insurance, bond: FULL.bond },
    docReview: VERIFIED, jobDate: "2026-03-01", asOf: "2026-03-02" });
  ck("no W-9 blocks", !noW9.clear && noW9.problems.some((p) => p.kind === "w9"),
    JSON.stringify(noW9.problems));
}

console.log("\n-- the words, because the wrong ones send somebody to renew --");
{
  const p = { kind: "insurance", reason: "lapsed", until: "2026-07-01" };
  const txt = coverProblemText(p, "2026-08-01");
  ck("a lapse names the day of the WORK, not just the expiry",
    /2026-08-01/.test(txt) && /2026-07-01/.test(txt), txt);
  ck("and a lapse on a past day is not fixable by uploading", !fixableByUpload(p));
  ck("a missing document is", fixableByUpload({ kind: "w9", reason: "missing" }));
  ck("so is an unread one", fixableByUpload({ kind: "insurance", reason: "unverified" }));
  ck("the advisory says the work itself WAS covered",
    /was covered/i.test(coverProblemText({ kind: "insurance", reason: "lapsed_since", until: "2026-07-01" })),
    coverProblemText({ kind: "insurance", reason: "lapsed_since", until: "2026-07-01" }));
  // Never a bare kind id in front of anybody. `w9` is the one that would
  // actually show up as an id -- "insurance" and "bond" are English words as
  // well as keys, so asserting their absence would be asserting nothing.
  for (const k of PAY_GATE_KINDS) {
    const t = coverProblemText({ kind: k, reason: "missing" });
    ck(`${k} reads as a document, not a key`,
      t !== `No ${k} on file.` && !/\bw9\b/.test(t) && !/\bundefined\b/.test(t), t);
  }
}

// ---------------------------------------------------------------------------
// The route
// ---------------------------------------------------------------------------
const ENV = (db) => ({ DB: makeD1(db) });
const call = async (env, path, { method = "GET", seat = { u: "u_ad", a: "acc_gc" }, body } = {}) => {
  const res = await worker.fetch(new Request(`https://api.subsub.work${path}`, {
    method,
    headers: { "X-User-Id": seat.u, "X-Account-Id": seat.a, "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }), env);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

// The whole ledger down to one release, with the work done on a known day.
// `docs` is a list of [kind, expiresOn] and `review` a list of verified kinds,
// so each test states only the thing it is about.
const JOB_DAY = "2026-03-10";
function seed({ docs = [], review = [], scopeKind = "labor_only" } = {}) {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind,plan) VALUES
      ('acc_gc','Outerhome','outerhome','general_contractor','scale');
    INSERT INTO users(id,name,email) VALUES ('u_ad','Rae','rae@outerhome.test'),('u_sub','Dev','dev@cascade.test');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES ('m_ad','u_ad','acc_gc','admin');
    INSERT INTO companies(id,company,contact,email) VALUES ('cmp_roof','Cascade Roofworks','Dev','dev@cascade.test');
    INSERT INTO engagements(id,account_id,company_id,status,doc_review) VALUES
      ('en1','acc_gc','cmp_roof','active','${JSON.stringify(Object.fromEntries(review.map((k) => [k, { status: "verified" }]))).replace(/'/g, "''")}');
    INSERT INTO jobs(id,account_id,title,date,trades) VALUES ('job1','acc_gc','Re-roof','${JOB_DAY}','["roofing"]');
    INSERT INTO work_orders(id,wo_number,job_id,trade,company_id,engagement_id,value_cents,status,scope_kind)
      VALUES ('wo1','WO-1001','job1','roofing','cmp_roof','en1',500000,'accepted','${scopeKind}');
    INSERT INTO wo_milestones(id,work_order_id,account_id,seq,label,amount_cents,status)
      VALUES ('ms1','wo1','acc_gc',1,'Complete',500000,'verified');
    INSERT INTO wo_releases(id,work_order_id,account_id,milestone_id,company_id,gross_cents,net_cents,status)
      VALUES ('rel1','wo1','acc_gc','ms1','cmp_roof',500000,500000,'due');
  `);
  for (const [kind, expires] of docs) {
    db.prepare(`INSERT INTO company_docs(id,company_id,kind,file_key,file_name,expires_on)
                VALUES (?,?,?,?,?,?)`)
      .run(`cd_${kind}`, "cmp_roof", kind, `k/${kind}`, `${kind}.pdf`, expires);
  }
  // A signed labour-only waiver, so the waiver half is never what refuses.
  db.prepare(`INSERT INTO lien_waivers
                (id,job_id,release_id,work_order_id,account_id,from_company_id,tier,kind,status,through_date,scope_kind)
              VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run("lw1", "job1", "rel1", "wo1", "acc_gc", "cmp_roof", 0,
         "unconditional_progress", "signed", "2030-01-01", "labor_only");
  return db;
}

const COVERED = [["insurance", "2026-12-31"], ["bond", null], ["w9", null]];
const ALL_REVIEWED = ["insurance", "bond", "w9"];

console.log("\n-- the route refuses, and names which gate --");
{
  const db = seed({ docs: [["bond", null], ["w9", null]], review: ALL_REVIEWED });
  const env = ENV(db);
  const r = await call(env, "/api/releases/rel1/settle", { method: "POST", body: { method: "check" } });
  ck("no certificate: refused 409", r.status === 409, `${r.status} ${JSON.stringify(r.body)}`);
  ck("and it is the cover gate, not the waiver", r.body.error === "cover_outstanding", r.body.error);
  ck("the reply carries what is wrong",
    (r.body.cover?.problems || []).some((p) => p.kind === "insurance"), JSON.stringify(r.body.cover));
  const row = db.prepare(`SELECT status FROM wo_releases WHERE id='rel1'`).get();
  ck("and nothing was recorded as paid", row.status === "due", row.status);
}

console.log("\n-- cover in force on the day goes through --");
{
  const db = seed({ docs: COVERED, review: ALL_REVIEWED });
  const r = await call(ENV(db), "/api/releases/rel1/settle", { method: "POST", body: { method: "check", reference: "1044" } });
  ck("settled", r.status === 200 && r.body.ok === true, `${r.status} ${JSON.stringify(r.body)}`);
  ck("and says cover was clear", r.body.coverClear === true, JSON.stringify(r.body));
  const row = db.prepare(`SELECT status, reference FROM wo_releases WHERE id='rel1'`).get();
  ck("the row is paid with its reference", row.status === "paid" && row.reference === "1044", JSON.stringify(row));
}

console.log("\n-- lapsed after the work is not a bar --");
{
  // Expired long ago as of today, but current on the job's date.
  const db = seed({ docs: [["insurance", "2026-03-20"], ["bond", null], ["w9", null]], review: ALL_REVIEWED });
  const r = await call(ENV(db), "/api/releases/rel1/settle", { method: "POST", body: { method: "ach" } });
  ck("paying for covered work whose certificate has since lapsed is allowed",
    r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
}

console.log("\n-- lapsed before the work is --");
{
  const db = seed({ docs: [["insurance", "2026-01-01"], ["bond", null], ["w9", null]], review: ALL_REVIEWED });
  const r = await call(ENV(db), "/api/releases/rel1/settle", { method: "POST", body: { method: "ach" } });
  ck("refused", r.status === 409 && r.body.error === "cover_outstanding", `${r.status} ${JSON.stringify(r.body)}`);
  ck("and the reason is the lapse",
    (r.body.cover?.problems || []).some((p) => p.reason === "lapsed"), JSON.stringify(r.body.cover));
}

console.log("\n-- an unreviewed certificate is not cover --");
{
  const db = seed({ docs: COVERED, review: ["bond", "w9"] });
  const r = await call(ENV(db), "/api/releases/rel1/settle", { method: "POST", body: { method: "check" } });
  ck("refused", r.status === 409 && r.body.error === "cover_outstanding", `${r.status} ${JSON.stringify(r.body)}`);
  ck("and names it as unread rather than missing",
    (r.body.cover?.problems || []).some((p) => p.kind === "insurance" && p.reason === "unverified"),
    JSON.stringify(r.body.cover));
}

console.log("\n-- the override: a reason, on the record --");
{
  const db = seed({ docs: [["bond", null], ["w9", null]], review: ALL_REVIEWED });
  const env = ENV(db);
  const bare = await call(env, "/api/releases/rel1/settle",
    { method: "POST", body: { method: "check", coverOverride: true } });
  ck("overriding with no reason is refused", bare.status === 400 && bare.body.error === "cover_reason_required",
    `${bare.status} ${JSON.stringify(bare.body)}`);
  ck("and still nothing is paid",
    db.prepare(`SELECT status FROM wo_releases WHERE id='rel1'`).get().status === "due");

  const ok = await call(env, "/api/releases/rel1/settle", { method: "POST",
    body: { method: "check", coverOverride: true, coverOverrideReason: "Owner accepts the exposure" } });
  ck("with a reason it goes through", ok.status === 200, `${ok.status} ${JSON.stringify(ok.body)}`);
  ck("and reports that cover was NOT clear", ok.body.coverClear === false, JSON.stringify(ok.body));

  const ev = db.prepare(`SELECT kind, payload FROM wo_events WHERE work_order_id='wo1' ORDER BY rowid`).all();
  const ovr = ev.find((e) => e.kind === "release.cover_override");
  ck("an override event is written", !!ovr, ev.map((e) => e.kind).join(","));
  ck("carrying the reason", /Owner accepts the exposure/.test(ovr?.payload || ""), ovr?.payload);
  ck("and what was wrong at the time", /"reason":"missing"/.test(ovr?.payload || ""), ovr?.payload);
  const settled = ev.find((e) => e.kind === "release.settled");
  ck("the settled event records that cover was not clear",
    /"coverClear":false/.test(settled?.payload || ""), settled?.payload);
}

console.log("\n-- two gates, two reasons, and neither reason covers the other --");
{
  // No certificate AND no waiver. A single override must not clear both.
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind,plan) VALUES ('acc_gc','Outerhome','outerhome','general_contractor','scale');
    INSERT INTO users(id,name,email) VALUES ('u_ad','Rae','rae@outerhome.test');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES ('m_ad','u_ad','acc_gc','admin');
    INSERT INTO companies(id,company,contact,email) VALUES ('cmp_roof','Cascade Roofworks','Dev','dev@cascade.test');
    INSERT INTO engagements(id,account_id,company_id,status,doc_review) VALUES ('en1','acc_gc','cmp_roof','active','{}');
    INSERT INTO jobs(id,account_id,title,date,trades) VALUES ('job1','acc_gc','Re-roof','${JOB_DAY}','["roofing"]');
    INSERT INTO work_orders(id,wo_number,job_id,trade,company_id,engagement_id,value_cents,status,scope_kind)
      VALUES ('wo1','WO-1001','job1','roofing','cmp_roof','en1',500000,'accepted','labor_materials');
    INSERT INTO wo_milestones(id,work_order_id,account_id,seq,label,amount_cents,status)
      VALUES ('ms1','wo1','acc_gc',1,'Complete',500000,'verified');
    INSERT INTO wo_releases(id,work_order_id,account_id,milestone_id,company_id,gross_cents,net_cents,status)
      VALUES ('rel1','wo1','acc_gc','ms1','cmp_roof',500000,500000,'due');
  `);
  const env = ENV(db);
  // Cover is asked first, so overriding only the waiver still refuses.
  const waiverOnly = await call(env, "/api/releases/rel1/settle", { method: "POST",
    body: { method: "check", override: true, overrideReason: "On the owner's instruction" } });
  ck("a waiver override does not clear the cover gate",
    waiverOnly.status === 409 && waiverOnly.body.error === "cover_outstanding",
    `${waiverOnly.status} ${JSON.stringify(waiverOnly.body)}`);

  // And overriding only cover still refuses on the waiver.
  const coverOnly = await call(env, "/api/releases/rel1/settle", { method: "POST",
    body: { method: "check", coverOverride: true, coverOverrideReason: "Exposure accepted" } });
  ck("a cover override does not clear the waiver gate",
    coverOnly.status === 409 && coverOnly.body.error === "waiver_outstanding",
    `${coverOnly.status} ${JSON.stringify(coverOnly.body)}`);

  const both = await call(env, "/api/releases/rel1/settle", { method: "POST",
    body: { method: "check", coverOverride: true, coverOverrideReason: "Exposure accepted",
      override: true, overrideReason: "On the owner's instruction" } });
  ck("both, with both reasons, goes through", both.status === 200, `${both.status} ${JSON.stringify(both.body)}`);
  const kinds = db.prepare(`SELECT kind FROM wo_events WHERE work_order_id='wo1'`).all().map((e) => e.kind);
  ck("and each override is its own event",
    kinds.includes("release.cover_override") && kinds.includes("release.override"), kinds.join(","));
  const ev = db.prepare(`SELECT kind,payload FROM wo_events WHERE work_order_id='wo1'`).all();
  const cov = ev.find((e) => e.kind === "release.cover_override");
  ck("and the cover reason is the cover one, not the waiver's",
    /Exposure accepted/.test(cov.payload) && !/owner's instruction/.test(cov.payload), cov.payload);
}

console.log("\n-- the state is readable before anybody presses pay --");
{
  const db = seed({ docs: [["bond", null], ["w9", null]], review: ALL_REVIEWED });
  const env = ENV(db);
  const r = await call(env, "/api/releases/rel1/cover-state");
  ck("cover-state answers", r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
  ck("and it is not clear", r.body.clear === false, JSON.stringify(r.body));
  ck("naming the job's date it was asked about", r.body.asOfJob === JOB_DAY, r.body.asOfJob);
  // Another account's release is not readable, and reads as absent rather
  // than as forbidden.
  db.exec(`INSERT INTO accounts(id,name,subdomain,kind,plan) VALUES ('acc_x','Other','other','general_contractor','basic');
           INSERT INTO users(id,name,email) VALUES ('u_x','Pat','pat@other.test');
           INSERT INTO memberships(id,user_id,account_id,role) VALUES ('m_x','u_x','acc_x','admin');`);
  const o = await call(env, "/api/releases/rel1/cover-state", { seat: { u: "u_x", a: "acc_x" } });
  ck("somebody else's release is not found", o.status === 404, `${o.status} ${JSON.stringify(o.body)}`);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
