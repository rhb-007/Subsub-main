// CRM leads: everybody a general contractor is trying to sell to, from the
// first call to the last job. Migration 107. Sits beside shared/salesappt.js
// (the call script and the appointment) and shared/salescrm.js (consent and
// activity), and is read by the route, the screen and the tests.
//
// A lead is a PERSON (one homeowner, keyed by phone on the account); an
// appointment is one visit to them. One lead can have several appointments,
// and the lead's stage says where the whole relationship is.

import { STATUSES, SERVICE_IDS } from "./salesappt.js";

// The five stages, in order. `term` is the word on screen; `means` is the
// plain sentence the owner gave for it.
export const LEAD_STAGES = [
  { id: "lead", term: "Lead", means: "Not yet qualified" },
  { id: "prospect", term: "Prospect", means: "Potential buyer" },
  { id: "opportunity", term: "Opportunity", means: "Qualified sales opportunity: appointment set" },
  { id: "customer", term: "Customer", means: "Has purchased" },
  { id: "former", term: "Former customer", means: "Previously purchased" },
];
export const STAGE_IDS = LEAD_STAGES.map((s) => s.id);
export const stageTerm = (id) => LEAD_STAGES.find((s) => s.id === id)?.term || id;

// What a call-center seat may set by hand. Opportunity comes from booking an
// appointment, and customer and former customer are the office's word on a
// sale, the same line the appointment outcome draws.
export const CALLCENTER_STAGES = ["lead", "prospect"];

// Where a lead came from. `call_center` is set when a call-center seat books
// or adds one, `api` when one arrives through the API.
export const LEAD_SOURCES = [
  { id: "call_center", label: "Call center" },
  { id: "website", label: "Website" },
  { id: "referral", label: "Referral" },
  { id: "in_person", label: "In person" },
  { id: "event", label: "Home show or event" },
  { id: "api", label: "API / integration" },
  { id: "office", label: "Office" },
  { id: "other", label: "Other" },
];
export const SOURCE_IDS = LEAD_SOURCES.map((s) => s.id);
export const sourceLabel = (id) => LEAD_SOURCES.find((s) => s.id === id)?.label || "Other";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const digits = (v) => String(v ?? "").replace(/\D/g, "");
const str = (v, max = 200) => String(v ?? "").trim().slice(0, max);
export const phoneKey = (p) => digits(p).slice(-10);

// One lead, checked. `role` decides which stages may be set; `current` is the
// stored stage on an edit, so a call-center seat cannot move a customer back
// to a lead. Answers {ok, value} or {ok:false, error, field}.
export function validLead(b, { role = "admin", current = null } = {}) {
  const o = b && typeof b === "object" ? b : {};
  const firstName = str(o.firstName, 80);
  const lastName = str(o.lastName, 80);
  if (!firstName && !lastName) return { ok: false, error: "name_required", field: "firstName" };
  const rawPhone = digits(o.phone);
  const phone = rawPhone.length === 11 && rawPhone.startsWith("1") ? rawPhone.slice(1) : rawPhone;
  if (phone && phone.length !== 10) return { ok: false, error: "bad_phone", field: "phone" };
  const email = str(o.email, 200).toLowerCase();
  if (email && !EMAIL_RE.test(email)) return { ok: false, error: "bad_email", field: "email" };
  if (!phone && !email) return { ok: false, error: "contact_required", field: "phone" };
  const services = Array.isArray(o.services) ? [...new Set(o.services.filter((s) => SERVICE_IDS.includes(s)))] : [];
  const source = SOURCE_IDS.includes(o.source) ? o.source : null;
  let stage = current || "lead";
  if (o.stage !== undefined && o.stage !== current) {
    if (!STAGE_IDS.includes(o.stage)) return { ok: false, error: "bad_stage", field: "stage" };
    if (role === "callcenter") {
      if (!CALLCENTER_STAGES.includes(o.stage)) return { ok: false, error: "stage_sales_only", field: "stage" };
      if (current && !CALLCENTER_STAGES.includes(current)) return { ok: false, error: "stage_sales_only", field: "stage" };
    }
    stage = o.stage;
  }
  const a = o.address && typeof o.address === "object" ? o.address : {};
  return { ok: true, value: {
    firstName, lastName, phone, email, services, source, stage,
    address: { street: str(a.street, 200), city: str(a.city, 80), state: str(a.state, 2).toUpperCase(), zip: digits(a.zip).slice(0, 5) },
    notes: str(o.notes, 4000) || null,
    ownerId: o.ownerId ? String(o.ownerId) : null,
  } };
}

// The stage a lead moves to when one of its appointments changes. Stages
// only move FORWARD on their own, with two exceptions that follow from what
// the words mean: an opportunity with no appointment left open goes back to
// prospect (they were qualified enough to book once), and a sale makes them a
// customer again even if they had been a former customer.
//
// `appts` is every appointment linked to the lead, as {status, jobId}.
export function stageAfterAppointments(current, appts = []) {
  const sold = appts.some((a) => a.status === "sold" || a.jobId);
  const open = appts.some((a) => STATUSES[a.status]?.open);
  const cur = STAGE_IDS.includes(current) ? current : "lead";
  if (sold && (cur === "lead" || cur === "prospect" || cur === "opportunity")) return "customer";
  if (open) return cur === "lead" || cur === "prospect" ? "opportunity" : cur;
  if (cur === "opportunity") return "prospect";
  return cur;
}

// The pipeline counts, in stage order.
export function stageCounts(leads = []) {
  return Object.fromEntries(STAGE_IDS.map((id) => [id, leads.filter((l) => l.stage === id).length]));
}

// The CRM dashboard's figures, from the lists the screen already holds.
// `today` is a YYYY-MM-DD on the reader's clock.
export function crmDashboard({ leads = [], appointments = [], today }) {
  const month = today.slice(0, 7);
  const weekAhead = addDays(today, 7);
  const monthOf = (stamp) => String(stamp || "").replace(" ", "T").slice(0, 7);
  const inMonth = (a) => monthOf(a.statusAt || a.updatedAt) === month;
  const soldMonth = appointments.filter((a) => a.status === "sold" && inMonth(a)).length;
  const lostMonth = appointments.filter((a) => a.status === "lost" && inMonth(a)).length;
  const upcoming = appointments.filter((a) => STATUSES[a.status]?.open && a.date >= today && a.date <= weekAhead)
    .sort((x, y) => `${x.date}${x.time}`.localeCompare(`${y.date}${y.time}`));
  const bySource = {};
  for (const l of leads) bySource[l.source || "other"] = (bySource[l.source || "other"] || 0) + 1;
  return {
    stages: stageCounts(leads),
    newLeadsMonth: leads.filter((l) => monthOf(l.createdAt) === month).length,
    bookedMonth: appointments.filter((a) => monthOf(a.createdAt) === month).length,
    soldMonth, lostMonth,
    // Of the visits that reached a yes or a no this month, the share that
    // was a yes. null with none, because a rate over nothing is not 0%.
    closeRate: soldMonth + lostMonth ? Math.round((soldMonth / (soldMonth + lostMonth)) * 100) : null,
    needsOutcome: appointments.filter((a) => a.date < today && STATUSES[a.status]?.open).length,
    upcoming,
    bySource: Object.entries(bySource).sort((a, b) => b[1] - a[1]),
  };
}

function addDays(day, n) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Where a lead that arrived by booking came from. A call-center seat is the
// call center whatever the homeowner said; otherwise the appointment's own
// "how did you hear about us" answer, where it maps to a lead source.
const FROM_HEARD = { Referral: "referral", Website: "website", Google: "website",
  "Facebook / Instagram": "website", "Door knocking": "in_person", "Home show": "event" };
export function sourceFromBooking(role, heard) {
  if (role === "callcenter") return "call_center";
  return FROM_HEARD[heard] || "office";
}

// A call-center seat's own dashboard: what THEY did today and this month,
// and who is next to ring. `toCall` is every lead or prospect on the account
// with no appointment still open, oldest touch first, because the call
// center works the account's list rather than only the leads it added.
export function callerDashboard({ leads = [], appointments = [], meId = null, today }) {
  const month = today.slice(0, 7);
  const weekAhead = addDays(today, 7);
  const day = (stamp) => String(stamp || "").replace(" ", "T").slice(0, 10);
  const mine = (x) => !!meId && x.createdBy === meId;
  const myLeads = leads.filter(mine);
  const myAppts = appointments.filter(mine);
  const openAppt = new Set(appointments.filter((a) => STATUSES[a.status]?.open).map((a) => a.id));
  const hasOpen = (l) => (l.appointments || []).some((a) => openAppt.has(a.id) || STATUSES[a.status]?.open);
  const toCall = leads.filter((l) => (l.stage === "lead" || l.stage === "prospect") && !hasOpen(l))
    .sort((a, b) => String(a.updatedAt || a.createdAt || "").localeCompare(String(b.updatedAt || b.createdAt || "")));
  const reached = myLeads.filter((l) => ["opportunity", "customer", "former"].includes(l.stage)).length;
  return {
    leadsToday: myLeads.filter((l) => day(l.createdAt) === today).length,
    leadsMonth: myLeads.filter((l) => day(l.createdAt).slice(0, 7) === month).length,
    bookedToday: myAppts.filter((a) => day(a.createdAt) === today).length,
    bookedMonth: myAppts.filter((a) => day(a.createdAt).slice(0, 7) === month).length,
    // Of the leads this seat added, the share that got an appointment. null
    // with none, because a rate over nothing is not 0%.
    bookRate: myLeads.length ? Math.round((reached / myLeads.length) * 100) : null,
    toCall,
    upcoming: myAppts.filter((a) => STATUSES[a.status]?.open && a.date >= today && a.date <= weekAhead)
      .sort((x, y) => `${x.date}${x.time}`.localeCompare(`${y.date}${y.time}`)),
  };
}
