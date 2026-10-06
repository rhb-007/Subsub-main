// "WON'T LET ME EDIT THE SUBCONTRACTOR AT ALL" WAS TWO BUGS AND A MISSING
// CONTROL.
//
// Reported from the staff console's Companies screen, with the pencil tapped
// on a company and nothing apparently happening: *"won't let me edit the
// subcontractor at all, we'd [need] to be able to as well as change their type
// from contractor or subcontractor to handyman, etc."*
//
//   SAVE WAS DEAD ON ANY COMPANY WITH NO LICENCE NUMBER. The button read
//   `!f.company.trim() || !f.license.trim()`, so a record somebody typed off a
//   business card could be opened, edited and never saved -- with nothing
//   beside the button saying why, which this repository has already called
//   indistinguishable from a broken one. And it contradicted a decision taken
//   twice here: several states have no state contractor licence at all, so
//   signing up never requires one and neither does being on a roster. The one
//   screen demanding one was the console.
//
//   THE FORM OPENED BELOW THE FOLD. It renders after the whole company grid,
//   so on ten companies at an iPad's width the pencil drew nothing in view.
//
//   AND THE RELATIONSHIP COULD BE READ NOWHERE AND CHANGED NOWHERE. 058 put
//   that word on `engagements` -- per account, because one account's handyman
//   is another account's contractor -- and the console, which exists to answer
//   what a customer cannot, carried it in neither direction.
//
// What this pins beyond those: the new route is keyed by the ENGAGEMENT and
// never the company, it is superadmin, it refuses the word on an account kind
// that may not engage one, and it writes NULL rather than a second spelling of
// the ordinary state.
//
//   node --no-warnings scripts/console-engaged-test.mjs

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";

// Supabase, enough that the real staff auth path gets an answer -- the same
// stub the other console suites use, on a port of its own.
const supa = createServer((req, res) => {
  const who = String(req.headers.authorization || "").replace("Bearer ", "");
  if (!who || who === "nobody") { res.writeHead(401); return res.end("{}"); }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ id: `auth_${who}`, email: `${who}@subsub.test` }));
}).listen(8926);

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(join(app, "worker", "schema.sql"), "utf8");

const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,kind,subdomain,plan) VALUES
      -- Has buildings, so it has handyman work.
      ('acc_pm','Sound Property Management','property_manager','soundpm','scale'),
      -- Works job to job under a prime contract. The discriminating half.
      ('acc_gc','Outerhome','general_contractor','outerhome','scale');
    INSERT INTO companies(id,company,contact) VALUES
      -- NO LICENCE, which is the row the Save button was dead on.
      ('cmp_pac','Pacific apartment maintenance','Juan Soto'),
      ('cmp_alex','Alexburd llc','Oleksandr Burdak');
    -- The SAME company on two rosters, which is the only fixture that can show
    -- the word is per-account rather than per-company.
    INSERT INTO engagements(id,account_id,company_id,status,categories) VALUES
      ('en_pm','acc_pm','cmp_pac','active','["electrical"]'),
      ('en_gc','acc_gc','cmp_pac','active','["electrical"]');
    INSERT INTO users(id,name,email,auth_id) VALUES
      ('u_super','Richard','super@subsub.test','auth_super'),
      ('u_plain','Helper','plain@subsub.test','auth_plain');
    INSERT INTO superadmins(user_id,role,finance,impersonate) VALUES
      ('u_super','superadmin',1,1),
      -- A standard seat. This route is the entry that excuses somebody their
      -- insurance on a roster, so it is superadmin like the deletes beside it.
      ('u_plain','standard',0,0);
  `);
  return { db, env: { DB: makeD1(db),
    SUPABASE_URL: "http://127.0.0.1:8926", SUPABASE_ANON_KEY: "stub",
    STAFF_ALLOW_PASSWORD: "1" } };
};

const call = (env, path, opts = {}, who = "super") => worker.fetch(
  new Request(`https://api.subsub.work${path}`, {
    method: opts.method || "GET",
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${who}` },
  }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];
const engOf = (db, id) => db.prepare(`SELECT * FROM engagements WHERE id = ?`).get(id);

try {
  console.log("\n-- the console can read what a company is to each account --");
  {
    const { db, env } = seed();
    db.prepare(`UPDATE engagements SET engaged_as = 'handyman' WHERE id = 'en_pm'`).run();
    const [s, b] = await json(await call(env, "/api/platform/bootstrap"));
    ck("the console loads", s === 200, `${s} ${JSON.stringify(b).slice(0, 160)}`);
    const rows = b.engagements || [];
    const pm = rows.find((e) => e.id === "en_pm"), gc = rows.find((e) => e.id === "en_gc");
    // A column named in the row shape and not in the SELECT comes back
    // undefined, which reads as subcontractor -- a console that quietly
    // disagrees with the roster it is meant to explain.
    ck("and carries the relationship", pm?.engagedAs === "handyman", String(pm?.engagedAs));
    // PER ACCOUNT. The same company, the other roster, the ordinary answer.
    ck("per account, not per company", gc?.engagedAs === "subcontractor", String(gc?.engagedAs));
  }

  console.log("\n-- and change it --");
  {
    const { db, env } = seed();
    const [s, b] = await json(await call(env, "/api/platform/engagements/en_pm",
      { method: "PATCH", body: { engagedAs: "handyman" } }));
    ck("a superadmin may set it", s === 200 && b.engagedAs === "handyman", `${s} ${JSON.stringify(b)}`);
    ck("and it is written", engOf(db, "en_pm").engaged_as === "handyman",
      String(engOf(db, "en_pm").engaged_as));
    // THE OTHER ROSTER IS UNTOUCHED, which is the whole reason this is keyed
    // by the engagement. A company-keyed write would say it for both.
    ck("the same company on another roster is untouched",
      engOf(db, "en_gc").engaged_as === null, String(engOf(db, "en_gc").engaged_as));
    // Who, on whose roster, from what to what -- "staff changed a
    // relationship" is not answerable afterwards.
    const ev = db.prepare(`SELECT * FROM events WHERE kind = 'engagement_relationship_changed'`).get();
    ck("recorded against the account it happened on", ev?.account_id === "acc_pm", String(ev?.account_id));
    // THE DIRECTION, not just that something changed. "Staff changed a
    // relationship" is not answerable afterwards; from what, to what, is --
    // and this is the edit that decides whether a certificate of insurance is
    // ever asked for again.
    const meta = JSON.parse(ev?.payload || "{}");
    ck("with the direction in the payload",
      meta.from === "subcontractor" && meta.to === "handyman", JSON.stringify(meta));
    ck("and the engagement it was about", meta.engagementId === "en_pm", String(meta.engagementId));
    // The sentence goes to the per-account feed, which is the stream the
    // customer's own screen reads -- `events.payload` is the machine half and
    // `activity.text` is the readable one.
    const act = db.prepare(`SELECT * FROM activity WHERE kind = 'engagement_relationship_changed'`).get();
    ck("the account's own feed names both sides",
      /Pacific/.test(act?.text || "") && /Sound Property/.test(act?.text || "")
      && /handyman/.test(act?.text || ""), act?.text);
  }
  {
    const { db, env } = seed();
    db.prepare(`UPDATE engagements SET engaged_as = 'handyman' WHERE id = 'en_pm'`).run();
    const [s] = await json(await call(env, "/api/platform/engagements/en_pm",
      { method: "PATCH", body: { engagedAs: "subcontractor" } }));
    ck("switching back saves", s === 200, String(s));
    // NULL, never the word: every existing row holds NULL, and two spellings
    // of the ordinary state is engagedAs() reading one of them by luck.
    ck("and stores NULL rather than a second spelling",
      engOf(db, "en_pm").engaged_as === null, String(engOf(db, "en_pm").engaged_as));
  }

  console.log("\n-- what staff may not do --");
  {
    const { env } = seed();
    // The same predicate the customer side reads. Being staff is a reason to
    // reach another account's record, not a reason for that record to be
    // wrong -- CHECK.sql counts this exact row as a fault.
    const [s, b] = await json(await call(env, "/api/platform/engagements/en_gc",
      { method: "PATCH", body: { engagedAs: "handyman" } }));
    ck("a general contractor's engagement refuses the word",
      s === 409 && b.error === "not_a_handyman_account", `${s} ${JSON.stringify(b)}`);
  }
  {
    const { env } = seed();
    const [s, b] = await json(await call(env, "/api/platform/engagements/en_pm",
      { method: "PATCH", body: { engagedAs: "plumber" } }));
    ck("an unrecognised word is refused rather than defaulted",
      s === 400 && b.error === "bad_engaged_as", `${s} ${JSON.stringify(b)}`);
  }
  {
    const { env } = seed();
    // This is the entry that excuses somebody their insurance and their
    // licence on a roster. Closer to the delete button than to correcting a
    // phone number.
    const [s] = await json(await call(env, "/api/platform/engagements/en_pm",
      { method: "PATCH", body: { engagedAs: "handyman" } }, "plain"));
    ck("a support seat may not", s === 403, String(s));
  }
  {
    const { env } = seed();
    const [s] = await json(await call(env, "/api/platform/engagements/nope",
      { method: "PATCH", body: { engagedAs: "handyman" } }));
    ck("an engagement that does not exist is a miss", s === 404, String(s));
  }

  console.log("\n-- editing a company with no licence --");
  {
    const { db, env } = seed();
    // THE REPORTED ROW. cmp_alex has no licence number at all, and the route
    // has always accepted the save -- it was the button that refused.
    const [s, b] = await json(await call(env, "/api/platform/companies/cmp_alex",
      { method: "PATCH", body: { contact: "Oleksandr Burdak", city: "Seattle" } }));
    ck("the server takes it without one", s === 200, `${s} ${JSON.stringify(b)}`);
    ck("and writes it", db.prepare(`SELECT city FROM companies WHERE id='cmp_alex'`).get().city === "Seattle");
  }
  {
    const src = readFileSync(join(app, "src", "App.tsx"), "utf8");
    // The gate that was there, by name, so it cannot come back quietly.
    ck("the console's Save no longer demands a licence",
      !/disabled=\{!f\.company\.trim\(\) \|\| !f\.license\.trim\(\)\}/.test(src));
    ck("a name is still required", /const problem = !f\.company\.trim\(\)/.test(src));
    // A disabled control with no reason beside it is indistinguishable from a
    // broken one -- and this button had none.
    ck("and the reason is said beside the button", /\{problem && <p className="pf-note pfe-why">/.test(src));
    // Landing somewhere is not the same as pointing at something. The form
    // used to render below the whole company grid and be scrolled to and
    // rung; it now opens in a window over the row that was pressed, which is
    // in view by construction. So the property is that the edit form lives
    // INSIDE that window, keyed on which company is being edited -- read
    // from that block alone, because a bare search for CompanyEditFields
    // finds it whichever place it is drawn.
    const winAt = src.indexOf("{editCompanyId && (() => {");
    const win = src.slice(winAt, src.indexOf("})()}", winAt));
    ck("the company opens in a window", /<Modal wide className="modal-co" onClose=\{\(\) => setEditCompanyId\(null\)\}>/.test(win),
      win.slice(0, 80));
    ck("and the edit form is inside it",
      win.indexOf("<CompanyEditFields") > win.indexOf("<Modal") && win.indexOf("<CompanyEditFields") < win.indexOf("</Modal>"));
    // Offered only where the server would accept it: a control whose save is
    // refused is the screen-that-lies rule pointed at a picker.
    ck("the relationship control reads the same gate as the route",
      /mayEngageHandyman\(acct\?\.kind\)/.test(src));
    ck("and is keyed by the engagement", /onSetEngagedAs\(e\.id, k\.id\)/.test(src));
  }
} catch (err) {
  fail++;
  console.log("FAIL  the suite threw  --", err?.message || String(err));
}

supa.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
