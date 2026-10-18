// Account -> Integrations: the switches, and that OFF is enforced where every
// door's token is read rather than only drawn on a screen.
//
//   node --no-warnings scripts/integrations-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { hookIntegration, integrationEnabled, INTEGRATIONS } from "../shared/integrations.js";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const M048 = readFileSync(new URL("../worker/migrations/048_api.sql", import.meta.url), "utf8");

const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [M048] });
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind,plan) VALUES
      ('acc_gc','Outerhome','outerhome','general_contractor','scale'),
      ('acc_pm','Sound PM','sound','property_manager','scale'),
      ('acc_sub','Bay Roofing','bay','subcontractor','scale');
    INSERT INTO users(id,name,email) VALUES
      ('u_ad','Rae','rae@outerhome.test'), ('u_pm','Pat','pat@outerhome.test'),
      ('u_sa','Sam','sam@sound.test'), ('u_bay','Bo','bo@bay.test');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES
      ('m_ad','u_ad','acc_gc','admin'), ('m_pm','u_pm','acc_gc','pm'),
      ('m_sa','u_sa','acc_pm','admin'), ('m_bay','u_bay','acc_sub','admin');
  `);
  return db;
};

const call = async (env, path, { method = "GET", seat, token, body } = {}) => {
  const headers = { "Content-Type": "application/json" };
  if (seat) { headers["X-User-Id"] = seat.u; headers["X-Account-Id"] = seat.a; }
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await worker.fetch(new Request(`https://api.subsub.work${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const GC = { u: "u_ad", a: "acc_gc" };
const PM = { u: "u_sa", a: "acc_pm" };

const JOB = { externalId: "X-1", title: "Reroof", trades: ["roofing"], date: "2026-11-14",
  address: "14 Alder Way", zip: "98101" };

console.log("\n-- the rules --");
ck("a CRM with its own receiver has its own switch", hookIntegration("jobnimbus") === "jobnimbus");
ck("the generic address is 'other CRMs'", hookIntegration("generic") === "webhooks");
ck("an unknown source still falls under a switch", hookIntegration("acculynx") === "webhooks");
ck("no row is on", integrationEnabled([], "api") === true);
ck("a 0 row is off", integrationEnabled([{ provider: "api", enabled: 0 }], "api") === false);
ck("Hover and Aurora are listed as soon",
  ["hover", "aurora"].every((id) => INTEGRATIONS.find((i) => i.id === id)?.soon));
ck("CompanyCam connects by token, not soon",
  INTEGRATIONS.find((i) => i.id === "companycam")?.connect === "token"
  && !INTEGRATIONS.find((i) => i.id === "companycam")?.soon);

console.log("\n-- the list --");
let DB = seed(), env = { DB: makeD1(DB) };
{
  const r = await call(env, "/api/integrations", { seat: GC });
  const ids = (r.body.integrations || []).map((i) => i.id);
  ck("an admin reads it", r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
  ck("everything is on by default", (r.body.integrations || []).filter((i) => !i.soon).every((i) => i.enabled));
  ck("a GC is not offered inspection apps (no buildings)", !ids.includes("inspection_hooks"), ids.join(","));
  ck("but is offered Zapier and the CRMs", ["api", "jobnimbus", "webhooks"].every((i) => ids.includes(i)));
  const p = await call(env, "/api/integrations", { seat: PM });
  ck("a property manager is offered inspection apps",
    (p.body.integrations || []).some((i) => i.id === "inspection_hooks"));
  const pm = await call(env, "/api/integrations", { seat: { u: "u_pm", a: "acc_gc" } });
  ck("a project manager is refused, as the key panel is", pm.status === 403, String(pm.status));
  const sub = await call(env, "/api/integrations", { seat: { u: "u_bay", a: "acc_sub" } });
  ck("a subcontractor account is refused by name", sub.body.error === "not_a_hiring_account", JSON.stringify(sub.body));
}

console.log("\n-- switching --");
{
  const soon = await call(env, "/api/integrations/hover", { method: "PUT", seat: GC, body: { enabled: true } });
  ck("Hover cannot be switched yet", soon.status === 409 && soon.body.error === "not_available", JSON.stringify(soon.body));
  const ins = await call(env, "/api/integrations/inspection_hooks", { method: "PUT", seat: GC, body: { enabled: false } });
  ck("one the account is not offered answers not_found", ins.status === 404, String(ins.status));
  const bad = await call(env, "/api/integrations/api", { method: "PUT", seat: GC, body: { enabled: "no" } });
  ck("enabled must be a boolean", bad.status === 400, String(bad.status));
  const off = await call(env, "/api/integrations/api", { method: "PUT", seat: GC, body: { enabled: false } });
  ck("an admin turns Zapier off", off.status === 200 &&
    off.body.integrations.find((i) => i.id === "api")?.enabled === false, JSON.stringify(off.body));
  ck("and the feed says who and what",
    !!DB.prepare("SELECT 1 FROM activity WHERE account_id='acc_gc' AND kind='integration' AND text LIKE 'Turned off%'").get());
}

console.log("\n-- off is enforced at the door --");
{
  const m = await call(env, "/api/api-tokens", { method: "POST", seat: GC, body: { name: "Zap" } });
  const TOKEN = m.body.token;
  const j = await call(env, "/api/v1/jobs", { method: "POST", token: TOKEN, body: JOB });
  ck("a job through the API is refused while it is off", j.status === 403 && j.body.error === "integration_paused",
    `${j.status} ${JSON.stringify(j.body)}`);
  ck("and the refusal names where to turn it back on", /Integrations/.test(j.body.message || ""));
  ck("nothing was written", !DB.prepare("SELECT 1 FROM jobs").get());
  const me = await call(env, "/api/v1/me", { token: TOKEN });
  ck("the connection test reads paused too", me.body.error === "integration_paused", JSON.stringify(me.body));
  const bogus = await call(env, "/api/v1/jobs", { method: "POST", token: "ssk_nope", body: JOB });
  ck("a bad token still learns nothing about switches", bogus.body.error === "invalid_token", bogus.body.error);

  // The other doors are not stopped by this switch.
  const g = await call(env, `/api/v1/hooks/generic/${TOKEN}`, { method: "POST", body: JOB });
  ck("the generic webhook is its own switch, still on", g.status === 201, `${g.status} ${JSON.stringify(g.body)}`);
  await call(env, "/api/integrations/webhooks", { method: "PUT", seat: GC, body: { enabled: false } });
  const g2 = await call(env, `/api/v1/hooks/generic/${TOKEN}`, { method: "POST", body: { ...JOB, externalId: "X-2" } });
  ck("and stops once that one is off", g2.body.error === "integration_paused" && g2.body.integration === "webhooks",
    JSON.stringify(g2.body));
  const jn = await call(env, `/api/v1/hooks/jobnimbus/${TOKEN}`, { method: "POST", body: {} });
  ck("JobNimbus is not stopped by the other-CRMs switch", jn.body.error !== "integration_paused", JSON.stringify(jn.body));
  await call(env, "/api/integrations/jobnimbus", { method: "PUT", seat: GC, body: { enabled: false } });
  const jn2 = await call(env, `/api/v1/hooks/jobnimbus/${TOKEN}`, { method: "POST", body: {} });
  ck("but is by its own", jn2.body.error === "integration_paused", JSON.stringify(jn2.body));

  await call(env, "/api/integrations/api", { method: "PUT", seat: GC, body: { enabled: true } });
  const back = await call(env, "/api/v1/jobs", { method: "POST", token: TOKEN, body: { ...JOB, externalId: "X-3" } });
  ck("turning it back on lets it in again", back.status === 201, `${back.status} ${JSON.stringify(back.body)}`);
}

console.log("\n-- the inspection hook --");
{
  const m = await call(env, "/api/api-tokens", { method: "POST", seat: PM, body: { name: "Insp" } });
  await call(env, "/api/integrations/inspection_hooks", { method: "PUT", seat: PM, body: { enabled: false } });
  const r = await call(env, `/api/v1/hooks/generic/${m.body.token}/inspections`, { method: "POST", body: {} });
  ck("an inspection app is refused while its switch is off", r.body.error === "integration_paused", JSON.stringify(r.body));
}

console.log("\n-- a database without 090 --");
{
  const db = seed(); db.exec("DROP TABLE account_integrations"); const e = { DB: makeD1(db) };
  const m = await call(e, "/api/api-tokens", { method: "POST", seat: GC, body: { name: "Zap" } });
  const j = await call(e, "/api/v1/jobs", { method: "POST", token: m.body.token, body: JOB });
  ck("jobs still arrive (a missing table reads as on)", j.status === 201, `${j.status} ${JSON.stringify(j.body)}`);
  const l = await call(e, "/api/integrations", { seat: GC });
  ck("the list names the file", l.body.migration === "090_account_integrations", JSON.stringify(l.body));
  const s = await call(e, "/api/integrations/api", { method: "PUT", seat: GC, body: { enabled: false } });
  ck("and a switch names it", s.status === 503 && s.body.migration === "090_account_integrations", JSON.stringify(s.body));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
