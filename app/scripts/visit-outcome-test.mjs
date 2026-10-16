// "DID YOUR VENDOR SHOW UP?" -- THE ANSWER IS THE TENANT'S, WHICHEVER WAY THEY
// CAME TO BE ON THE JOB.
//
// Reported as "That didn't go through. Try again in a moment." under
// "Send -- nobody showed up". The outcome route checked `requested_by` alone,
// so a tenant a manager NAMED on a job (062's access_user_id, and the Create
// job picker) was refused at the one question only they can answer -- while
// the respond route beside it has read both since 062. And the screen said
// "try again" over every refusal, none of which trying again fixes.
//
//   node --no-warnings scripts/visit-outcome-test.mjs

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(join(app, "worker", "schema.sql"), "utf8");
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const db = freshDb({ base: SCHEMA, migrations: [] });
db.exec(`
INSERT INTO accounts(id,name,kind,subdomain,plan) VALUES ('acc_pm','Sound','property_manager','soundpm','scale');
INSERT INTO users(id,name,email) VALUES ('u_mgr','Chris','c@x.t'),('u_ten','John','j@x.t'),('u_oth','Ann','a@x.t'),('u_sub','Juan','ju@x.t');
INSERT INTO companies(id,company,contact,email,state) VALUES ('cmp_pac','Pacific','Juan','ju@x.t','WA');
INSERT INTO engagements(id,account_id,company_id,status,categories) VALUES ('en_pac','acc_pm','cmp_pac','active','["plumbing"]');
INSERT INTO properties(id,account_id,name,address,city,state,zip) VALUES ('prop_1','acc_pm','Press','1','Seattle','WA','98122');
INSERT INTO memberships(id,user_id,account_id,role,company_id) VALUES
  ('m_mgr','u_mgr','acc_pm','admin',NULL),('m_ten','u_ten','acc_pm','tenant',NULL),
  ('m_oth','u_oth','acc_pm','tenant',NULL),('m_sub','u_sub','acc_pm','contractor','cmp_pac');
INSERT INTO membership_properties(membership_id,property_id) VALUES ('m_ten','prop_1'),('m_oth','prop_1');
-- The tenant's own report.
INSERT INTO jobs(id,account_id,property_id,title,trades,status,requested_by,approved_at,created_at)
  VALUES ('job_rep','acc_pm','prop_1','Window','["plumbing"]','active','u_ten','2026-10-01','2026-10-01');
-- A job the manager raised and named the tenant on: nobody "requested" it.
INSERT INTO jobs(id,account_id,property_id,title,trades,status,access,access_user_id,approved_at,created_at)
  VALUES ('job_named','acc_pm','prop_1','Door','["plumbing"]','active','tenant','u_ten','2026-10-01','2026-10-01');
INSERT INTO work_orders(id,wo_number,job_id,trade,company_id,engagement_id,status,value_cents) VALUES
  ('wo_1','WO-1','job_rep','plumbing','cmp_pac','en_pac','accepted',40000),
  ('wo_2','WO-2','job_named','plumbing','cmp_pac','en_pac','accepted',40000);
-- NOBODY EVER SAID YES. An offer that ran out with no reply is still a live,
-- undeclined work order -- which is exactly the state of a job put out to
-- overflow -- and the route counted it as somebody sent. Beside it: a job
-- with no work order at all, and one whose only crew was withdrawn.
INSERT INTO jobs(id,account_id,property_id,title,trades,status,requested_by,approved_at,created_at) VALUES
  ('job_offer','acc_pm','prop_1','No power','["electrical"]','active','u_ten','2026-10-01','2026-10-01'),
  ('job_none','acc_pm','prop_1','No heat','["hvac"]','active','u_ten','2026-10-01','2026-10-01'),
  ('job_void','acc_pm','prop_1','Leak','["plumbing"]','active','u_ten','2026-10-01','2026-10-01'),
  ('job_auto','acc_pm','prop_1','Drip','["plumbing"]','active','u_ten','2026-10-01','2026-10-01');
INSERT INTO work_orders(id,wo_number,job_id,trade,company_id,engagement_id,status,respond_by,value_cents,voided_at,auto_scheduled) VALUES
  ('wo_offer','WO-3','job_offer','electrical','cmp_pac','en_pac','pending','2026-09-20',40000,NULL,0),
  ('wo_void','WO-4','job_void','plumbing','cmp_pac','en_pac','accepted',NULL,40000,'2026-10-06',0),
  ('wo_auto','WO-5','job_auto','plumbing','cmp_pac','en_pac','accepted',NULL,40000,NULL,1);
INSERT INTO visits(id,job_id,account_id,date,start_time,end_time,status,proposed_by,created_at) VALUES
  ('v_offer','job_offer','acc_pm','2026-09-23','10:00','11:00','confirmed','u_mgr','2026-09-20'),
  ('v_none','job_none','acc_pm','2026-09-23','10:00','11:00','confirmed','u_mgr','2026-09-20'),
  ('v_void','job_void','acc_pm','2026-09-23','10:00','11:00','confirmed','u_mgr','2026-09-20'),
  ('v_auto','job_auto','acc_pm','2026-09-23','10:00','11:00','confirmed','u_mgr','2026-09-20');
-- A MOVE-OUT: nobody lives there, the office lets the crew in. Whether they
-- came is the office's to say, and the tenant of the building is not asked.
INSERT INTO jobs(id,account_id,property_id,title,trades,status,access,approved_at,created_at)
  VALUES ('job_out','acc_pm','prop_1','Move-out work','["plumbing"]','active','manager','2026-10-01','2026-10-01');
INSERT INTO work_orders(id,wo_number,job_id,trade,company_id,engagement_id,status,value_cents) VALUES
  ('wo_out','WO-6','job_out','plumbing','cmp_pac','en_pac','accepted',40000);
INSERT INTO visits(id,job_id,account_id,date,start_time,end_time,status,proposed_by,created_at,manager_at,contractor_at) VALUES
  ('v_out','job_out','acc_pm','2026-10-09','15:00','16:00','confirmed','u_mgr','2026-10-05','2026-10-05','2026-10-05');
INSERT INTO visits(id,job_id,account_id,date,start_time,end_time,status,proposed_by,created_at) VALUES
  ('v_rep','job_rep','acc_pm','2026-10-09','09:45','10:45','confirmed','u_ten','2026-10-05'),
  ('v_named','job_named','acc_pm','2026-10-09','09:45','10:45','confirmed','u_mgr','2026-10-05'),
  ('v_prop','job_named','acc_pm','2026-10-08','09:00','10:00','superseded','u_mgr','2026-10-04');
`);
const env = { DB: makeD1(db) };
const say = (id, body, who) => worker.fetch(new Request(`https://api.subsub.work/api/visits/${id}/outcome`, {
  method: "POST", body: JSON.stringify(body),
  headers: { "Content-Type": "application/json", "X-User-Id": who, "X-Account-Id": "acc_pm" } }), env);
const st = (id) => db.prepare(`SELECT status, tenant_note, responded_at FROM visits WHERE id = ?`).get(id);

try {
  console.log("\n-- who may answer --");
  let r = await say("v_rep", { happened: false, note: "waited all morning" }, "u_ten");
  ck("the tenant who reported it can say nobody came", r.status === 200 && st("v_rep").status === "missed", String(r.status));
  r = await say("v_named", { happened: false }, "u_ten");
  ck("and so can the tenant a manager named on the job", r.status === 200 && st("v_named").status === "missed",
    `${r.status} ${await r.clone().text()}`);
  db.exec(`UPDATE visits SET status = 'confirmed' WHERE id = 'v_named'`);
  r = await say("v_named", { happened: true }, "u_oth");
  ck("another tenant of the building cannot", r.status === 403 && st("v_named").status === "confirmed", String(r.status));

  console.log("\n-- no tenant had to be in: the office answers --");
  r = await say("v_out", { happened: true }, "u_ten");
  ck("a tenant of the building is not the one asked about a move-out", r.status === 403 && st("v_out").status === "confirmed", String(r.status));
  r = await say("v_out", { happened: true }, "u_sub");
  ck("nor is the crew", r.status === 403 && st("v_out").status === "confirmed", String(r.status));
  r = await say("v_out", { happened: true, note: "all good" }, "u_mgr");
  ck("the property manager says they showed up", r.status === 200 && st("v_out").status === "happened",
    `${r.status} ${await r.clone().text()}`);
  ck("and the tenant's columns are left alone", st("v_out").tenant_note === null && st("v_out").responded_at === null,
    JSON.stringify(st("v_out")));
  db.exec(`UPDATE visits SET status = 'confirmed' WHERE id = 'v_rep'`);
  r = await say("v_rep", { happened: true }, "u_mgr");
  ck("but on a tenant's own report it stays the tenant's", r.status === 403 && st("v_rep").status === "confirmed", String(r.status));

  console.log("\n-- what is refused, by name --");
  r = await say("v_prop", { happened: true }, "u_ten");
  ck("a window that is no longer live answers not_open", r.status === 409 && (await r.json()).error === "not_open");
  r = await say("v_named", { happened: "no" }, "u_ten");
  ck("an answer that is not yes or no is refused", r.status === 400);

  console.log("\n-- nobody was sent, so there is nothing to answer about --");
  for (const [id, what] of [["v_offer", "an offer nobody accepted (out to overflow)"],
    ["v_none", "a job with no work order at all"], ["v_void", "a job whose only crew was withdrawn"]]) {
    for (const happened of [true, false]) {
      r = await say(id, { happened }, "u_ten");
      const body = await r.json();
      ck(`${what}: "${happened ? "they came" : "nobody came"}" is refused no_contractor`,
        r.status === 409 && body.error === "no_contractor" && st(id).status === "confirmed",
        `${r.status} ${JSON.stringify(body)} ${st(id).status}`);
    }
  }
  r = await say("v_auto", { happened: true }, "u_ten");
  ck("a crew issued already accepted by auto-schedule still counts", r.status === 200 && st("v_auto").status === "happened",
    String(r.status));

  console.log("\n-- and the screen names it --");
  const src = readFileSync(join(app, "src", "App.tsx"), "utf8");
  const comp = src.slice(src.indexOf("function TenantVisitOutcome("), src.indexOf("function TenantVisitOutcome(") + 1500);
  ck("the show-up answer says why it was refused", /setErr\(visitOutcomeErrText\(e\)\)/.test(comp)
    && !/Try again in a moment/.test(comp));
  const vo = src.slice(src.indexOf("const visitOutcome = async"), src.indexOf("const visitOutcome = async") + 1200);
  ck("and a stale row re-reads the visits", /"not_open"/.test(vo) && /api\.listVisits\(\)/.test(vo));
} catch (e) { fail++; console.log("FAIL  threw", e); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
