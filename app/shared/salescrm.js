// CRM / Sales: what happens to a homeowner after the call center books them.
// Migration 106. Sits on top of shared/salesappt.js (105), which is the call
// script and the appointment itself.
//
// Three things live here, because the route, the screen and the tests all
// read them and must not disagree:
//
// 1. CONSENT. Before anybody follows up by email, phone or text, the homeowner
//    is asked, in words the script reads out, and the answer is stored with
//    when it was captured and by whom. A text needs express written consent
//    under the TCPA, so the words carry the opt-out. An answer is a yes or a
//    no; "not asked" is not an answer and the booking waits for one.
//
// 2. ACTIVITY. A note, a logged call, a follow-up somebody has to do, and a
//    call recording. Append-only apart from ticking a follow-up done, because
//    "who said what to this homeowner and when" is what a dispute asks.
//
// 3. The gates between them: an outbound call is logged only for somebody who
//    agreed to be called, a follow-up by a channel only where that channel was
//    agreed, and a recording only where the homeowner agreed to be recorded.

// Bumped when the words change. Stored beside every answer, so what somebody
// agreed to can always be read back in the words they heard.
export const CONSENT_VERSION = "2026-11-24";

export const CONSENT_CHANNELS = [
  { id: "email", label: "Email",
    ask: "Is it OK if we follow up with you by email about your project?" },
  { id: "phone", label: "Phone calls",
    ask: "Is it OK if we call you at this number to follow up?" },
  { id: "text", label: "Text messages",
    ask: "Is it OK if we text you at this number about your appointment and project? Message and data rates may apply. You can reply STOP at any time to opt out." },
];
export const CONSENT_IDS = CONSENT_CHANNELS.map((c) => c.id);

// Read at the start of a call that is being recorded. Several states (WA, CA,
// FL and others) need every party's consent to record, so the answer is
// recorded and a recording is refused for a call somebody said no to.
export const RECORD_ASK = "Before we start, this call may be recorded for quality and training. Is that OK with you?";

// The consent the script collected, checked. `email` and `phone` are the
// homeowner's contact details as booked: agreeing to email with no address is
// agreeing to nothing, so it is refused rather than stored.
// Answers {ok, value, missing} where missing lists channels left unanswered.
export function validConsent(raw, { email = "", phone = "" } = {}) {
  const c = raw && typeof raw === "object" ? raw : {};
  const value = {};
  const missing = [];
  for (const id of CONSENT_IDS) {
    if (c[id] === true || c[id] === false) value[id] = c[id];
    else missing.push(`consent.${id}`);
  }
  // Recording is not a follow-up channel and is not required: most calls are
  // not recorded. null means nobody asked, which is not the same as no.
  value.record = c.record === true ? true : c.record === false ? false : null;
  if (value.email === true && !email) return { ok: false, error: "consent_needs_email", field: "consent.email" };
  if ((value.text === true || value.phone === true) && String(phone).replace(/\D/g, "").length !== 10) {
    return { ok: false, error: "consent_needs_phone", field: value.text ? "consent.text" : "consent.phone" };
  }
  return { ok: true, value, missing };
}

// What a stored row (or nothing) reads as. Absent consent is NOT a yes to
// anything: an appointment booked before 106 has no answer on file.
export function consentOf(row) {
  if (!row) return null;
  const b = (v) => (v === 1 || v === true ? true : v === 0 || v === false ? false : null);
  return { email: b(row.email), phone: b(row.phone), text: b(row.text), record: b(row.record_call),
    version: row.script_version || null, capturedAt: row.captured_at || null,
    capturedBy: row.captured_by || null, capturedByName: row.captured_by_name || null };
}

export const mayUse = (consent, channel) => !!consent && consent[channel] === true;

// The kinds of activity on an appointment.
export const ACTIVITY_KINDS = {
  note: { label: "Note" },
  call: { label: "Call" },
  follow_up: { label: "Follow-up" },
  recording: { label: "Call recording" },
};
export const ACTIVITY_IDS = Object.keys(ACTIVITY_KINDS);
export const CALL_OUTCOMES = ["Reached them", "Left a voicemail", "No answer", "Wrong number"];
// How a follow-up is to be done. `visit` needs no consent; each of the others
// needs the channel the homeowner agreed to.
export const FOLLOW_CHANNELS = {
  call: { label: "Call", needs: "phone" },
  email: { label: "Email", needs: "email" },
  text: { label: "Text", needs: "text" },
  visit: { label: "Visit or other", needs: null },
};

// A recording is the call itself, so it is audio, and nothing that renders as
// a page on our origin. 50MB is about an hour of compressed speech.
export const AUDIO_TYPES = ["audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/m4a", "audio/aac",
  "audio/wav", "audio/x-wav", "audio/wave", "audio/webm", "audio/ogg"];
export const MAX_RECORDING_BYTES = 50 * 1024 * 1024;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v, max) => String(v ?? "").trim().slice(0, max);

// One activity, checked against the appointment's consent. `accountId` is the
// caller's own, read off the session: a recording key must be under it.
// `assignees` are the ids a follow-up may go to.
export function validActivity(b, { consent, accountId, assignees = [] } = {}) {
  const body = b && typeof b === "object" ? b : {};
  const kind = ACTIVITY_IDS.includes(body.kind) ? body.kind : null;
  if (!kind) return { ok: false, error: "bad_kind" };
  const text = str(body.body, 4000);
  if (kind === "note") {
    if (!text) return { ok: false, error: "note_required" };
    return { ok: true, value: { kind, body: text } };
  }
  if (kind === "call") {
    const direction = body.direction === "inbound" || body.direction === "outbound" ? body.direction : null;
    if (!direction) return { ok: false, error: "bad_direction" };
    const outcome = CALL_OUTCOMES.includes(body.outcome) ? body.outcome : null;
    if (!outcome) return { ok: false, error: "bad_outcome" };
    // Calling them back is a follow-up call, which they have to have agreed
    // to. Taking a call they made is not, so inbound is always fine.
    if (direction === "outbound" && !mayUse(consent, "phone")) return { ok: false, error: "no_call_consent" };
    return { ok: true, value: { kind, direction, outcome, body: text || null } };
  }
  if (kind === "follow_up") {
    if (!text) return { ok: false, error: "follow_up_required" };
    const due = DATE_RE.test(body.dueDate || "") ? body.dueDate : null;
    if (!due) return { ok: false, error: "due_required" };
    const ch = FOLLOW_CHANNELS[body.channel] ? body.channel : null;
    if (!ch) return { ok: false, error: "bad_channel" };
    const needs = FOLLOW_CHANNELS[ch].needs;
    if (needs && !mayUse(consent, needs)) return { ok: false, error: "no_channel_consent", channel: ch };
    const assignee = body.assigneeId ? String(body.assigneeId) : null;
    if (assignee && !assignees.includes(assignee)) return { ok: false, error: "bad_assignee" };
    return { ok: true, value: { kind, body: text, dueDate: due, channel: ch, assigneeId: assignee } };
  }
  // recording
  if (consent && consent.record === false) return { ok: false, error: "no_recording_consent" };
  if (body.consentConfirmed !== true) return { ok: false, error: "recording_consent_required" };
  const key = String(body.fileKey || "");
  if (!accountId || !key.startsWith(`${accountId}/call-recording/`) || key.includes("..")) {
    return { ok: false, error: "recording_not_uploaded" };
  }
  const type = String(body.fileType || "").toLowerCase();
  if (!AUDIO_TYPES.includes(type)) return { ok: false, error: "not_audio" };
  const size = Number(body.fileSize);
  return { ok: true, value: { kind, body: text || null, fileKey: key, fileName: str(body.fileName, 200) || "recording",
    fileType: type, fileSize: Number.isFinite(size) && size > 0 ? Math.min(size, MAX_RECORDING_BYTES) : null } };
}

// A follow-up is due on its day and overdue the day after. `today` is a
// YYYY-MM-DD in whatever clock the caller is reading.
export function followUpState(a, today) {
  if (a.kind !== "follow_up") return null;
  if (a.doneAt) return "done";
  if (a.dueDate < today) return "overdue";
  if (a.dueDate === today) return "due";
  return "upcoming";
}

// The homeowners on an account, one per phone number, out of its own
// appointments -- nothing here reads anybody else's. Newest appointment first,
// and its consent is the consent on file, because it was asked most recently.
export function contactsFrom(appointments = []) {
  const by = new Map();
  const sorted = [...appointments].sort((x, y) => `${y.date}${y.time}`.localeCompare(`${x.date}${x.time}`));
  for (const a of sorted) {
    const key = String(a.homeowner?.phone || "").replace(/\D/g, "") || `id:${a.id}`;
    if (!by.has(key)) {
      by.set(key, { key, firstName: a.homeowner?.firstName || "", lastName: a.homeowner?.lastName || "",
        phone: a.homeowner?.phone || "", email: a.homeowner?.email || "",
        address: a.address || {}, consent: a.consent || null, latestId: a.id, latestStatus: a.status,
        latestDate: a.date, appointments: [] });
    }
    const c = by.get(key);
    c.appointments.push(a.id);
    if (!c.email && a.homeowner?.email) c.email = a.homeowner.email;
    if (!c.consent && a.consent) c.consent = a.consent;
  }
  return [...by.values()];
}
