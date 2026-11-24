// 109. Contacting a CRM lead from SubSub, and the CRM Inbox that lists every
// contact. Read by the Worker, the screen and the tests, so the three cannot
// disagree about what may be sent.
//
// Five channels, and they are not equally real:
//   email -- sent by SubSub through Resend, in the account's name, with a
//            reply address so the homeowner's answer lands back in the Inbox.
//   text  -- SubSub has no text provider yet, so a text is written here and
//            opened in YOUR phone's messages app with the words filled in.
//            It is logged as "opened on your phone", never as delivered,
//            because SubSub cannot see whether it was sent.
//   mail  -- a letter, printed from here and put in the mail. Recorded as
//            printed, and as mailed once somebody says it went.
//   call  -- logged, like an appointment's calls.
//   note  -- a note on the lead.
//
// Consent gates email, text and an outbound call exactly as it gates an
// appointment's follow-ups (shared/salescrm.js): the homeowner's yes for that
// channel, asked in the words the script reads out. Postal mail needs no
// consent and needs a whole address.

import { CALL_OUTCOMES, CONSENT_IDS, consentOf } from "./salescrm.js";

export const LEAD_CHANNELS = {
  email: { label: "Email", needs: "email" },
  text: { label: "Text", needs: "text" },
  mail: { label: "Letter", needs: null },
  call: { label: "Call", needs: null },
  note: { label: "Note", needs: null },
};
export const LEAD_CHANNEL_IDS = Object.keys(LEAD_CHANNELS);

const str = (v, max) => String(v ?? "").trim().slice(0, max);
const digits = (v) => String(v ?? "").replace(/\D/g, "");

export const MAX_EMAIL_BODY = 8000;
export const MAX_TEXT_BODY = 1000;
export const MAX_LETTER_BODY = 6000;
// Per account, per hour. Every email is real mail in somebody's inbox, and a
// loop sending hundreds is the one thing a limit has to stop.
export const LEAD_EMAILS_PER_HOUR = 120;

// The consent on file for a lead: the newest answer, whether it was asked of
// the lead directly or when one of its appointments was booked. Each is in the
// shape consentOf gives, with capturedAt. null when nothing was ever asked,
// which is not a yes to anything.
export function leadConsentFrom(direct, fromAppointments = []) {
  const all = [direct, ...fromAppointments].filter(Boolean);
  if (!all.length) return null;
  return all.sort((a, b) => String(b.capturedAt || "").localeCompare(String(a.capturedAt || "")))[0];
}
export const leadConsentOf = (row) => (row ? consentOf({ ...row, record_call: null }) : null);

const yes = (consent, ch) => !!consent && consent[ch] === true;
export const hasAddress = (a) => !!(a && a.street && a.city && a.state && digits(a.zip).length === 5);

// Whether a channel can be used for this lead right now, and if not, why --
// the screen greys the button out with the same words the route refuses with.
export function channelBlock(channel, { lead, consent }) {
  if (channel === "email") {
    if (!lead?.email) return "no_email";
    if (!yes(consent, "email")) return "no_email_consent";
  }
  if (channel === "text") {
    if (digits(lead?.phone).length !== 10) return "no_phone";
    if (!yes(consent, "text")) return "no_text_consent";
  }
  if (channel === "mail" && !hasAddress(lead?.address)) return "no_address";
  return null;
}

export const BLOCK_TEXT = {
  no_email: "There's no email address on this lead.",
  no_email_consent: "They haven't agreed to be emailed. Ask them first.",
  no_phone: "There's no mobile number on this lead.",
  no_text_consent: "They haven't agreed to texts. Ask them first.",
  no_call_consent: "They haven't agreed to be called. Ask them first.",
  no_address: "This lead needs a full street address, city, state and ZIP for a letter.",
};

// One contact, checked. Answers {ok, value} or {ok: false, error}.
export function validLeadMessage(b, { lead, consent }) {
  const o = b && typeof b === "object" ? b : {};
  const channel = LEAD_CHANNEL_IDS.includes(o.channel) ? o.channel : null;
  if (!channel) return { ok: false, error: "bad_channel" };
  const block = channelBlock(channel, { lead, consent });
  if (block) return { ok: false, error: block };
  if (channel === "email") {
    const subject = str(o.subject, 200);
    const body = str(o.body, MAX_EMAIL_BODY);
    if (!subject) return { ok: false, error: "subject_required" };
    if (!body) return { ok: false, error: "body_required" };
    return { ok: true, value: { channel, direction: "outbound", subject, body, to: lead.email, status: "sending" } };
  }
  if (channel === "text") {
    const body = str(o.body, MAX_TEXT_BODY);
    if (!body) return { ok: false, error: "body_required" };
    return { ok: true, value: { channel, direction: "outbound", body, to: digits(lead.phone), status: "device" } };
  }
  if (channel === "mail") {
    const body = str(o.body, MAX_LETTER_BODY);
    if (!body) return { ok: false, error: "body_required" };
    return { ok: true, value: { channel, direction: "outbound", subject: str(o.subject, 200) || null, body,
      to: addressLine(lead.address), status: "printed" } };
  }
  if (channel === "call") {
    const direction = o.direction === "inbound" || o.direction === "outbound" ? o.direction : null;
    if (!direction) return { ok: false, error: "bad_direction" };
    const outcome = CALL_OUTCOMES.includes(o.outcome) ? o.outcome : null;
    if (!outcome) return { ok: false, error: "bad_outcome" };
    // Calling them back needs their yes; taking their call does not.
    if (direction === "outbound" && !yes(consent, "phone")) return { ok: false, error: "no_call_consent" };
    return { ok: true, value: { channel, direction, outcome, body: str(o.body, 4000) || null,
      to: digits(lead.phone) || null, status: "logged" } };
  }
  const body = str(o.body, 4000);
  if (!body) return { ok: false, error: "body_required" };
  return { ok: true, value: { channel, direction: "outbound", body, status: "logged" } };
}

export const addressLine = (a) => (a ? `${a.street}, ${a.city}, ${a.state} ${a.zip}` : "");

// The messages app on the phone it is pressed on, with the words filled in.
// "?&body=" is the form both iOS and Android read.
export const smsHref = (phone, body) => `sms:+1${digits(phone)}?&body=${encodeURIComponent(String(body || ""))}`;
export const telHref = (phone) => `tel:+1${digits(phone)}`;

// The letter as it prints: the account at the top, the date, the homeowner's
// name and address where a window envelope shows them, then the words.
export function letterLines({ accountName, lead, body, date }) {
  const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ");
  return {
    from: accountName || "",
    date: date || "",
    to: [name, lead.address.street, `${lead.address.city}, ${lead.address.state} ${lead.address.zip}`].filter(Boolean),
    greeting: lead.firstName ? `Dear ${lead.firstName},` : "Hello,",
    paragraphs: String(body || "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean),
    signoff: accountName ? `The ${accountName} team` : "",
  };
}

// What each status is called on a row.
export function messageStatusText(m) {
  if (m.direction === "inbound") return "Reply";
  if (m.channel === "email") return m.status === "sent" ? "Sent" : m.status === "failed" ? "Didn't send" : "Sending";
  if (m.channel === "text") return "Opened on your phone";
  if (m.channel === "mail") return m.mailedAt ? "Mailed" : "Printed, not mailed yet";
  if (m.channel === "call") return m.direction === "inbound" ? "They called" : "You called";
  return "Note";
}

// The Inbox's counts: how many of each kind, and the replies nobody has read.
export function inboxCounts(messages = []) {
  const out = { all: messages.length, unread: 0, replies: 0 };
  for (const id of LEAD_CHANNEL_IDS) out[id] = 0;
  for (const m of messages) {
    if (out[m.channel] !== undefined) out[m.channel] += 1;
    if (m.direction === "inbound") { out.replies += 1; if (!m.readAt) out.unread += 1; }
  }
  return out;
}

// A lead's reply address. "l-" rather than the conversations' "m-", so the two
// kinds of token can never be confused for one another on the way in.
export const LEAD_TOKEN_RE = /^[a-z0-9]{24}$/;
export const leadReplyAddress = (token, domain) => (token && domain ? `l-${token}@${domain}` : null);
export function leadTokenFromAddress(addr, domain) {
  const m = String(addr || "").trim().toLowerCase().match(/^l-([a-z0-9]+)(?:\+[^@]*)?@(.+)$/);
  if (!m || (domain && m[2] !== String(domain).toLowerCase())) return null;
  return LEAD_TOKEN_RE.test(m[1]) ? m[1] : null;
}

// Consent asked of a lead directly: email, phone and text each a yes or a no.
export function validLeadConsent(raw, { lead }) {
  const c = raw && typeof raw === "object" ? raw : {};
  const value = {};
  for (const id of CONSENT_IDS) {
    if (c[id] === true || c[id] === false) value[id] = c[id];
    else return { ok: false, error: "incomplete", field: `consent.${id}` };
  }
  if (value.email && !lead?.email) return { ok: false, error: "consent_needs_email", field: "consent.email" };
  if ((value.text || value.phone) && digits(lead?.phone).length !== 10) {
    return { ok: false, error: "consent_needs_phone", field: value.text ? "consent.text" : "consent.phone" };
  }
  return { ok: true, value };
}
