// DELETING AN ACCOUNT OR A COMPANY FROM THE STAFF CONSOLE, which is the one
// place in this product that cannot be undone and so is the one place a
// typed confirmation is right.
//
// Reported as "can't delete subcontractors in admin console - stops here",
// with a screenshot of the name typed correctly and the button still dead.
// The cause was two bugs that only bite together:
//
//   PATCH DID NOT TRIM. `POST /api/platform/companies` has always trimmed
//   the name; the edit route beside it wrote whatever the browser sent. So
//   editing a company put a trailing space in the row.
//
//   AND THE COMPARISON WAS EXACT, against that stored value. A trailing
//   space renders identically in the label -- HTML collapses it -- so the
//   requirement the reader saw and the value the code compared were
//   different strings. The button was dead for ever, and nothing on the
//   screen said why, because the hint the countersign box has had since it
//   was written was never added here.
//
// Three copies of that comparison existed (the modal and both routes) and a
// fourth, correct one sat unused in `shared/`. There is one now.
//
//   node --no-warnings scripts/console-delete-test.mjs

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { typedNameMatches, typedNameHint } from "../shared/typedname.js";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");

const supa = createServer((req, res) => {
  const who = String(req.headers.authorization || "").replace("Bearer ", "");
  if (!who || who === "nobody") { res.writeHead(401); return res.end("{}"); }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ id: `auth_${who}`, email: `${who}@subsub.test` }));
}).listen(8963);

const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const M031 = `ALTER TABLE accounts ADD COLUMN company_id TEXT REFERENCES companies(id);`;

const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [M031] });
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind,plan,billing) VALUES
      ('acc1','Cascade Management','cascade','property_manager','scale','monthly');
    INSERT INTO companies(id,company,contact,email,city,state) VALUES
      -- THE REPORTED ROW: a trailing space, which is what the edit route put
      -- there. It renders identically to the one below it and is the only
      -- fixture either direction of this can be checked against.
      ('cmp_rk','Roundhouse Kick Consgruction ','Chuck N','chuck@rk.test','Seattle','WA'),
      ('cmp_ok','Orcas Roofing','Jason Stanton','jason@orcas.test','Bellevue','WA'),
      ('cmp_case','Alexburd LLC','Oleksandr Burdak','ob@alex.test','Seattle','WA');
    INSERT INTO users(id,name,email,auth_id) VALUES
      ('u_staff','Staff Person','staff@subsub.test','auth_staff');
    INSERT INTO superadmins(user_id,role,finance,impersonate) VALUES ('u_staff','superadmin',1,1);
    INSERT INTO engagements(id,account_id,company_id,status,categories) VALUES
      ('en_rk','acc1','cmp_rk','active','["framing"]');
  `);
  return { db, env: { DB: makeD1(db),
    SUPABASE_URL: "http://127.0.0.1:8963", SUPABASE_ANON_KEY: "stub",
    STAFF_ALLOW_PASSWORD: "1" } };
};

const call = (env, path, { method = "GET", body, who = "staff" } = {}) =>
  worker.fetch(new Request(`https://api.subsub.work${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${who}` },
  }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];

console.log("\n-- the predicate, which is now the only one --");
{
  // THE REPORTED CASE. Typed exactly as the label renders it, against a
  // stored value that is not what the label renders.
  ck("a trailing space on the STORED name still matches",
    typedNameMatches("Roundhouse Kick Consgruction", "Roundhouse Kick Consgruction "));
  ck("and a leading one", typedNameMatches("Acme Roofing", "  Acme Roofing"));
  ck("and a double space inside, which also renders as one",
    typedNameMatches("Acme Roofing", "Acme  Roofing"));
  // A typed confirmation is there to make somebody read the name and
  // decide. It is not a test of the shift key, and a name that has to be
  // reproduced character-exact is one people copy and paste -- which
  // defeats the point of asking.
  ck("case does not matter", typedNameMatches("alexburd llc", "Alexburd LLC"));
  // And it is not a weakening: nothing here matches a different name.
  ck("a different name does not match", !typedNameMatches("Orcas Roof", "Orcas Roofing"));
  ck("nor a prefix", !typedNameMatches("Orcas", "Orcas Roofing"));
  ck("nor a substring", !typedNameMatches("Roofing", "Orcas Roofing"));
  ck("nor nothing at all", !typedNameMatches("   ", "Orcas Roofing"));

  // THE HALF THAT WAS REPORTED: a dead button with no reason beside it.
  ck("an empty box is not told off", typedNameHint("", "Orcas Roofing") === null);
  ck("a wrong name gets a reason", /does not match Orcas Roofing/.test(typedNameHint("Orcas", "Orcas Roofing") || ""),
    typedNameHint("Orcas", "Orcas Roofing"));
  ck("and it says what does not count, so the next try is informed",
    /[Ss]paces and capitals do not matter/.test(typedNameHint("Orcas", "Orcas Roofing") || ""));
  ck("a right name gets no reason", typedNameHint("orcas roofing ", "Orcas Roofing") === null);
  // AND THE HINT NAMES WHAT THE LABEL SHOWS, not what is stored. Printing
  // the raw value put a space before the full stop -- this bug's own shape
  // in miniature, on the sentence written to explain it.
  ck("and it names the tidied name, as the label draws it",
    typedNameHint("x", "Roundhouse Kick Consgruction ")
      === "That does not match Roundhouse Kick Consgruction. Spaces and capitals do not matter, the words do.",
    typedNameHint("x", "Roundhouse Kick Consgruction "));
}

try {
  console.log("\n-- deleting the company that could not be deleted --");
  {
    const { db, env } = seed();
    // Typed as the screen renders it, which is NOT what is stored.
    const [s, out] = await json(await call(env, "/api/platform/companies/cmp_rk",
      { method: "DELETE", body: { confirmName: "Roundhouse Kick Consgruction" } }));
    ck("it deletes", s === 200, `${s} ${JSON.stringify(out)}`);
    const left = db.prepare(`SELECT COUNT(*) AS n FROM companies WHERE id = 'cmp_rk'`).get();
    ck("the company is gone", left.n === 0, String(left.n));
    // The engagement goes with it, which is what the modal warns about.
    const en = db.prepare(`SELECT COUNT(*) AS n FROM engagements WHERE company_id = 'cmp_rk'`).get();
    ck("and every hiring account's engagement with them", en.n === 0, String(en.n));
  }
  {
    // THE ROUTE MUST NOT BE STRICTER THAN THE SCREEN, or the now-enabled
    // button answers 400 -- which would be the same dead end one layer
    // along. Case is the half most likely to be left behind.
    const { db, env } = seed();
    const [s] = await json(await call(env, "/api/platform/companies/cmp_case",
      { method: "DELETE", body: { confirmName: "alexburd llc" } }));
    ck("a differently-cased name is accepted, as the screen accepts it", s === 200, String(s));
    const left = db.prepare(`SELECT COUNT(*) AS n FROM companies WHERE id = 'cmp_case'`).get();
    ck("and it really went", left.n === 0, String(left.n));
  }
  {
    // AND IT IS STILL A GATE. Relaxing whitespace and case must not relax
    // what the confirmation is for.
    const { db, env } = seed();
    const [s, out] = await json(await call(env, "/api/platform/companies/cmp_ok",
      { method: "DELETE", body: { confirmName: "Orcas" } }));
    ck("a name that is merely close is refused",
      s === 400 && out.error === "confirm_name_mismatch", `${s} ${out.error}`);
    const left = db.prepare(`SELECT COUNT(*) AS n FROM companies WHERE id = 'cmp_ok'`).get();
    ck("and nothing was deleted", left.n === 1, String(left.n));

    const [s2, out2] = await json(await call(env, "/api/platform/companies/cmp_ok",
      { method: "DELETE", body: {} }));
    ck("so is naming nothing", s2 === 400 && out2.error === "confirm_name_mismatch", `${s2} ${out2.error}`);
  }
  {
    // The account side reads the same predicate. It had the identical bug
    // and would have been fixed on one branch only -- the diagonal coverage
    // this project keeps paying for.
    const { db, env } = seed();
    db.exec(`UPDATE accounts SET name = 'Cascade Management ' WHERE id = 'acc1'`);
    const [s] = await json(await call(env, "/api/platform/accounts/acc1",
      { method: "DELETE", body: { confirmName: "cascade management" } }));
    ck("an account with the same stored flaw deletes too", s === 200, String(s));
    const left = db.prepare(`SELECT COUNT(*) AS n FROM accounts WHERE id = 'acc1'`).get();
    ck("and it is gone", left.n === 0, String(left.n));
    // THE TRAIL IS THE WHOLE POINT. "A support action nobody can
    // reconstruct afterwards is indistinguishable from an intrusion" is the
    // comment above these routes, so the record of the deletion has to
    // outlive the row -- in `events`, whose account_id is nullable, since
    // the per-account stream goes with the account.
    const ev = db.prepare(
      `SELECT account_id, payload FROM events WHERE kind = 'account_deleted'`).get();
    ck("and the deletion is still on the record afterwards", !!ev, JSON.stringify(ev));
    ck("with the staff member who did it named",
      /staff@subsub.test/.test(ev?.payload || ""), ev?.payload);
    ck("detached from the account that is gone", ev?.account_id === null, String(ev?.account_id));
  }
  {
    const { env } = seed();
    const [s, out] = await json(await call(env, "/api/platform/accounts/acc1",
      { method: "DELETE", body: { confirmName: "Cascade" } }));
    ck("a close account name is still refused",
      s === 400 && out.error === "confirm_name_mismatch", `${s} ${out.error}`);
  }

  console.log("\n-- the write that produced the untrimmed row --");
  {
    const { db, env } = seed();
    // THE CAUSE. POST has always trimmed; this route wrote what it was
    // given, so editing a company is what put the space there -- and the
    // Delete button lives in that very edit panel.
    const [s] = await json(await call(env, "/api/platform/companies/cmp_ok",
      { method: "PATCH", body: { company: "  Orcas Roofing LLC  ", contact: " Jason Stanton " } }));
    ck("an edit saves", s === 200, String(s));
    const row = db.prepare(`SELECT company, contact FROM companies WHERE id = 'cmp_ok'`).get();
    ck("and the name is stored trimmed", row.company === "Orcas Roofing LLC", JSON.stringify(row.company));
    // Every string column, not just the one that was reported: the same
    // flaw in `contact` is a contact that fails any exact comparison made
    // about it later.
    ck("as is every other text field it writes", row.contact === "Jason Stanton", JSON.stringify(row.contact));

    // And the round trip, which is the property the report was about: a
    // company edited through the console is deletable afterwards.
    const [sd] = await json(await call(env, "/api/platform/companies/cmp_ok",
      { method: "DELETE", body: { confirmName: "Orcas Roofing LLC" } }));
    ck("so a company that has been edited can then be deleted", sd === 200, String(sd));
  }
  {
    const { db, env } = seed();
    // Blanking a field still means null rather than an empty string -- the
    // behaviour that was there before the trim went in.
    await call(env, "/api/platform/companies/cmp_ok", { method: "PATCH", body: { contact: "   " } });
    const row = db.prepare(`SELECT contact FROM companies WHERE id = 'cmp_ok'`).get();
    ck("a field blanked with spaces is null, not whitespace", row.contact === null, JSON.stringify(row.contact));
  }

  console.log("\n-- and it is still staff-only --");
  {
    const { db, env } = seed();
    const [s] = await json(await call(env, "/api/platform/companies/cmp_ok",
      { method: "DELETE", body: { confirmName: "Orcas Roofing" }, who: "nobody" }));
    ck("somebody who is not staff cannot delete a company", s === 401 || s === 403, String(s));
    const left = db.prepare(`SELECT COUNT(*) AS n FROM companies WHERE id = 'cmp_ok'`).get();
    ck("and nothing went", left.n === 1, String(left.n));
  }
} finally {
  supa.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
