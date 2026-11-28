// 115. A SALE IS A SIGNED ESTIMATE. Nothing is sold, no lead is a customer
// and no job is made from a sale until the homeowner has signed one.
//
// What is pinned:
//   - "sold" by hand is refused without a signed estimate, and allowed with
//     one (for that appointment, or for the lead with no appointment named);
//   - a lead cannot be moved to Customer by hand without one;
//   - a job is made from an appointment only once it is sold;
//   - signing marks the appointment sold and the lead a customer, so the job
//     can then be made from the appointment or from the estimate itself;
//   - an estimate with no appointment becomes a job once (estimate_jobs), and
//     the lead's list says which job;
//   - a draft or a declined estimate is not a sale;
//   - the appointments list says which have a signed estimate;
//   - the job seed is what they signed, without the price.
//
//   node --no-warnings scripts/sale-sign-test.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeD1, makeR2, freshDb } from "./lib/d1-sqlite.mjs";
import { jobSeedFromEstimate, saleStep } from "../shared/estimate.js";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

// --- the rules -----------------------------------------------------------------
const seed0 = jobSeedFromEstimate({ id: "abc123xyz", title: "Full roof", signedAt: "2027-05-01T10:00:00Z", targetStart: "2027-05-20",
  projectType: "residential", items: [{ label: "Shingles", qty: 1, unitCents: 800000 }, { label: "Gutters", qty: 2, unitCents: 40000 }],
  details: [{ label: "Roof size", value: "27 SQ" }], notes: "Gate code 4411", totalCents: 880000 },
  { firstName: "Dana", lastName: "Ruiz", services: ["roofing"], address: { street: "1 Pine", city: "Tacoma", state: "WA", zip: "98406" } });
ck("the job is seeded from what they signed", seed0.trades.join() === "roofing" && seed0.date === "2027-05-20" && seed0.client === "Dana Ruiz"
  && seed0.address === "1 Pine, Tacoma, WA" && /Roof size: 27 SQ/.test(seed0.scope) && /- Shingles/.test(seed0.scope) && /- Gutters \(2\)/.test(seed0.scope)
  && /Gate code/.test(seed0.scope) && /EST-ABC123/.test(seed0.scope), JSON.stringify(seed0));
ck("and carries no price", !/8,?000|\$|880000|800000/.test(seed0.scope), seed0.scope);
ck("the next step: book, write, send, sign, job",
  saleStep({}).step === "book"
  && saleStep({ appointments: [{ status: "booked" }] }).step === "write"
  && saleStep({ appointments: [{ status: "booked" }], estimates: [{ status: "draft" }] }).step === "send"
  && saleStep({ estimates: [{ status: "viewed" }] }).step === "awaiting_signature"
  && saleStep({ estimates: [{ status: "viewed" }, { status: "signed" }] }).step === "create_job"
  && saleStep({ estimates: [{ status: "signed", jobId: "j1" }] }).step === "job");
ck("a withdrawn estimate is not a step, a declined one asks for a new one",
  saleStep({ appointments: [{ status: "booked" }], estimates: [{ status: "void" }] }).step === "write"
  && saleStep({ appointments: [{ status: "booked" }], estimates: [{ status: "declined" }] }).declined === true);

// --- the routes ----------------------------------------------------------------
const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(join(app, "worker", "schema.sql"), "utf8");
globalThis.fetch = async () => new Response(JSON.stringify({ id: "em_1" }), { headers: { "Content-Type": "application/json" } });
const db = freshDb({ base: SCHEMA, migrations: [] });
db.exec(`
  INSERT INTO accounts(id,name,kind,subdomain,plan) VALUES ('acc_gc','Outerhome','general_contractor','outerhome','basic');
  INSERT INTO users(id,name,email) VALUES ('u_admin','Richard Braun','rb@o.test'),('u_sm','Alex Johnson','alex@o.test'),('u_cc','Cara Call','cara@o.test');
  INSERT INTO memberships(id,user_id,account_id,role) VALUES ('m1','u_admin','acc_gc','admin'),('m2','u_sm','acc_gc','sales'),('m3','u_cc','acc_gc','callcenter');
`);
const env = { DB: makeD1(db), FILES: makeR2(), RESEND_API_KEY: "re_t", MAIL_FROM: "x@subsub.work", RESEND_API_BASE: "https://mail.test" };
const call = (path, { method = "GET", body, who = "u_admin" } = {}) => worker.fetch(
  new Request(`https://api.subsub.work${path}`, { method, body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: { "Content-Type": "application/json", "X-User-Id": who, "X-Account-Id": "acc_gc" } }), env);
const pub = (path, { method = "GET", body } = {}) => worker.fetch(new Request(`https://api.subsub.work${path}`,
  { method, body: body ? JSON.stringify(body) : undefined, headers: { "Content-Type": "application/json", "CF-Connecting-IP": "9.9.9.9" } }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];
const booking = (over = {}) => ({
  direction: "inbound", source: "Google", services: ["roofing"],
  details: { roofing: { material: "Asphalt shingle", age: "Over 20 years", leaks: "Yes", stories: "2" } },
  home: { owns: "Yes", timeline: "Within 3 months" },
  homeowner: { firstName: "Dana", lastName: "Ruiz", phone: "(253) 555-0142", email: "dana@home.test" },
  address: { street: "1204 N Pine St", city: "Tacoma", state: "WA", zip: "98406" },
  second: null, date: "2027-12-07", time: "10:00", minutes: 90, repId: "u_sm",
  consent: { email: true, phone: true, text: true, record: null }, ...over,
});
const JOB = { title: "Roof — Dana Ruiz", trades: ["roofing"], date: "2027-12-20", address: "1204 N Pine St, Tacoma, WA", zip: "98406" };

let [s, b] = await json(await call("/api/appointments", { method: "POST", body: booking() }));
const appt = b.appointment?.id, lead = b.lead?.leadId;
ck("an estimate is booked", s === 201 && !!appt && !!lead, JSON.stringify(b).slice(0, 200));

[s, b] = await json(await call(`/api/appointments/${appt}`, { method: "PATCH", who: "u_sm", body: { status: "sold" } }));
ck("sold by hand is refused with no signed estimate", s === 409 && b.error === "estimate_not_signed", `${s} ${JSON.stringify(b)}`);
[s, b] = await json(await call(`/api/sales-leads/${lead}`, { method: "PATCH", body: { stage: "customer" } }));
ck("so is making the lead a customer", s === 409 && b.error === "estimate_not_signed", `${s} ${JSON.stringify(b)}`);
[s, b] = await json(await call("/api/jobs", { method: "POST", body: { ...JOB, fromAppointment: appt } }));
ck("and making the job", s === 409 && b.error === "estimate_not_signed", `${s} ${JSON.stringify(b)}`);
ck("and no job was written", db.prepare(`SELECT COUNT(*) n FROM jobs`).get().n === 0);
[s, b] = await json(await call("/api/appointments"));
ck("the list says it has no signed estimate", b.appointments?.find((a) => a.id === appt)?.estimateSigned === false, JSON.stringify(b.appointments?.[0]).slice(0, 120));

[s, b] = await json(await call(`/api/sales-leads/${lead}/proposals`, { method: "POST", who: "u_sm",
  body: { title: "Roof replacement", appointmentId: appt, targetStart: "2027-12-20", items: [{ label: "Tear off and replace", unit: "14000" }] } }));
const pid = b.proposal?.id;
[s, b] = await json(await call("/api/jobs", { method: "POST", body: { ...JOB, fromEstimate: pid } }));
ck("a draft estimate is not a sale", s === 409 && b.error === "estimate_not_signed", `${s} ${JSON.stringify(b)}`);
[s, b] = await json(await call(`/api/proposals/${pid}/send`, { method: "POST", who: "u_sm" }));
const token = b.proposal?.link?.split("/proposal/")[1];
[s, b] = await json(await call(`/api/appointments/${appt}`, { method: "PATCH", who: "u_sm", body: { status: "sold" } }));
ck("nor is a sent one nobody signed", s === 409 && b.error === "estimate_not_signed");

[s, b] = await json(await pub(`/api/public/proposal/${token}/sign`, { method: "POST", body: { name: "Dana Ruiz", agree: true } }));
ck("they sign it", s === 200 && b.status === "signed", `${s} ${JSON.stringify(b).slice(0, 120)}`);
ck("signing marks the appointment sold and the lead a customer",
  db.prepare(`SELECT status FROM sales_appointments WHERE id = ?`).get(appt).status === "sold"
  && db.prepare(`SELECT stage FROM sales_leads WHERE id = ?`).get(lead).stage === "customer");
[s, b] = await json(await call("/api/appointments"));
ck("the list says it has one now", b.appointments?.find((a) => a.id === appt)?.estimateSigned === true);
[s, b] = await json(await call("/api/jobs", { method: "POST", who: "u_sm", body: { ...JOB, fromEstimate: pid } }));
ck("a sales manager does not make the job", s === 403, `${s} ${JSON.stringify(b).slice(0, 120)}`);
[s, b] = await json(await call("/api/jobs", { method: "POST", body: { ...JOB, fromEstimate: pid } }));
const job1 = b.id;
ck("the office makes the job from the signed estimate", s === 201 && b.fromEstimate?.linked === true && b.fromAppointment?.linked === true, `${s} ${JSON.stringify(b).slice(0, 200)}`);
ck("its appointment points at the job", db.prepare(`SELECT job_id FROM sales_appointments WHERE id = ?`).get(appt).job_id === job1);
[s, b] = await json(await call("/api/jobs", { method: "POST", body: { ...JOB, fromEstimate: pid } }));
ck("a second press makes no second job", s === 409 && b.error === "estimate_already_a_job" && b.jobId === job1, `${s} ${JSON.stringify(b)}`);
[s, b] = await json(await call(`/api/sales-leads/${lead}/proposals`));
ck("the lead's list says which job", b.proposals?.find((x) => x.id === pid)?.jobId === job1, JSON.stringify(b.proposals?.[0]).slice(0, 160));

// An estimate written for the lead with no appointment named.
[s, b] = await json(await call("/api/appointments", { method: "POST", body: booking({ homeowner: { firstName: "Sam", lastName: "Ito", phone: "(253) 555-0199", email: "sam@home.test" } }) }));
const appt2 = b.appointment?.id, lead2 = b.lead?.leadId;
[s, b] = await json(await call(`/api/sales-leads/${lead2}/proposals`, { method: "POST", who: "u_sm",
  body: { title: "Gutters", items: [{ label: "Gutters", unit: "2400" }] } }));
const pid2 = b.proposal?.id;
[s, b] = await json(await call(`/api/proposals/${pid2}/send`, { method: "POST", who: "u_sm" }));
const token2 = b.proposal?.link?.split("/proposal/")[1];
[s, b] = await json(await pub(`/api/public/proposal/${token2}/decline`, { method: "POST", body: { note: "Too much" } }));
[s, b] = await json(await call(`/api/appointments/${appt2}`, { method: "PATCH", who: "u_sm", body: { status: "sold" } }));
ck("a declined estimate is not a sale", s === 409 && b.error === "estimate_not_signed");
[s, b] = await json(await call(`/api/sales-leads/${lead2}/proposals`, { method: "POST", who: "u_sm",
  body: { title: "Gutters, again", items: [{ label: "Gutters", unit: "2100" }] } }));
const pid3 = b.proposal?.id;
[s, b] = await json(await call(`/api/proposals/${pid3}/send`, { method: "POST", who: "u_sm" }));
await pub(`/api/public/proposal/${b.proposal.link.split("/proposal/")[1]}/sign`, { method: "POST", body: { name: "Sam Ito", agree: true } });
[s, b] = await json(await call(`/api/appointments/${appt2}`, { method: "PATCH", who: "u_sm", body: { status: "sold" } }));
ck("a lead's signed estimate with no appointment named lets the appointment be marked sold", s === 200 && b.appointment.status === "sold", `${s} ${JSON.stringify(b).slice(0, 120)}`);
db.exec(`UPDATE sales_appointments SET status = 'booked' WHERE id = '${appt2}'`);
[s, b] = await json(await call("/api/jobs", { method: "POST", body: { ...JOB, title: "Gutters — Sam Ito", fromEstimate: pid3 } }));
const job2 = b.id;
ck("and it becomes a job, linked to the estimate", s === 201 && b.fromEstimate?.linked === true && !b.fromAppointment
  && db.prepare(`SELECT job_id FROM estimate_jobs WHERE proposal_id = ?`).get(pid3)?.job_id === job2, `${s} ${JSON.stringify(b).slice(0, 200)}`);
[s, b] = await json(await call("/api/jobs", { method: "POST", body: { ...JOB, fromEstimate: pid3 } }));
ck("once", s === 409 && b.error === "estimate_already_a_job" && b.jobId === job2);
[s, b] = await json(await call(`/api/sales-leads/${lead2}/proposals`));
ck("its list says which job", b.proposals?.find((x) => x.id === pid3)?.jobId === job2 && !b.proposals.find((x) => x.id === pid2)?.jobId);

// A lead that has bought before may go back to being a customer.
db.exec(`UPDATE sales_leads SET stage = 'former' WHERE id = '${lead2}'`);
[s, b] = await json(await call(`/api/sales-leads/${lead2}`, { method: "PATCH", body: { stage: "customer" } }));
ck("a former customer can be a customer again", s === 200 && b.lead.stage === "customer", `${s} ${JSON.stringify(b).slice(0, 120)}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
