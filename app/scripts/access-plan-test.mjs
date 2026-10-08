// HOW THE CREW GETS IN, said to the two people at the door.
//
// Reported as *"on the pm side it shows tenant lets service provider in, but
// in both of their accounts (tenant and service provider) it's not clear who
// lets who in"* -- with the ask for where to meet, when, and both sides'
// first name and mobile.
//
// What is pinned here is mostly WHOSE NUMBER GOES WHERE, because that is the
// part with a cost if it is wrong:
//
//   the tenant's mobile reaches a crew only on a job that tenant is letting
//   them into, and only a crew that has ACCEPTED the work;
//   a crew's mobile reaches a tenant on the same two conditions;
//   on a job the office opens, the crew gets the office and not the tenant;
//   a finished job hands nobody's number to anybody;
//   another tenant, and a crew merely offered the job, get not-found.
//
//   node --no-warnings scripts/access-plan-test.mjs

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { visiblePeople, normalizeHow, mayEditHow, accessHeadline, ACCESS_HOW_MAX,
  ACCESS_HOW_PRESETS } from "../shared/accessplan.js";
import { ACCESS_IDS } from "../shared/access.js";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(join(app, "worker", "schema.sql"), "utf8");
const SRC = readFileSync(join(app, "worker", "index.js"), "utf8");

const TEN_PHONE = "2065550111", CREW_PHONE = "2065550122", MGR_PHONE = "2065550133", OTH_PHONE = "2065550144";

const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,kind,subdomain,plan) VALUES
      ('acc_pm','Sound Property Management','property_manager','soundpm','scale');
    INSERT INTO users(id,name,email,phone) VALUES
      ('u_mgr','Chris Lane','chris@soundpm.test','${MGR_PHONE}'),
      ('u_ten','John Smith','john@tenant.test','${TEN_PHONE}'),
      ('u_ten2','Ana Diaz','ana@tenant.test','2065550199'),
      ('u_sub','Juan Soto','juan@pacific.test',NULL),
      ('u_oth','Other Crew','crew@other.test','${OTH_PHONE}');
    INSERT INTO companies(id,company,contact,email,phone,state) VALUES
      ('cmp_pac','Pacific apartment maintenance','Juan Soto','juan@pacific.test','${CREW_PHONE}','WA'),
      ('cmp_oth','Other Maintenance','Other Crew','crew@other.test','${OTH_PHONE}','WA');
    INSERT INTO engagements(id,account_id,company_id,status,categories) VALUES
      ('en_pac','acc_pm','cmp_pac','active','["plumbing"]'),
      ('en_oth','acc_pm','cmp_oth','active','["electrical"]');
    INSERT INTO properties(id,account_id,name,address,city,state,zip) VALUES
      ('prop_1','acc_pm','Press Apartments','1620 Belmont','Seattle','WA','98122');
    INSERT INTO memberships(id,user_id,account_id,role,company_id) VALUES
      ('m_mgr','u_mgr','acc_pm','admin',NULL),
      ('m_ten','u_ten','acc_pm','tenant',NULL),
      ('m_ten2','u_ten2','acc_pm','tenant',NULL),
      ('m_sub','u_sub','acc_pm','contractor','cmp_pac'),
      ('m_oth','u_oth','acc_pm','contractor','cmp_oth');
    INSERT INTO membership_properties(membership_id,property_id) VALUES ('m_ten','prop_1'),('m_ten2','prop_1');

    INSERT INTO jobs(id,account_id,property_id,title,trades,status,requested_by,approved_at,access,created_at) VALUES
      ('job_t','acc_pm','prop_1','Leaking sink','["plumbing","electrical"]','active','u_ten','2026-10-01','tenant','2026-10-01'),
      ('job_m','acc_pm','prop_1','Hall light','["plumbing"]','active','u_ten','2026-10-01','manager','2026-10-01'),
      ('job_n','acc_pm','prop_1','Gutter','["plumbing"]','active','u_ten','2026-10-01','none','2026-10-01'),
      ('job_d','acc_pm','prop_1','Old tap','["plumbing"]','completed','u_ten','2026-10-01','tenant','2026-10-01');

    INSERT INTO work_orders(id,wo_number,job_id,trade,company_id,engagement_id,status,value_cents) VALUES
      ('wo_t','WO-1','job_t','plumbing','cmp_pac','en_pac','accepted',40000),
      ('wo_to','WO-2','job_t','electrical','cmp_oth','en_oth','pending',30000),
      ('wo_m','WO-3','job_m','plumbing','cmp_pac','en_pac','accepted',40000),
      ('wo_n','WO-4','job_n','plumbing','cmp_pac','en_pac','accepted',40000),
      ('wo_d','WO-5','job_d','plumbing','cmp_pac','en_pac','accepted',40000);
    INSERT INTO visits(id,account_id,job_id,proposed_by,date,start_time,end_time,status,created_at)
      VALUES ('v1','acc_pm','job_t','u_ten','2026-10-09','09:45','10:45','confirmed','2026-10-08 10:00:00');
  `);
  db.exec(readFileSync(join(app, "worker", "migrations", "073_job_access.sql"), "utf8"));
  return { db, env: { DB: makeD1(db) } };
};

const call = (env, path, who, method = "GET", body) => worker.fetch(
  new Request(`https://api.subsub.work${path}`, {
    method, body: body ? JSON.stringify(body) : undefined,
    headers: { "Content-Type": "application/json", "X-User-Id": who, "X-Account-Id": "acc_pm" },
  }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];
const access = (env, job, who) => call(env, `/api/jobs/${job}/access`, who).then(json);
const sideOf = (plan, side) => (plan.people || []).filter((p) => p.side === side);
const has = (plan, phone) => JSON.stringify(plan).includes(phone);

try {
  console.log("\n-- the rule on its own --");
  {
    const tenant = { firstName: "John", phone: TEN_PHONE };
    const manager = { firstName: "Chris", phone: MGR_PHONE };
    const crews = [{ company: "Pacific", firstName: "Juan", phone: CREW_PHONE }];
    const t = visiblePeople({ kind: "tenant", viewer: "crew", tenant, manager, crews });
    ck("a crew on a tenant's job gets the tenant and itself",
      t.map((p) => p.side).join() === "tenant,crew" && t[1].you === true, JSON.stringify(t));
    const m = visiblePeople({ kind: "manager", viewer: "crew", tenant, manager, crews });
    ck("a crew on a job the office opens gets the office, never the tenant",
      m.map((p) => p.side).join() === "manager,crew" && !JSON.stringify(m).includes(TEN_PHONE), JSON.stringify(m));
    const tm = visiblePeople({ kind: "manager", viewer: "tenant", tenant, manager, crews });
    ck("and the tenant there gets the office, not the crew",
      tm.map((p) => p.side).join() === "manager" && !JSON.stringify(tm).includes(CREW_PHONE), JSON.stringify(tm));
    const n = visiblePeople({ kind: "none", viewer: "tenant", tenant, manager, crews });
    ck("nobody to meet hands the tenant nobody", n.length === 0, JSON.stringify(n));
    ck("normalizeHow trims, collapses and caps",
      normalizeHow("  Meet   at the\nfront door ") === "Meet at the front door"
      && normalizeHow("x".repeat(500)).length === ACCESS_HOW_MAX && normalizeHow("   ") === null);
    ck("a tenant may say where only on a job they open",
      mayEditHow("tenant", { kind: "tenant", isAccessTenant: true })
      && !mayEditHow("tenant", { kind: "manager", isAccessTenant: true })
      && !mayEditHow("tenant", { kind: "tenant", isAccessTenant: false })
      && !mayEditHow("contractor", { kind: "tenant" }) && mayEditHow("pm", { kind: "none" }));
    ck("every kind of access has suggestions", ACCESS_IDS.every((k) => (ACCESS_HOW_PRESETS[k] || []).length > 0));
    const plan = { kind: "tenant", people: [{ side: "tenant", firstName: "John" },
      { side: "crew", company: "Pacific", firstName: "Juan" }] };
    ck("the headline is said from the reader's side",
      accessHeadline(plan, "tenant") === "You let Pacific in."
      && accessHeadline(plan, "crew") === "John (the tenant) lets you in.",
      `${accessHeadline(plan, "tenant")} | ${accessHeadline(plan, "crew")}`);
  }

  console.log("\n-- a job the tenant opens --");
  {
    const { env } = seed();
    const [ts, t] = await access(env, "job_t", "u_ten");
    ck("the tenant can read it", ts === 200 && t.kind === "tenant", `${ts} ${JSON.stringify(t)}`);
    ck("and gets the crew that accepted, first name and mobile",
      sideOf(t, "crew").length === 1 && sideOf(t, "crew")[0].firstName === "Juan"
      && sideOf(t, "crew")[0].phone === CREW_PHONE, JSON.stringify(t.people));
    ck("never the crew that was only offered it", !has(t, OTH_PHONE), JSON.stringify(t.people));
    ck("and their own number, marked as theirs",
      sideOf(t, "tenant")[0]?.you === true && sideOf(t, "tenant")[0]?.phone === TEN_PHONE);
    ck("with the agreed window", t.when?.date === "2026-10-09" && t.when?.startTime === "09:45", JSON.stringify(t.when));
    ck("and may say where to meet", t.canEditHow === true);

    const [cs, cr] = await access(env, "job_t", "u_sub");
    ck("the crew can read it", cs === 200, String(cs));
    ck("and gets the tenant's first name and mobile",
      sideOf(cr, "tenant")[0]?.firstName === "John" && sideOf(cr, "tenant")[0]?.phone === TEN_PHONE,
      JSON.stringify(cr.people));
    ck("and only itself among the crews", sideOf(cr, "crew").length === 1 && sideOf(cr, "crew")[0].you === true
      && !has(cr, OTH_PHONE), JSON.stringify(cr.people));
    ck("but may not change where to meet", cr.canEditHow === false);

    const [os] = await access(env, "job_t", "u_oth");
    ck("a crew merely offered the job gets not-found", os === 404, String(os));
    const [xs] = await access(env, "job_t", "u_ten2");
    ck("another tenant gets not-found", xs === 404, String(xs));

    const [ms, m] = await access(env, "job_t", "u_mgr");
    ck("the office sees both sides", ms === 200 && sideOf(m, "tenant").length === 1 && sideOf(m, "crew").length === 1,
      JSON.stringify(m.people));
  }

  console.log("\n-- where to meet --");
  {
    const { db, env } = seed();
    const [ps, p] = await json(await call(env, "/api/jobs/job_t/access-how", "u_ten", "PUT",
      { how: "  The tenant will open the garage door " }));
    ck("the tenant can say which door", ps === 200 && p.how === "The tenant will open the garage door"
      && p.howFrom === "tenant", `${ps} ${JSON.stringify(p)}`);
    const [, cr] = await access(env, "job_t", "u_sub");
    ck("and the crew reads it", cr.how === "The tenant will open the garage door" && cr.howFrom === "tenant");
    const [cs] = await json(await call(env, "/api/jobs/job_t/access-how", "u_sub", "PUT", { how: "x" }));
    ck("the crew may not rewrite it", cs === 403, String(cs));
    const [ts] = await json(await call(env, "/api/jobs/job_m/access-how", "u_ten", "PUT", { how: "x" }));
    ck("a tenant may not say where on a job the office opens", ts === 403, String(ts));
    const [ms, m] = await json(await call(env, "/api/jobs/job_m/access-how", "u_mgr", "PUT", { how: "Key in the lockbox" }));
    ck("the office may", ms === 200 && m.how === "Key in the lockbox" && m.howFrom === "office", `${ms} ${JSON.stringify(m)}`);
    ck("one row per job", db.prepare(`SELECT COUNT(*) n FROM job_access`).get().n === 2);
  }

  console.log("\n-- a job the office opens, and one nobody needs to --");
  {
    const { env } = seed();
    const [, cr] = await access(env, "job_m", "u_sub");
    ck("the crew is given the office", sideOf(cr, "manager")[0]?.firstName === "Chris"
      && sideOf(cr, "manager")[0]?.phone === MGR_PHONE, JSON.stringify(cr.people));
    ck("and not the tenant's number", !has(cr, TEN_PHONE), JSON.stringify(cr.people));
    const [, t] = await access(env, "job_m", "u_ten");
    ck("the tenant is given the office and not the crew",
      sideOf(t, "manager").length === 1 && !has(t, CREW_PHONE), JSON.stringify(t.people));
    const [, tn] = await access(env, "job_n", "u_ten");
    ck("nobody needs to meet: the tenant is handed nobody", (tn.people || []).length === 0, JSON.stringify(tn.people));
    const [, cn] = await access(env, "job_n", "u_sub");
    ck("and the crew only itself", !has(cn, TEN_PHONE) && sideOf(cn, "crew").length === 1, JSON.stringify(cn.people));
  }

  console.log("\n-- a finished job hands nobody's number to anybody --");
  {
    const { env } = seed();
    const [, cr] = await access(env, "job_d", "u_sub");
    ck("the crew is not given the tenant once it is done", !has(cr, TEN_PHONE) && cr.live === false, JSON.stringify(cr));
    const [, t] = await access(env, "job_d", "u_ten");
    ck("nor the tenant the crew", !has(t, CREW_PHONE), JSON.stringify(t));
  }

  console.log("\n-- the crew's own list carries it --");
  {
    const { env } = seed();
    const [, mw] = await json(await call(env, "/api/my-work", "u_sub"));
    const row = (mw.work || []).find((w) => w.jobId === "job_t");
    ck("an accepted job carries the plan", row?.accessPlan?.kind === "tenant", JSON.stringify(row?.accessPlan));
    ck("with the tenant's number", sideOf(row?.accessPlan || {}, "tenant")[0]?.phone === TEN_PHONE);
    const [, ow] = await json(await call(env, "/api/my-work", "u_oth"));
    const orow = (ow.work || []).find((w) => w.jobId === "job_t");
    ck("an offer nobody has taken carries none", orow && orow.accessPlan === null, JSON.stringify(orow?.accessPlan));
  }

  console.log("\n-- before 073 is pasted --");
  {
    const { db, env } = seed();
    db.exec(`DROP TABLE job_access`);
    const [s, p] = await access(env, "job_t", "u_ten");
    ck("the panel still answers, without the sentence", s === 200 && p.how === null
      && p.migration === "073_job_access" && sideOf(p, "crew").length === 1, `${s} ${JSON.stringify(p)}`);
    const [ps, pb] = await json(await call(env, "/api/jobs/job_t/access-how", "u_ten", "PUT", { how: "x" }));
    ck("and saving names the file", ps === 503 && pb.migration === "073_job_access", `${ps} ${JSON.stringify(pb)}`);
  }

  console.log("\n-- a tenant's seat can reach it --");
  {
    ck("the tenant allowlist carries the read", /\[\/\^\\\/api\\\/jobs\\\/\[\^\/\]\+\\\/access\$\/, \["GET"\]\]/.test(SRC));
    ck("and the sentence", /\[\/\^\\\/api\\\/jobs\\\/\[\^\/\]\+\\\/access-how\$\/, \["PUT"\]\]/.test(SRC));
  }
} catch (err) {
  ck("the suite ran to the end", false, err?.stack || String(err));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
