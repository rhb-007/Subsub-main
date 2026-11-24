// 107. CRM LEADS: EVERYBODY THE ACCOUNT IS TRYING TO SELL TO, AND THEIR STAGE.
//
// What is pinned:
//
//   FIVE STAGES, named as the owner named them: Lead (not yet qualified),
//   Prospect (potential buyer), Opportunity (appointment set), Customer (has
//   purchased), Former customer (previously purchased).
//
//   BOOKING IS AN OPPORTUNITY. A call-center seat booking an appointment
//   finds the homeowner's lead by phone, or makes one with source "call
//   center", and moves it to Opportunity. A call-center seat adding somebody
//   with no appointment makes a Lead (or a Prospect) and nothing higher.
//
//   A SALE IS A CUSTOMER, AND NOTHING LEFT OPEN IS A PROSPECT AGAIN. Even a
//   former customer who buys again is a customer.
//
//   ONE PERSON, ONE LEAD, on this account only, and leads also arrive through
//   the API key.
//
//   node --no-warnings scripts/crm-leads-test.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { runCheck } from "./lib/check-sql.mjs";
import { LEAD_STAGES, validLead, stageAfterAppointments, crmDashboard, sourceFromBooking, callerDashboard } from "../shared/leads.js";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(join(app, "worker", "schema.sql"), "utf8");
const TOKEN = "ssk_test_leads_token_0123456789";

const seed = ({ drop107 = false } = {}) => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,kind,subdomain,plan) VALUES
      ('acc_gc','Outerhome','general_contractor','outerhome','scale'),
      ('acc_other','Other Co','general_contractor','otherco','scale'),
      ('acc_pm','Sound PM','property_manager','soundpm','scale');
    INSERT INTO users(id,name,email) VALUES
      ('u_admin','Richard Braun','rb@outerhome.test'),
      ('u_rep','Marcus Hill','marcus@outerhome.test'),
      ('u_cc','Cara Call','cara@outerhome.test'),
      ('u_other','Olive Other','olive@other.test'),
      ('u_pm','Pat Manager','pat@sound.test');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES
      ('m_admin','u_admin','acc_gc','admin'),
      ('m_rep','u_rep','acc_gc','pm'),
      ('m_cc','u_cc','acc_gc','callcenter'),
      ('m_other','u_other','acc_other','admin'),
      ('m_pm','u_pm','acc_pm','admin');
    INSERT INTO api_tokens(id,account_id,name,prefix,token_hash) VALUES
      ('t1','acc_gc','Website','ssk_test','${createHash("sha256").update(TOKEN).digest("hex")}');
  `);
  if (drop107) db.exec(`DROP TABLE sales_lead_links; DROP TABLE sales_leads;`);
  return { db, env: { DB: makeD1(db) } };
};

const call = (env, path, { method = "GET", body, who = "u_cc", acct = "acc_gc", token = null } = {}) => worker.fetch(
  new Request(`https://api.subsub.work${path}`, {
    method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: { "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : { "X-User-Id": who, "X-Account-Id": acct }) },
  }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];

const DAY = "2027-12-07";
const booking = (over = {}) => ({
  direction: "inbound", source: "Google", services: ["roofing"],
  details: { roofing: { material: "Asphalt shingle", age: "Over 20 years", leaks: "Yes", stories: "2" } },
  home: { owns: "Yes", timeline: "Within 3 months" },
  homeowner: { firstName: "Dana", lastName: "Ruiz", phone: "(253) 555-0142", email: "dana@home.test" },
  address: { street: "1204 N Pine St", city: "Tacoma", state: "WA", zip: "98406" },
  second: null, date: DAY, time: "10:00", minutes: 90, repId: "u_rep",
  consent: { email: true, phone: true, text: false, record: null },
  ...over,
});

try {
  console.log("\n-- the rules --");
  {
    ck("five stages, in the owner's words", LEAD_STAGES.map((s) => `${s.term}=${s.means}`).join("|")
      === "Lead=Not yet qualified|Prospect=Potential buyer|Opportunity=Qualified sales opportunity: appointment set|Customer=Has purchased|Former customer=Previously purchased");
    ck("a lead needs a name", validLead({ phone: "2535550100" }).error === "name_required");
    ck("and a way to reach them", validLead({ firstName: "A" }).error === "contact_required");
    ck("a call-center seat cannot make a customer", validLead({ firstName: "A", phone: "2535550100", stage: "customer" }, { role: "callcenter" }).error === "stage_sales_only");
    ck("nor move a customer back to a lead",
      validLead({ firstName: "A", phone: "2535550100", stage: "lead" }, { role: "callcenter", current: "customer" }).error === "stage_sales_only");
    ck("the office may set any stage", validLead({ firstName: "A", phone: "2535550100", stage: "former" }).value.stage === "former");
    ck("an open appointment is an opportunity", stageAfterAppointments("lead", [{ status: "scheduled" }]) === "opportunity");
    ck("a sale is a customer", stageAfterAppointments("opportunity", [{ status: "sold" }]) === "customer");
    ck("nothing open takes an opportunity back to prospect", stageAfterAppointments("opportunity", [{ status: "lost" }]) === "prospect");
    ck("a customer booking again stays a customer", stageAfterAppointments("customer", [{ status: "scheduled" }]) === "customer");
    ck("a former customer is left alone by the list", stageAfterAppointments("former", [{ status: "sold" }]) === "former");
    ck("a call-center booking is a call-center lead", sourceFromBooking("callcenter", "Google") === "call_center"
      && sourceFromBooking("admin", "Google") === "website" && sourceFromBooking("admin", "Mailer") === "office");
    const d = crmDashboard({ today: "2027-12-10",
      leads: [{ stage: "lead", createdAt: "2027-12-01 09:00:00", source: "api" }, { stage: "customer", createdAt: "2027-11-02", source: "call_center" }],
      appointments: [{ status: "sold", statusAt: "2027-12-03 10:00:00", createdAt: "2027-12-01" },
        { status: "lost", statusAt: "2027-12-04 10:00:00", createdAt: "2027-11-20" },
        { status: "scheduled", date: "2027-12-12", time: "09:00", createdAt: "2027-12-05" },
        { status: "scheduled", date: "2027-12-01", time: "09:00", createdAt: "2027-11-25" }] });
    ck("the dashboard counts each stage", d.stages.lead === 1 && d.stages.customer === 1 && d.stages.prospect === 0);
    ck("and this month's sales, losses and close rate", d.soldMonth === 1 && d.lostMonth === 1 && d.closeRate === 50, JSON.stringify(d));
    ck("and the week ahead, and what went by with no outcome", d.upcoming.length === 1 && d.needsOutcome === 1);
    ck("a close rate over nothing is not 0%", crmDashboard({ today: "2027-12-10" }).closeRate === null);
    {
      const today = "2027-12-10";
      const leads = [
        { id: "a", stage: "lead", createdBy: "me", createdAt: "2027-12-10 09:00:00", updatedAt: "2027-12-09 09:00:00", appointments: [] },
        { id: "b", stage: "prospect", createdBy: "other", createdAt: "2027-12-01 09:00:00", updatedAt: "2027-12-01 09:00:00", appointments: [] },
        { id: "c", stage: "prospect", createdBy: "me", createdAt: "2027-11-20 09:00:00", updatedAt: "2027-11-20 09:00:00", appointments: [{ id: "x", status: "scheduled" }] },
        { id: "d", stage: "opportunity", createdBy: "me", createdAt: "2027-12-03T09:00:00Z", appointments: [{ id: "y", status: "sat" }] },
      ];
      const appts = [
        { id: "x", status: "scheduled", date: "2027-12-12", time: "10:00", createdBy: "me", createdAt: "2027-12-10 08:00:00" },
        { id: "y", status: "sat", date: "2027-12-05", time: "09:00", createdBy: "other", createdAt: "2027-12-02 08:00:00" },
      ];
      const d = callerDashboard({ leads, appointments: appts, meId: "me", today });
      ck("the call center's figures are its own seat's", d.leadsToday === 1 && d.leadsMonth === 2 && d.bookedToday === 1 && d.bookedMonth === 1, JSON.stringify(d));
      ck("ready to book is every lead or prospect with nothing open, oldest touch first", d.toCall.map((l) => l.id).join() === "b,a", d.toCall.map((l) => l.id).join());
      ck("a lead with an open appointment is not ready to book again", !d.toCall.some((l) => l.id === "c"));
      ck("its book rate is of its own leads", d.bookRate === 33, String(d.bookRate));
      ck("the week ahead is what it booked", d.upcoming.map((a) => a.id).join() === "x");
      ck("a rate over nothing is not 0%, for the call center too", callerDashboard({ today, meId: "me" }).bookRate === null);
    }
  }

  console.log("\n-- booking makes an opportunity --");
  {
    const { db, env } = seed();
    const [st, b] = await json(await call(env, "/api/appointments", { method: "POST", body: booking() }));
    ck("the call center books", st === 201, `${st} ${JSON.stringify(b)}`);
    ck("and the reply names a new lead at Opportunity", b.lead?.created === true && b.lead?.stage === "opportunity", JSON.stringify(b.lead));
    const lead = db.prepare("SELECT * FROM sales_leads").get();
    ck("the lead is the homeowner, from the call center", lead.first_name === "Dana" && lead.phone === "2535550142" && lead.source === "call_center");
    ck("and it is linked to the appointment", db.prepare("SELECT COUNT(*) n FROM sales_lead_links WHERE lead_id = ?").get(lead.id).n === 1);

    // A second booking for the same phone joins the same lead.
    const [st2, b2] = await json(await call(env, "/api/appointments", { method: "POST",
      body: booking({ date: "2027-12-14", services: ["gutters"], details: { gutters: { scope: "Whole home", stories: "2" } } }) }));
    ck("a second booking for the same phone joins their lead", st2 === 201 && b2.lead?.leadId === lead.id && b2.lead?.created === false,
      `${st2} ${JSON.stringify(b2.lead || b2)}`);
    ck("still one lead", db.prepare("SELECT COUNT(*) n FROM sales_leads").get().n === 1);

    // Both visits lost: nothing open, so back to prospect.
    const appts = db.prepare("SELECT id FROM sales_appointments ORDER BY date").all();
    await call(env, `/api/appointments/${appts[0].id}`, { method: "PATCH", body: { status: "lost" }, who: "u_rep" });
    ck("one lost with one still open stays an opportunity", db.prepare("SELECT stage FROM sales_leads").get().stage === "opportunity");
    const [, lp] = await json(await call(env, `/api/appointments/${appts[1].id}`, { method: "PATCH", body: { status: "lost" }, who: "u_rep" }));
    ck("nothing open is a prospect again", db.prepare("SELECT stage FROM sales_leads").get().stage === "prospect"
      && lp.leadStage?.stage === "prospect", JSON.stringify(lp.leadStage));
    ck("and the move is in the event log", db.prepare("SELECT COUNT(*) n FROM events WHERE kind = 'lead.stage'").get().n >= 2);

    // Reopened and sold.
    await call(env, `/api/appointments/${appts[1].id}`, { method: "PATCH", body: { status: "sat" }, who: "u_rep" });
    ck("a reopened visit is an opportunity again", db.prepare("SELECT stage FROM sales_leads").get().stage === "opportunity");
    await call(env, `/api/appointments/${appts[1].id}`, { method: "PATCH", body: { status: "sold" }, who: "u_rep" });
    ck("a sale is a customer", db.prepare("SELECT stage FROM sales_leads").get().stage === "customer");

    // Former customer who buys again.
    db.prepare("UPDATE sales_leads SET stage = 'former'").run();
    db.prepare("UPDATE sales_appointments SET status = 'sat' WHERE id = ?").run(appts[0].id);
    await call(env, `/api/appointments/${appts[0].id}`, { method: "PATCH", body: { status: "sold" }, who: "u_rep" });
    ck("a former customer who buys again is a customer", db.prepare("SELECT stage FROM sales_leads").get().stage === "customer");
  }

  console.log("\n-- turning a sale into a job makes a customer --");
  {
    const { db, env } = seed();
    const [, b] = await json(await call(env, "/api/appointments", { method: "POST", body: booking() }));
    const [st] = await json(await call(env, "/api/jobs", { method: "POST", who: "u_admin",
      body: { title: "Roof for Dana", trades: ["roofing"], address: "1204 N Pine St", area: "Tacoma", zip: "98406",
        date: "2027-12-20", fromAppointment: b.appointment.id } }));
    ck("the job is made", st === 201, String(st));
    ck("and the lead is a customer", db.prepare("SELECT stage FROM sales_leads").get().stage === "customer");
  }

  console.log("\n-- adding a lead by hand --");
  {
    const { db, env } = seed();
    const [st, b] = await json(await call(env, "/api/sales-leads", { method: "POST",
      body: { firstName: "Lee", lastName: "Park", phone: "253-555-0199", services: ["siding"] } }));
    ck("the call center adds a lead with no appointment", st === 201 && b.lead.stage === "lead" && b.lead.source === "call_center",
      `${st} ${JSON.stringify(b)}`);
    const [st2] = await json(await call(env, "/api/sales-leads", { method: "POST",
      body: { firstName: "Lee", phone: "253-555-0199", stage: "prospect" } }));
    ck("the same phone again is refused by name", st2 === 409);
    const [st3, b3] = await json(await call(env, "/api/sales-leads", { method: "POST",
      body: { firstName: "Max", phone: "253-555-0111", stage: "opportunity" } }));
    ck("the call center cannot make an opportunity by hand", st3 === 403 && b3.error === "stage_sales_only", `${st3} ${JSON.stringify(b3)}`);
    const id = b.lead.id;
    const [st4] = await json(await call(env, `/api/sales-leads/${id}`, { method: "PATCH", body: { stage: "prospect" } }));
    ck("the call center may qualify a lead to prospect", st4 === 200 && db.prepare("SELECT stage FROM sales_leads WHERE id = ?").get(id).stage === "prospect");
    const [st5] = await json(await call(env, `/api/sales-leads/${id}`, { method: "PATCH", body: { stage: "customer" } }));
    ck("and not to customer", st5 === 403);
    const [st6, b6] = await json(await call(env, `/api/sales-leads/${id}`, { method: "PATCH", body: { stage: "former", notes: "Bought in 2019" }, who: "u_admin" }));
    ck("the office may", st6 === 200 && b6.lead.stage === "former" && b6.lead.notes === "Bought in 2019", JSON.stringify(b6));
    ck("and a partial edit keeps the rest", b6.lead.phone === "2535550199" && b6.lead.services.join() === "siding");
    const [st7] = await json(await call(env, `/api/sales-leads/${id}`, { method: "PATCH", body: { stage: "lead" }, who: "u_other", acct: "acc_other" }));
    ck("another account cannot touch it", st7 === 404);
    const [, l8] = await json(await call(env, "/api/sales-leads", { who: "u_other", acct: "acc_other" }));
    ck("nor list it", Array.isArray(l8.leads) && l8.leads.length === 0);
    const [st9] = await json(await call(env, "/api/sales-leads", { who: "u_pm", acct: "acc_pm" }));
    ck("a property manager has no CRM", st9 === 403);

    // A booking for the hand-added lead joins it and makes it an opportunity.
    const [, bk] = await json(await call(env, "/api/appointments", { method: "POST",
      body: booking({ homeowner: { firstName: "Lee", lastName: "Park", phone: "2535550199", email: "" },
        consent: { email: false, phone: true, text: false, record: null }, leadId: id }) }));
    ck("booking the lead links it", bk.lead?.leadId === id, JSON.stringify(bk.lead));
    ck("a former customer booking again is left at former until a sale", db.prepare("SELECT stage FROM sales_leads WHERE id = ?").get(id).stage === "former");
  }

  console.log("\n-- the list --");
  {
    const { db, env } = seed();
    // An appointment booked before 107: no link yet.
    await call(env, "/api/appointments", { method: "POST", body: booking() });
    db.exec("DELETE FROM sales_lead_links; DELETE FROM sales_leads;");
    const [st, b] = await json(await call(env, "/api/sales-leads"));
    ck("an appointment booked before 107 gets its lead on the first read", st === 200 && b.leads.length === 1
      && b.leads[0].stage === "opportunity" && b.leads[0].appointments.length === 1, JSON.stringify(b));
    ck("with its consent", b.leads[0].consent?.email === true && b.leads[0].consent?.text === false);
    const [, b2] = await json(await call(env, "/api/sales-leads"));
    ck("and a second read makes no second lead", b2.leads.length === 1);
    ck("the owners offered are the sales side", b.owners.map((o) => o.id).sort().join() === "u_admin,u_rep");
  }

  console.log("\n-- leads through the API --");
  {
    const { db, env } = seed();
    const [st, b] = await json(await call(env, "/api/v1/leads", { method: "POST", token: TOKEN,
      body: { firstName: "Web", lastName: "Form", email: "web@home.test", services: ["windows"], source: "website" } }));
    ck("a lead arrives by API key", st === 201 && b.stage === "lead", `${st} ${JSON.stringify(b)}`);
    ck("with its source", db.prepare("SELECT source FROM sales_leads").get().source === "website");
    const [st2, b2] = await json(await call(env, "/api/v1/leads", { method: "POST", token: TOKEN,
      body: { firstName: "Web", email: "WEB@home.test" } }));
    ck("the same person again is a duplicate, not a second lead", st2 === 200 && b2.duplicate === true && b2.leadId === b.leadId);
    const [st3] = await json(await call(env, "/api/v1/leads", { method: "POST", token: TOKEN, body: { firstName: "X", phone: "253", stage: "customer" } }));
    ck("a bad phone is refused", st3 === 400);
    const [, b4] = await json(await call(env, "/api/v1/leads", { method: "POST", token: TOKEN,
      body: { firstName: "Y", phone: "2535550177", stage: "customer" } }));
    ck("the API cannot say somebody bought", db.prepare("SELECT stage FROM sales_leads WHERE id = ?").get(b4.leadId)?.stage === "lead");
    const [st5] = await json(await call(env, "/api/v1/leads", { method: "POST", token: "nope", body: { firstName: "Z", phone: "2535550170" } }));
    ck("a bad token is refused", st5 === 401);
  }

  console.log("\n-- without 107 --");
  {
    const { env } = seed({ drop107: true });
    const [st, b] = await json(await call(env, "/api/appointments", { method: "POST", body: booking() }));
    ck("booking still works", st === 201 && b.lead?.migration === "107_crm_leads", `${st} ${JSON.stringify(b.lead)}`);
    const [st2, b2] = await json(await call(env, "/api/sales-leads"));
    ck("the list names the file", st2 === 503 && b2.migration === "107_crm_leads", `${st2} ${JSON.stringify(b2)}`);
  }

  console.log("\n-- CHECK.sql --");
  {
    const { db } = seed();
    const r = runCheck(db);
    ck("both tables are checked", r.m107_sales_leads >= 1 && r.m107_sales_lead_links >= 1, JSON.stringify([r.m107_sales_leads, r.m107_sales_lead_links]));
    ck("a clean database reads zero", r.m107_inv_bad_lead === 0);
    db.exec(`INSERT INTO sales_leads(id,account_id,stage,first_name) VALUES ('lx','acc_gc','hot','X')`);
    ck("a stage the screen cannot draw is counted", runCheck(db).m107_inv_bad_lead === 1);
  }
} catch (err) {
  fail++;
  console.log("FAIL  threw", err?.stack || err);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
