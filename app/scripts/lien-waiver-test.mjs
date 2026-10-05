// Lien waivers, end to end: asked for against a release, on the form the
// building's state allows, signed in the app or by link or by upload, and the
// chain below it asked for in turn.
//
// What this suite is for, in the order it matters:
//
//   * A STATUTORY STATE NEVER GETS SUBSUB'S FORM. Twelve states set the words
//     of a lien waiver in statute and a waiver on another form can release
//     nothing while looking exactly like one that does. Refused on the
//     SERVER, and counted by an invariant, because a screen that merely
//     hides the button is a suggestion.
//
//   * THE HASH IS OF WHAT WAS SHOWN. Recomputed from the stored parties and
//     the declaration chosen at signature -- so the test recomputes it the
//     same way and compares, rather than checking a hash is present.
//
//   * AN UNCONDITIONAL WAIVER IS NEVER ASKED FOR BEFORE THE MONEY. It gives
//     the right up whether or not the payment arrives.
//
//   * THE CHAIN ROLLS UP AS COUNTS. The paying side learns that somebody
//     below has not signed; it never learns who. The subcontractor sees their
//     own suppliers by name, because they are theirs.
//
//   * THE GATE COUNTS THE WORK'S DAY, NOT TODAY. A waiver through the day the
//     release was made covers that release, however many days later the
//     money goes out.
//
//   node --no-warnings scripts/lien-waiver-test.mjs

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { runCheck } from "./lib/check-sql.mjs";
import {
  STATUTORY_STATES, isStatutory, formsFor, kindRefusal, renderWaiver, canonicalText,
  STANDARD_WAIVER, TEMPLATES, generatedTemplateFor, KIND_WORDS, formsReasonText,
} from "../shared/waiverform.js";
import { WAIVER_KINDS } from "../shared/waivers.js";
import { US_STATES } from "../shared/states.js";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };
const sha = (s) => createHash("sha256").update(s).digest("hex");

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(join(app, "worker", "schema.sql"), "utf8");

// An R2 stand-in: what was put, by key.
const bucket = () => {
  const m = new Map();
  return {
    m,
    put: async (k, body, opts) => { m.set(k, { body: new Uint8Array(body instanceof ArrayBuffer ? body : await new Response(body).arrayBuffer()), type: opts?.httpMetadata?.contentType }); },
    get: async (k) => { const o = m.get(k); return o ? { body: o.body, httpMetadata: { contentType: o.type } } : null; },
  };
};

const day = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,kind,subdomain,plan) VALUES
      ('acc_gc','Alder Construction','general_contractor','alder','scale'),
      ('acc_other','Cascade Management','property_manager','cascade','basic');
    INSERT INTO users(id,name,email) VALUES
      ('u_admin','Chris Lane','chris@alder.test'),
      ('u_sub','Juan Soto','juan@pacific.test'),
      ('u_else','Rita Mills','rita@other.test'),
      ('u_other','Olu Ade','olu@cascade.test');
    INSERT INTO companies(id,company,contact,email,state) VALUES
      ('cmp_sub','Pacific Roofing','Juan Soto','juan@pacific.test','OR'),
      ('cmp_else','Someone Else Plumbing','Rita Mills','rita@other.test','WA');
    INSERT INTO memberships(id,user_id,account_id,role,company_id) VALUES
      ('m_admin','u_admin','acc_gc','admin',NULL),
      ('m_sub','u_sub','acc_gc','contractor','cmp_sub'),
      ('m_else','u_else','acc_gc','contractor','cmp_else'),
      ('m_other','u_other','acc_other','admin',NULL);
    -- Cover is in order, verified by this account, so the gate that refuses
    -- a payment below is the WAIVER and never the paperwork -- cover is asked
    -- first and would otherwise answer for it.
    INSERT INTO engagements(id,account_id,company_id,status,doc_review) VALUES
      ('en_sub','acc_gc','cmp_sub','active',
       '{"insurance":{"status":"verified"},"bond":{"status":"verified"},"w9":{"status":"verified"}}'),
      ('en_else','acc_gc','cmp_else','active','{}');
    UPDATE companies SET insurance = 1, bond = 1, w9 = 1 WHERE id = 'cmp_sub';
    INSERT INTO company_docs(id,company_id,kind,file_key,file_name,expires_on) VALUES
      ('cd_i','cmp_sub','insurance','k/i','i.pdf','2030-01-01'),
      ('cd_b','cmp_sub','bond','k/b','b.pdf',NULL),
      ('cd_w','cmp_sub','w9','k/w','w.pdf',NULL);
    INSERT INTO properties(id,account_id,name,address,city,state,zip) VALUES
      ('p_wa','acc_gc','Press Apartments','1620 Belmont','Seattle','WA','98122'),
      ('p_ca','acc_gc','Bay Lofts','1 Market St','San Francisco','CA','94105'),
      ('p_ns','acc_gc','Old Mill',NULL,NULL,NULL,NULL);
    INSERT INTO jobs(id,account_id,property_id,title,trades,status,date) VALUES
      ('j_wa','acc_gc','p_wa','Re-roof Press Apartments','["roofing"]','active','2026-09-01'),
      ('j_ca','acc_gc','p_ca','Re-roof Bay Lofts','["roofing"]','active','2026-09-01'),
      ('j_ns','acc_gc','p_ns','Mill gutters','["roofing"]','active','2026-09-01');
    INSERT INTO work_orders(id,wo_number,job_id,trade,company_id,engagement_id,value_cents,status) VALUES
      ('wo_wa','WO-1','j_wa','roofing','cmp_sub','en_sub',1000000,'accepted'),
      ('wo_ca','WO-2','j_ca','roofing','cmp_sub','en_sub',500000,'accepted'),
      ('wo_ns','WO-3','j_ns','roofing','cmp_sub','en_sub',200000,'accepted');
    -- Two milestones on the Washington job, so its first release is a PROGRESS
    -- payment; one on California's, so that one is FINAL. Only a pair can show
    -- the suggestion reads the work order rather than answering one word.
    INSERT INTO wo_milestones(id,work_order_id,account_id,seq,label,amount_cents,status) VALUES
      ('ms_wa1','wo_wa','acc_gc',1,'Tear-off',400000,'verified'),
      ('ms_wa2','wo_wa','acc_gc',2,'Shingles',600000,'pending'),
      ('ms_ca','wo_ca','acc_gc',1,'All',500000,'verified'),
      ('ms_ns','wo_ns','acc_gc',1,'All',200000,'verified');
    INSERT INTO wo_releases(id,work_order_id,account_id,milestone_id,company_id,gross_cents,net_cents,status,created_at) VALUES
      ('rel_wa','wo_wa','acc_gc','ms_wa1','cmp_sub',400000,380000,'due','${day(-3)} 10:00:00'),
      ('rel_ca','wo_ca','acc_gc','ms_ca','cmp_sub',500000,500000,'due','${day(0)} 10:00:00'),
      ('rel_ns','wo_ns','acc_gc','ms_ns','cmp_sub',200000,200000,'due','${day(0)} 10:00:00');
  `);
  return { db, env: { DB: makeD1(db), FILES: bucket() } };
};

const call = (env, method, path, { body, who = "u_admin", acc = "acc_gc", raw, type, anon } = {}) =>
  worker.fetch(new Request(`https://api.subsub.work${path}`, {
    method,
    ...(raw !== undefined ? { body: raw } : body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: anon ? { "Content-Type": type || "application/json" }
      : { "Content-Type": type || "application/json", "X-User-Id": who, "X-Account-Id": acc },
  }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];
const row = (db, id) => db.prepare(`SELECT * FROM lien_waivers WHERE id = ?`).get(id);
const form = (db, id) => db.prepare(`SELECT * FROM waiver_forms WHERE waiver_id = ?`).get(id);

try {
  console.log("\n-- the rule, before any route --");
  {
    ck("twelve statutory states", STATUTORY_STATES.length === 12, STATUTORY_STATES.join());
    ck("and they are the twelve named",
      ["AZ", "CA", "FL", "GA", "MA", "MI", "MS", "MO", "NV", "TX", "UT", "WY"].every(isStatutory));
    ck("every one is a real state", STATUTORY_STATES.every((s) => US_STATES.some(([c]) => c === s)));
    ck("Washington is not one", !isStatutory("WA") && !isStatutory("wa"));
    // The other thirty-eight and DC get SubSub's form or an upload.
    const others = US_STATES.map(([c]) => c).filter((c) => !isStatutory(c));
    ck("the rest -- 38 states and DC -- may use SubSub's form", others.length === 39
      && others.every((c) => formsFor(c).sources.includes("subsub_standard")), String(others.length));
    // NOTHING STATUTORY IS GENERATED UNTIL ITS TEXT IS LOADED, FROM ITS SOURCE.
    ck("a statutory state is upload-only today",
      STATUTORY_STATES.every((c) => formsFor(c).sources.join() === "uploaded"
        && formsFor(c).reason === "statutory_text_not_loaded"));
    ck("and no generated template is offered for one",
      STATUTORY_STATES.every((c) => generatedTemplateFor(c) === null));
    // No state recorded cannot be told apart from a statutory one.
    ck("no state is upload-only too, and says why",
      formsFor(null).sources.join() === "uploaded" && formsFor("").reason === "no_state");
    ck("both reasons have words",
      !!formsReasonText("no_state") && /California/.test(formsReasonText("statutory_text_not_loaded", "CA")));
    // The one rule that protects the signer.
    ck("an unconditional waiver is refused before the money",
      kindRefusal({ kind: "unconditional_progress", paid: false }) === "unconditional_before_paid"
      && kindRefusal({ kind: "unconditional_final", paid: false }) === "unconditional_before_paid");
    ck("and allowed after it", kindRefusal({ kind: "unconditional_final", paid: true }) === null);
    ck("a conditional one is allowed either way",
      kindRefusal({ kind: "conditional_progress", paid: false }) === null);
    ck("a word that is not a kind is refused", kindRefusal({ kind: "partial", paid: true }) === "bad_kind");
    ck("every kind has a title, a name and a when",
      WAIVER_KINDS.every((k) => KIND_WORDS[k]?.title && KIND_WORDS[k]?.short && KIND_WORDS[k]?.when));
  }

  console.log("\n-- SubSub's form --");
  {
    ck("not reviewed by a lawyer, and says so", STANDARD_WAIVER.reviewed === null);
    let threw = null;
    try { renderWaiver({ templateId: STANDARD_WAIVER.id, templateVersion: "9.9.9", kind: "conditional_progress" }); }
    catch (e) { threw = e.code; }
    ck("an unknown version throws rather than rendering the current one", threw === "unknown_template");
    ck("templates are keyed by id AND version",
      Object.keys(TEMPLATES).every((k) => /@\d+\.\d+\.\d+$/.test(k)), Object.keys(TEMPLATES).join());

    const base = { parties: { claimant: "Pacific Roofing", customer: "Alder Construction",
      job: "Re-roof", property: "Press Apartments, 1620 Belmont, Seattle, WA 98122" },
      amountCents: 380000, throughDate: "2026-10-02", state: "WA" };
    // ${} in a plain string is five literal characters, and this file has
    // shipped that twice. Every kind, every declaration.
    const leaks = [];
    for (const kind of WAIVER_KINDS) for (const scopeKind of [null, "labor_only", "labor_materials"]) {
      const t = canonicalText(renderWaiver({ ...base, kind, scopeKind }));
      if (/\$\{|undefined|\[claimant\]|\[customer\]|NaN/.test(t)) leaks.push(`${kind}/${scopeKind}`);
    }
    ck("no template text leaks into any rendering", leaks.length === 0, leaks.join());
    const cond = canonicalText(renderWaiver({ ...base, kind: "conditional_progress", scopeKind: "labor_only" }));
    const unc = canonicalText(renderWaiver({ ...base, kind: "unconditional_progress", scopeKind: "labor_only" }));
    ck("conditional says it waits for the money", /no effect until the Claimant has actually received/.test(cond));
    ck("unconditional says it does not", /whether or not the payment clears/.test(unc));
    ck("progress names the through date in words", /through October 2, 2026/.test(cond));
    ck("and the amount", /\$3,800\.00/.test(cond));
    ck("and the governing state is the property's", /law of Washington/.test(cond));
    const fin = canonicalText(renderWaiver({ ...base, kind: "conditional_final", scopeKind: "labor_only" }));
    ck("final includes retention", /including any retention/.test(fin));
    // A lower-tier waiver often has no figure; $0.00 would be a waiver for nothing.
    const none = canonicalText(renderWaiver({ ...base, amountCents: 0, kind: "conditional_progress", scopeKind: "labor_only" }));
    ck("no figure says everything owed, never $0.00",
      /everything the Claimant is owed/.test(none) && !/\$0\.00/.test(none));
    ck("labour only is sworn in the text", /furnished labor only/.test(cond));
    ck("an unchosen declaration says it is chosen at signing",
      /chooses its declaration when signing/.test(canonicalText(renderWaiver({ ...base, kind: "conditional_progress" }))));

    // THE GUARD IS A HARD-CODED HASH, NOT A RE-RENDER. A re-render agrees with
    // itself whatever the file says; this fails on any drift in 1.0.0 -- a
    // stray edit, a shared helper moving under it. If you are changing the
    // words, add 1.0.1 beside it and leave this alone.
    const golden = sha(canonicalText(renderWaiver({
      templateId: "subsub_standard_waiver", templateVersion: "1.0.0", kind: "conditional_progress",
      parties: { claimant: "Golden Roofing", customer: "Golden GC", job: "Golden Job", property: "1 Golden Way, Seattle, WA 98101" },
      amountCents: 1234500, throughDate: "2026-01-15", state: "WA", scopeKind: "labor_materials",
    })));
    ck("1.0.0 renders byte for byte what it always has",
      golden === "9f5b5be43f493329171de064e1ea735f7401b2facf907e649585064f31c36d7f", golden);
  }

  console.log("\n-- asking for one --");
  const { db, env } = seed();
  let wid;
  {
    const [s, b] = await json(await call(env, "GET", "/api/releases/rel_wa/waivers"));
    ck("the release says what it allows", s === 200 && b.forms?.sources?.includes("subsub_standard"), `${s} ${JSON.stringify(b.forms)}`);
    ck("and suggests a conditional progress waiver", b.suggestedKind === "conditional_progress", b.suggestedKind);
    ck("and the gate reads no waiver yet", b.chain?.reasons?.includes("no_waiver"), JSON.stringify(b.chain));
    const [s2, b2] = await json(await call(env, "GET", "/api/releases/rel_ca/waivers"));
    ck("a last milestone suggests final", s2 === 200 && b2.suggestedKind === "conditional_final", b2.suggestedKind);
    ck("and California offers only an upload", b2.forms?.sources?.join() === "uploaded"
      && b2.forms.reason === "statutory_text_not_loaded");

    let [rs, rb] = await json(await call(env, "POST", "/api/releases/rel_wa/waiver",
      { body: { kind: "unconditional_progress" } }));
    ck("an unconditional waiver before the money is refused", rs === 400 && rb.error === "unconditional_before_paid", `${rs} ${rb.error}`);

    [rs, rb] = await json(await call(env, "POST", "/api/releases/rel_ca/waiver",
      { body: { source: "subsub_standard" } }));
    ck("SubSub's form in California is refused ON THE SERVER", rs === 400 && rb.error === "form_not_allowed"
      && rb.reason === "statutory_text_not_loaded", `${rs} ${JSON.stringify(rb)}`);
    [rs, rb] = await json(await call(env, "POST", "/api/releases/rel_ns/waiver",
      { body: { source: "subsub_standard" } }));
    ck("and with no state on the building", rs === 400 && rb.reason === "no_state", `${rs} ${JSON.stringify(rb)}`);

    [rs, rb] = await json(await call(env, "POST", "/api/releases/rel_wa/waiver", { body: {} }));
    ck("asking for one works", rs === 201 && rb.ok, `${rs} ${JSON.stringify(rb)}`);
    wid = rb.waiver?.id;
    const w = row(db, wid);
    ck("tier 0, requested, with a link", w?.tier === 0 && w.status === "requested" && (w.token || "").length > 30);
    ck("the state is the PROPERTY'S, not the roofer's Oregon", w?.governing_state === "WA", w?.governing_state);
    ck("the amount is what goes out", w?.amount_cents === 380000, String(w?.amount_cents));
    ck("through the day the release was made", w?.through_date === day(-3), w?.through_date);
    const f = form(db, wid);
    const parties = JSON.parse(f?.parties || "{}");
    ck("the parties are stamped as they read now", parties.claimant === "Pacific Roofing"
      && parties.customer === "Alder Construction" && /Seattle, WA 98122/.test(parties.property), f?.parties);
    ck("on SubSub's form, version and all", f?.source === "subsub_standard"
      && f.template_id === "subsub_standard_waiver" && f.template_version === "1.0.0");
    ck("and the reply does not hand the token back", !JSON.stringify(rb).includes(w.token));
    ck("mail not configured is said, not assumed", rb.emailed === false && f.emailed === 0);

    [rs, rb] = await json(await call(env, "POST", "/api/releases/rel_wa/waiver", { body: {} }));
    ck("asking twice is refused", rs === 409 && rb.error === "already_requested", `${rs} ${rb.error}`);
    // The partial index is what holds under a race -- asserted directly.
    let raced = null;
    try {
      db.prepare(`INSERT INTO lien_waivers(id,job_id,account_id,tier,release_id,kind,through_date,status)
                  VALUES ('race','j_wa','acc_gc',0,'rel_wa','conditional_progress','2026-10-01','requested')`).run();
    } catch (e) { raced = String(e.message); }
    ck("the database itself refuses a second open request", /UNIQUE/.test(raced || ""), raced || "inserted");

    [rs, rb] = await json(await call(env, "POST", "/api/releases/rel_wa/waiver", { body: {}, acc: "acc_other", who: "u_other" }));
    ck("another account's release is not found", rs === 404, String(rs));
  }

  console.log("\n-- the subcontractor signs --");
  let supplierToken;
  {
    let [s, b] = await json(await call(env, "GET", "/api/my-waivers", { who: "u_sub" }));
    const mine = Array.isArray(b) ? b.find((x) => x.id === wid) : null;
    ck("it is on their list", s === 200 && !!mine, `${s} ${JSON.stringify(b).slice(0, 200)}`);
    ck("with the document to read", (mine?.document?.sections || []).length === 6);
    ck("and who asked", mine?.accountName === "Alder Construction");
    [s, b] = await json(await call(env, "GET", "/api/my-waivers", { who: "u_else" }));
    ck("somebody else's company does not see it", s === 200 && !b.some((x) => x.id === wid));

    [s, b] = await json(await call(env, "POST", `/api/my-waivers/${wid}/sign`,
      { who: "u_sub", body: { typedName: "Juan Soto" } }));
    ck("no declaration is refused", s === 400 && b.error === "declaration_required", `${s} ${b.error}`);
    [s, b] = await json(await call(env, "POST", `/api/my-waivers/${wid}/sign`,
      { who: "u_sub", body: { typedName: "Juan Soto", scopeKind: "labor_materials" } }));
    // The one answer that would read the chain as clear with nobody below it asked.
    ck("materials with nobody named is refused", s === 400 && b.error === "parties_required", `${s} ${b.error}`);
    [s, b] = await json(await call(env, "POST", `/api/my-waivers/${wid}/sign`,
      { who: "u_sub", body: { typedName: "Juan Soto", scopeKind: "labor_only", parties: [{ name: "ABC Supply" }] } }));
    ck("labour only with somebody named is a contradiction", s === 400 && b.error === "labor_only_with_parties", `${s} ${b.error}`);
    [s, b] = await json(await call(env, "POST", `/api/my-waivers/${wid}/sign`,
      { who: "u_sub", body: { typedName: "Someone Else", scopeKind: "labor_only" } }));
    ck("a name that is not theirs is refused", s === 400 && b.error === "name_mismatch", `${s} ${b.error}`);
    [s, b] = await json(await call(env, "POST", `/api/my-waivers/${wid}/sign`,
      { who: "u_else", body: { typedName: "Rita Mills", scopeKind: "labor_only" } }));
    ck("another company cannot sign it", s === 404, String(s));

    [s, b] = await json(await call(env, "POST", `/api/my-waivers/${wid}/sign`, { who: "u_sub", body: {
      typedName: "juan  soto", scopeKind: "labor_materials",
      parties: [{ name: "ABC Supply — Ballard", email: "yard@abc.test", role: "supplier" }],
      docSha256: "0".repeat(64),
    } }));
    ck("signing works", s === 200 && b.ok, `${s} ${JSON.stringify(b)}`);
    const w = row(db, wid);
    ck("it is signed, by them", w.status === "signed" && w.signed_by_name === "Juan Soto" && !!w.signed_at);
    ck("and their declaration is on the row", w.scope_kind === "labor_materials");
    // THE HASH IS OF WHAT WAS SHOWN: recomputed here from the same stored
    // inputs, never taken from the request.
    const f = form(db, wid);
    const expect = sha(canonicalText(renderWaiver({ templateId: f.template_id, templateVersion: f.template_version,
      kind: w.kind, parties: JSON.parse(f.parties), amountCents: w.amount_cents, throughDate: w.through_date,
      state: w.governing_state, scopeKind: "labor_materials" })));
    ck("the hash is of the text they were shown", w.doc_sha256 === expect, w.doc_sha256);
    ck("and not the one the request named", w.doc_sha256 !== "0".repeat(64));

    const declared = db.prepare(`SELECT * FROM lower_tier_parties WHERE work_order_id = 'wo_wa'`).all();
    ck("the supplier is declared", declared.length === 1 && declared[0].email === "yard@abc.test"
      && declared[0].complete_attested === 1);
    const kid = db.prepare(`SELECT * FROM lien_waivers WHERE parent_id = ?`).get(wid);
    ck("and asked for their own waiver", kid?.tier === 1 && kid.status === "requested"
      && kid.from_email === "yard@abc.test" && kid.kind === w.kind && kid.through_date === w.through_date);
    ck("under the same state", kid?.governing_state === "WA");
    ck("addressed from the subcontractor, not the account",
      JSON.parse(form(db, kid.id).parties).customer === "Pacific Roofing");
    supplierToken = kid?.token;

    [s, b] = await json(await call(env, "POST", `/api/my-waivers/${wid}/sign`,
      { who: "u_sub", body: { typedName: "Juan Soto", scopeKind: "labor_only" } }));
    ck("signing twice is refused", s === 409 && b.error === "already_answered", `${s} ${b.error}`);
  }

  console.log("\n-- the chain, as the paying side reads it --");
  {
    let [s, b] = await json(await call(env, "GET", "/api/releases/rel_wa/waiver-state"));
    ck("not clear while the supplier has not signed", s === 200 && !b.clear
      && b.reasons.includes("lower_tier_outstanding"), JSON.stringify(b));
    ck("counted", b.lowerTierTotal === 1 && b.lowerTierSigned === 0);
    [s, b] = await json(await call(env, "GET", "/api/releases/rel_wa/waivers"));
    // Their supplier list is their book.
    ck("the paying side never sees who", !/ABC Supply|yard@abc/.test(JSON.stringify(b)), "leaked");
    ck("only how many", b.waivers?.[0]?.lowerTierTotal === 1);
    [s, b] = await json(await call(env, "GET", "/api/my-waivers", { who: "u_sub" }));
    const mine = b.find((x) => x.id === wid);
    ck("the subcontractor sees their own supplier by name",
      mine?.below?.[0]?.name === "ABC Supply — Ballard" && mine.below[0].status === "requested");

    let [rs, rb] = await json(await call(env, "POST", "/api/releases/rel_wa/settle",
      { body: { method: "check", reference: "1" } }));
    ck("the gate still refuses", rs === 409 && rb.error === "waiver_outstanding", `${rs} ${rb.error}`);
  }

  console.log("\n-- the supplier signs by link --");
  {
    let [s, b] = await json(await call(env, "GET", `/api/waiver/${supplierToken}`, { anon: true }));
    ck("the link opens with no account", s === 200 && b.status === "requested", `${s} ${JSON.stringify(b).slice(0, 120)}`);
    ck("shows them the document", (b.document?.sections || []).length === 6);
    ck("and says who is asking", b.customer === "Pacific Roofing");
    ck("never the token or the hash", !("token" in b) && b.docSha256 === undefined);
    [s, b] = await json(await call(env, "GET", `/api/waiver/${"x".repeat(43)}`, { anon: true }));
    ck("an invented token is not found", s === 404, String(s));
    [s] = await json(await call(env, "GET", `/api/waivers/${wid}/file`, { anon: true }));
    ck("the paying side's routes stay behind auth", s === 401 || s === 403, String(s));

    [s, b] = await json(await call(env, "POST", `/api/waiver/${supplierToken}/sign`,
      { anon: true, body: { typedName: "Pat", scopeKind: "labor_materials" } }));
    ck("a single name is not a signature", s === 400 && b.error === "full_name_required", `${s} ${b.error}`);
    [s, b] = await json(await call(env, "POST", `/api/waiver/${supplierToken}/sign`,
      { anon: true, body: { typedName: "Pat Ruiz", scopeKind: "materials_only" } }));
    ck("a full one is", s === 200 && b.ok, `${s} ${JSON.stringify(b)}`);
    const kid = db.prepare(`SELECT * FROM lien_waivers WHERE token = ?`).get(supplierToken);
    ck("recorded against the address it was sent to",
      kid.status === "signed" && kid.signed_by_name === "Pat Ruiz" && kid.signed_by_email === "yard@abc.test");
    // Below the first tier the chain is capped, so nothing is fanned out.
    ck("and nobody below the supplier is asked",
      db.prepare(`SELECT COUNT(*) AS n FROM lien_waivers WHERE parent_id = ?`).get(kid.id).n === 0);
    [s, b] = await json(await call(env, "POST", `/api/waiver/${supplierToken}/decline`, { anon: true, body: {} }));
    ck("a signed link cannot then be declined", s === 409 && b.error === "already_answered", `${s} ${b.error}`);

    [s, b] = await json(await call(env, "GET", "/api/releases/rel_wa/waiver-state"));
    ck("now the chain is clear", s === 200 && b.clear === true, JSON.stringify(b));
    // THE WORK'S DAY, NOT TODAY. The release was made three days ago and the
    // waiver runs through that day; under the old rule it went stale the
    // morning after.
    ck("through the release's own day, three days ago", b.through === day(-3), b.through);
    const [rs, rb] = await json(await call(env, "POST", "/api/releases/rel_wa/settle",
      { body: { method: "check", reference: "1" } }));
    ck("and the money goes, with no override", rs === 200 && rb.status === "paid", `${rs} ${JSON.stringify(rb)}`);
  }

  console.log("\n-- an upload, in a statutory state --");
  {
    let [s, b] = await json(await call(env, "POST", "/api/releases/rel_ca/waiver", { body: {} }));
    ck("California asks for an upload by default", s === 201 && b.waiver?.source === "uploaded"
      && b.waiver.document === null, `${s} ${JSON.stringify(b).slice(0, 160)}`);
    const id = b.waiver.id;
    [s, b] = await json(await call(env, "POST", `/api/my-waivers/${id}/sign`,
      { who: "u_sub", body: { typedName: "Juan Soto", scopeKind: "labor_only" } }));
    ck("and cannot be signed in the app", s === 409 && b.error === "upload_required", `${s} ${b.error}`);

    [s, b] = await json(await call(env, "PUT", `/api/my-waivers/${id}/file/waiver.txt`,
      { who: "u_sub", raw: "hello", type: "text/plain" }));
    ck("a text file is not a signed waiver", s === 415, `${s} ${b.error}`);
    const pdf = new TextEncoder().encode("%PDF-1.4 signed california waiver");
    const decl = encodeURIComponent(JSON.stringify({ scopeKind: "labor_only" }));
    [s, b] = await json(await call(env, "PUT", `/api/my-waivers/${id}/file/CA%20waiver.pdf?declaration=${decl}`,
      { who: "u_sub", raw: pdf, type: "application/pdf" }));
    ck("uploading the signed form is signing it", s === 200 && b.ok, `${s} ${JSON.stringify(b)}`);
    const w = row(db, id);
    ck("signed, with the file kept", w.status === "signed" && !!w.doc_key && env.FILES.m.has(w.doc_key));
    ck("the hash is of the bytes", w.doc_sha256 === sha(Buffer.from(pdf)), w.doc_sha256);
    ck("their declaration rode with it", w.scope_kind === "labor_only");
    ck("recorded as the claimant's own upload", form(db, id).uploaded_side === "claimant");
    const r = await call(env, "GET", `/api/waivers/${id}/file`);
    ck("the paying side can read it back", r.status === 200
      && (await r.text()).startsWith("%PDF") && r.headers.get("Content-Type") === "application/pdf");
    const r2 = await call(env, "GET", `/api/waivers/${id}/file`, { acc: "acc_other", who: "u_other" });
    ck("another account cannot", r2.status === 404, String(r2.status));
    const r3 = await call(env, "GET", `/api/waivers/${id}/file`, { who: "u_else" });
    ck("nor another company on the same roster", r3.status === 404, String(r3.status));
  }

  console.log("\n-- the paying side records a copy it was emailed --");
  {
    let [s, b] = await json(await call(env, "POST", "/api/releases/rel_ns/waiver", { body: {} }));
    const id = b.waiver?.id;
    ck("no state asks for an upload", s === 201 && b.waiver.source === "uploaded");
    [s, b] = await json(await call(env, "PUT", `/api/waivers/${id}/file/scan.jpg`,
      { raw: new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), type: "image/jpeg" }));
    ck("recorded", s === 200 && b.ok, `${s} ${JSON.stringify(b)}`);
    ck("as the RECIPIENT's upload, so nobody reads it as theirs", form(db, id).uploaded_side === "recipient");
    ck("signed by nobody's name", row(db, id).signed_by_name === null);
    [s, b] = await json(await call(env, "POST", `/api/waivers/${id}/void`, {}));
    ck("a signed waiver is never withdrawn", s === 409 && b.error === "already_answered", `${s} ${b.error}`);
  }

  console.log("\n-- declining, and withdrawing --");
  {
    db.exec(`UPDATE wo_releases SET status = 'paid' WHERE id = 'rel_ca'`);
    let [s, b] = await json(await call(env, "POST", "/api/releases/rel_ca/waiver",
      { body: { kind: "unconditional_final" } }));
    ck("after the money, unconditional is allowed", s === 201, `${s} ${b.error}`);
    const id = b.waiver.id;
    [s, b] = await json(await call(env, "POST", `/api/my-waivers/${id}/decline`,
      { who: "u_sub", body: { note: "Check has not cleared" } }));
    ck("they can decline, with a reason", s === 200 && row(db, id).status === "declined"
      && row(db, id).declined_note === "Check has not cleared");
    // The signed conditional one still counts: a declined unconditional
    // request must not hide the waiver the money went out against.
    [s, b] = await json(await call(env, "GET", "/api/releases/rel_ca/waiver-state"));
    ck("a declined later request does not hide the signed earlier one", b.clear === true, JSON.stringify(b));

    [s, b] = await json(await call(env, "POST", "/api/releases/rel_ca/waiver",
      { body: { kind: "unconditional_final" } }));
    ck("a declined one can be asked for again", s === 201, `${s} ${b.error}`);
    [s, b] = await json(await call(env, "POST", `/api/waivers/${b.waiver.id}/void`, {}));
    ck("and an open one withdrawn", s === 200 && b.ok);
  }

  console.log("\n-- the email --");
  {
    const { env: e2 } = seed();
    const mailed = [];
    const real = globalThis.fetch;
    globalThis.fetch = async (u, o) => { mailed.push(JSON.parse(o.body)); return new Response("{\"id\":\"m1\"}", { status: 200 }); };
    try {
      const env2 = { ...e2, RESEND_API_KEY: "k", MAIL_FROM: "no-reply@subsub.work", RESEND_API_BASE: "https://mail.test" };
      const [s, b] = await json(await call(env2, "POST", "/api/releases/rel_wa/waiver", { body: {} }));
      ck("sent, and recorded as sent", s === 201 && b.emailed === true && mailed.length === 1);
      const m = mailed[0];
      ck("to the company's address", m.to?.[0] === "juan@pacific.test");
      ck("with a link that opens the waiver", /app\.subsub\.work\/\?waiver=/.test(m.text));
      ck("saying it waits for the money", /only takes effect once you have actually received/.test(m.text));
      ck("naming the amount and the day", /\$3,800\.00/.test(m.text) && /through/.test(m.text));
      mailed.length = 0;
      const [s2] = await json(await call(env2, "POST", "/api/releases/rel_ca/waiver", { body: {} }));
      ck("a statutory state is told to use its own form",
        s2 === 201 && /California sets the exact wording/.test(mailed[0]?.text || ""), mailed[0]?.text?.slice(0, 300));
    } finally { globalThis.fetch = real; }
  }

  console.log("\n-- on Basic: no waivers, and no gate demanding one --");
  {
    // BOTH BRANCHES IN THE SAME PLACE. Everything above ran on Scale; a change
    // that gated everybody, or nobody, passes one branch and not the other.
    const { db: d2, env: e2 } = seed();
    // A waiver asked for while the account was on Scale, before it moved down.
    let [s, b] = await json(await call(e2, "POST", "/api/releases/rel_wa/waiver", { body: {} }));
    const earlier = b.waiver?.id;
    ck("asked for while on Scale", s === 201 && !!earlier, `${s} ${b.error}`);
    d2.exec(`UPDATE accounts SET plan = 'basic' WHERE id = 'acc_gc'`);

    [s, b] = await json(await call(e2, "POST", "/api/releases/rel_ca/waiver", { body: {} }));
    ck("a Basic account cannot ask for one", s === 403 && b.error === "scale_required", `${s} ${b.error}`);
    [s, b] = await json(await call(e2, "POST", `/api/waivers/${earlier}/resend`, { body: {} }));
    ck("nor send one again", s === 403 && b.error === "scale_required", `${s} ${b.error}`);
    [s, b] = await json(await call(e2, "GET", "/api/releases/rel_ca/waivers"));
    ck("the panel is told it is not on Scale", s === 200 && b.onScale === false, `${s} ${b.onScale}`);
    [s, b] = await json(await call(e2, "GET", "/api/releases/rel_ns/waiver-state"));
    // Holding a Basic account's cheque over a feature it does not have would
    // make every payment an override.
    ck("and nothing is outstanding on it", s === 200 && b.clear === true && b.onScale === false, JSON.stringify(b));
    [s, b] = await json(await call(e2, "POST", "/api/releases/rel_ns/settle", { body: { method: "check", reference: "9" } }));
    ck("so recording a payment is not held for a waiver", s === 200 && b.status === "paid", `${s} ${JSON.stringify(b)}`);

    // The subcontractor's act survives the other side's plan, and taking a
    // request back costs nothing.
    [s, b] = await json(await call(e2, "POST", `/api/my-waivers/${earlier}/sign`,
      { who: "u_sub", body: { typedName: "Juan Soto", scopeKind: "labor_only" } }));
    ck("an earlier request can still be signed", s === 200 && b.ok, `${s} ${b.error}`);

    // Comped is Scale, which is the rule accountOnScale already keeps.
    d2.exec(`UPDATE accounts SET comped = 1 WHERE id = 'acc_gc'`);
    [s, b] = await json(await call(e2, "POST", "/api/releases/rel_ca/waiver", { body: {} }));
    ck("a comped account can ask", s === 201, `${s} ${b.error}`);
    d2.exec(`UPDATE accounts SET comped = 0 WHERE id = 'acc_gc'`);

    // PAYING THROUGH SUBSUB IS SCALE, enforced where the money comes in. The
    // Stripe key is set so the plan check is what answers, not the missing key.
    const real = globalThis.fetch;
    globalThis.fetch = async (u) => { throw new Error(`unexpected Stripe call: ${u}`); };
    try {
      [s, b] = await json(await call({ ...e2, STRIPE_SECRET_KEY: "sk_test_x" }, "POST",
        "/api/work-orders/wo_wa/fund", { body: { amountCents: 500000 } }));
    } finally { globalThis.fetch = real; }
    ck("a Basic account cannot fund a work order", s === 403 && b.error === "scale_required", `${s} ${b.error}`);
  }

  console.log("\n-- what only reading the source can show --");
  {
    const src = readFileSync(join(app, "worker", "index.js"), "utf8");
    const ui = readFileSync(join(app, "src", "App.tsx"), "utf8");
    // The pre-check answers the sequential double press; the guard in the
    // UPDATE is what holds when two arrive at once, and no single-threaded
    // test can race them. Mutating it out survives every route assertion
    // above, which is why it is pinned here.
    const mark = src.slice(src.indexOf("async function markSigned"), src.indexOf("async function markSigned") + 900);
    ck("signing is guarded in the UPDATE itself", /WHERE id = \? AND status = 'requested'/.test(mark));
    ck("and reports a lost race rather than claiming success", /if \(!res\.meta\?\.changes\) return false/.test(mark));
    // The link is public and /api/waivers/* is not -- the trailing slash is
    // what separates them.
    ck("the link route is exempt, by its own prefix", /startsWith\("\/api\/waiver\/"\)/.test(src));
    ck("the paying side's prefix is not", !/startsWith\("\/api\/waivers/.test(src));
    // The subcontractor's list, mounted where each kind of seat looks: the
    // contractor portal's dashboard and a hireable account's own paperwork.
    // Counted, because a bare search finds whichever exists.
    ck("the subcontractor's waivers are mounted in both places", (ui.match(/<MyWaivers /g) || []).length === 2,
      String((ui.match(/<MyWaivers /g) || []).length));
    ck("and the paying side's panel in both of its places", (ui.match(/<ReleaseWaivers /g) || []).length === 2,
      String((ui.match(/<ReleaseWaivers /g) || []).length));
  }

  console.log("\n-- CHECK.sql, against real rows --");
  {
    const { db: d3 } = seed();
    const inv = (n) => runCheck(d3)[n];
    ck("clean on a clean database", inv("m069_inv_signed_unrecorded") === 0 && inv("m069_inv_standard_in_statutory") === 0);
    d3.exec(`INSERT INTO lien_waivers(id,job_id,account_id,tier,release_id,kind,through_date,status,governing_state)
               VALUES ('bad1','j_wa','acc_gc',0,'rel_wa','conditional_progress','2026-10-01','signed','WA');
             INSERT INTO waiver_forms(waiver_id,source) VALUES ('bad1','subsub_standard');`);
    ck("a signed waiver with nothing behind it is counted", inv("m069_inv_signed_unrecorded") === 1);
    d3.exec(`UPDATE lien_waivers SET doc_sha256 = 'abc' WHERE id = 'bad1'`);
    ck("and stops being counted once there is", inv("m069_inv_signed_unrecorded") === 0);
    d3.exec(`INSERT INTO lien_waivers(id,job_id,account_id,tier,release_id,kind,through_date,status,governing_state)
               VALUES ('bad2','j_ca','acc_gc',0,'rel_ca','conditional_final','2026-10-01','requested','CA');
             INSERT INTO waiver_forms(waiver_id,source,template_id,template_version)
               VALUES ('bad2','subsub_standard','subsub_standard_waiver','1.0.0');`);
    ck("SubSub's form in a statutory state is counted", inv("m069_inv_standard_in_statutory") === 1);
    d3.exec(`UPDATE lien_waivers SET governing_state = 'WA' WHERE id = 'bad2'`);
    ck("and not in Washington", inv("m069_inv_standard_in_statutory") === 0);
    const col = runCheck(d3);
    ck("the did-I-run-it rows read the columns", col.m069_waiver_forms >= 1 && col.m069_waiver_open_unique >= 1,
      JSON.stringify({ a: col.m069_waiver_forms, b: col.m069_waiver_open_unique }));
  }
} catch (err) {
  fail++;
  console.log("FAIL  the suite threw  -- " + (err?.stack || err));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
