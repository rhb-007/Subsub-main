// SUPPORT MAY FIX A RECORD THE CUSTOMER CANNOT, AND IT IS WRITTEN DOWN.
//
// Reported from an impersonated session: a superadmin standing in Sound
// Property Management opened Pacific apartment maintenance -- a contractor who
// answers for themselves -- and got the refusal pane, with no way to upload a
// document for them. *"A superadmin should be able to edit all users and upload
// documents on behalf of all users to get them setup."*
//
// Two separate faults behind one screen, and only one of them was about staff:
//
//   THE DOCUMENTS BLOCK WAS GATED ON THE WRONG PREDICATE, for everybody.
//   `locked` answers "may I rewrite their company record";
//   `mayWriteCompanyDocs` answers "may I put a certificate on file for them"
//   and has always said yes to any live engagement, because a hiring account
//   being emailed a COI and uploading it is the ordinary case. So the route
//   took the upload and the screen offered no control -- stricter than the
//   route, which this project calls the same lie as looser.
//
//   AND `companyAnswersForItself` WAS REFUSING SUPPORT. That rule stops one
//   hiring account rewriting another business's record and does not move; a
//   staff member standing in the account is not that, and the alternative this
//   project has already written down is SQL against D1.
//
// What is pinned here is that the rule did NOT move for a customer, that the
// override is read off the session row rather than anything a caller sends,
// and that it is recorded -- because the banner across that screen promises
// actions are, and a promise the product does not keep is worse than one it
// never made.
//
//   node --no-warnings scripts/staffwrite-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { staffMayWriteShared, isTeamSeat } from "../shared/seats.js";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const W = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");
const APP = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

console.log("\n-- the predicate --");
{
  // IT READS THE SESSION, NOT THE SEAT. A plain admin -- the ordinary caller
  // this rule exists to refuse -- gets nothing, however senior they are on
  // their own account.
  ck("a plain admin may not", !staffMayWriteShared({ role: "admin" }));
  ck("nor a plain pm", !staffMayWriteShared({ role: "pm" }));
  ck("staff standing in an admin seat may", staffMayWriteShared({ impersonatedBy: "u_s", role: "admin" }));
  ck("and in a pm seat", staffMayWriteShared({ impersonatedBy: "u_s", role: "pm" }));

  // A TEAM SEAT ONLY. Staff sitting in a tenant's or a contractor's seat are
  // there to see what that person sees, and widening those would make
  // reproducing the customer's view impossible -- the reason naming a seat
  // exists at all.
  ck("not from a tenant's seat", !staffMayWriteShared({ impersonatedBy: "u_s", role: "tenant" }));
  ck("not from an owner's", !staffMayWriteShared({ impersonatedBy: "u_s", role: "owner" }));
  ck("not from a contractor's", !staffMayWriteShared({ impersonatedBy: "u_s", role: "contractor" }));
  ck("and the team list is the one shared predicate",
    isTeamSeat("admin") && isTeamSeat("pm") && !isTeamSeat("owner"));
  ck("nothing at all answers no", !staffMayWriteShared(null) && !staffMayWriteShared(undefined));
  ck("and an empty context does too", !staffMayWriteShared({}));
}

const VERIFIED = '{"insurance":{"status":"verified"},"bond":{"status":"verified"},'
  + '"contract":{"status":"verified"},"w9":{"status":"verified"}}';

// Pacific answers for itself: it has its own contractor seat, which is exactly
// what `companyAnswersForItself` asks about. Harbour does not -- a record the
// account typed in -- and is the row the rule has never applied to, so the two
// together are the only fixture either direction can be told apart on.
const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO companies(id,company,contact,email,phone,city,state,zip,license,insurance,bond,contract,w9,doc_files) VALUES
      ('cmp_pac','Pacific apartment maintenance','Juan Soto','juan@pac.test','(206)555-0111','Seattle','WA','98101','PACAM*111',0,0,0,0,'{}'),
      ('cmp_har','Harbour Glass','Mo','mo@har.test','(206)555-0122','Seattle','WA','98101',NULL,0,0,0,0,'{}');
    INSERT INTO accounts(id,name,subdomain,kind,plan) VALUES
      ('acc_pm','Sound Property Management','sound','property_manager','scale');
    INSERT INTO engagements(id,account_id,company_id,status,categories,doc_review) VALUES
      ('en_pac','acc_pm','cmp_pac','active','["roofing","painting"]','${VERIFIED}'),
      ('en_har','acc_pm','cmp_har','active','["windows_doors"]','${VERIFIED}');
    INSERT INTO users(id,name,email) VALUES
      ('u_admin','Dana Reyes','dana@sound.test'),
      ('u_staff','Richard Braun','rb@subsub.work'),
      ('u_juan','Juan Soto','juan@pac.test');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES
      ('m_admin','u_admin','acc_pm','admin');
    -- The seat that makes Pacific answer for itself, and it is on ANOTHER
    -- account's roster rather than this one: the predicate is unscoped on
    -- purpose, so a fixture with the seat here would pass a scoped check too.
    INSERT INTO accounts(id,name,subdomain,kind,plan) VALUES
      ('acc_other','Outerhome','outerhome','general_contractor','scale');
    INSERT INTO memberships(id,user_id,account_id,role,company_id) VALUES
      ('m_juan','u_juan','acc_other','contractor','cmp_pac');
    INSERT INTO impersonation_sessions(token,account_id,act_as_user_id,staff_user_id,reason,expires_at) VALUES
      ('tok_live','acc_pm','u_admin','u_staff','support',datetime('now','+30 minutes')),
      -- A session handed back. It must stop working on the next request, which
      -- is the whole reason this is a table and not a signed blob.
      ('tok_done','acc_pm','u_admin','u_staff','support',datetime('now','+30 minutes'));
    UPDATE impersonation_sessions SET ended_at = datetime('now') WHERE token = 'tok_done';
  `);
  return { db, env: { DB: makeD1(db), FILES: { put: async () => {}, get: async () => null } } };
};

// Two callers, the same route. The customer sends their own headers; staff send
// only a token, and the account and the identity come off the row.
const asAdmin = (env, path, { method = "GET", body } = {}) =>
  worker.fetch(new Request(`https://api.subsub.work${path}`, {
    method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json", "X-User-Id": "u_admin", "X-Account-Id": "acc_pm" },
  }), env);
const asStaff = (env, path, { method = "GET", body, token = "tok_live" } = {}) =>
  worker.fetch(new Request(`https://api.subsub.work${path}`, {
    method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json", "X-Impersonation-Token": token },
  }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];
const nameOf = (db, id) => db.prepare(`SELECT company, phone FROM companies WHERE id = ?`).get(id);

console.log("\n-- the rule has not moved for a customer --");
{
  const { db, env } = seed();
  const [st, got] = await json(await asAdmin(env, "/api/subs/cmp_pac",
    { method: "PATCH", body: { phone: "(206)555-9999" } }));
  ck("an admin is still refused the company half", st === 409 && got.error === "company_not_yours",
    `${st} ${JSON.stringify(got)}`);
  ck("and it names the fields rather than saying no",
    (got.fields || []).includes("phone"), JSON.stringify(got.fields));
  ck("nothing was written", nameOf(db, "cmp_pac").phone === "(206)555-0111",
    nameOf(db, "cmp_pac").phone);

  // THE ENGAGEMENT HALF IS STILL THEIRS. The refusal is about the shared row,
  // not about the form, and a change that locked the whole record would pass a
  // suite that only checked the company half.
  const [st2] = await json(await asAdmin(env, "/api/subs/cmp_pac",
    { method: "PATCH", body: { notes: "Good on short notice" } }));
  ck("while their own notes still save", st2 === 200, String(st2));

  // AND A RECORD NOBODY ANSWERS FOR IS STILL THEIRS TO CORRECT. That is the
  // line the rule actually draws -- *you may correct a record you created, and
  // you may never edit a business somebody else answers for* -- so a mistyped
  // phone number on a company the account typed in must stay fixable.
  const [st3] = await json(await asAdmin(env, "/api/subs/cmp_har",
    { method: "PATCH", body: { phone: "(206)555-0133" } }));
  ck("a company nobody answers for is still editable", st3 === 200, String(st3));
  ck("and the correction landed", nameOf(db, "cmp_har").phone === "(206)555-0133");
}

console.log("\n-- and support may do what the customer cannot --");
{
  const { db, env } = seed();
  const [st, got] = await json(await asStaff(env, "/api/subs/cmp_pac",
    { method: "PATCH", body: { phone: "(206)555-9999", contact: "Juan Soto Jr" } }));
  ck("staff standing in may correct the shared row", st === 200, `${st} ${JSON.stringify(got)}`);
  ck("and it actually changed", nameOf(db, "cmp_pac").phone === "(206)555-9999",
    nameOf(db, "cmp_pac").phone);

  // RECORDED, because the banner over that screen promises it is. A separate
  // event from the ordinary update: *which fields of somebody else's record*
  // is the whole of what anybody would ask afterwards.
  const ev = db.prepare(
    `SELECT payload FROM events WHERE kind = 'sub.company_written_by_staff'
      ORDER BY rowid DESC LIMIT 1`).get();
  ck("a record of it exists", !!ev, JSON.stringify(ev));
  const meta = JSON.parse(ev?.payload || "{}");
  ck("it names the staff member who really did it", meta.staffUserId === "u_staff",
    JSON.stringify(meta));
  ck("and the fields of the shared row that were written",
    (meta.fields || []).includes("phone") && (meta.fields || []).includes("contact"),
    JSON.stringify(meta.fields));
  ck("the ordinary update is still logged beside it",
    !!db.prepare(`SELECT 1 AS y FROM events WHERE kind = 'sub.updated'`).get());
  // The reply says so too, so the screen can tell somebody what it just did
  // rather than reporting an ordinary save.
  ck("and the reply says which fields it overrode",
    (got.staffOverrode || []).includes("phone"), JSON.stringify(got));

  // AN ENGAGEMENT-ONLY SAVE IS NOT AN OVERRIDE, so the record means something.
  // Without this every staff save would look like one and the log would stop
  // being readable.
  const [st2, got2] = await json(await asStaff(env, "/api/subs/cmp_pac",
    { method: "PATCH", body: { notes: "Called them" } }));
  const n = db.prepare(
    `SELECT COUNT(*) AS n FROM events WHERE kind = 'sub.company_written_by_staff'`).get().n;
  ck("writing only the engagement half records no override", st2 === 200 && n === 1,
    `${st2} / ${n} ${JSON.stringify(got2)}`);
}

console.log("\n-- the session row is what decides, not the caller --");
{
  const { db, env } = seed();
  // A HANDED-BACK SESSION STOPS WORKING. Taken from the row on every request,
  // so ending it is immediate rather than something a cached claim outlives.
  const [st] = await json(await asStaff(env, "/api/subs/cmp_pac",
    { method: "PATCH", body: { phone: "(206)555-7777" }, token: "tok_done" }));
  ck("an ended session is refused outright", st === 401, String(st));
  ck("and wrote nothing", nameOf(db, "cmp_pac").phone === "(206)555-0111");
  const [st2] = await json(await asStaff(env, "/api/subs/cmp_pac",
    { method: "PATCH", body: { phone: "(206)555-7777" }, token: "nope" }));
  ck("so is a token nobody issued", st2 === 401, String(st2));

  // AND THERE IS NOTHING A CUSTOMER CAN SEND TO CLAIM IT. The account and the
  // identity come off the session row; a header naming a staff user is not a
  // thing the middleware reads at all.
  const [st3, got3] = await json(await worker.fetch(new Request(
    "https://api.subsub.work/api/subs/cmp_pac", {
      method: "PATCH", body: JSON.stringify({ phone: "(206)555-6666" }),
      headers: { "Content-Type": "application/json", "X-User-Id": "u_admin",
        "X-Account-Id": "acc_pm", "X-Impersonated-By": "u_staff",
        "X-Staff-User-Id": "u_staff" },
    }), env));
  ck("a forged header buys nothing", st3 === 409 && got3.error === "company_not_yours",
    `${st3} ${JSON.stringify(got3)}`);
  ck("and still wrote nothing", nameOf(db, "cmp_pac").phone === "(206)555-0111");
}

console.log("\n-- documents were never the same question --");
{
  const { db, env } = seed();
  // THE ROUTE HAS ALWAYS TAKEN THIS, which is the half the screen was hiding:
  // `mayWriteCompanyDocs` accepts any live engagement, deliberately, because a
  // hiring account being emailed a certificate and uploading it is the ordinary
  // case rather than the odd one.
  const [st] = await json(await asAdmin(env, "/api/subs/cmp_pac/documents/insurance", {
    method: "POST",
    body: { fileName: "coi.pdf", contentType: "application/pdf", data: "JVBERi0=" },
  }));
  ck("an ordinary admin may upload for a company that answers for itself",
    st === 200 || st === 201, String(st));
  ck("and the company row says so now",
    db.prepare(`SELECT insurance FROM companies WHERE id = 'cmp_pac'`).get().insurance === 1);
  // Staff may too, through the same door -- nothing special was needed here,
  // and inventing a second path would have been two rules for one question.
  const [st2] = await json(await asStaff(env, "/api/subs/cmp_pac/documents/bond", {
    method: "POST",
    body: { fileName: "bond.pdf", contentType: "application/pdf", data: "JVBERi0=" },
  }));
  ck("and so may staff standing in", st2 === 200 || st2 === 201, String(st2));

  // THE RELATIONSHIP IS STILL THE GATE. Without an engagement it is
  // `not_found` and not `forbidden`, so this cannot be walked to find out which
  // company ids are real.
  db.exec(`DELETE FROM engagements WHERE id = 'en_har'`);
  const [st3, got3] = await json(await asAdmin(env, "/api/subs/cmp_har/documents/insurance", {
    method: "POST",
    body: { fileName: "x.pdf", contentType: "application/pdf", data: "JVBERi0=" },
  }));
  ck("a company nobody here engages answers not_found",
    st3 === 404 && got3.error === "not_found", `${st3} ${JSON.stringify(got3)}`);
}

console.log("\n-- the screen and the route read one rule --");
{
  ck("the Worker reads the shared predicate", /staffMayWriteShared\(auth\)/.test(W));
  ck("and the browser reads the same one", /staffMayWriteShared\(\{/.test(APP));
  ck("neither keeps its own copy",
    !/const staffMayWriteShared/.test(W) && !/const staffMayWriteShared/.test(APP));
  // THE DOCUMENTS BLOCK IS NO LONGER GATED ON THE LOCK. That was the reported
  // bug and it is a one-token change, which is exactly the kind that comes back
  // -- so it is pinned rather than trusted.
  ck("the documents block is not hidden by the company lock",
    !/\{!locked && <div className="fld">Documents/.test(APP));
  // And deleting is still withheld on somebody else's record, which is
  // prominence rather than permission: the route is unchanged.
  ck("deleting is gated on whose record it is",
    /!existing\?\.answersForItself \|\| staffWrite/.test(APP));
  ck("while the route is untouched and still allows it",
    /mayWriteCompanyDocs\(c, companyId\)/.test(W));
  // The warning did not become silence: staff get a different sentence, not no
  // sentence, because the danger inverts rather than disappearing.
  ck("staff are told the change reaches every account that hires them",
    /changes it for all of them/.test(APP));
  ck("and that it is recorded against them", /recorded against your name/.test(APP));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
