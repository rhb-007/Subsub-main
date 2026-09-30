// A subcontractor agreement is between TWO PARTIES.
//
// What this covers is the handful of properties that are easy to destroy by
// accident and that no screen can report:
//
//   IT HANGS OFF THE PAIR. `companies.contract` is one boolean on a row every
//   hiring account shares, so signing with one general contractor read as
//   signed with all of them. A form with both parties' names printed in it
//   makes that unmissable, and the fix has to hold on the ROSTER read, which
//   is the screen that draws the conclusion.
//
//   BOTH SIGNATURES, AND NEITHER SIDE MAY DO THE OTHER'S. A form signed by
//   one side is not a contract. The sub signs and the hiring account
//   countersigns, and nothing is in force until both.
//
//   AN AGREEMENT COUNTS ONLY ONCE ASKED FOR. Before this, every roster
//   counted one against every subcontractor, so a sub whose client never sent
//   an agreement sat permanently short of complete over a document only the
//   hiring account could produce.
//
//   THE HASH IS OF WHAT THEY WERE SHOWN. Recomputed from the stored parties
//   and terms, never carried over from issue and never taken from the
//   request: a caller who could name the hash could sign one document and
//   record another.
//
//   A TEMPLATE VERSION MISS IS LOUD. Rendering a different contract under a
//   heading saying it was signed is worse than rendering nothing, because the
//   wrong contract still reads like a contract.
//
//   node --no-warnings scripts/agreement-test.mjs

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const A = await import("../shared/agreement.js");
const { DOC_KINDS } = await import("../shared/docs.js");

const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const M052 = readFileSync(new URL("../worker/migrations/052_agreements.sql", import.meta.url), "utf8");

const GC = "acc_gc", SUB_ACC = "acc_sub";
const SUB_CO = "cmp_bay", OTHER_CO = "cmp_other";

const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [M052] });
  db.exec(`
    INSERT INTO companies(id,company,mail_street,city,state,zip,license,insurance,bond,w9,doc_files) VALUES
      ('cmp_gc','Outerhome LLC','1 Pike St','Seattle','WA','98101','OUTERH*111',1,1,1,'{}'),
      ('${SUB_CO}','Bay Roofing Inc','9 Dock Rd','Tacoma','WA','98402','BAYRR*222',1,1,1,
       '{"insurance":"coi.pdf","bond":"bond.pdf","w9":"w9.pdf"}'),
      ('${OTHER_CO}','Other Co','2 Elm','Olympia','WA','98501',NULL,1,1,1,'{}');
    INSERT INTO accounts(id,name,subdomain,kind,plan,company_id) VALUES
      ('${GC}','Outerhome','outerhome','general_contractor','scale','cmp_gc'),
      ('${SUB_ACC}','Bay Roofing','bay','subcontractor','basic','${SUB_CO}'),
      ('acc_pm','Cascade Management','cascade','property_manager','scale',NULL);
    INSERT INTO engagements(id,account_id,company_id,status) VALUES
      ('en1','${GC}','${SUB_CO}','active'),
      ('en2','acc_pm','${SUB_CO}','active'),
      ('en3','${GC}','${OTHER_CO}','active');
    INSERT INTO users(id,name,email) VALUES
      ('u_gc','Dana Ruiz','dana@outerhome.test'),
      ('u_gcpm','Pat Lee','pat@outerhome.test'),
      ('u_sub','Rae Okafor','rae@bay.test'),
      ('u_pm','Jo Kim','jo@cascade.test');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES
      ('m_gc','u_gc','${GC}','admin'),
      ('m_gcpm','u_gcpm','${GC}','pm'),
      ('m_sub','u_sub','${SUB_ACC}','admin'),
      ('m_pm','u_pm','acc_pm','admin');
  `);
  return db;
};

const ENV = (db) => ({ DB: makeD1(db) });

const call = async (env, path, { method = "GET", seat = { u: "u_gc", a: GC }, body } = {}) => {
  const res = await worker.fetch(new Request(`https://api.subsub.work${path}`, {
    method,
    headers: { "X-User-Id": seat.u, "X-Account-Id": seat.a, "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }), env);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const GC_SEAT = { u: "u_gc", a: GC };
const SUB_SEAT = { u: "u_sub", a: SUB_ACC };

// ---------------------------------------------------------------------------
console.log("-- the document is deterministic, which is what makes the hash mean anything --");
{
  const args = {
    parties: { hiring: { name: "Outerhome LLC", city: "Seattle", state: "WA" },
               sub: { name: "Bay Roofing Inc", city: "Tacoma", state: "WA" } },
    terms: A.validTerms({ governingState: "WA" }),
    issuedOn: "2026-09-30",
  };
  const a = A.canonicalText(A.renderAgreement(args));
  const b = A.canonicalText(A.renderAgreement(args));
  ck("the same inputs render the same bytes", a === b, `${a.length} vs ${b.length}`);
  ck("and different terms render different bytes",
    a !== A.canonicalText(A.renderAgreement({ ...args, terms: A.validTerms({ ...args.terms, paymentDays: 45 }) })));
  ck("and different parties do too",
    a !== A.canonicalText(A.renderAgreement({
      ...args, parties: { ...args.parties, sub: { name: "Somebody Else" } } })));

  // The canonical text is its own function rather than "whatever the screen
  // drew", so a layout change cannot invalidate every signature ever taken.
  const r = A.renderAgreement(args);
  ck("the canonical text carries the template version",
    A.canonicalText(r).includes(`${r.templateId} ${r.templateVersion}`));

  let threw = null;
  try { A.renderAgreement({ ...args, templateVersion: "0.0.1" }); } catch (e) { threw = e?.code; }
  ck("an unknown template version throws rather than drawing a DIFFERENT contract",
    threw === "unknown_template", String(threw));
}

console.log("\n-- it is SUBSUB'S form, with the company filled into it --");
{
  const mk = (kind) => A.renderAgreement({
    parties: { kind, hiring: { name: "Acme Management" }, sub: { name: "Bay Roofing Inc" } },
    terms: A.validTerms({ governingState: "WA" }), issuedOn: "2026-09-30" });

  const gc = mk("general_contractor");
  ck("the title says whose form it is, not whose company sent it",
    gc.title === "SubSub Standard Subcontractor Agreement", gc.title);
  ck("and the hiring company appears as a PARTY rather than in the title",
    !gc.title.includes("Acme") && gc.sections[0].paragraphs[0].includes("Acme Management"),
    gc.title);

  // A general contractor holds the prime contract, so the people they engage
  // work UNDER it. A property manager engages a plumber directly: nobody is
  // sub to anything, and a document calling them a subcontractor describes a
  // chain that does not exist. Same rule `hiresLabel` draws on the roster.
  const pm = mk("property_manager");
  ck("a property manager hires a Contractor, not a Subcontractor",
    pm.title === "SubSub Standard Contractor Agreement"
      && pm.partyTerms.hired === "Contractor" && pm.partyTerms.hiring === "Manager",
    `${pm.title} / ${JSON.stringify(pm.partyTerms)}`);
  ck("a building owner is the Owner", mk("building_owner").partyTerms.hiring === "Owner");
  ck("and a subcontractor passing work down is still a Contractor over a Subcontractor",
    mk("subcontractor").partyTerms.hired === "Subcontractor");
  // A contract rendering with a blank where a party name belongs is worse
  // than one using a slightly formal word.
  ck("an unknown kind gets a neutral pair rather than nothing",
    mk(null).partyTerms.hiring === "Hiring Party" && mk(null).partyTerms.hired === "Contractor");

  // The words are part of the document, so they change the bytes -- which is
  // what makes stamping the kind load-bearing rather than cosmetic.
  ck("the defined terms change the document, so the hash follows them",
    A.canonicalText(gc) !== A.canonicalText(pm));

  // A ${} inside a plain string is five literal characters, not an
  // interpolation. That shipped once in a heading here, and it is the same
  // class as a \\uXXXX escape in JSX text -- invisible in the source, obvious
  // to the reader, and caught by nothing that only checks the document
  // renders. Every kind, because only one heading was ever wrong.
  for (const kind of ["general_contractor", "property_manager", "building_owner",
                      "portfolio_manager", "subcontractor", null]) {
    const r = mk(kind);
    const stray = [r.title, ...r.sections.flatMap((x) => [x.heading, ...x.paragraphs])]
      .filter((t) => String(t).includes("${"));
    ck(`no unrendered interpolation anywhere for ${kind}`, stray.length === 0,
      stray[0] || "");
  }
  // And nothing may render an empty heading or paragraph, which is what a
  // body reading a field that moved would produce.
  const empties = gc.sections.filter((x) => !x.heading.trim() || x.paragraphs.some((p) => !p.trim()));
  ck("and no empty heading or paragraph", empties.length === 0, empties.map((x) => x.id).join(","));
}

console.log("\n-- terms are normalised on the way IN, never only on the way out --");
{
  const t = A.validTerms({ paymentDays: "45", retainageBps: 99999, warrantyMonths: -3,
                           workersComp: 0, governingState: "wa", nonsense: 1 });
  ck("a numeric string becomes a number", t.paymentDays === 45, JSON.stringify(t.paymentDays));
  ck("an out-of-range value is clamped rather than refused", t.retainageBps === 2000, String(t.retainageBps));
  ck("and clamped at the bottom too", t.warrantyMonths === 0, String(t.warrantyMonths));
  ck("a falsy boolean is a boolean", t.workersComp === false, String(t.workersComp));
  ck("a state is upper-cased", t.governingState === "WA", String(t.governingState));
  ck("and an unknown key is dropped rather than stored", !("nonsense" in t));
  ck("an absent field falls back to the default",
    A.validTerms({}).paymentDays === A.defaultTerms().paymentDays);
  // A per-subcontractor override sits on top of the account's own terms; most
  // accounts use one set for everybody, so this is usually a no-op.
  const m = A.mergeTerms({ paymentDays: 45 }, { retainageBps: 500 });
  ck("an override keeps the account's other terms", m.paymentDays === 45 && m.retainageBps === 500,
    JSON.stringify({ p: m.paymentDays, r: m.retainageBps }));
}

console.log("\n-- what counts against a subcontractor, and when --");
{
  ck("with no agreement the three the subcontractor owns are counted",
    JSON.stringify(A.kindsFor(null)) === JSON.stringify(["insurance", "bond", "w9"]),
    JSON.stringify(A.kindsFor(null)));
  ck("and an agreement is NOT, which is the whole point",
    !A.kindsFor(null).includes("contract"));
  ck("once one is issued it counts",
    A.kindsFor({ status: "sent" }).includes("contract"));
  ck("DOC_KINDS itself is untouched -- the hiring side's own list is unchanged",
    JSON.stringify(DOC_KINDS) === JSON.stringify(["insurance", "bond", "contract", "w9"]));

  ck("in force means BOTH signed", A.inForce({ status: "countersigned" })
    && !A.inForce({ status: "signed" }) && !A.inForce({ status: "sent" }));
  // A form the sub signed and nobody countersigned is an offer that was never
  // accepted, so it must not read as a document on file.
  ck("a signed-but-not-countersigned agreement is still outstanding",
    A.agreementDocShape({ status: "signed", source: "subsub_standard" })?.fileName === null);
  ck("and a countersigned one is on file",
    !!A.agreementDocShape({ status: "countersigned", source: "subsub_standard" })?.fileName);
  ck("an agreement does not expire, which docs.js reads as 'does not expire'",
    A.agreementDocShape({ status: "countersigned" }).expiresOn === null);

  // Drawn on both sides at once is how a two-party handshake stalls forever
  // with each side believing the other has it.
  for (const st of ["sent", "signed", "countersigned", "declined", "void"]) {
    const w = A.waitingOn({ status: st, source: "subsub_standard" });
    ck(`'${st}' waits on at most one side`, w === null || typeof w === "string", String(w));
  }
  ck("an uploaded agreement waits on an upload, not a signature",
    A.waitingOn({ status: "sent", source: "uploaded" }) === "sub_upload");
}

console.log("\n-- issuing --");
{
  const db = seed(); const env = ENV(db);

  const before = await call(env, `/api/subs/${SUB_CO}/agreement`);
  ck("before anything, there is no agreement and a preview of what would be sent",
    before.status === 200 && before.body.agreement === null && before.body.preview?.sections?.length > 0,
    `${before.status}`);
  ck("the preview names the two parties from their own records",
    JSON.stringify(before.body.parties?.hiring?.name) === '"Outerhome LLC"'
      && before.body.parties?.sub?.name === "Bay Roofing Inc",
    JSON.stringify(before.body.parties));

  const made = await call(env, `/api/subs/${SUB_CO}/agreement`, { method: "POST", body: {} });
  ck("issuing one puts it to the subcontractor", made.status === 200
    && made.body.agreement?.status === "sent", `${made.status} ${made.body.agreement?.status}`);
  ck("it waits on them to sign", made.body.agreement?.waitingOn === "sub_sign");
  ck("and is not in force", made.body.agreement?.inForce === false);

  const row = db.prepare(`SELECT * FROM agreements`).get();
  ck("the template version is stamped, not left to be read live later",
    !!row.template_id && !!row.template_version, `${row.template_id}@${row.template_version}`);
  ck("the parties are stamped, so renaming a company cannot change a signed document",
    JSON.parse(row.parties).sub.name === "Bay Roofing Inc");
  ck("the terms are stamped alongside them", !!JSON.parse(row.terms).paymentDays);
  ck("and the governing state comes off the hiring party rather than being guessed",
    row.governing_state === "WA", String(row.governing_state));
  ck("the account KIND is stamped with them, because the defined terms follow it",
    JSON.parse(row.parties).kind === "general_contractor",
    JSON.parse(row.parties).kind);
  ck("so the document calls them a Subcontractor",
    made.body.agreement?.document?.title === "SubSub Standard Subcontractor Agreement",
    made.body.agreement?.document?.title);
  // Changing kind afterwards must not change a document already issued.
  db.exec(`UPDATE accounts SET kind = 'property_manager' WHERE id = '${GC}'`);
  const after = await call(env, `/api/subs/${SUB_CO}/agreement`);
  ck("and re-kinding the account afterwards does not rewrite it",
    after.body.agreement?.document?.title === "SubSub Standard Subcontractor Agreement",
    after.body.agreement?.document?.title);

  // Refused rather than quietly replaced: a live agreement is a document the
  // other party may be reading right now.
  const again = await call(env, `/api/subs/${SUB_CO}/agreement`, { method: "POST", body: {} });
  ck("issuing a second one is refused rather than superseding the first",
    again.status === 409 && again.body.error === "already_issued",
    `${again.status} ${again.body.error}`);
  ck("and there is still exactly one",
    db.prepare(`SELECT COUNT(*) n FROM agreements`).get().n === 1);

  const notOurs = await call(env, `/api/subs/${OTHER_CO}/agreement`, {
    method: "POST", seat: { u: "u_pm", a: "acc_pm" }, body: {} });
  ck("a company this account does not engage answers not_found, never 403",
    notOurs.status === 404 && notOurs.body.error === "not_found",
    `${notOurs.status} ${notOurs.body.error}`);
}

console.log("\n-- signing, which takes both parties --");
{
  const db = seed(); const env = ENV(db);
  await call(env, `/api/subs/${SUB_CO}/agreement`, { method: "POST", body: {} });
  const id = db.prepare(`SELECT id FROM agreements`).get().id;

  const early = await call(env, `/api/agreements/${id}/countersign`,
    { method: "POST", body: { typedName: "Dana Ruiz" } });
  ck("the hiring account cannot countersign before the subcontractor has signed",
    early.status === 409 && early.body.error === "waiting_on_sub",
    `${early.status} ${early.body.error}`);

  const wrongName = await call(env, `/api/my-agreements/${id}/sign`,
    { method: "POST", seat: SUB_SEAT, body: { typedName: "Somebody Else" } });
  ck("a typed name that is not the signer's is refused",
    wrongName.status === 400 && wrongName.body.error === "name_mismatch",
    `${wrongName.status} ${wrongName.body.error}`);

  const signed = await call(env, `/api/my-agreements/${id}/sign`,
    { method: "POST", seat: SUB_SEAT,
      // A hash the caller names is ignored. Signing one document and
      // recording another is the whole thing the hash exists to prevent.
      body: { typedName: "  rae   OKAFOR ", docSha256: "deadbeef" } });
  ck("a name that matches apart from spacing and case is accepted", signed.status === 200,
    `${signed.status} ${signed.body.error || ""}`);
  ck("it is signed, and waiting on the hiring account",
    signed.body.agreement?.status === "signed"
      && signed.body.agreement?.waitingOn === "hiring_countersign");
  ck("and STILL not in force, because one signature is not a contract",
    signed.body.agreement?.inForce === false);

  const after = db.prepare(`SELECT * FROM agreements WHERE id = ?`).get(id);
  ck("the hash is not the one the caller named",
    after.doc_sha256 !== "deadbeef" && /^[0-9a-f]{64}$/.test(after.doc_sha256 || ""),
    String(after.doc_sha256).slice(0, 16));
  // Recomputed from the STORED parties and terms, which are the same inputs
  // the screen was rendered from -- so what is hashed is what they were shown.
  const expect = A.canonicalText(A.renderAgreement({
    templateId: after.template_id, templateVersion: after.template_version,
    parties: JSON.parse(after.parties), terms: JSON.parse(after.terms),
    issuedOn: String(after.issued_at).slice(0, 10),
  }));
  const { createHash } = await import("node:crypto");
  ck("and it is the hash of the document they were shown",
    after.doc_sha256 === createHash("sha256").update(expect).digest("hex"));
  ck("who signed is recorded, with their name and address",
    after.signed_by === "u_sub" && after.signed_by_name === "Rae Okafor"
      && after.signed_by_email === "rae@bay.test",
    `${after.signed_by_name} / ${after.signed_by_email}`);

  const twice = await call(env, `/api/my-agreements/${id}/sign`,
    { method: "POST", seat: SUB_SEAT, body: { typedName: "Rae Okafor" } });
  ck("signing twice is refused", twice.status === 409, `${twice.status} ${twice.body.error}`);

  // The two-party rule, from the other direction: the subcontractor may not
  // supply the hiring account's signature.
  const subCounters = await call(env, `/api/agreements/${id}/countersign`,
    { method: "POST", seat: SUB_SEAT, body: { typedName: "Rae Okafor" } });
  ck("the subcontractor cannot countersign on the hiring account's behalf",
    subCounters.status === 404 || subCounters.status === 403,
    `${subCounters.status} ${subCounters.body.error}`);

  const counter = await call(env, `/api/agreements/${id}/countersign`,
    { method: "POST", body: { typedName: "Dana Ruiz" } });
  ck("the hiring account countersigns", counter.status === 200
    && counter.body.agreement?.status === "countersigned", `${counter.status}`);
  ck("and NOW it is in force", counter.body.agreement?.inForce === true);
  ck("with nobody waiting on anybody", counter.body.agreement?.waitingOn === null);

  const both = db.prepare(`SELECT * FROM agreements WHERE id = ?`).get(id);
  ck("both signatures are on the row -- the CHECK.sql invariant",
    !!both.signed_at && !!both.countersigned_at);
  ck("and the hiring signature names its own signer",
    both.countersigned_by === "u_gc" && both.countersigned_by_name === "Dana Ruiz");
}

console.log("\n-- the roster, which is where the old bug showed --");
{
  const db = seed(); const env = ENV(db);

  const clean = await call(env, "/api/subs");
  const bay = (clean.body || []).find((s) => s.id === SUB_CO);
  ck("with no agreement a fully-papered subcontractor is complete",
    bay?.docState === "current" && bay?.docAssignable === true,
    `${bay?.docState} assignable=${bay?.docAssignable}`);
  ck("and carries no agreement", bay?.agreement === null, JSON.stringify(bay?.agreement));

  await call(env, `/api/subs/${SUB_CO}/agreement`, { method: "POST", body: {} });
  const asked = await call(env, "/api/subs");
  const bay2 = (asked.body || []).find((s) => s.id === SUB_CO);
  ck("once asked for, an unsigned agreement is outstanding",
    bay2?.docState === "missing" && bay2?.docAssignable === false,
    `${bay2?.docState} assignable=${bay2?.docAssignable}`);
  ck("and the roster row says which side it is waiting on",
    bay2?.agreement?.waitingOn === "sub_sign", JSON.stringify(bay2?.agreement));

  const id = db.prepare(`SELECT id FROM agreements`).get().id;
  await call(env, `/api/my-agreements/${id}/sign`,
    { method: "POST", seat: SUB_SEAT, body: { typedName: "Rae Okafor" } });
  const half = await call(env, "/api/subs");
  const bay3 = (half.body || []).find((s) => s.id === SUB_CO);
  ck("one signature does not make it on file",
    bay3?.docState === "missing", String(bay3?.docState));

  await call(env, `/api/agreements/${id}/countersign`,
    { method: "POST", body: { typedName: "Dana Ruiz" } });
  const done = await call(env, "/api/subs");
  const bay4 = (done.body || []).find((s) => s.id === SUB_CO);
  ck("and with both signatures it is", bay4?.docState === "current"
    && bay4?.docAssignable === true, `${bay4?.docState}`);

  // THE ORIGINAL BUG. One company row, two hiring accounts: an agreement with
  // Outerhome must say nothing at all on Cascade Management's roster.
  const other = await call(env, "/api/subs", { seat: { u: "u_pm", a: "acc_pm" } });
  const bayThere = (other.body || []).find((s) => s.id === SUB_CO);
  ck("another account's roster does not see this agreement",
    bayThere?.agreement === null, JSON.stringify(bayThere?.agreement));
  ck("and is not told the subcontractor has one on file with them",
    bayThere?.docState === "current" && bayThere?.docAssignable === true,
    `${bayThere?.docState}`);
}

console.log("\n-- the subcontractor's own list, across every client --");
{
  const db = seed(); const env = ENV(db);
  await call(env, `/api/subs/${SUB_CO}/agreement`, { method: "POST", body: {} });
  await call(env, `/api/subs/${SUB_CO}/agreement`,
    { method: "POST", seat: { u: "u_pm", a: "acc_pm" }, body: {} });

  const mine = await call(env, "/api/my-agreements", { seat: SUB_SEAT });
  ck("a subcontractor sees every client's agreement in one list",
    mine.status === 200 && mine.body.length === 2, `${mine.status} ${mine.body.length}`);
  // WHO IS THIS FOR is the whole question when the answer is a different
  // company every row.
  ck("each row names the account it is with",
    mine.body.every((r) => !!r.accountName)
      && mine.body.map((r) => r.accountName).sort().join(",") === "Cascade Management,Outerhome",
    JSON.stringify(mine.body.map((r) => r.accountName)));
  ck("and carries the document itself, not a reference to one",
    mine.body.every((r) => r.document?.sections?.length > 0));
  ck("the signer's IP is never sent to a browser",
    !JSON.stringify(mine.body).includes("signed_ip") && !JSON.stringify(mine.body).includes("signedIp"));

  // SCOPED BY `company_id = mine`, read off the seat and never the URL. Seeded
  // directly, because the only way to prove the WHERE clause is to put a row
  // in that it must not return.
  db.exec(`INSERT INTO agreements(id,account_id,company_id,status)
           VALUES ('a_other','${GC}','${OTHER_CO}','sent')`);
  const again = await call(env, "/api/my-agreements", { seat: SUB_SEAT });
  ck("another company's agreement on the same account is not in this list",
    again.body.length === 2 && !again.body.some((r) => r.companyId === OTHER_CO),
    `${again.body.length} rows`);

  // A property manager has no company row by design, so there is nothing for
  // them to be a party to -- and they are told that rather than getting an
  // empty list, which would read as "nobody has sent you one".
  const noCompany = await call(env, "/api/my-agreements", { seat: { u: "u_pm", a: "acc_pm" } });
  ck("an account that cannot be hired is told why, not handed an empty list",
    noCompany.status === 403 && noCompany.body.error === "not_hireable",
    `${noCompany.status} ${noCompany.body.error}`);
}

console.log("\n-- standing terms --");
{
  const db = seed(); const env = ENV(db);
  const got = await call(env, "/api/agreement-terms");
  ck("an account that has never answered gets the defaults",
    got.status === 200 && got.body.terms.paymentDays === A.defaultTerms().paymentDays,
    `${got.status}`);
  ck("and is not requiring one of anybody", got.body.requireByDefault === false);
  // Null until somebody qualified has actually read it. An unreviewed
  // template naming a real firm and a real date reads exactly like a
  // reviewed one, which is why this is not something anybody gets for free.
  ck("the template says whether it has been reviewed, and says no",
    got.body.template.reviewed === null, JSON.stringify(got.body.template.reviewed));

  const set = await call(env, "/api/agreement-terms", { method: "PATCH",
    body: { terms: { paymentDays: "21", retainageBps: 500 },
            hiringParty: { name: "Outerhome LLC", street: "1 Pike St", city: "Seattle", state: "wa" } } });
  ck("terms are saved normalised", set.status === 200 && set.body.terms.paymentDays === 21,
    JSON.stringify(set.body.terms?.paymentDays));
  ck("and the state on the hiring party with them", set.body.hiringParty.state === "WA");
  // The assertion has to read the COLUMN: the read path normalises too, so
  // checking the route's own answer would report a clean shape over a stored
  // one that is not.
  const stored = JSON.parse(db.prepare(`SELECT terms FROM agreement_terms`).get().terms);
  ck("stored as a number, not as the string it arrived as", stored.paymentDays === 21,
    JSON.stringify(stored.paymentDays));

  await call(env, `/api/subs/${SUB_CO}/agreement`, { method: "POST",
    body: { terms: { paymentDays: 45 } } });
  const t = JSON.parse(db.prepare(`SELECT terms FROM agreements`).get().terms);
  ck("a per-subcontractor override sits on top of the account's own terms",
    t.paymentDays === 45 && t.retainageBps === 500,
    JSON.stringify({ p: t.paymentDays, r: t.retainageBps }));

  const pm = await call(env, "/api/agreement-terms", { method: "PATCH",
    seat: { u: "u_gcpm", a: GC }, body: { terms: { paymentDays: 90 } } });
  ck("a project manager cannot rewrite the account's standard terms",
    pm.status === 403, `${pm.status}`);
}

console.log("\n-- an uploaded agreement is the other way to satisfy the same thing --");
{
  const db = seed(); const env = ENV(db);
  const made = await call(env, `/api/subs/${SUB_CO}/agreement`,
    { method: "POST", body: { source: "uploaded" } });
  ck("it can be issued", made.status === 200 && made.body.agreement?.source === "uploaded");
  ck("and waits on an upload rather than a signature",
    made.body.agreement?.waitingOn === "sub_upload");
  ck("there is no document to render, because SubSub did not write it",
    made.body.agreement?.document === null, JSON.stringify(made.body.agreement?.document));

  const id = db.prepare(`SELECT id FROM agreements`).get().id;
  const sign = await call(env, `/api/my-agreements/${id}/sign`,
    { method: "POST", seat: SUB_SEAT, body: { typedName: "Rae Okafor" } });
  ck("and it cannot be signed in the app, because there is nothing here to sign",
    sign.status === 409 && sign.body.error === "upload_instead",
    `${sign.status} ${sign.body.error}`);

  // WITHOUT THIS IT WAS A DEAD END. The screen told them to upload their
  // signed copy and nothing anywhere moved when they did, so an uploaded
  // agreement sat at `sent` for ever.
  ck("before uploading, it waits on them",
    (await call(env, "/api/subs")).body.find((s) => s.id === SUB_CO)?.agreement?.waitingOn
      === "sub_upload");
  const up = await call(env, `/api/subs/${SUB_CO}/documents/contract`,
    { method: "POST", seat: SUB_SEAT, body: { fileKey: "k/1", fileName: "signed-subcontract.pdf" } });
  ck("uploading the signed copy is accepted", up.status === 200, `${up.status}`);
  const moved = db.prepare(`SELECT * FROM agreements WHERE id = ?`).get(id);
  ck("and it advances the agreement rather than going nowhere",
    moved.status === "signed", String(moved.status));
  ck("recording which file was signed", moved.file_name === "signed-subcontract.pdf",
    String(moved.file_name));
  ck("but NOT to in force -- the hiring account still has to say it is theirs",
    moved.status !== "countersigned");

  // Which is the only way an uploaded agreement ever reaches in force, so the
  // hiring account must be able to countersign one.
  const cs = await call(env, `/api/agreements/${id}/countersign`,
    { method: "POST", body: { typedName: "Dana Ruiz" } });
  ck("the hiring account confirms the paper they got back", cs.status === 200
    && cs.body.agreement?.inForce === true, `${cs.status}`);
  ck("and only then does it count as on file",
    (await call(env, "/api/subs")).body.find((s) => s.id === SUB_CO)?.docState === "current");
}

console.log("\n-- declining, and withdrawing --");
{
  const db = seed(); const env = ENV(db);
  await call(env, `/api/subs/${SUB_CO}/agreement`, { method: "POST", body: {} });
  const id = db.prepare(`SELECT id FROM agreements`).get().id;
  const no = await call(env, `/api/my-agreements/${id}/decline`,
    { method: "POST", seat: SUB_SEAT, body: { note: "Our insurer will not agree to clause 5." } });
  ck("a subcontractor may decline", no.status === 200, `${no.status}`);
  ck("and it stops counting against them",
    (await call(env, "/api/subs")).body.find((s) => s.id === SUB_CO)?.docState === "current");
  // The partial index is PARTIAL so that a declined one does not leave the
  // relationship unable to have another -- the ux_wo_transfer_live shape.
  const second = await call(env, `/api/subs/${SUB_CO}/agreement`, { method: "POST", body: {} });
  ck("and another can be issued afterwards", second.status === 200, `${second.status}`);
  ck("the declined one is kept, not deleted",
    db.prepare(`SELECT COUNT(*) n FROM agreements WHERE status='declined'`).get().n === 1);

  const id2 = db.prepare(`SELECT id FROM agreements WHERE status='sent'`).get().id;
  const v = await call(env, `/api/agreements/${id2}/void`, { method: "POST" });
  ck("the hiring account may withdraw one", v.status === 200, `${v.status}`);
  ck("withdrawing keeps the record rather than deleting it",
    db.prepare(`SELECT COUNT(*) n FROM agreements WHERE status='void'`).get().n === 1);
}

console.log("\n-- the live index, which is what holds when two arrive at once --");
{
  const db = seed();
  db.exec(`INSERT INTO agreements(id,account_id,company_id,status) VALUES ('a1','${GC}','${SUB_CO}','sent')`);
  let threw = null;
  try {
    db.exec(`INSERT INTO agreements(id,account_id,company_id,status) VALUES ('a2','${GC}','${SUB_CO}','sent')`);
  } catch (e) { threw = String(e.message || e); }
  // Asserted DIRECTLY. The route's own pre-check catches the sequential case,
  // so without this the half that matters under load could go with nothing
  // noticing -- and `freshDb` applies schema.sql AND the migration, so the
  // index has two sources and both have to carry it.
  ck("two live agreements for one pair are refused by the database itself",
    /UNIQUE|constraint/i.test(threw || ""), String(threw).slice(0, 60));
  db.exec(`UPDATE agreements SET status='declined' WHERE id='a1'`);
  db.exec(`INSERT INTO agreements(id,account_id,company_id,status) VALUES ('a3','${GC}','${SUB_CO}','sent')`);
  ck("but a finished one does not block the next",
    db.prepare(`SELECT COUNT(*) n FROM agreements`).get().n === 2);
}

console.log("\n-- and a database without 052 --");
{
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind,plan) VALUES ('${GC}','Outerhome','outerhome','general_contractor','scale');
    INSERT INTO companies(id,company) VALUES ('${SUB_CO}','Bay Roofing Inc');
    INSERT INTO engagements(id,account_id,company_id,status) VALUES ('en1','${GC}','${SUB_CO}','active');
    INSERT INTO users(id,name,email) VALUES ('u_gc','Dana Ruiz','dana@outerhome.test');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES ('m_gc','u_gc','${GC}','admin');
    DROP TABLE IF EXISTS agreements;
    DROP TABLE IF EXISTS agreement_terms;
  `);
  const env = ENV(db);
  const r = await call(env, `/api/subs/${SUB_CO}/agreement`);
  ck("is told which migration, not 500",
    r.status === 503 && r.body.migration === "052_agreements",
    `${r.status} ${r.body.migration || r.body.error}`);
  // The roster must keep working on a database that has not run this yet.
  // Reporting a whole roster as broken because one table is missing is worse
  // than the gap it reports.
  const roster = await call(env, "/api/subs");
  ck("and the roster still loads, rather than the whole screen going",
    roster.status === 200, `${roster.status}`);
}

console.log("\n-- the warranty clause, and the terms behind it --");
{
  const parties = {
    kind: "general_contractor",
    hiring: { name: "Outerhome LLC", street: "1 Pike St", city: "Seattle", state: "WA", zip: "98101" },
    sub: { name: "Bay Roofing Inc", street: "4 Dock Rd", city: "Tacoma", state: "WA", zip: "98402" },
  };
  const s9 = (terms) => A.renderAgreement({ parties, terms, issuedOn: "2026-01-15" })
    .sections.find((x) => x.id === "warranty").paragraphs.join(" ");

  const def = A.defaultTerms();
  ck("the warranty runs three years by default", def.warrantyMonths === 36, String(def.warrantyMonths));
  // Quoted in years by everybody who sells one, so "36 months" is a number
  // somebody has to convert in their head on a document they are signing.
  ck("and reads as years rather than months", /runs for 3 years from the date/.test(s9(def)), s9(def));
  ck("a whole year is singular", /runs for 1 year from/.test(s9({ ...def, warrantyMonths: 12 })));
  ck("and a part year stays in months",
    /runs for 18 months from/.test(s9({ ...def, warrantyMonths: 18 })));

  // TWO OBLIGATIONS, NOT ONE. "Within a reasonable time" alone cannot
  // distinguish a subcontractor coming on Thursday from one who is never
  // coming, and by the time it can, the leak has run for a fortnight.
  ck("a defect notice has to be answered within the response time",
    /acknowledge the notice within 48 business hours/.test(s9(def)), s9(def));
  ck("and the repair itself still gets a reasonable time",
    /correct the defect at its own expense within a reasonable time/.test(s9(def)));
  ck("the response time is the account's to change",
    /within 12 business hours/.test(s9({ ...def, warrantyResponseHours: 12 })));
  ck("and reads singular at one", /within 1 business hour of/.test(s9({ ...def, warrantyResponseHours: 1 })));
  // BUSINESS HOURS ARE DEFINED IN THE DOCUMENT. 48 clock hours from a Friday
  // afternoon is a Sunday, so the operative number has to say what it counts.
  ck("and what a business hour is, is said rather than assumed",
    /not a Saturday, a Sunday or a public holiday/.test(s9(def)), s9(def));

  ck("both are validated like every other term",
    A.validTerms({ warrantyMonths: "24", warrantyResponseHours: "8" }).warrantyMonths === 24
      && A.validTerms({ warrantyResponseHours: "8" }).warrantyResponseHours === 8);
  ck("and clamped rather than refused, because a term nobody can save is a form nobody finishes",
    A.validTerms({ warrantyResponseHours: 0 }).warrantyResponseHours === 1
      && A.validTerms({ warrantyMonths: 9999 }).warrantyMonths === 120);
}

console.log("\n-- and 1.0.0 still renders 1.0.0 --");
{
  // THE ONE ASSERTION THAT MAKES A VERSION BUMP SAFE. A stored agreement names
  // the version it was rendered from and carries a hash of that text, so a
  // superseded template has to keep producing the same bytes for as long as a
  // document signed under it matters. The failure it guards is the one nobody
  // catches by looking: the WRONG CONTRACT STILL READS LIKE A CONTRACT, under
  // a heading saying it was signed.
  //
  // Hard-coded rather than compared against a re-render, because a re-render
  // of the same file agrees with itself whatever the file says. This catches a
  // stray edit, a shared helper changing under it -- `plural` learning about
  // years would have rewritten this section -- and a dependency moving.
  const V1 = "e01d263589a56c747a7814b563a14d2addd59fb5ebcdc5dcea896d702a689d21";
  const parties = {
    kind: "general_contractor",
    hiring: { name: "Outerhome LLC", street: "1 Pike St", city: "Seattle", state: "WA", zip: "98101", license: "OUTERH*781QA" },
    sub: { name: "Bay Roofing Inc", street: "4 Dock Rd", city: "Tacoma", state: "WA", zip: "98402", license: "BAYROO*112KK" },
  };
  // The terms as they stood when 1.0.0 was current. Written out rather than
  // taken from `defaultTerms()`, which has moved since and will move again.
  const terms = {
    cglPerOccurrenceCents: 100000000, cglAggregateCents: 200000000,
    autoLiabilityCents: 100000000, umbrellaCents: 0, workersComp: true,
    additionalInsured: true, primaryNonContributory: true, waiverOfSubrogation: true,
    paymentDays: 30, retainageBps: 0, warrantyMonths: 12,
    noticeDays: 7, cureDays: 3, recordsYears: 4, governingState: "WA",
  };
  // CAUGHT, BECAUSE THE SUBJECT CAN VANISH. Dropping 1.0.0 from `TEMPLATES` is
  // exactly the mistake this block exists to catch, and `renderAgreement`
  // answers it by throwing -- which at the top level of a script kills the run
  // and takes every assertion after it with it. One real failure reported as
  // silence. Same lesson the front-door card's test records about reading
  // through `link?.`: a test that cannot survive its own subject reports least
  // when it matters most.
  let text = null, renderErr = null;
  try {
    text = A.canonicalText(A.renderAgreement({ templateId: "subsub-standard-subcontract",
      templateVersion: "1.0.0", parties, terms, issuedOn: "2026-01-15" }));
  } catch (e) { renderErr = e.code || String(e); }
  ck("1.0.0 is still in TEMPLATES and still renders", text !== null, String(renderErr));
  const got = text === null ? null : createHash("sha256").update(text, "utf8").digest("hex");
  ck("the frozen 1.0.0 hashes to exactly what it always did", got === V1, String(got));
  ck("and still carries its own warranty wording, not 1.1.0's",
    text !== null && /runs for 12 months/.test(text) && !/business hour/.test(text));

  // The current version is a different document and must not answer to the
  // old key, or the freeze buys nothing.
  ck("1.1.0 is a different document", text !== null && A.canonicalText(
    A.renderAgreement({ templateVersion: "1.1.0", parties, terms, issuedOn: "2026-01-15" })) !== text);

  // LOUD, NOT A FALLBACK. A version that is not here has to throw rather than
  // render whatever is current under a heading saying it was signed.
  let threw = null;
  try { A.renderAgreement({ templateVersion: "0.9.0", parties, terms, issuedOn: "2026-01-15" }); }
  catch (e) { threw = e.code; }
  ck("and an unknown version throws rather than falling back", threw === "unknown_template", String(threw));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
