// 113. THE REST OF THE CRM: proposals a homeowner signs from a link, an
// insurance claim on a lead, routing a new lead to a sales manager, tags and
// custom fields, saved views, bulk changes, merging duplicates, files on a
// lead, importing a list, review requests and repeat-business reminders, text
// reminders as follow-ups, and commission per sales manager.
//
// What is pinned:
//
//   A SIGNATURE MARKS THE ESTIMATE SOLD, in the same request, and its deal
//   amount the proposal's total. The total is worked out on the server and the
//   hash is of the stored text. Two presses sign once; an expired, declined or
//   withdrawn proposal cannot be signed.
//
//   ROUTING TAKES TURNS and skips somebody no longer on the account; the
//   person a lead goes to is told the moment it arrives.
//
//   A BULK CHANGE names a lead it cannot reach and changes nothing; moving
//   leads between people is the office's.
//
//   AN IMPORT checks every row before writing any, and skips a duplicate.
//
//   A FILE is only one uploaded under this account's own prefix.
//
//   AFTERCARE sends one review request per sale and makes one repeat-business
//   follow-up, each once.
//
//   A COMMISSION paid is stamped, once, by an admin.
//
//   node --no-warnings scripts/crm-plus-test.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeD1, makeR2, freshDb } from "./lib/d1-sqlite.mjs";
import { runCheck } from "./lib/check-sql.mjs";
import { routeLead, validProposal, proposalSignBlock, validClaim, validBulk, duplicateGroups, mergedLead, parseCsv,
  importRow, guessMapping, validCrmSettings, commissionReport, saleValue, addMonths, validCustomValues,
  validCustomFields, cleanTags, validReviewUrl } from "../shared/crmplus.js";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker, crmAftercareSweep } = await import("../worker/index.js");
const SCHEMA = readFileSync(join(app, "worker", "schema.sql"), "utf8");

const sent = [];
globalThis.fetch = async (input, init = {}) => {
  const url = String(input?.url || input);
  if (url.includes("mail.test")) sent.push(JSON.parse(String(init.body || "{}")));
  return new Response(JSON.stringify({ id: "em_" + sent.length }), { headers: { "Content-Type": "application/json" } });
};
const mailsTo = (addr, re) => sent.filter((m) => [].concat(m.to).includes(addr) && (!re || re.test(m.subject)));

const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,kind,subdomain,plan) VALUES
      ('acc_gc','Outerhome','general_contractor','outerhome','scale'),
      ('acc_x','Other Co','general_contractor','otherco','scale');
    INSERT INTO users(id,name,email) VALUES
      ('u_admin','Richard Braun','rb@outerhome.test'),
      ('u_pm','Pat Manager','pat@outerhome.test'),
      ('u_sm','Sam Seller','sam@outerhome.test'),
      ('u_sm2','Tia Seller','tia@outerhome.test'),
      ('u_cc','Cara Call','cara@outerhome.test');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES
      ('m_admin','u_admin','acc_gc','admin'),
      ('m_pm','u_pm','acc_gc','pm'),
      ('m_sm','u_sm','acc_gc','sales'),
      ('m_sm2','u_sm2','acc_gc','sales'),
      ('m_cc','u_cc','acc_gc','callcenter');
  `);
  return { db, env: { DB: makeD1(db), FILES: makeR2(), RESEND_API_KEY: "re_test", MAIL_FROM: "SubSub <hello@subsub.work>",
    RESEND_API_BASE: "https://mail.test" } };
};
const call = (env, path, { method = "GET", body, who = "u_admin", acct = "acc_gc", ip = "1.1.1.1" } = {}) => worker.fetch(
  new Request(`https://api.subsub.work${path}`, {
    method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: { "Content-Type": "application/json", "X-User-Id": who, "X-Account-Id": acct, "CF-Connecting-IP": ip },
  }), env);
const pub = (env, path, { method = "GET", body, ip = "2.2.2.2" } = {}) => worker.fetch(
  new Request(`https://api.subsub.work${path}`, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip } }), env);
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

try {
  console.log("\n-- the rules --");
  {
    const s = { mode: "round_robin", reps: ["a", "b", "c"], cursor: 0 };
    const one = routeLead(s, { reps: ["a", "b", "c"] });
    const two = routeLead({ ...s, cursor: one.cursor }, { reps: ["a", "b", "c"] });
    ck("round robin takes turns", one.ownerId === "a" && two.ownerId === "b");
    ck("and skips somebody no longer on the account", routeLead({ ...s, cursor: 0 }, { reps: ["b", "c"] }).ownerId === "b");
    ck("by market goes to the market's person", routeLead({ mode: "market", reps: ["a"], marketReps: { m1: "c" } }, { marketId: "m1", reps: ["a", "c"] }).ownerId === "c");
    ck("and a market with nobody falls back to taking turns", routeLead({ mode: "market", reps: ["a"], marketReps: {} }, { marketId: "m2", reps: ["a"] }).ownerId === "a");
    ck("none leaves it unassigned", routeLead({ mode: "none", reps: ["a"] }, { reps: ["a"] }).ownerId === null);
  }
  {
    const p = validProposal({ title: "Roof", items: [{ label: "Tear off", qty: 2, unit: "1,250.50" }, { label: "Permit", unitCents: 15000 }], totalCents: 1 });
    ck("a proposal's total is worked out, not taken", p.ok && p.value.totalCents === 265100, JSON.stringify(p));
    ck("a proposal with no lines is refused", validProposal({ title: "x", items: [] }).error === "items_required");
    ck("a fractional cent quantity is refused", validProposal({ title: "x", items: [{ label: "a", qty: 1.005, unitCents: 100 }] }).error === "bad_qty");
    ck("an expired proposal cannot be signed", proposalSignBlock({ status: "sent", expiresAt: "2020-01-01T00:00:00Z" }) === "expired");
    ck("nor a draft", proposalSignBlock({ status: "draft" }) === "not_sent");
  }
  ck("an approved claim needs its amount", validClaim({ status: "approved" }).error === "approved_amount_required");
  ck("an adjuster meeting must be a real day", validClaim({ adjusterMeeting: "2027-02-30T10:00" }).error === "bad_date");
  ck("a claim reads its money", validClaim({ status: "approved", approved: "$12,000", deductible: "1000" }).value.approvedCents === 1200000);
  ck("reassigning many leads is the office's", validBulk({ ids: ["a"], action: "owner" }, { role: "callcenter" }).error === "office_only");
  ck("tagging many is anybody's", validBulk({ ids: ["a"], action: "tag", tag: "storm" }, { role: "callcenter" }).ok);
  ck("marking many Do not contact needs a reason", validBulk({ ids: ["a"], action: "dnc" }, { role: "admin" }).error === "reason_required");
  {
    const g = duplicateGroups([
      { id: "1", phone: "2535550142", createdAt: "1" }, { id: "2", phone: "(253) 555-0142", createdAt: "2" },
      { id: "3", email: "X@y.com", createdAt: "3" }, { id: "4", email: "x@Y.com", createdAt: "4" },
      { id: "5", firstName: "Al", lastName: "Bo", address: { street: "1 Main" }, createdAt: "5" },
      { id: "6", firstName: "al", lastName: "bo", address: { street: "1 main " }, createdAt: "6" },
      { id: "7", phone: "2065550000", createdAt: "7" },
    ]);
    ck("duplicates are found by phone, email or name at a street", g.length === 3 && g.every((x) => x.length === 2), JSON.stringify(g.map((x) => x.map((l) => l.id))));
  }
  {
    const m = mergedLead({ firstName: "Dana", phone: "", stage: "lead", services: ["roofing"], tags: ["a"] },
      { firstName: "Danielle", phone: "2535550142", stage: "customer", services: ["siding"], tags: ["b", "A"] });
    ck("a merge keeps its own answers and fills the blanks", m.firstName === "Dana" && m.phone === "2535550142");
    ck("and keeps the further-along stage and both services and tags", m.stage === "customer" && m.services.length === 2 && m.tags.length === 2);
  }
  {
    const rows = parseCsv('Name,Phone,Email\n"Ruiz, Dana",253-555-0142,d@x.com\n\n"Bo ""Al"" Lee",,a@x.com\n');
    ck("a CSV with quoted commas and quotes is read", rows.length === 3 && rows[1][0] === "Ruiz, Dana" && rows[2][0] === 'Bo "Al" Lee');
    const map = guessMapping(rows[0]);
    const r = importRow(rows[2], map);
    ck("a full name column splits into first and last", r.firstName === 'Bo "Al"' && r.lastName === "Lee", JSON.stringify(r));
  }
  ck("settings refuse a rep not on the account", validCrmSettings({ routingReps: ["zz"] }, { reps: ["a"] }).error === "bad_rep");
  ck("and a commission past 50%", validCrmSettings({ commissionPct: "60" }).error === "bad_commission");
  ck("a review link must be a web address", validReviewUrl("javascript:alert(1)") === undefined && validReviewUrl("g.page/r/abc").startsWith("https://"));
  ck("custom values follow their field", validCustomValues([{ key: "roof_age", type: "number" }], { roof_age: "abc" }).error === "bad_value"
    && validCustomValues([], { nope: 1 }).error === "unknown_field");
  ck("a select needs two options", validCustomFields([{ label: "Kind", type: "select", options: ["a"] }]).error === "options_required");
  ck("tags dedupe and cap", cleanTags(["Storm", "storm", " ", "x".repeat(40)]).length === 2);
  ck("a month on from the 31st lands on the month's last day", addMonths("2027-01-31", 1) === "2027-02-28");
  ck("commission is worked out from the job when the account says so", saleValue({ proposalCents: 100, jobCents: 90, basis: "job" }).source === "job"
    && saleValue({ proposalCents: 100, jobCents: 90 }).source === "proposal");
  {
    const rep = commissionReport([{ repId: "r", repName: "R", proposalCents: 1000000 }, { repId: "r", dealCents: null }],
      { commissionBps: 500, repCommissionBps: { r: 1000 }, commissionBasis: "sale" });
    ck("a rep's own rate outranks the default, and an unpriced sale is counted", rep[0].owedCents === 100000 && rep[0].unpriced === 1);
  }

  console.log("\n-- a proposal, signed from a link --");
  const { db, env } = seed();
  let [st, b] = await json(await call(env, "/api/appointments", { method: "POST", body: booking() }));
  const appt = b.appointment?.id;
  const lead = b.lead?.leadId;
  ck("an estimate is booked", st === 201 && !!lead, JSON.stringify(b).slice(0, 200));
  [st, b] = await json(await call(env, `/api/sales-leads/${lead}/proposals`, { method: "POST", who: "u_cc",
    body: { title: "Roof replacement", items: [{ label: "Roof", unit: "14800" }] } }));
  ck("a contact-center seat cannot write one", st === 403, JSON.stringify(b));
  [st, b] = await json(await call(env, `/api/sales-leads/${lead}/proposals`, { method: "POST", who: "u_sm",
    body: { title: "Roof replacement", appointmentId: appt, items: [{ label: "Tear off and replace", unit: "14000" }, { label: "Gutters", qty: 2, unit: "400" }], totalCents: 5 } }));
  const pid = b.proposal?.id;
  ck("the sales manager writes one, totaled on the server", st === 201 && b.proposal.totalCents === 1480000 && b.proposal.status === "draft" && !b.proposal.link,
    JSON.stringify(b).slice(0, 200));
  [st, b] = await json(await call(env, `/api/proposals/${pid}`, { method: "PATCH", who: "u_sm2", body: { title: "x" } }));
  ck("another sales manager cannot reach it", st === 404, JSON.stringify(b));
  [st, b] = await json(await call(env, `/api/proposals/${pid}/send`, { method: "POST", who: "u_sm" }));
  const link = b.proposal?.link || "";
  const token = link.split("/proposal/")[1];
  ck("sending emails the homeowner the link", st === 200 && b.emailed?.ok && mailsTo("dana@home.test", /^Your estimate from/i).length === 1 && /^[a-z0-9]{32}$/.test(token || ""),
    JSON.stringify(b).slice(0, 300));
  [st, b] = await json(await call(env, `/api/proposals/${pid}`, { method: "PATCH", who: "u_sm", body: { title: "Changed" } }));
  ck("a sent proposal is not edited under them", st === 409 && b.error === "not_a_draft");
  [st, b] = await json(await pub(env, `/api/public/proposal/${token}`));
  ck("the homeowner opens it with no account", st === 200 && b.totalCents === 1480000 && b.account.name === "Outerhome" && b.homeowner === "Dana Ruiz" && !b.block,
    JSON.stringify(b).slice(0, 200));
  ck("and it carries no ids", !("id" in b) && !("leadId" in b) && !JSON.stringify(b).includes(lead));
  ck("opening marks it opened", db.prepare(`SELECT status FROM sales_proposals WHERE id = ?`).get(pid).status === "viewed");
  [st, b] = await json(await pub(env, `/api/public/proposal/${token}/sign`, { method: "POST", body: { name: "Dana", agree: true } }));
  ck("one word is not a signature", st === 400 && b.error === "full_name_required");
  [st, b] = await json(await pub(env, `/api/public/proposal/${token}/sign`, { method: "POST", body: { name: "Dana Ruiz" } }));
  ck("nor is a name without agreeing", st === 400 && b.error === "agree_required");
  [st, b] = await json(await pub(env, `/api/public/proposal/${token}/sign`, { method: "POST", body: { name: "Dana Ruiz", agree: true, hash: "forged" } }));
  ck("they sign it", st === 200 && b.status === "signed" && b.signerName === "Dana Ruiz", JSON.stringify(b).slice(0, 200));
  {
    const p = db.prepare(`SELECT * FROM sales_proposals WHERE id = ?`).get(pid);
    const a = db.prepare(`SELECT status FROM sales_appointments WHERE id = ?`).get(appt);
    const d = db.prepare(`SELECT amount_cents FROM sales_deals WHERE appointment_id = ?`).get(appt);
    const l = db.prepare(`SELECT stage FROM sales_leads WHERE id = ?`).get(lead);
    ck("the hash is of the stored text, not the request's", /^[0-9a-f]{64}$/.test(p.signed_hash) && p.signed_hash !== "forged");
    ck("the estimate is marked sold", a.status === "sold");
    ck("its deal amount is the proposal's total", d?.amount_cents === 1480000);
    ck("and the lead is a customer", l.stage === "customer");
    ck("whoever sent it is told", mailsTo("sam@outerhome.test", /Signed/).length === 1);
  }
  [st, b] = await json(await pub(env, `/api/public/proposal/${token}/sign`, { method: "POST", body: { name: "Dana Ruiz", agree: true } }));
  ck("a second press signs nothing", st === 409 && b.error === "already_signed");
  ck("the invariant reads zero", runCheck(db).m113_inv_signed_unsold === 0);
  db.prepare(`UPDATE sales_appointments SET status = 'scheduled' WHERE id = ?`).run(appt);
  ck("and counts a signed proposal over an estimate not sold", runCheck(db).m113_inv_signed_unsold === 1);
  db.prepare(`UPDATE sales_appointments SET status = 'sold' WHERE id = ?`).run(appt);
  [st, b] = await json(await pub(env, `/api/public/proposal/${"z".repeat(32)}`));
  ck("an unknown link is not found", st === 404);
  {
    [st, b] = await json(await call(env, `/api/sales-leads/${lead}/proposals`, { method: "POST", who: "u_admin",
      body: { title: "Gutters", items: [{ label: "Gutters", unit: "900" }] } }));
    const p2 = b.proposal.id;
    await call(env, `/api/proposals/${p2}/send`, { method: "POST", body: { email: false } });
    const t2 = db.prepare(`SELECT token FROM sales_proposals WHERE id = ?`).get(p2).token;
    db.prepare(`UPDATE sales_proposals SET expires_at = '2020-01-01T00:00:00Z' WHERE id = ?`).run(p2);
    [st, b] = await json(await pub(env, `/api/public/proposal/${t2}/sign`, { method: "POST", body: { name: "Dana Ruiz", agree: true } }));
    ck("an expired proposal is refused", st === 409 && b.error === "expired");
    db.prepare(`UPDATE sales_proposals SET expires_at = '2099-01-01T00:00:00Z' WHERE id = ?`).run(p2);
    [st, b] = await json(await pub(env, `/api/public/proposal/${t2}/decline`, { method: "POST", body: { note: "Too much" } }));
    ck("a homeowner can decline", st === 200 && b.status === "declined");
    [st, b] = await json(await call(env, `/api/proposals/${p2}/void`, { method: "POST" }));
    ck("a declined one cannot be withdrawn", st === 409);
  }

  console.log("\n-- an insurance claim --");
  [st, b] = await json(await call(env, `/api/sales-leads/${lead}/claim`, { method: "PUT", who: "u_cc", body: { status: "approved" } }));
  ck("approved with no amount is refused", st === 400 && b.error === "approved_amount_required");
  [st, b] = await json(await call(env, `/api/sales-leads/${lead}/claim`, { method: "PUT", who: "u_cc",
    body: { status: "adjuster_scheduled", carrier: "State Farm", claimNumber: "SF-123", adjusterName: "Lee Ames",
      adjusterPhone: "253-555-0199", adjusterMeeting: "2027-12-10T09:30", approved: "", deductible: "1000" } }));
  ck("a claim is saved", st === 200 && b.claim.carrier === "State Farm" && b.claim.adjusterPhone === "2535550199"
    && b.claim.deductibleCents === 100000 && b.claim.adjusterMeeting === "2027-12-10T09:30", JSON.stringify(b));
  [st, b] = await json(await call(env, `/api/sales-leads/${lead}/claim`, { acct: "acc_x", who: "u_admin" }));
  ck("another account cannot read it", st !== 200);

  console.log("\n-- routing a new lead --");
  [st, b] = await json(await call(env, "/api/crm-settings", { method: "PUT", who: "u_sm", body: { routingMode: "round_robin" } }));
  ck("a sales manager cannot change routing", st === 403);
  [st, b] = await json(await call(env, "/api/crm-settings", { method: "PUT", body: { routingMode: "round_robin", routingReps: ["u_sm", "u_sm2"] } }));
  ck("the office turns it on", st === 200 && b.routingMode === "round_robin" && b.routingReps.length === 2, JSON.stringify(b));
  sent.length = 0;
  const mk = async (first, phone) => json(await call(env, "/api/sales-leads", { method: "POST", who: "u_cc",
    body: { firstName: first, lastName: "Test", phone, stage: "lead" } }));
  const [, l1] = await mk("Ann", "2065550101");
  const [, l2] = await mk("Ben", "2065550102");
  const own = (id) => db.prepare(`SELECT owner_id FROM sales_leads WHERE id = ?`).get(id).owner_id;
  ck("leads take turns between sales managers", own(l1.lead.id) === "u_sm" && own(l2.lead.id) === "u_sm2", `${own(l1.lead.id)} ${own(l2.lead.id)}`);
  ck("and each owner is told at once", mailsTo("sam@outerhome.test", /New lead for you/).length === 1 && mailsTo("tia@outerhome.test", /New lead for you/).length === 1);
  await call(env, "/api/crm-settings", { method: "PUT", body: { alertNewLeads: false } });
  sent.length = 0;
  const [, l3] = await mk("Cal", "2065550103");
  ck("with alerts off, it is routed and nobody is emailed", own(l3.lead.id) === "u_sm" && sent.length === 0);

  console.log("\n-- tags, custom fields, saved views, bulk --");
  await call(env, "/api/crm-settings", { method: "PUT", body: { customFields: [{ label: "Roof age", type: "number" }, { label: "HOA", type: "yesno" }] } });
  [st, b] = await json(await call(env, `/api/sales-leads/${l1.lead.id}/meta`, { method: "PUT", who: "u_cc", body: { custom: { roof_age: "old" } } }));
  ck("a custom value is checked against its field", st === 400 && b.error === "bad_value");
  [st, b] = await json(await call(env, `/api/sales-leads/${l1.lead.id}/meta`, { method: "PUT", who: "u_cc", body: { tags: ["Storm 2027"], custom: { roof_age: 22, hoa: true } } }));
  ck("tags and custom values are saved", st === 200 && b.tags[0] === "Storm 2027" && b.custom.roof_age === 22);
  [st, b] = await json(await call(env, "/api/sales-leads"));
  ck("and the list carries them", b.leads.find((x) => x.id === l1.lead.id)?.tags?.[0] === "Storm 2027" && b.plusReady === true);
  [st, b] = await json(await call(env, "/api/crm-views", { method: "POST", who: "u_cc", body: { name: "Storm leads", filters: { tag: "Storm 2027", stage: "nope" } } }));
  ck("a view with a stage that does not exist is refused", st === 400);
  [st, b] = await json(await call(env, "/api/crm-views", { method: "POST", who: "u_cc", body: { name: "Storm leads", filters: { tag: "Storm 2027" } } }));
  const vid = b.view?.id;
  [st, b] = await json(await call(env, "/api/crm-views", { who: "u_sm" }));
  ck("a saved view is the person's own", b.views.length === 0);
  [st, b] = await json(await call(env, `/api/crm-views/${vid}`, { method: "DELETE", who: "u_sm" }));
  ck("and nobody else deletes it", st === 404);
  [st, b] = await json(await call(env, "/api/sales-leads/bulk", { method: "POST", who: "u_cc", body: { ids: [l1.lead.id, l2.lead.id], action: "owner", ownerId: "u_sm" } }));
  ck("a contact-center seat cannot reassign", st === 403);
  [st, b] = await json(await call(env, "/api/sales-leads/bulk", { method: "POST", body: { ids: [l1.lead.id, "nope"], action: "owner", ownerId: "u_sm2" } }));
  ck("a lead it cannot reach is named and nothing changes", st === 404 && b.leadId === "nope" && own(l1.lead.id) === "u_sm");
  [st, b] = await json(await call(env, "/api/sales-leads/bulk", { method: "POST", body: { ids: [l1.lead.id, l2.lead.id, l3.lead.id], action: "owner", ownerId: "u_sm2" } }));
  ck("the office reassigns many at once", st === 200 && b.changed === 3 && own(l1.lead.id) === "u_sm2" && own(l3.lead.id) === "u_sm2");
  [st, b] = await json(await call(env, "/api/sales-leads/bulk", { method: "POST", who: "u_cc", body: { ids: [l2.lead.id, l3.lead.id], action: "tag", tag: "Spring" } }));
  ck("anybody tags many at once", st === 200 && b.changed === 2);
  [st, b] = await json(await call(env, "/api/sales-leads/bulk", { method: "POST", body: { ids: [l3.lead.id], action: "dnc", reason: "Asked us to stop" } }));
  ck("and the office marks many Do not contact", st === 200 && !!db.prepare(`SELECT dnc_at FROM lead_opt_outs WHERE lead_id = ?`).get(l3.lead.id)?.dnc_at);

  console.log("\n-- a text they sent, logged by hand --");
  [st, b] = await json(await call(env, `/api/sales-leads/${l3.lead.id}/messages`, { method: "POST", who: "u_cc",
    body: { channel: "text", direction: "inbound", body: "Can you come Thursday instead?" } }));
  ck("logging their text needs no consent and is allowed under Do not contact", st === 201 && b.message?.direction === "inbound", JSON.stringify(b).slice(0, 200));
  [st, b] = await json(await call(env, `/api/sales-leads/${l3.lead.id}/messages`, { method: "POST", who: "u_cc",
    body: { channel: "text", body: "Hi again" } }));
  ck("but a text to them still is refused", st === 409 || st === 400, JSON.stringify(b));

  console.log("\n-- merging duplicates --");
  {
    db.prepare(`INSERT INTO sales_leads (id, account_id, stage, first_name, last_name, email, notes) VALUES ('dupe', 'acc_gc', 'lead', 'Dana', 'R', 'dana@home.test', 'Called twice')`).run();
    db.prepare(`INSERT INTO lead_messages (id, account_id, lead_id, channel, direction, body, status, created_at) VALUES ('msg1','acc_gc','dupe','note','outbound','hi','logged','2027-01-01')`).run();
    [st, b] = await json(await call(env, `/api/sales-leads/${lead}/merge`, { method: "POST", who: "u_sm", body: { dropId: "dupe" } }));
    ck("merging is the office's", st === 403);
    [st, b] = await json(await call(env, `/api/sales-leads/${lead}/merge`, { method: "POST", body: { dropId: "dupe" } }));
    ck("the office merges two leads into one", st === 200 && !db.prepare(`SELECT 1 FROM sales_leads WHERE id = 'dupe'`).get());
    ck("and what the other held moves with it", db.prepare(`SELECT lead_id FROM lead_messages WHERE id = 'msg1'`).get().lead_id === lead
      && /Called twice/.test(db.prepare(`SELECT notes FROM sales_leads WHERE id = ?`).get(lead).notes || ""));
    ck("and the merge is logged with what it held", !!db.prepare(`SELECT 1 FROM events WHERE kind = 'lead.merged' AND subject_id = ?`).get(lead));
  }

  console.log("\n-- importing a list --");
  {
    const before = db.prepare(`SELECT COUNT(*) AS n FROM sales_leads`).get().n;
    [st, b] = await json(await call(env, "/api/sales-leads/import", { method: "POST", body: { rows: [
      { firstName: "Imp", lastName: "One", phone: "3605550001" }, { firstName: "", lastName: "", phone: "3605550002" } ] } }));
    ck("a bad row refuses the file by number and writes nothing", st === 400 && b.row === 2 && db.prepare(`SELECT COUNT(*) AS n FROM sales_leads`).get().n === before);
    [st, b] = await json(await call(env, "/api/sales-leads/import", { method: "POST", who: "u_cc", body: { rows: [{ firstName: "x", phone: "3605550009" }] } }));
    ck("importing is the office's", st === 403);
    [st, b] = await json(await call(env, "/api/sales-leads/import", { method: "POST", body: { source: "event", tag: "Home show", rows: [
      { firstName: "Imp", lastName: "One", phone: "3605550001" }, { firstName: "Imp", lastName: "Two", phone: "3605550002", tags: ["Hot"] },
      { firstName: "Imp", lastName: "Again", phone: "360-555-0001" }, { firstName: "Ann", lastName: "Test", phone: "2065550101" } ] } }));
    ck("good rows are added and duplicates skipped by name", st === 201 && b.created === 2 && b.skipped.length === 2
      && b.skipped.some((s) => s.why === "twice_in_file") && b.skipped.some((s) => s.why === "already_a_lead"), JSON.stringify(b));
    const imp = db.prepare(`SELECT l.id, l.source, l.owner_id, m.tags FROM sales_leads l LEFT JOIN lead_meta m ON m.lead_id = l.id WHERE l.last_name = 'Two'`).get();
    ck("each carries the source, the file's tag, and is routed", imp.source === "event" && /Home show/.test(imp.tags) && /Hot/.test(imp.tags) && !!imp.owner_id, JSON.stringify(imp));
  }

  console.log("\n-- files on a lead --");
  [st, b] = await json(await call(env, `/api/sales-leads/${lead}/files`, { method: "POST", who: "u_cc",
    body: { files: [{ key: "acc_x/measurement-doc/abc-report.pdf", name: "report.pdf" }] } }));
  ck("a key under another account's prefix is refused", st === 400 && b.error === "not_uploaded");
  await env.FILES.put("acc_gc/measurement-doc/u1-hover.pdf", "PDFBYTES", { httpMetadata: { contentType: "application/pdf" } });
  [st, b] = await json(await call(env, `/api/sales-leads/${lead}/files`, { method: "POST", who: "u_cc",
    body: { files: [{ key: "acc_gc/measurement-doc/u1-hover.pdf", name: "hover.pdf", type: "application/pdf", kind: "measurement" }] } }));
  ck("an upload is attached", st === 201 && b.files.length === 1 && b.files[0].kind === "measurement");
  const fid = b.files?.[0]?.id;
  {
    const r = await call(env, `/api/sales-leads/${lead}/files/${fid}`, { who: "u_cc" });
    ck("and served back", r.status === 200 && (await r.text()) === "PDFBYTES" && r.headers.get("X-Content-Type-Options") === "nosniff");
    const r2 = await call(env, `/api/sales-leads/${lead}/files/${fid}`, { who: "u_sm2" });
    ck("not to a sales manager whose lead it is not", r2.status === 404);
  }

  console.log("\n-- aftercare: a text reminder, a review request, a repeat reminder --");
  {
    const now = Date.parse("2027-12-06T15:00:00Z");
    const [, bk] = await json(await call(env, "/api/appointments", { method: "POST", body: booking({
      homeowner: { firstName: "Eli", lastName: "Fox", phone: "2535550300", email: "eli@home.test" }, date: "2027-12-07", time: "13:00" }) }));
    let r = await crmAftercareSweep(env, now);
    const fu = db.prepare(`SELECT * FROM lead_followups WHERE lead_id = ? AND channel = 'text'`).all(bk.lead.leadId);
    ck("tomorrow's estimate gets a text reminder to send", r.texts >= 1 && fu.length === 1 && fu[0].assignee_id === "u_sm" && /reminder/i.test(fu[0].body), JSON.stringify(r));
    r = await crmAftercareSweep(env, now);
    ck("once", db.prepare(`SELECT COUNT(*) AS n FROM lead_followups WHERE lead_id = ? AND channel = 'text'`).get(bk.lead.leadId).n === 1);
    db.prepare(`INSERT INTO jobs (id, account_id, title, status, completed_at) VALUES ('job1','acc_gc','Roof','completed','2027-12-01')`).run();
    db.prepare(`UPDATE sales_appointments SET job_id = 'job1' WHERE id = ?`).run(appt);
    sent.length = 0;
    r = await crmAftercareSweep(env, now);
    ck("with no review link, nothing is asked", r.reviews === 0 && mailsTo("dana@home.test").length === 0);
    await call(env, "/api/crm-settings", { method: "PUT", body: { reviewUrl: "g.page/r/outerhome/review", reviewDelayDays: 3, repeatMonths: 11 } });
    r = await crmAftercareSweep(env, now);
    ck("a few days after the job, they are asked for a review", r.reviews === 1 && mailsTo("dana@home.test", /review/i).length === 1, JSON.stringify(r));
    r = await crmAftercareSweep(env, now + 86400000);
    ck("once per sale", r.reviews === 0 && mailsTo("dana@home.test", /review/i).length === 1);
    r = await crmAftercareSweep(env, Date.parse("2028-11-08T15:00:00Z"));
    const rep = db.prepare(`SELECT * FROM lead_followups WHERE lead_id = ? AND body LIKE 'Check in%'`).all(lead);
    ck("eleven months on, a repeat-business follow-up", r.repeats >= 1 && rep.length === 1, JSON.stringify(r));
  }

  console.log("\n-- commission --");
  {
    [st, b] = await json(await call(env, "/api/crm-commissions", { who: "u_cc" }));
    ck("a contact-center seat does not see commission", st === 403);
    await call(env, "/api/crm-settings", { method: "PUT", body: { commissionPct: "5", repCommissionPct: { u_sm: "8" } } });
    [st, b] = await json(await call(env, "/api/crm-commissions", { who: "u_sm" }));
    const row = b.report?.[0]?.rows?.[0];
    ck("a sale's commission is the rep's rate times the signed proposal", st === 200 && row?.valueSource === "proposal" && row.amountCents === 118400, JSON.stringify(b).slice(0, 300));
    [st, b] = await json(await call(env, `/api/crm-commissions/${appt}/pay`, { method: "POST", who: "u_sm" }));
    ck("a sales manager cannot mark their own paid", st === 403);
    [st, b] = await json(await call(env, `/api/crm-commissions/${appt}/pay`, { method: "POST", body: { reference: "Check 1042" } }));
    ck("an admin marks it paid", st === 200 && b.amountCents === 118400);
    await call(env, "/api/crm-settings", { method: "PUT", body: { repCommissionPct: { u_sm: "20" } } });
    [st, b] = await json(await call(env, "/api/crm-commissions"));
    ck("a rate changed afterwards does not rewrite what was paid", b.report[0].paidCents === 118400 && b.report[0].owedCents === 0, JSON.stringify(b.report[0]));
    [st, b] = await json(await call(env, `/api/crm-commissions/${appt}/pay`, { method: "POST" }));
    ck("and it is paid once", st === 409 && b.error === "already_paid");
  }
} catch (err) {
  console.error(err);
  fail++;
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
