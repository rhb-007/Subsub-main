// A review can say WHAT is wrong, and the subcontractor is told.
//
// Review was pass or fail with a free-text note. The checklist looked like it
// carried the detail, and it did not: an unticked box meant "I have not got to
// this yet" and "I checked, and it is not there" with one mark, and nothing
// anywhere could tell them apart. So a reviewer who found the hiring account
// missing from the additional insured schedule -- the commonest correctable
// fault on a certificate of insurance -- had one move: reject the whole
// document and type a paragraph. What then went to the subcontractor was the
// generic "upload your compliance documents" notice, about a document they had
// already uploaded.
//
// What has to hold:
//
//   THREE STATES, AND THE LEGACY READ MUST NOT INVENT FINDINGS. Every review
//   written before this has a `checks` object where `false` means "not ticked",
//   NOT "found wrong". Mapping it to `wrong` would retroactively put faults on
//   documents that are already verified.
//
//   `checks` IS DERIVED, NEVER STORED BESIDE. Two independently stored answers
//   to one question is two answers.
//
//   ONE CHECKLIST. It lived in App.tsx and again in worker/mail.js, and the
//   moment the email names a specific line, two lists means an email naming a
//   line the screen never asked about.
//
//   THE MAIL FOLLOWS THE FINDINGS, NOT THE CALLER. The preview and the send
//   pick the template the same way, or what was reviewed on screen is not what
//   goes out.
//
//   AND IT SAYS WHAT WAS RIGHT. A list of faults with no mention of the lines
//   that were fine reads as "start again", which costs a phone call.
//
//   node --no-warnings scripts/doc-findings-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import * as dc from "../shared/doccheck.js";
import { DOC_KINDS, OPTIONAL_KINDS } from "../shared/docs.js";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const mail = await import("../worker/mail.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const APP = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

// ---------------------------------------------------------------------------
// One checklist
// ---------------------------------------------------------------------------
console.log("\n-- one list, not three --");
{
  ck("every document kind has something to confirm",
    DOC_KINDS.every((k) => dc.checkItems(k, "Outerhome").length > 0),
    DOC_KINDS.map((k) => `${k}:${dc.checkItems(k, "X").length}`).join(" "));
  ck("and the module's own list agrees with DOC_KINDS",
    dc.CHECK_KINDS.slice().sort().join(",") === DOC_KINDS.slice().sort().join(","),
    dc.CHECK_KINDS.join(","));
  // Every item needs an id, a label and an instruction: a finding with no
  // instruction is a fault reported with nothing to do about it.
  const bad = [];
  for (const k of DOC_KINDS) {
    for (const it of dc.checkItems(k, "Outerhome")) {
      if (!it.id || !it.label || !it.fix) bad.push(`${k}.${it.id || "?"}`);
    }
  }
  ck("each item has an id, a label and an instruction", bad.length === 0, bad.join(","));
  // The hiring account is named, because "the hiring account named as
  // additional insured" is a line somebody has to translate.
  ck("the account's own name reaches the label",
    /Outerhome/.test(dc.checkItems("insurance", "Outerhome").find((i) => i.id === "named").label));
  ck("and the instruction too",
    /Outerhome/.test(dc.checkItems("insurance", "Outerhome").find((i) => i.id === "named").fix));

  // The copies are gone, and this is what stops them growing back.
  ck("App.tsx has no INSURANCE_ATTEST of its own", !/const INSURANCE_ATTEST\s*=/.test(APP));
  ck("nor its own INSURANCE_LINES array", !/const INSURANCE_LINES\s*=\s*\[/.test(APP));
  ck("nor its own BOND_MIN", !/const BOND_MIN\s*=/.test(APP));
  ck("and it imports the shared one", /from "\.\.\/shared\/doccheck\.js"/.test(APP));
  const MAIL = readFileSync(new URL("../worker/mail.js", import.meta.url), "utf8");
  ck("mail.js has no copy either",
    !/const INSURANCE_LINES\s*=\s*\[/.test(MAIL) && !/const INSURANCE_ATTEST\s*=/.test(MAIL)
      && !/const BOND_MIN\s*=/.test(MAIL));
  ck("and imports it", /from "\.\.\/shared\/doccheck\.js"/.test(MAIL));
  // Same merge, one list along: mail.js held its own DOC_KINDS and DOC_LABELS,
  // agreeing with shared/docs.js by luck. An email naming a document by a word
  // no screen uses is an email about a row the reader cannot find.
  ck("nor its own DOC_KINDS or DOC_LABELS",
    !/^export const DOC_KINDS\s*=/m.test(MAIL) && !/^export const DOC_LABELS\s*=/m.test(MAIL));
  // Imported, not `export ... from`: that re-exports without binding either
  // name here, so the module loads and `missingDocs` throws on the first email
  // sent. The assertion below is what catches it, and this is what names it.
  ck("and imports them rather than only re-exporting",
    /import \{[^}]*DOC_KINDS[^}]*\} from "\.\.\/shared\/docs\.js"/.test(MAIL));
}

console.log("\n-- three states, and the middle one is the whole point --");
{
  ck("there are exactly three", dc.FINDING_STATES.join(",") === "unanswered,ok,wrong", dc.FINDING_STATES.join(","));
  const rv = { findings: { named: { state: "wrong", note: "Add us to the CGL" }, primary: { state: "ok" } } };
  const f = dc.findingsFor(rv, "insurance", "Outerhome");
  ck("a wrong one is wrong", f.named.state === "wrong");
  ck("carrying its own instruction", f.named.note === "Add us to the CGL");
  ck("a confirmed one is ok", f.primary.state === "ok");
  // The state an unticked box used to be indistinguishable from.
  ck("and one nobody has answered is unanswered", f.wc.state === "unanswered", f.wc.state);
  ck("every item gets an entry, so no caller has to guess",
    Object.keys(f).length === dc.checkItems("insurance", "Outerhome").length);
}

console.log("\n-- a review written before this must not grow faults --");
{
  // `false` in a legacy `checks` object means "not ticked". Reading it as
  // `wrong` would put findings on already-verified documents that nobody ever
  // recorded, which is the exact ambiguity this replaces, inverted.
  const legacy = { status: "verified", checks: { named: true, primary: true, wc: false } };
  const f = dc.findingsFor(legacy, "insurance", "Outerhome");
  ck("a ticked box reads as confirmed", f.named.state === "ok" && f.primary.state === "ok");
  ck("an UNTICKED one reads as unanswered, never as wrong",
    f.wc.state === "unanswered", f.wc.state);
  ck("so a legacy review has no findings at all",
    dc.problemsIn(legacy, "insurance", "Outerhome").length === 0);
  ck("and does not read as complete either",
    !dc.allConfirmed(legacy, "insurance", "Outerhome"));
  const allTicked = { checks: { named: true, primary: true, wc: true, current: true, carrier: true } };
  ck("a fully ticked legacy review still reads as complete",
    dc.allConfirmed(allTicked, "insurance", "Outerhome"));
}

console.log("\n-- checks is derived, so the two cannot disagree --");
{
  const f = { a: { state: "ok" }, b: { state: "wrong" }, c: { state: "unanswered" } };
  const c = dc.checksFrom(f);
  ck("ok is true", c.a === true);
  ck("wrong is false", c.b === false);
  ck("and unanswered is false too, as an unticked box always was", c.c === false);
}

console.log("\n-- what is wrong, in order, with instructions --");
{
  const rv = { findings: { carrier: { state: "wrong" }, named: { state: "wrong", note: "Ours, please" },
    primary: { state: "ok" } } };
  const p = dc.problemsIn(rv, "insurance", "Outerhome");
  ck("two problems", p.length === 2, JSON.stringify(p.map((x) => x.id)));
  // The reading order of the document, not the order somebody happened to tap.
  ck("in the order the document is read, not the order they were tapped",
    p[0].id === "named" && p[1].id === "carrier", p.map((x) => x.id).join(","));
  ck("a typed instruction is used", p[0].fix === "Ours, please", p[0].fix);
  ck("and a blank one falls back to the standing instruction",
    /agent/i.test(p[1].fix) === false && p[1].fix.length > 10, p[1].fix);
  const w = dc.outcomeWords(rv, "insurance", "Outerhome");
  ck("the words count them", w.headline === "2 things to fix", w.headline);
  ck("and one is singular", dc.outcomeWords({ findings: { named: { state: "wrong" } } },
    "insurance", "X").headline === "1 thing to fix");
  ck("with no findings it is simply turned down",
    dc.outcomeWords({}, "insurance", "X").headline === "Turned down");
}

console.log("\n-- verifying still needs every line confirmed --");
{
  const items = dc.checkItems("bond", "Outerhome");
  const all = { findings: Object.fromEntries(items.map((i) => [i.id, { state: "ok" }])) };
  ck("all ok is complete", dc.allConfirmed(all, "bond", "Outerhome"));
  const one = { findings: { ...all.findings, [items[0].id]: { state: "wrong" } } };
  ck("one wrong is not", !dc.allConfirmed(one, "bond", "Outerhome"));
  const gap = { findings: { ...all.findings, [items[1].id]: { state: "unanswered" } } };
  ck("nor is one unanswered", !dc.allConfirmed(gap, "bond", "Outerhome"));
}

console.log("\n-- and there is no fourth status to leak into eight gates --");
{
  // The decision recorded in shared/doccheck.js: the verdict stays a verdict
  // and the findings carry the substance. A "changes" status would have to be
  // answered by docStatus, missingDocs, docsComplete, the assignment gate, the
  // nav badge and the send gate, and would answer exactly as `rejected` in all
  // of them.
  const SRC = readFileSync(new URL("../shared/doccheck.js", import.meta.url), "utf8");
  ck("no needs_changes state is introduced",
    !/["']needs_changes["']|["']changes["']/.test(SRC));
  ck("and the signed agreement is still optional, so a fault on it is not a bar",
    OPTIONAL_KINDS.includes("contract"));
}

// ---------------------------------------------------------------------------
// The email
// ---------------------------------------------------------------------------
const CO = { company: "Cascade Roofworks", email: "dev@cascade.test", insurance: 1, bond: 1, w9: 1, contract: 1 };
const ACCT = { name: "Outerhome", subdomain: "outerhome" };
const REVIEW = { status: "rejected", note: "Before Friday if you can.", findings: {
  named: { state: "wrong", note: "" },
  primary: { state: "ok" }, wc: { state: "ok" },
  current: { state: "wrong", note: "The policy runs out before the job starts." },
  carrier: { state: "ok" },
} };

console.log("\n-- the mail names the faults and the instructions --");
{
  const m = mail.docFindingsEmail({ company: CO, contact: "Dev", account: ACCT,
    kind: "insurance", review: REVIEW, note: REVIEW.note });
  ck("the subject counts them rather than saying rejected",
    /2 things to fix/.test(m.subject) && !/reject/i.test(m.subject), m.subject);
  ck("both faults are named",
    /additional insured/i.test(m.text) && /Policy period/i.test(m.text));
  ck("with the standing instruction for the one left blank",
    /Ask your agent to add Outerhome as an additional insured/.test(m.text));
  ck("and the typed one for the other",
    /runs out before the job starts/.test(m.text));
  // The half that stops it reading as "start again".
  ck("it says what was already fine",
    /ALREADY FINE/.test(m.text) && /Primary & non-contributory/.test(m.text));
  ck("and says they need not start again", /not need to start again/i.test(m.text));
  ck("the reviewer's own note travels too", /Before Friday/.test(m.text));
  ck("it points at the portal, not at a reply", /outerhome\.subsub\.work\/documents/.test(m.text));
  ck("and says replies are not received", /Replies aren't received/.test(m.text));
  ck("it never says the word rejected", !/reject/i.test(m.text), (m.text.match(/reject\w*/i) || [])[0]);
  ck("and the problems come back for the screen to head the panel with",
    m.problems.length === 2, JSON.stringify(m.problems.map((p) => p.id)));
  // No JSX-escape, no raw \uXXXX in front of anybody.
  ck("no literal \\uXXXX survives into the body", !/\\u[0-9a-f]{4}/i.test(m.text),
    (m.text.match(/\\u[0-9a-f]{4}/i) || [])[0]);
}

console.log("\n-- and the generic request is still the right mail when nothing was sent --");
{
  const m = mail.docRequestEmail({ company: { company: "Cascade", email: "d@c.test" },
    contact: "Dev", docReview: {}, account: ACCT });
  ck("it asks for the documents", /upload your compliance documents/i.test(m.subject));
  // Reading the shared list, which is how the two cannot name different lines.
  ck("and its insurance checklist is the shared one",
    /Outerhome named as additional insured on CGL/.test(m.text));
}

// ---------------------------------------------------------------------------
// The routes
// ---------------------------------------------------------------------------
const ENV = (db) => ({ DB: makeD1(db), RESEND_API_KEY: "re_x", MAIL_FROM: "no-reply@subsub.work" });
const call = async (env, path, { method = "GET", seat = { u: "u_ad", a: "acc_gc" }, body } = {}) => {
  const res = await worker.fetch(new Request(`https://api.subsub.work${path}`, {
    method,
    headers: { "X-User-Id": seat.u, "X-Account-Id": seat.a, "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }), env);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

function seed(docReview = {}) {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind,plan) VALUES ('acc_gc','Outerhome','outerhome','general_contractor','scale');
    INSERT INTO users(id,name,email) VALUES ('u_ad','Rae','rae@outerhome.test');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES ('m_ad','u_ad','acc_gc','admin');
    INSERT INTO companies(id,company,contact,email,insurance,bond,w9,contract)
      VALUES ('cmp_roof','Cascade Roofworks','Dev','dev@cascade.test',1,1,1,1);
  `);
  db.prepare(`INSERT INTO engagements(id,account_id,company_id,status,doc_review) VALUES (?,?,?,?,?)`)
    .run("en1", "acc_gc", "cmp_roof", "active", JSON.stringify(docReview));
  db.prepare(`INSERT INTO company_docs(id,company_id,kind,file_key,file_name,expires_on)
              VALUES ('cd_i','cmp_roof','insurance','k/i','coi.pdf','2030-01-01')`).run();
  return db;
}

console.log("\n-- the review route stores findings and derives checks --");
{
  const db = seed(); const env = ENV(db);
  const r = await call(env, "/api/subs/cmp_roof/documents/insurance/review", { method: "POST", body: {
    status: "rejected", note: "",
    findings: { named: { state: "wrong", note: "Add us" }, primary: { state: "ok" },
      wc: { state: "unanswered" } },
  } });
  ck("accepted", r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
  const rv = JSON.parse(db.prepare(`SELECT doc_review FROM engagements WHERE id='en1'`).get().doc_review).insurance;
  ck("the findings are stored", rv.findings?.named?.state === "wrong", JSON.stringify(rv.findings));
  ck("with the instruction", rv.findings.named.note === "Add us");
  ck("and checks agrees with them by construction",
    rv.checks?.named === false && rv.checks?.primary === true, JSON.stringify(rv.checks));
  // An unanswered line is not worth a row -- it is the absence of an answer.
  ck("an unanswered line is not stored as a finding", !rv.findings.wc, JSON.stringify(rv.findings.wc));
  ck("the verdict is still the verdict, with no fourth value",
    rv.status === "rejected", rv.status);

  // The stronger form: a caller who sends a DISAGREEING `checks` does not get
  // it stored. Sending none at all leaves the field undefined, which is caught
  // too but for a weaker reason.
  const r2 = await call(env, "/api/subs/cmp_roof/documents/bond/review", { method: "POST", body: {
    status: "rejected",
    checks: { active: true, amount: true, principal: true, surety: true },   // a lie
    findings: { active: { state: "wrong", note: "Lapsed" } },
  } });
  ck("a second review lands", r2.status === 200, `${r2.status}`);
  const bond = JSON.parse(db.prepare(`SELECT doc_review FROM engagements WHERE id='en1'`).get().doc_review).bond;
  ck("the body's own `checks` is overridden by the findings",
    bond.checks?.active === false, JSON.stringify(bond.checks));
  ck("and the lines it claimed are not silently confirmed",
    !bond.checks?.amount && !bond.checks?.surety, JSON.stringify(bond.checks));

  // The body is normalised against the item list on the way in, so it is not a
  // place to write arbitrary keys or states into an engagement row that the
  // roster, the mail and the badge all read.
  const r3 = await call(env, "/api/subs/cmp_roof/documents/w9/review", { method: "POST", body: {
    status: "rejected",
    findings: {
      tin: { state: "wrong", note: "Blank" },
      "../../etc": { state: "wrong", note: "nope" },
      name: { state: "banana" },
    },
  } });
  ck("a third review lands", r3.status === 200, `${r3.status}`);
  const w9 = JSON.parse(db.prepare(`SELECT doc_review FROM engagements WHERE id='en1'`).get().doc_review).w9;
  ck("an item id that is not on the list is dropped",
    !("../../etc" in (w9.findings || {})), JSON.stringify(Object.keys(w9.findings || {})));
  ck("and a state that is not a state reads as unanswered rather than stored",
    !w9.findings?.name, JSON.stringify(w9.findings?.name));
  ck("while the real finding survives", w9.findings?.tin?.state === "wrong");

  // A caller that sends NO findings key at all keeps its legacy `checks`
  // untouched: writing an invented all-unanswered map would mask the checks
  // that same call sent, because findingsFor prefers a stored map over them.
  const r4 = await call(env, "/api/subs/cmp_roof/documents/contract/review", { method: "POST", body: {
    status: "verified", checks: { signed: true, counter: true, version: true },
  } });
  ck("a fourth review lands", r4.status === 200, `${r4.status}`);
  const ct = JSON.parse(db.prepare(`SELECT doc_review FROM engagements WHERE id='en1'`).get().doc_review).contract;
  ck("no findings key is invented", ct.findings === undefined, JSON.stringify(ct.findings));
  ck("and the legacy checks it did send survive",
    ct.checks?.signed === true && ct.checks?.version === true, JSON.stringify(ct.checks));
  ck("so it still reads as complete", dc.allConfirmed(ct, "contract", "Outerhome"));

  // And one that sends a findings map with nothing answered writes it, because
  // "the reviewer opened this and answered nothing" is a real state.
  const items = dc.checkItems("bond", "Outerhome");
  const r5 = await call(env, "/api/subs/cmp_roof/documents/bond/review", { method: "POST", body: {
    status: "rejected", note: "Wrong company entirely.",
    findings: Object.fromEntries(items.map((i) => [i.id, { state: "unanswered" }])),
  } });
  ck("a fifth review lands", r5.status === 200, `${r5.status}`);
  const bd = JSON.parse(db.prepare(`SELECT doc_review FROM engagements WHERE id='en1'`).get().doc_review).bond;
  ck("an all-unanswered map is stored as an empty findings object",
    !!bd.findings && Object.keys(bd.findings).length === 0, JSON.stringify(bd.findings));
  ck("and reads as no problems rather than as unknown",
    dc.problemsIn(bd, "bond", "Outerhome").length === 0);
  ck("so the words fall back to turned down, with the note carrying the reason",
    dc.outcomeWords(bd, "bond", "Outerhome").headline === "Turned down" && /Wrong company/.test(bd.note));
}

console.log("\n-- the preview picks the mail from the findings --");
{
  const db = seed({ insurance: { status: "rejected", findings: {
    named: { state: "wrong", note: "" }, primary: { state: "ok" } } } });
  const env = ENV(db);
  const withKind = await call(env, "/api/notify/documents/preview?companyId=cmp_roof&kind=insurance");
  ck("with the kind it is the findings mail",
    withKind.body.template === "findings", `${withKind.status} ${withKind.body.template}`);
  ck("and it names the fault", /additional insured/i.test(withKind.body.text || ""));
  ck("handing the screen the problems so the panel can be headed honestly",
    (withKind.body.problems || []).length === 1, JSON.stringify(withKind.body.problems));

  // Without a kind there is nothing to be specific about, so it is the
  // generic request -- which is right, and is also what every other caller of
  // this preview (the assign screen, the roster's Request button) wants.
  const noKind = await call(env, "/api/notify/documents/preview?companyId=cmp_roof");
  ck("without a kind it is the request mail", noKind.body.template === "request", noKind.body.template);

  // A kind with no findings is not the findings mail: there would be nothing
  // in it.
  const clean = await call(env, "/api/notify/documents/preview?companyId=cmp_roof&kind=bond");
  ck("a kind with nothing marked wrong is the request mail too",
    clean.body.template === "request", clean.body.template);
}

console.log("\n-- and the send builds from the same function --");
{
  const db = seed({ insurance: { status: "rejected", findings: {
    named: { state: "wrong", note: "" }, current: { state: "wrong", note: "Expired" } } } });
  const env = ENV(db);
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("resend")) {
      sent.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ id: "em_1" }), { status: 200,
        headers: { "Content-Type": "application/json" } });
    }
    return realFetch(url, init);
  };
  const pv = await call(env, "/api/notify/documents/preview?companyId=cmp_roof&kind=insurance");
  const r = await call(env, "/api/notify/documents", { method: "POST",
    body: { companyId: "cmp_roof", kind: "insurance" } });
  globalThis.fetch = realFetch;
  ck("it sends", r.status === 200 && r.body.ok === true, `${r.status} ${JSON.stringify(r.body)}`);
  ck("as the findings mail", r.body.template === "findings", r.body.template);
  ck("and one email went", sent.length === 1, String(sent.length));
  // The property the preview exists for: what was reviewed is what went.
  ck("the subject that went is the subject that was previewed",
    sent[0].subject === pv.body.subject, `${sent[0].subject} vs ${pv.body.subject}`);
  ck("and the body too", sent[0].text === pv.body.text);
  ck("to the company's own address", sent[0].to?.[0] === "dev@cascade.test" || sent[0].to === "dev@cascade.test",
    JSON.stringify(sent[0].to));
  const logged = db.prepare(`SELECT kind FROM email_log ORDER BY rowid DESC LIMIT 1`).get();
  ck("logged as its own kind, not as a document request",
    logged?.kind === "doc_findings", logged?.kind);
}

console.log("\n-- who may, and whose --");
{
  const db = seed(); const env = ENV(db);
  db.exec(`INSERT INTO accounts(id,name,subdomain,kind,plan) VALUES ('acc_x','Other','other','general_contractor','basic');
           INSERT INTO users(id,name,email) VALUES ('u_x','Pat','pat@other.test');
           INSERT INTO memberships(id,user_id,account_id,role) VALUES ('m_x','u_x','acc_x','admin');`);
  const theirs = await call(env, "/api/notify/documents/preview?companyId=cmp_roof&kind=insurance",
    { seat: { u: "u_x", a: "acc_x" } });
  ck("a company you do not engage is not previewable",
    theirs.status === 404, `${theirs.status} ${JSON.stringify(theirs.body)}`);
  const write = await call(env, "/api/subs/cmp_roof/documents/insurance/review",
    { method: "POST", seat: { u: "u_x", a: "acc_x" }, body: { status: "rejected", findings: {} } });
  ck("nor reviewable", write.status === 404, `${write.status}`);
}

console.log("\n-- the screen collects them --");
{
  // Static, because the browser harnesses need a stack this environment cannot
  // run. These are the wiring facts a mutation would break silently.
  ck("the review form renders the three-state list", /<FindingList\b/.test(APP));
  ck("and the list has both answers as buttons",
    /onState\(it\.id, "ok"\)/.test(APP) && /onState\(it\.id, "wrong"\)/.test(APP));
  ck("a wrong line offers the instruction that goes to them",
    /What they need to do/.test(APP));
  ck("prefilled from the standing one", /placeholder=\{it\.fix\}/.test(APP));
  ck("the verdict carries findings to the server", /findings: found, checks: ticked/.test(APP));
  ck("and rejecting does too",
    /onReject\(kind, \{ findings: found, checks: ticked, note: note\.trim\(\) \}\)/.test(APP));
  // The bug this whole pass is about: the kind has to reach the mail.
  ck("the rejection carries the KIND through to the notify modal",
    /requestDocs\(\{ \.\.\.target,[\s\S]{0,200}null, null, kind\)/.test(APP));
  ck("and the preview asks with it", /previewDocRequest\(\{ companyId: sub\.id, jobId: job\?\.id, trade, kind \}\)/.test(APP));
  ck("a note is only required when nothing is marked",
    /disabled=\{!wrongItems\.length && !note\.trim\(\)\}/.test(APP));
  ck("and the roster row names the faults rather than a blob",
    /Sent back — \{probs\.length\} thing/.test(APP));
  // Rejecting is recorded BEFORE the notify modal opens, so closing it without
  // sending leaves a contractor waiting on a job that will never be issued over
  // a fault nobody told them about -- the same silent failure one screen along.
  ck("closing the notify modal without sending is said out loud",
    /they have not been told yet/.test(APP));

  // AND THE SUBCONTRACTOR'S OWN SCREEN, which is the one they act on. It read
  // `Needs a new copy — {note}`, and the note is optional now because the
  // findings carry the reason -- so a certificate sent back with three named
  // faults would have rendered a dangling em dash and nothing at all, on the
  // screen somebody opens straight after reading the email about it.
  ck("the contractor's own row counts the faults rather than printing an empty note",
    /\{probs\.length\} thing\{probs\.length === 1 \? "" : "s"\} to fix<\/>/.test(APP));
  ck("and still says the old thing when there are none, without a dangling dash",
    /Needs a new copy\{rv\?\.note \? <> — \{rv\.note\}<\/> : null\}/.test(APP));
  ck("with the list and each instruction under it, because a count is not actionable",
    /className="dm-fixes"/.test(APP) && /needs these corrected/.test(APP));
  ck("and it tells them uploading replaces what is on file",
    /it replaces the one on file/.test(APP));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
