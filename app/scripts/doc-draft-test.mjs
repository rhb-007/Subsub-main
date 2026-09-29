// Pausing a review without losing it.
//
// Verifying is one press; READING an ACORD 25 is not. Six coverage lines, a
// carrier, a policy number, two dates and five things to confirm on the
// document itself -- and a reviewer who gets four lines in and finds the
// sixth missing has to stop and ask. Closing the modal threw all of it away,
// so the next attempt started from an empty form over a certificate they had
// already read once.
//
// The property that matters most here is a NEGATIVE one:
//
//   A DRAFT IS NOT A VERDICT. It is stored beside `status`, never as one, so
//   docStatus keeps answering "pending", missingDocs still counts the
//   document missing, docsComplete stays false and nobody becomes assignable
//   because somebody typed four coverage lines and went to lunch. A
//   half-finished review that granted compliance would be the
//   expired-certificate failure arrived at from a new direction, and worse,
//   because it would read as a decision somebody made.
//
//   IT CANNOT SET ITS OWN STATUS, even if the body asks to. The draft route
//   is reachable by every seat the review route is, so a `status` in the body
//   would be a verdict wearing a draft's name.
//
//   IT BELONGS TO THE ACCOUNT, not the person: a colleague picks it up, and
//   another account's reviewer never sees it.
//
//   A DECISION CLEARS IT. A draft that outlived the answer reopens over a
//   finished review -- the queue-row-that-survives-being-answered shape.
//
//   AND A VERDICT ALREADY RECORDED SURVIVES a draft being saved and
//   discarded, because re-reading a verified certificate must not un-verify
//   it.
//
//   node --no-warnings scripts/doc-draft-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { DOC_KINDS } from "../shared/docs.js";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");

const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind) VALUES
      ('acc_a','Alder','alder','general_contractor'),
      ('acc_b','Bayview','bayview','general_contractor');
    INSERT INTO companies(id,company,insurance,doc_files) VALUES
      ('cmp_bay','Bay Roofing',1,'{"insurance":"coi.pdf"}');
    INSERT INTO users(id,name,email) VALUES
      ('u_pat','Pat','pat@alder.test'),
      ('u_sam','Sam','sam@alder.test'),
      ('u_other','Ola','ola@bayview.test');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES
      ('m1','u_pat','acc_a','admin'),
      ('m2','u_sam','acc_a','pm'),
      ('m3','u_other','acc_b','admin');
    INSERT INTO engagements(id,account_id,company_id,status) VALUES
      ('en_a','acc_a','cmp_bay','active'),
      ('en_b','acc_b','cmp_bay','active');`);
  return { db, env: { DB: makeD1(db), FILES: { get: async () => null } } };
};

const call = (env, who, acct, path, method, body) => worker.fetch(
  new Request(`https://api.subsub.work/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-User-Id": who, "X-Account-Id": acct },
    ...(method === "GET" ? {} : { body: JSON.stringify(body || {}) }),
  }), env);
const review = (db, engId) => {
  const row = db.prepare(`SELECT doc_review FROM engagements WHERE id = ?`).get(engId);
  return JSON.parse(row.doc_review || "{}");
};

// What a reviewer has typed four lines into and not finished.
const HALF = {
  limits: { cgl_occ: "1000000", cgl_agg: "2000000" },
  checks: { named: true },
  issuer: "Cascade Mutual", policyNo: "CGL-99812",
  note: "waiting on the umbrella page",
};

console.log("\n-- a paused review comes back --");
{
  const { db, env } = seed();
  const r = await call(env, "u_pat", "acc_a", "/subs/cmp_bay/documents/insurance/draft", "PUT", { draft: HALF });
  ck("it saves", r.status === 200, String(r.status));
  const entry = review(db, "en_a").insurance;
  ck("the draft is stored", !!entry?.draft, JSON.stringify(entry));
  ck("with every field the reviewer typed",
    entry.draft.limits.cgl_agg === "2000000" && entry.draft.issuer === "Cascade Mutual"
    && entry.draft.note === "waiting on the umbrella page", JSON.stringify(entry.draft));
  ck("and says who left it", entry.draftBy === "u_pat", String(entry.draftBy));
  ck("and when", !!entry.draftAt, String(entry.draftAt));
}

console.log("\n-- and it is NOT a decision --");
{
  const { db, env } = seed();
  await call(env, "u_pat", "acc_a", "/subs/cmp_bay/documents/insurance/draft", "PUT", { draft: HALF });
  const entry = review(db, "en_a").insurance;
  // docStatus reads `status` and nothing else, so this is the whole of it.
  ck("the status is still pending", entry.status === "pending", String(entry.status));
  ck("nothing recorded a verifier", !entry.verifiedBy && !entry.verifiedAt, JSON.stringify(entry));
  // The half-typed limits must not be readable as the reviewed ones: they sit
  // under `draft`, so anything reading entry.limits finds nothing.
  ck("the typed limits are not the recorded limits", entry.limits === undefined,
    JSON.stringify(entry.limits));
  ck("nor the carrier", entry.issuer === undefined, String(entry.issuer));
}

console.log("\n-- a draft cannot set its own status, however it asks --");
{
  const { db, env } = seed();
  await call(env, "u_pat", "acc_a", "/subs/cmp_bay/documents/insurance/draft", "PUT",
    { draft: HALF, status: "verified", verifiedBy: "u_pat", verifiedAt: "2026-01-01" });
  const entry = review(db, "en_a").insurance;
  ck("the status is untouched", entry.status === "pending", String(entry.status));
  ck("and no verifier was taken from the body",
    !entry.verifiedBy && !entry.verifiedAt, JSON.stringify(entry));
}

console.log("\n-- a colleague picks it up; another account never sees it --");
{
  const { db, env } = seed();
  await call(env, "u_pat", "acc_a", "/subs/cmp_bay/documents/insurance/draft", "PUT", { draft: HALF });
  // Same account, different seat, and a project manager rather than an admin:
  // the review route allows both, so this one must too.
  const r = await call(env, "u_sam", "acc_a", "/subs/cmp_bay/documents/insurance/draft", "PUT",
    { draft: { ...HALF, note: "umbrella page arrived" } });
  ck("a pm on the same account may save over it", r.status === 200, String(r.status));
  ck("and it is theirs now", review(db, "en_a").insurance.draftBy === "u_sam");

  // Bayview also hires Bay Roofing. Their reviewer's half-read certificate is
  // their own: a verdict is each account's, and so is an unfinished one.
  ck("the other account's entry is untouched", !review(db, "en_b").insurance,
    JSON.stringify(review(db, "en_b")));
  await call(env, "u_other", "acc_b", "/subs/cmp_bay/documents/insurance/draft", "PUT",
    { draft: { note: "bayview's own reading" } });
  ck("and theirs does not reach ours",
    review(db, "en_a").insurance.draft.note === "umbrella page arrived",
    JSON.stringify(review(db, "en_a").insurance.draft));
}

console.log("\n-- deciding clears it --");
{
  const { db, env } = seed();
  await call(env, "u_pat", "acc_a", "/subs/cmp_bay/documents/insurance/draft", "PUT", { draft: HALF });
  ck("a draft is waiting", !!review(db, "en_a").insurance.draft);
  await call(env, "u_pat", "acc_a", "/subs/cmp_bay/documents/insurance/review", "POST",
    { status: "verified", limits: { cgl_agg: "2000000" }, checks: {}, expires: "2027-03-01" });
  const entry = review(db, "en_a").insurance;
  ck("verifying records the verdict", entry.status === "verified", String(entry.status));
  // A draft that outlived the answer reopens over a finished review.
  ck("and the draft is gone", entry.draft === undefined, JSON.stringify(entry.draft));
  ck("along with who left it", entry.draftBy === undefined && entry.draftAt === undefined,
    JSON.stringify(entry));
}

console.log("\n-- rejecting clears it too --");
{
  const { db, env } = seed();
  await call(env, "u_pat", "acc_a", "/subs/cmp_bay/documents/insurance/draft", "PUT", { draft: HALF });
  await call(env, "u_pat", "acc_a", "/subs/cmp_bay/documents/insurance/review", "POST",
    { status: "rejected", note: "no umbrella page" });
  const entry = review(db, "en_a").insurance;
  ck("the rejection stands", entry.status === "rejected", String(entry.status));
  ck("and nothing half-read survives it", entry.draft === undefined, JSON.stringify(entry.draft));
}

console.log("\n-- re-reading a verified document does not un-verify it --");
{
  const { db, env } = seed();
  await call(env, "u_pat", "acc_a", "/subs/cmp_bay/documents/insurance/review", "POST",
    { status: "verified", limits: { cgl_agg: "2000000" }, checks: {}, expires: "2027-03-01" });
  // Somebody opens it again, starts changing figures, and gives up.
  await call(env, "u_sam", "acc_a", "/subs/cmp_bay/documents/insurance/draft", "PUT",
    { draft: { limits: { cgl_agg: "500000" } } });
  const entry = review(db, "en_a").insurance;
  ck("it is still verified", entry.status === "verified", String(entry.status));
  ck("the recorded limits are the verified ones", entry.limits.cgl_agg === "2000000",
    JSON.stringify(entry.limits));
  ck("and the half-typed ones stay in the draft", entry.draft.limits.cgl_agg === "500000");

  // Discarding puts it back exactly as it was.
  await call(env, "u_sam", "acc_a", "/subs/cmp_bay/documents/insurance/draft", "PUT", { draft: null });
  const after = review(db, "en_a").insurance;
  ck("discarding leaves the verdict alone", after.status === "verified" && after.limits.cgl_agg === "2000000",
    JSON.stringify(after));
  ck("and the draft is gone", !after.draft, JSON.stringify(after.draft));
}

console.log("\n-- a stranger cannot park a draft on somebody's contractor --");
{
  const { db, env } = seed();
  db.exec(`INSERT INTO accounts(id,name,subdomain,kind) VALUES ('acc_x','Nowt','nowt','general_contractor');
           INSERT INTO users(id,name,email) VALUES ('u_x','Xan','xan@nowt.test');
           INSERT INTO memberships(id,user_id,account_id,role) VALUES ('mx','u_x','acc_x','admin');`);
  const r = await call(env, "u_x", "acc_x", "/subs/cmp_bay/documents/insurance/draft", "PUT", { draft: HALF });
  ck("no engagement, no draft", r.status === 404, String(r.status));
  const fake = await call(env, "u_x", "acc_x", "/subs/cmp_nope/documents/insurance/draft", "PUT", { draft: HALF });
  ck("and a company that is not there answers the same", fake.status === r.status,
    `${fake.status} vs ${r.status}`);
}

console.log("\n-- an unknown kind is refused --");
{
  const { env } = seed();
  const r = await call(env, "u_pat", "acc_a", "/subs/cmp_bay/documents/bogus/draft", "PUT", { draft: HALF });
  ck("not a document kind, not a draft", r.status === 404, String(r.status));
  ck("and the four real kinds are what DOC_KINDS says", DOC_KINDS.length === 4, DOC_KINDS.join(","));
}

console.log("\n-- the screen reads the draft, and only for the form --");
{
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const slice = (name) => {
    const at = app.indexOf(`function ${name}(`);
    if (at < 0) return "";
    const next = app.indexOf("\nfunction ", at + 1);
    return app.slice(at, next < 0 ? app.length : next);
  };
  const rv = slice("DocReview");
  ck("the review modal seeds from a saved draft", /const draft = rv\?\.draft/.test(rv));
  ck("and offers a way to pause", /Save and finish later/.test(rv));
  // The whole reason to save is that the form is not finished, so gating the
  // button on completeness would offer it only once it is no longer needed.
  ck("which is not gated on the form being complete",
    !/rv-save[^]{0,200}disabled=\{!canVerify\}/.test(rv));
  ck("it says the draft is not an approval", /has been\s*\n?\s*approved|Nothing here has been/.test(rv));
  ck("and the roster says a review was started", /Review started/.test(app));
  // docStatus is what every compliance read goes through. If it ever learned
  // about drafts, a half-finished review would start moving badges.
  const ds = app.slice(app.indexOf("const docStatus ="), app.indexOf("const docVerified ="));
  ck("docStatus still knows nothing about drafts", !/draft/i.test(ds), ds.trim());
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
