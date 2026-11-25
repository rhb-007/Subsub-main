// 110. The CRM's selling half: what an estimate is worth and why one was lost,
// the reports built from that, a homeowner's way out of our email (and the
// office's "never contact them"), saved email templates with short follow-up
// sequences, and the form an account puts on its own website so homeowners
// land in the CRM as leads. Read by the Worker, the screen and the tests, so
// the three cannot disagree.

import { STATUSES } from "./salesappt.js";
import { LEAD_SOURCES } from "./leads.js";

const str = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const realDay = (d) => {
  if (!DAY_RE.test(String(d || ""))) return false;
  const t = new Date(`${d}T12:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
};

// ---------------------------------------------------------------------------
// 1. Deal value and why a deal was lost.
// ---------------------------------------------------------------------------

// Why an estimate did not sell. A fixed list, because a report over free text
// is a report nobody can read; "Other" carries a note.
export const LOST_REASONS = [
  { id: "price", label: "Price" },
  { id: "competitor", label: "Went with another company" },
  { id: "timing", label: "Not the right time" },
  { id: "no_decision", label: "No decision / stopped answering" },
  { id: "financing", label: "Couldn't get financing" },
  { id: "insurance", label: "Insurance didn't cover it" },
  { id: "diy", label: "Doing it themselves" },
  { id: "scope", label: "Not work we do" },
  { id: "other", label: "Other" },
];
export const LOST_REASON_IDS = LOST_REASONS.map((r) => r.id);
export const lostReasonLabel = (id) => LOST_REASONS.find((r) => r.id === id)?.label || "No reason given";

// $10 million. A figure past this is a slipped decimal, not a roof.
export const MAX_DEAL_CENTS = 1_000_000_000;

// Dollars as typed ("$12,450.50", "12450") to whole cents. null for blank;
// undefined for something that is not a number.
export function dollarsToCents(v) {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const s = String(v).replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return undefined;
  return Math.round(Number(s) * 100);
}

// A deal, checked. Answers {ok, value} or {ok:false, error, field}. Every key
// is optional, so the screen sends only what it shows.
export function validDeal(raw) {
  const o = raw && typeof raw === "object" ? raw : {};
  const value = {};
  if ("amount" in o) {
    const c = dollarsToCents(o.amount);
    if (c === undefined || (c !== null && (c < 0 || c > MAX_DEAL_CENTS))) return { ok: false, error: "bad_amount", field: "amount" };
    value.amountCents = c;
  }
  if ("expectedClose" in o) {
    const d = o.expectedClose ? String(o.expectedClose) : null;
    if (d && !realDay(d)) return { ok: false, error: "bad_date", field: "expectedClose" };
    value.expectedClose = d;
  }
  if ("lostReason" in o) {
    const r = o.lostReason || null;
    if (r && !LOST_REASON_IDS.includes(r)) return { ok: false, error: "bad_lost_reason", field: "lostReason" };
    value.lostReason = r;
  }
  if ("lostNote" in o) value.lostNote = str(o.lostNote, 1000) || null;
  return { ok: true, value };
}

export const centsText = (c) => (c == null ? "" : `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })}`);

// ---------------------------------------------------------------------------
// 2. Reports. Pure, from the lists the screen already holds: appointments
// (each with its deal) and leads. Everything is narrowed for a sales manager
// by the routes that produced those lists, so their report is their own.
// ---------------------------------------------------------------------------

const monthOf = (stamp) => String(stamp || "").replace(" ", "T").slice(0, 7);
const dayOf = (stamp) => String(stamp || "").replace(" ", "T").slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(`${dayOf(b)}T12:00:00Z`) - Date.parse(`${dayOf(a)}T12:00:00Z`)) / 86400000);
const rate = (yes, no) => (yes + no ? Math.round((yes / (yes + no)) * 100) : null);
const amountOf = (a) => (a.deal && Number.isFinite(a.deal.amountCents) ? a.deal.amountCents : 0);
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

// The last `n` months ending with `today`'s, oldest first.
export function lastMonths(today, n = 6) {
  const [y, m] = today.slice(0, 7).split("-").map(Number);
  const out = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

export function salesReport({ leads = [], appointments = [], today, months = 6 }) {
  const live = appointments.filter((a) => a.status !== "cancelled");
  const open = live.filter((a) => STATUSES[a.status]?.open);
  const sold = live.filter((a) => a.status === "sold");
  const lost = live.filter((a) => a.status === "lost");
  const leadOfAppt = new Map();
  for (const l of leads) for (const ap of l.appointments || []) leadOfAppt.set(ap.id, l);

  // The pipeline: what is still open and what it is worth. An open estimate
  // with no amount on it is counted and said, never valued at nothing quietly.
  const pipeline = {
    open: open.length,
    valueCents: open.reduce((n, a) => n + amountOf(a), 0),
    unpriced: open.filter((a) => !amountOf(a)).length,
    closingThisMonth: open.filter((a) => a.deal?.expectedClose && monthOf(a.deal.expectedClose) === today.slice(0, 7)).length,
    overdue: open.filter((a) => a.deal?.expectedClose && a.deal.expectedClose < today).length,
  };

  const soldCents = sold.reduce((n, a) => n + amountOf(a), 0);
  const totals = {
    booked: live.length, sold: sold.length, lost: lost.length, closeRate: rate(sold.length, lost.length),
    soldCents, averageSaleCents: sold.filter(amountOf).length ? Math.round(soldCents / sold.filter(amountOf).length) : null,
  };

  // By source: leads, how many got an appointment, how many bought.
  const sources = new Map();
  const srcRow = (id) => {
    if (!sources.has(id)) sources.set(id, { id, leads: 0, booked: 0, sold: 0, lost: 0, soldCents: 0 });
    return sources.get(id);
  };
  for (const l of leads) {
    const r = srcRow(l.source || "other");
    r.leads += 1;
    if ((l.appointments || []).some((ap) => ap.status !== "cancelled")) r.booked += 1;
  }
  for (const a of live) {
    const l = leadOfAppt.get(a.id);
    const r = srcRow(l?.source || "other");
    if (a.status === "sold") { r.sold += 1; r.soldCents += amountOf(a); }
    if (a.status === "lost") r.lost += 1;
  }
  const order = LEAD_SOURCES.map((s) => s.id);
  const bySource = [...sources.values()].map((r) => ({ ...r, bookRate: r.leads ? Math.round((r.booked / r.leads) * 100) : null,
    closeRate: rate(r.sold, r.lost) }))
    .sort((a, b) => b.leads - a.leads || order.indexOf(a.id) - order.indexOf(b.id));

  // By sales manager: what they ran and what it closed.
  const reps = new Map();
  for (const a of live) {
    const id = a.repId || "none";
    if (!reps.has(id)) reps.set(id, { id, name: a.repName || (a.repId ? "" : "Not assigned"), booked: 0, ran: 0, sold: 0, lost: 0, soldCents: 0, openCents: 0 });
    const r = reps.get(id);
    r.booked += 1;
    if (["sat", "sold", "lost"].includes(a.status)) r.ran += 1;
    if (a.status === "sold") { r.sold += 1; r.soldCents += amountOf(a); }
    if (a.status === "lost") r.lost += 1;
    if (STATUSES[a.status]?.open) r.openCents += amountOf(a);
  }
  const byRep = [...reps.values()].map((r) => ({ ...r, closeRate: rate(r.sold, r.lost) }))
    .sort((a, b) => b.soldCents - a.soldCents || b.booked - a.booked || String(a.name).localeCompare(String(b.name)));

  // Why estimates were lost, most common first. "No reason given" is a row of
  // its own, because a report hiding the ones nobody explained over-states
  // how well the reasons are known.
  const lostCounts = new Map();
  for (const a of lost) {
    const id = a.deal?.lostReason || "none";
    lostCounts.set(id, (lostCounts.get(id) || 0) + 1);
  }
  const lostReasons = [...lostCounts.entries()].map(([id, n]) => ({ id, label: id === "none" ? "No reason given" : lostReasonLabel(id), n }))
    .sort((a, b) => b.n - a.n);

  // Sold per month, by the day it was marked sold.
  const ms = lastMonths(today, months);
  const byMonth = ms.map((m) => {
    const s = sold.filter((a) => monthOf(a.statusAt || a.updatedAt) === m);
    return { month: m, sold: s.length, soldCents: s.reduce((n, a) => n + amountOf(a), 0),
      booked: live.filter((a) => monthOf(a.createdAt) === m).length,
      newLeads: leads.filter((l) => monthOf(l.createdAt) === m).length };
  });

  // How long the steps take. Stage history is not kept as rows, so these are
  // the two steps the records can answer honestly: from a lead arriving to
  // their first estimate being booked, and from booking to the sale.
  const toBooked = [];
  for (const l of leads) {
    const first = (l.appointments || []).map((ap) => appointments.find((a) => a.id === ap.id)).filter(Boolean)
      .sort((x, y) => String(x.createdAt).localeCompare(String(y.createdAt)))[0];
    if (first && l.createdAt) toBooked.push(Math.max(0, daysBetween(l.createdAt, first.createdAt)));
  }
  const toSold = sold.filter((a) => a.createdAt && (a.statusAt || a.updatedAt))
    .map((a) => Math.max(0, daysBetween(a.createdAt, a.statusAt || a.updatedAt)));
  const timing = { leadToBookedDays: median(toBooked), bookedToSoldDays: median(toSold), samples: { booked: toBooked.length, sold: toSold.length } };

  return { pipeline, totals, bySource, byRep, lostReasons, byMonth, timing };
}

// ---------------------------------------------------------------------------
// 3. Opt-out. Two different things, deliberately kept apart:
//   unsubscribed -- the homeowner pressed the link in one of our emails.
//                   Stops email (CAN-SPAM). Undone only by the homeowner
//                   saying yes to email again AFTER they unsubscribed.
//   do not contact -- the office's flag, for "stop calling me". Stops email,
//                   texts, letters, outbound calls and sequences. Only the
//                   office takes it off, with a reason.
// Notes and logging a call THEY made stay open, because recording what
// happened is not contacting anybody.
// ---------------------------------------------------------------------------

export function optOutBlock(channel, { optOut, consent }) {
  if (!optOut) return null;
  if (optOut.dncAt && ["email", "text", "mail", "call_out", "sequence"].includes(channel)) return "do_not_contact";
  if (optOut.unsubscribedAt && (channel === "email" || channel === "sequence")) {
    // A yes to email given after they unsubscribed is them changing their mind.
    const after = consent?.email === true && consent.capturedAt && String(consent.capturedAt) > String(optOut.unsubscribedAt);
    if (!after) return "unsubscribed";
  }
  return null;
}

export const OPT_OUT_TEXT = {
  do_not_contact: "This lead is marked Do not contact.",
  unsubscribed: "They unsubscribed from your emails. They can be emailed again only if they say yes to email again.",
};

export const UNSUB_TOKEN_RE = /^[a-z0-9]{24}$/;
export const unsubscribeLink = (token, origin = "https://app.subsub.work") => `${origin}/unsubscribe/${token}`;
// The path the app reads the token from.
export function unsubscribePathToken(path) {
  const m = String(path || "").match(/^\/unsubscribe\/([a-z0-9]{24})\/?$/);
  return m ? m[1] : null;
}
// What every email to a lead ends with. Words and a link, never only a link,
// because a mail client that strips links still has to say how to stop.
export const unsubscribeFooter = (accountName, link) =>
  `You're getting this because you asked ${accountName || "us"} about work on your home. Don't want these emails? Unsubscribe: ${link}`;

export function validDnc(b, { role }) {
  const o = b && typeof b === "object" ? b : {};
  if (typeof o.on !== "boolean") return { ok: false, error: "bad_request" };
  const reason = str(o.reason, 500) || null;
  // Taking it off reopens contact with somebody who asked to be left alone,
  // so it is the office's call and it is said why.
  if (!o.on && !["admin", "pm"].includes(role)) return { ok: false, error: "office_only" };
  if (!o.on && !reason) return { ok: false, error: "reason_required", field: "reason" };
  return { ok: true, value: { on: o.on, reason } };
}

// ---------------------------------------------------------------------------
// 4. Templates and sequences.
// ---------------------------------------------------------------------------

// The values a template may use. Anything else in {{ }} is refused on save,
// because a sentence with a hole in it is read and believed.
export const TEMPLATE_VARS = {
  firstName: "Their first name",
  lastName: "Their last name",
  accountName: "Your company's name",
  senderName: "The name of whoever sends it",
  services: "The work they asked about",
  city: "Their city",
};
export const TEMPLATE_VAR_IDS = Object.keys(TEMPLATE_VARS);

// The starters every account has. Read-only; "Make a copy" turns one into
// the account's own. Plain words, American English, no promises about price.
export const BUILTIN_TEMPLATES = [
  { id: "std:thanks", name: "Thanks for meeting", subject: "Thanks for having us out, {{firstName}}",
    body: "Hi {{firstName}},\n\nThanks for having us out to look at your home. If you have any questions about what we talked about, just reply to this email.\n\nWe'll follow up shortly with your estimate." },
  { id: "std:estimate", name: "Here's your estimate", subject: "Your estimate from {{accountName}}",
    body: "Hi {{firstName}},\n\nYour estimate is ready. Reply to this email with any questions, or to set a start date.\n\nThanks for considering us." },
  { id: "std:checkin", name: "Checking in", subject: "Checking in, {{firstName}}",
    body: "Hi {{firstName}},\n\nJust checking in on your project. Is there anything you need from us to help you decide?\n\nHappy to answer any questions." },
  { id: "std:last", name: "Last check-in", subject: "Should we close your file, {{firstName}}?",
    body: "Hi {{firstName}},\n\nWe haven't heard back, so we'll assume now isn't the right time. If anything changes, just reply to this email and we'll pick it up from here." },
];
export const isBuiltin = (id) => String(id || "").startsWith("std:");

export const MAX_TEMPLATE_BODY = 6000;
const VAR_RE = /\{\{\s*([a-zA-Z]+)\s*\}\}/g;
export function unknownVars(text) {
  const bad = [];
  for (const m of String(text || "").matchAll(VAR_RE)) if (!TEMPLATE_VAR_IDS.includes(m[1])) bad.push(m[1]);
  return [...new Set(bad)];
}
export function validTemplate(b) {
  const o = b && typeof b === "object" ? b : {};
  const name = str(o.name, 80);
  const subject = str(o.subject, 200);
  const body = String(o.body ?? "").trim().slice(0, MAX_TEMPLATE_BODY);
  if (!name) return { ok: false, error: "name_required", field: "name" };
  if (!subject) return { ok: false, error: "subject_required", field: "subject" };
  if (!body) return { ok: false, error: "body_required", field: "body" };
  const bad = unknownVars(`${subject}\n${body}`);
  if (bad.length) return { ok: false, error: "unknown_placeholder", field: bad[0], placeholders: bad };
  return { ok: true, value: { name, subject, body } };
}

// A template filled in for one lead. A value we do not have becomes nothing
// rather than "{{firstName}}", and "Hi ," is tidied to "Hi,".
export function fillTemplate(text, vars = {}) {
  return String(text || "")
    .replace(VAR_RE, (_, k) => String(vars[k] ?? "").trim())
    .replace(/(\bHi|\bHello|\bDear) ,/g, "$1,")
    .replace(/[ \t]{2,}/g, " ");
}
export function leadVars(lead, { accountName = "", senderName = "", serviceLabel = (s) => s } = {}) {
  return {
    firstName: lead?.firstName || "", lastName: lead?.lastName || "", accountName, senderName,
    services: (lead?.services || []).map(serviceLabel).join(", "), city: lead?.address?.city || "",
  };
}

// A sequence is up to MAX_STEPS emails, each a template and a number of days
// after the lead is put on it. Day 0 goes on the next sweep.
export const MAX_STEPS = 6;
export const MAX_STEP_DAY = 90;
export function validSequence(b, { templateIds = [] } = {}) {
  const o = b && typeof b === "object" ? b : {};
  const name = str(o.name, 80);
  if (!name) return { ok: false, error: "name_required", field: "name" };
  const raw = Array.isArray(o.steps) ? o.steps : [];
  if (!raw.length) return { ok: false, error: "steps_required", field: "steps" };
  if (raw.length > MAX_STEPS) return { ok: false, error: "too_many_steps", field: "steps" };
  const known = new Set([...BUILTIN_TEMPLATES.map((t) => t.id), ...templateIds]);
  const steps = [];
  let last = -1;
  for (let i = 0; i < raw.length; i += 1) {
    const s = raw[i] || {};
    const day = Number(s.day);
    if (!Number.isInteger(day) || day < 0 || day > MAX_STEP_DAY) return { ok: false, error: "bad_day", field: `steps.${i}.day` };
    // Each step after the one before it, so the order on screen is the order sent.
    if (day <= last) return { ok: false, error: "days_out_of_order", field: `steps.${i}.day` };
    if (!known.has(s.templateId)) return { ok: false, error: "bad_template", field: `steps.${i}.templateId` };
    steps.push({ day, templateId: s.templateId });
    last = day;
  }
  return { ok: true, value: { name, steps, stopOnBooking: o.stopOnBooking !== false } };
}

// When step `n` of an enrollment that started at `startedAt` is due.
export function stepDueAt(startedAt, day) {
  const t = Date.parse(String(startedAt).replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(startedAt) ? "" : "Z"));
  return new Date(t + day * 86400000).toISOString();
}

// Why a running sequence must stop before its next email, or null. Every one
// of these is somebody having answered, or somebody being told not to.
export function sequenceStop({ lead, consent, optOut, repliedSince, startStage, stopOnBooking = true, sequenceActive = true }) {
  if (!sequenceActive) return "sequence_off";
  if (!lead) return "lead_gone";
  if (repliedSince) return "replied";
  if (["customer", "former"].includes(lead.stage)) return "bought";
  if (stopOnBooking && ["lead", "prospect"].includes(startStage) && lead.stage === "opportunity") return "booked";
  const o = optOutBlock("sequence", { optOut, consent });
  if (o) return o;
  if (!lead.email) return "no_email";
  if (consent?.email !== true) return "no_email_consent";
  return null;
}
export const STOP_TEXT = {
  replied: "They replied", bought: "They bought", booked: "An estimate was booked", unsubscribed: "They unsubscribed",
  do_not_contact: "Marked Do not contact", no_email: "No email address", no_email_consent: "They haven't agreed to email",
  sequence_off: "The sequence was turned off", lead_gone: "The lead was removed", stopped: "Stopped by hand", done: "Every email sent",
};

// ---------------------------------------------------------------------------
// 5. The website lead form. What a homeowner sends from the account's own
// website, checked. Consent is asked as three checkboxes in the script's own
// words; unticked is a no, which on a form is a real answer.
// ---------------------------------------------------------------------------

export const WEB_CONSENT_VERSION = "web-2026-11-25";
export const WEB_CONSENT_TEXT = {
  email: "Email me about my project.",
  phone: "Call me about my project.",
  text: "Text me about my project. Message and data rates may apply. Reply STOP to opt out.",
};
export function webLeadProblem(b) {
  const o = b && typeof b === "object" ? b : {};
  if (!str(o.firstName) && !str(o.lastName)) return "name_required";
  const phone = String(o.phone || "").replace(/\D/g, "");
  if (!str(o.email) && phone.length < 10) return "contact_required";
  return null;
}
