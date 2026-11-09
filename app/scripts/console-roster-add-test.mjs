// A COMPANY THAT SIGNED UP ON ITS OWN CAN BE PUT ON ANOTHER ACCOUNT'S ROSTER
// FROM THE CONSOLE.
//
// Reported as: "If the subcontractor has already signed up for general sub, I
// should be able to assign them to outerhome roster from admin console." A
// subcontractor who signs up through get-started is their own account and on
// nobody's roster; the only customer-side door is a connect request. This is
// that request asked and accepted in one staff press.
//
//   node --no-warnings scripts/console-roster-add-test.mjs

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";

const supa = createServer((req, res) => {
  const who = String(req.headers.authorization || "").replace("Bearer ", "");
  if (!who || who === "nobody") { res.writeHead(401); return res.end("{}"); }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ id: `auth_${who}`, email: `${who}@subsub.test` }));
}).listen(8951);

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(join(app, "worker", "schema.sql"), "utf8");

const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO companies(id,company,contact) VALUES
      ('cmp_sub','Cascade Exteriors','Ana'),
      ('cmp_typed','Typed In Roofing','Bo'),
      ('cmp_pm_own','Sound PM company','Dee');
    INSERT INTO accounts(id,name,kind,subdomain,plan,company_id,trades) VALUES
      ('acc_gc','Outerhome','general_contractor','outerhome','scale',NULL,NULL),
      ('acc_pm','Sound Property Management','property_manager','soundpm','scale','cmp_pm_own',NULL),
      -- The sub's OWN account, made at get-started.
      ('acc_sub','Cascade Exteriors','subcontractor','cascadeext','basic','cmp_sub','["roofing","gutters"]');
    INSERT INTO users(id,name,email,auth_id) VALUES
      ('u_super','Richard','super@subsub.test','auth_super'),
      ('u_plain','Helper','plain@subsub.test','auth_plain'),
      ('u_ana','Ana','ana@subsub.test','auth_ana'),
      ('u_ten','Tenant','ten@subsub.test','auth_ten');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES
      ('m_ana','u_ana','acc_sub','admin'),
      -- A guest on their own account: never seated anywhere else.
      ('m_ten','u_ten','acc_sub','tenant');
    INSERT INTO superadmins(user_id,role,finance,impersonate) VALUES
      ('u_super','superadmin',1,1), ('u_plain','standard',0,0);
  `);
  return { db, env: { DB: makeD1(db),
    SUPABASE_URL: "http://127.0.0.1:8951", SUPABASE_ANON_KEY: "stub", STAFF_ALLOW_PASSWORD: "1" } };
};

const call = (env, path, body, who = "super") => worker.fetch(
  new Request(`https://api.subsub.work${path}`, {
    method: "POST", body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${who}` },
  }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];
const add = (env, acct, body, who) => call(env, `/api/platform/accounts/${acct}/roster`, body, who).then(json);

try {
  console.log("\n-- adding a self-signed-up subcontractor to Outerhome's roster --");
  {
    const { db, env } = seed();
    const [s, b] = await add(env, "acc_gc", { companyId: "cmp_sub", reason: "Both asked on the phone" });
    ck("a superadmin may add them", s === 200 && b.ok, `${s} ${JSON.stringify(b)}`);
    const en = db.prepare(`SELECT * FROM engagements WHERE account_id='acc_gc' AND company_id='cmp_sub'`).get();
    ck("an ACTIVE engagement is written on that account", en?.status === "active", String(en?.status));
    ck("with the trades their own account lists", en?.categories === '["roofing","gutters"]', String(en?.categories));
    const seat = db.prepare(`SELECT * FROM memberships WHERE account_id='acc_gc' AND user_id='u_ana'`).get();
    ck("their admin is seated there as a contractor",
      seat?.role === "contractor" && seat?.company_id === "cmp_sub", JSON.stringify(seat));
    ck("a guest on their account is not",
      !db.prepare(`SELECT 1 FROM memberships WHERE account_id='acc_gc' AND user_id='u_ten'`).get());
    ck("the reply counts the seat", b.seated === 1, String(b.seated));
    const ev = db.prepare(`SELECT * FROM events WHERE kind='engagement.applied' AND account_id='acc_gc'`).get();
    ck("logged so the dashboard says they are new",
      JSON.parse(ev?.payload || "{}").via === "staff" && ev?.subject_id === en?.id, JSON.stringify(ev));
    const audit = db.prepare(`SELECT * FROM activity WHERE kind='engagement_added_by_staff'`).get();
    ck("audited on that account's feed, with the reason",
      audit?.account_id === "acc_gc" && /Both asked on the phone/.test(audit?.text || ""), JSON.stringify(audit));
    const [s2, b2] = await add(env, "acc_gc", { companyId: "cmp_sub", reason: "again" });
    ck("a second add is refused as already on the roster", s2 === 409 && b2.error === "already_on_roster", `${s2} ${JSON.stringify(b2)}`);
  }

  console.log("\n-- the refusals --");
  {
    const { db, env } = seed();
    let [s, b] = await add(env, "acc_gc", { companyId: "cmp_sub", reason: "x" }, "plain");
    ck("a standard staff seat is refused", s === 403, `${s} ${JSON.stringify(b)}`);
    [s, b] = await add(env, "acc_gc", { companyId: "cmp_sub", reason: "  " });
    ck("a reason is required", s === 400 && b.error === "reason_required", `${s} ${JSON.stringify(b)}`);
    [s, b] = await add(env, "acc_sub", { companyId: "cmp_sub", reason: "x" });
    ck("their own account is refused", s === 409 && b.error === "own_company", `${s} ${JSON.stringify(b)}`);
    [s, b] = await add(env, "acc_gc", { companyId: "cmp_sub", engagedAs: "handyman", reason: "x" });
    ck("handyman on a general contractor is refused", s === 409 && b.error === "not_a_handyman_account", `${s} ${JSON.stringify(b)}`);
    [s, b] = await add(env, "acc_gc", { companyId: "nope", reason: "x" });
    ck("an unknown company is named", s === 404 && b.error === "company_not_found", `${s}`);
    ck("and nothing was written", !db.prepare(`SELECT 1 FROM engagements WHERE account_id='acc_gc'`).get());
  }

  console.log("\n-- a handyman on a property manager, a typed-in company, and an ended one --");
  {
    const { db, env } = seed();
    const [s, b] = await add(env, "acc_pm", { companyId: "cmp_sub", engagedAs: "handyman", reason: "x" });
    ck("a property manager may take them as a handyman", s === 200, `${s} ${JSON.stringify(b)}`);
    ck("and the word is written", db.prepare(`SELECT engaged_as FROM engagements WHERE account_id='acc_pm'`).get()?.engaged_as === "handyman");
    const [s2, b2] = await add(env, "acc_gc", { companyId: "cmp_typed", reason: "x" });
    ck("a company with no login is added with nobody seated", s2 === 200 && b2.seated === 0, `${s2} ${JSON.stringify(b2)}`);
    db.prepare(`UPDATE engagements SET status='ended' WHERE account_id='acc_gc' AND company_id='cmp_typed'`).run();
    const [s3, b3] = await add(env, "acc_gc", { companyId: "cmp_typed", reason: "back" });
    ck("an ended engagement is put back", s3 === 200 && b3.reactivated === true, `${s3} ${JSON.stringify(b3)}`);
    ck("as active, on the same row",
      db.prepare(`SELECT COUNT(*) n, MAX(status) s FROM engagements WHERE account_id='acc_gc' AND company_id='cmp_typed'`).get().s === "active");
  }

  console.log("\n-- the console offers it --");
  {
    const src = readFileSync(join(app, "src", "App.tsx"), "utf8");
    ck("the company window draws the form for a superadmin",
      /isSuper && onAddToRoster && \(/.test(src) && /<ConsoleAddToRoster /.test(src));
    const comp = src.slice(src.indexOf("function ConsoleAddToRoster"), src.indexOf("function ConsoleLicenseRecheck"));
    ck("it leaves out accounts they are live on and their own", /!live\.has\(a\.id\) && a\.companyId !== co\.id/.test(comp));
    ck("and the handyman choice only where the account may engage one", /mayEngageHandyman\(acct\.kind\)/.test(comp));
    const shared = readFileSync(join(app, "shared", "applicants.js"), "utf8");
    ck("the dashboard line says support added them", /Added to your roster by SubSub support/.test(shared));
  }
} finally {
  supa.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
