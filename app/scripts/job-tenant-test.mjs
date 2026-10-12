// NAMING THE TENANT WHEN A JOB IS CREATED -- 062's access_user_id, reached
// from the job form rather than only from an inspection.
//
// Asked for as a "Tenant" drop-down on the create form, listing the tenants
// of whichever building was picked. What is pinned:
//
//   ONLY A TENANT OF THAT BUILDING, ON THIS ACCOUNT. A tenant of another
//   building, a tenant of another account, and a job at no building are each
//   refused by name, and nothing is written -- naming them would ask a
//   stranger to confirm a time at somebody else's home.
//
//   NEVER FROM A REQUESTER. A tenant raising their own report cannot name
//   somebody else to be asked.
//
//   IT IS access_user_id AND NEVER requested_by. They did not ask for it.
//
//   THE TENANT NAMED IS THE ONE ASKED. A window proposed on the job waits on
//   them, and the tenant's own visit list carries it.
//
//   A DATABASE WITHOUT 062 LOSES THE TENANT, NEVER THE JOB.
//
//   node --no-warnings scripts/job-tenant-test.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(join(app, "worker", "schema.sql"), "utf8");

const DAY = "2027-11-04";

const seed = ({ drop062 = false } = {}) => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,kind,subdomain,plan) VALUES
      ('acc_pm','Sound Property Management','property_manager','soundpm','scale'),
      ('acc_x','Other Agent','property_manager','otheragent','scale');
    INSERT INTO properties(id,account_id,owner_account_id,name,address,city,state,zip) VALUES
      ('p_ballard','acc_pm','acc_pm','Ballard Apts','2028 NW 59th St','Seattle','WA','98107'),
      ('p_press','acc_pm','acc_pm','Press Apartments','1620 Belmont Ave','Seattle','WA','98122'),
      ('p_far','acc_x','acc_x','Far Away','1 Elsewhere','Tacoma','WA','98402');
    INSERT INTO users(id,name,email) VALUES
      ('u_mgr','Chris Lane','chris@soundpm.test'),
      ('u_ten','John Smith','john@tenant.test'),
      ('u_ten2','Mary Press','mary@tenant.test'),
      ('u_far','Far Tenant','far@tenant.test');
    INSERT INTO memberships(id,user_id,account_id,role,unit) VALUES
      ('m_mgr','u_mgr','acc_pm','admin',NULL),
      ('m_ten','u_ten','acc_pm','tenant','10A'),
      ('m_ten2','u_ten2','acc_pm','tenant','3B'),
      ('m_far','u_far','acc_x','tenant','1');
    INSERT INTO membership_properties(membership_id,property_id) VALUES
      ('m_ten','p_ballard'), ('m_ten2','p_press'), ('m_far','p_far');
  `);
  if (drop062) db.exec(`ALTER TABLE jobs RENAME COLUMN access_user_id TO access_user_gone`);
  return { db, env: { DB: makeD1(db), FILES: { put: async () => {}, get: async () => null } } };
};

const call = (env, path, { method = "GET", body, who = "u_mgr", acct = "acc_pm" } = {}) => worker.fetch(
  new Request(`https://api.subsub.work${path}`, {
    method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: { "Content-Type": "application/json", "X-User-Id": who, "X-Account-Id": acct },
  }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];
const job = (extra = {}) => ({ title: "Ballard Apts — bathroom wall", propertyId: "p_ballard",
  address: "2028 NW 59th St", area: "Seattle", zip: "98107", date: DAY, time: "09:00",
  trades: ["painting"], ...extra });
const count = (db) => db.prepare(`SELECT COUNT(*) AS n FROM jobs`).get().n;

try {
  console.log("\n-- a tenant of the building is named --");
  {
    const { db, env } = seed();
    const [st, b] = await json(await call(env, "/api/jobs", { method: "POST",
      body: job({ accessUserId: "u_ten", access: "tenant" }) }));
    ck("the job is created", st === 201 && b.id, JSON.stringify({ st, b }));
    const row = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(b.id);
    ck("and names them as the person who has to be let in", row?.access_user_id === "u_ten", row?.access_user_id);
    ck("never as somebody who asked for it", row?.requested_by === null, String(row?.requested_by));
    ck("with the access answer that came with naming them", row?.access === "tenant", row?.access);
    ck("the reply carries them, so the screen does not wait for a reload",
      b.job?.accessUserId === "u_ten", JSON.stringify(b.job?.accessUserId));

    console.log("\n-- and they are the one asked about the time --");
    const [vs, vb] = await json(await call(env, `/api/jobs/${b.id}/visits`, { method: "POST",
      body: { date: DAY, start: "09:00", end: "10:00" } }));
    ck("a window is proposed", vs === 201 || vs === 200, JSON.stringify({ vs, vb }));
    ck("and it waits on the tenant rather than booking outright",
      (vb.visit?.status || vb.status) === "proposed", JSON.stringify(vb));
    const [ts, tv] = await json(await call(env, "/api/visits", { who: "u_ten" }));
    const mine = (Array.isArray(tv) ? tv : tv?.visits || []).filter((v) => (v.jobId || v.job_id) === b.id);
    ck("the tenant's own visit list carries it", ts === 200 && mine.length === 1, JSON.stringify({ ts, tv }));
    const [, other] = await json(await call(env, "/api/visits", { who: "u_ten2" }));
    const theirs = (Array.isArray(other) ? other : other?.visits || []).filter((v) => (v.jobId || v.job_id) === b.id);
    ck("and a tenant of another building's does not", theirs.length === 0, JSON.stringify(other));
  }

  console.log("\n-- anybody else is refused, and nothing is written --");
  {
    const { db, env } = seed();
    const [s1, b1] = await json(await call(env, "/api/jobs", { method: "POST", body: job({ accessUserId: "u_ten2" }) }));
    ck("a tenant of a different building on this account", s1 === 400 && b1.error === "bad_tenant", JSON.stringify({ s1, b1 }));
    const [s2, b2] = await json(await call(env, "/api/jobs", { method: "POST", body: job({ accessUserId: "u_far" }) }));
    ck("a tenant of another account", s2 === 400 && b2.error === "bad_tenant", JSON.stringify({ s2, b2 }));
    const [s3, b3] = await json(await call(env, "/api/jobs", { method: "POST",
      body: job({ propertyId: undefined, accessUserId: "u_ten" }) }));
    ck("a job at no building", s3 === 400 && b3.error === "bad_tenant", JSON.stringify({ s3, b3 }));
    const [s4, b4] = await json(await call(env, "/api/jobs", { method: "POST", body: job({ accessUserId: "u_mgr" }) }));
    ck("somebody who is not a tenant at all", s4 === 400 && b4.error === "bad_tenant", JSON.stringify({ s4, b4 }));
    ck("no job was created by any of them", count(db) === 0, String(count(db)));
    const [s5, b5] = await json(await call(env, "/api/jobs", { method: "POST", body: job() }));
    const r5 = db.prepare(`SELECT access_user_id FROM jobs WHERE id = ?`).get(b5.id);
    ck("naming nobody still creates the job, with nobody named", s5 === 201 && r5?.access_user_id === null,
      JSON.stringify({ s5, r5 }));
  }

  console.log("\n-- a tenant raising their own report cannot name somebody else --");
  {
    const { db, env } = seed();
    const [st, b] = await json(await call(env, "/api/jobs", { method: "POST", who: "u_ten",
      body: job({ accessUserId: "u_ten2" }) }));
    const row = b.id ? db.prepare(`SELECT requested_by, access_user_id FROM jobs WHERE id = ?`).get(b.id) : null;
    ck("the report goes in as theirs", st === 201 && row?.requested_by === "u_ten", JSON.stringify({ st, b, row }));
    ck("and the name they sent is ignored", row?.access_user_id === null, JSON.stringify(row));
  }

  console.log("\n-- named, changed and cleared on an existing job --");
  {
    const { db, env } = seed();
    const [, made] = await json(await call(env, "/api/jobs", { method: "POST", body: job() }));
    const row = () => db.prepare(`SELECT access, access_user_id, requested_by FROM jobs WHERE id = ?`).get(made.id);
    const patch = (body, who = "u_mgr") => call(env, `/api/jobs/${made.id}`, { method: "PATCH", body, who });
    const [s1] = await json(await patch({ accessUserId: "u_ten" }));
    ck("a tenant of the building can be named on an edit", s1 === 200 && row().access_user_id === "u_ten", JSON.stringify(row()));
    ck("and the access nobody answered becomes the tenant needs to be in", row().access === "tenant", JSON.stringify(row()));
    ck("still never as somebody who asked", row().requested_by === null);
    const [s2, b2] = await json(await patch({ accessUserId: "u_ten2" }));
    ck("a tenant of another building is refused on an edit", s2 === 400 && b2.error === "bad_tenant" && row().access_user_id === "u_ten",
      JSON.stringify({ s2, b2, r: row() }));
    const [s3, b3] = await json(await patch({ accessUserId: "u_far" }));
    ck("and so is another account's", s3 === 400 && b3.error === "bad_tenant", JSON.stringify({ s3, b3 }));
    const [s4] = await json(await patch({ accessUserId: "u_ten2", propertyId: "p_press" }));
    ck("moving the job and naming that building's tenant in one save is checked against the NEW building",
      s4 === 200 && row().access_user_id === "u_ten2", JSON.stringify({ s4, r: row() }));
    await json(await patch({ propertyId: "p_ballard" }));
    ck("moving the job without naming anybody drops a tenant of the old building", row().access_user_id === null, JSON.stringify(row()));
    await json(await patch({ accessUserId: "u_ten" }));
    const [s5] = await json(await patch({ accessUserId: null }));
    ck("and a tenant can be taken off", s5 === 200 && row().access_user_id === null, JSON.stringify(row()));
    const [s6] = await json(await patch({ title: "Renamed" }));
    ck("an edit that says nothing about a tenant leaves them be", s6 === 200, String(s6));
  }
  {
    const { db, env } = seed();
    const [, req] = await json(await call(env, "/api/jobs", { method: "POST", who: "u_ten", body: job() }));
    const [s, b] = await json(await call(env, `/api/jobs/${req.id}`, { method: "PATCH", body: { accessUserId: "u_ten" } }));
    ck("a job a tenant requested cannot have somebody named over them", s === 400 && b.error === "tenant_from_request",
      JSON.stringify({ s, b }));
    const r = db.prepare(`SELECT access_user_id FROM jobs WHERE id = ?`).get(req.id);
    ck("and nothing was written", r.access_user_id === null, JSON.stringify(r));
  }

  console.log("\n-- a database without 062 --");
  {
    const { db, env } = seed({ drop062: true });
    const [st, b] = await json(await call(env, "/api/jobs", { method: "POST",
      body: job({ accessUserId: "u_ten", access: "tenant" }) }));
    ck("still creates the job", st === 201 && count(db) === 1, JSON.stringify({ st, b }));
    const row = db.prepare(`SELECT access FROM jobs WHERE id = ?`).get(b.id);
    ck("and keeps the access answer it can store", row?.access === "tenant", JSON.stringify(row));
  }
} catch (e) {
  ck("the suite ran to the end", false, e?.stack || String(e));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
