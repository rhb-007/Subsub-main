// Every email SubSub sends on its own, in one list, so the staff console can
// show each one, say whether it is going out, turn it off product-wide, and
// replace its words. Read by the composers in worker/mail.js (which tag each
// message with its key), by sendEmail (which applies what staff saved), by
// the console route, and by the tests.
//
// What is NOT here, deliberately: a message a person wrote (an inbox message,
// an invite an account typed in its own words), and texts, which are not live.
// Their words are somebody's, not ours to edit.
//
// `sample` is what the console previews with, and the source of the
// placeholders a template may use: every scalar in it, one level of object
// (`{{account.name}}`), and a list of plain values joined with commas.
// `logKinds` are the email_log kinds that record a send, so the console can
// say how many went out and how many failed. An entry with none is a message
// that is sent and not recorded, which the console says.
// `required` cannot be switched off: the email IS the way in (an invite's
// link), and turning it off leaves somebody with no way to sign in.

const ACCOUNT = { name: "Outerhome", kind: "general_contractor", subdomain: "outerhome", hostname_status: "active" };
const LINK = "https://outerhome.subsub.work/";

export const NOTICE_GROUPS = [
  "Joining and invites", "Compliance pack", "Agreements", "Work and scheduling",
  "Tenants and buildings", "Messages", "Signup and account", "Passport", "Lien waivers", "Inspections",
];

export const NOTICES = [
  // Joining and invites
  { key: "roster_joined", composer: "rosterJoinedEmail", group: "Joining and invites",
    label: "Somebody joined your roster", audience: "Hiring account's admins and project managers",
    when: "A contractor applies through the form, accepts an invite, accepts a connect request, or staff add them.",
    logKinds: ["roster_joined"],
    sample: { firstName: "Richard", account: ACCOUNT, companyName: "T&V Sons Construction", contact: "Tomas Vega",
      via: "form", kind: "general_contractor", link: `${LINK}?open=sub&id=c1`, pending: true } },
  { key: "appointment_booked", composer: "appointmentBookedEmail", group: "Sales appointments",
    label: "Estimate booked", audience: "The homeowner the call center booked",
    when: "A call-center seat or the office books a sales appointment and leaves the confirmation ticked.",
    logKinds: ["appointment_booked"],
    sample: { firstName: "Dana", account: ACCOUNT, services: ["Roof replacement", "Gutter replacement"],
      when: "Tuesday, December 2 at 10:00 AM", address: "1204 N Pine St, Tacoma, WA 98406",
      repName: "Marcus Hill", second: true } },
  { key: "appointment_assigned", composer: "appointmentAssignedEmail", group: "Sales appointments",
    label: "Estimate assigned to a sales manager", audience: "The sales manager the estimate is for",
    when: "An estimate is booked for a sales manager, or moved to a different one.",
    logKinds: ["appointment_assigned"],
    sample: { firstName: "Marcus", bookedBy: "Jess Ortiz", who: "Dana Price", services: ["Roof replacement"],
      when: "Tuesday, December 2 at 10:00 AM", address: "1204 N Pine St, Tacoma, WA 98406", link: `${LINK}?open=appointment&id=a1` } },
  { key: "followup_assigned", composer: "followUpAssignedEmail", group: "Sales appointments",
    label: "Follow-up handed to somebody", audience: "The person the follow-up was given to",
    when: "Somebody adds a follow-up on an appointment and gives it to a teammate.",
    logKinds: ["followup_assigned"],
    sample: { firstName: "Marcus", assignedBy: "Jess Ortiz", who: "Dana Price", what: "Send the metal roof brochure and pricing.",
      due: "Dec 4", channel: "Email", link: `${LINK}?open=appointment&id=a1` } },
  { key: "followup_due", composer: "followUpDueEmail", group: "Sales appointments",
    label: "Follow-ups due", audience: "The person each follow-up is for",
    when: "Each night, for follow-ups due that day or overdue, once per follow-up.",
    logKinds: ["followup_due"],
    sample: { firstName: "Marcus", items: [{ who: "Dana Price", what: "Call back about financing", due: "Dec 4", overdue: false }],
      link: `${LINK}?open=followups` } },
  { key: "appointment_reminder", composer: "appointmentReminderEmail", group: "Sales appointments",
    label: "Estimate reminder", audience: "The homeowner, only if they agreed to email",
    when: "The day before their estimate, once per booked time.",
    logKinds: ["appointment_reminder"],
    sample: { firstName: "Dana", account: ACCOUNT, services: ["Roof replacement"],
      when: "Tuesday, December 2 at 10:00 AM", address: "1204 N Pine St, Tacoma, WA 98406", repName: "Marcus Hill" } },
  { key: "application_received", composer: "applicationReceivedEmail", group: "Joining and invites",
    label: "Application received", audience: "The contractor who applied",
    when: "Right after somebody applies through an account's sign-up form.",
    logKinds: ["application_received"],
    sample: { companyName: "T&V Sons Construction", contact: "Tomas Vega", account: ACCOUNT, pending: true, signInLink: LINK } },
  { key: "application_decided", composer: "applicationDecidedEmail", group: "Joining and invites",
    label: "Application accepted or declined", audience: "The contractor who applied",
    when: "The hiring account accepts or declines their application.",
    logKinds: ["application_accepted", "application_declined"],
    sample: { contact: "Tomas Vega", companyName: "T&V Sons Construction", account: ACCOUNT, accepted: true, signInLink: LINK } },
  { key: "sub_invite", composer: "subInviteEmail", group: "Joining and invites", required: true,
    label: "Invitation to join a roster", audience: "A contractor an account invited",
    when: "An account invites a contractor, or resends the invite.",
    logKinds: ["sub_invite"],
    sample: { contact: "Tomas Vega", companyName: "T&V Sons Construction", account: ACCOUNT, link: `${LINK}?invite=abc` } },
  { key: "user_invite", composer: "userInviteEmail", group: "Joining and invites", required: true,
    label: "Invitation to an account's team", audience: "A person added to an account's team",
    when: "An admin adds a teammate, or staff create an account.",
    logKinds: ["user_invite"],
    sample: { name: "Dana Lee", account: ACCOUNT, role: "pm", invitedBy: "Richard Braun", link: `${LINK}?invite=abc` } },
  { key: "connect_request", composer: "connectRequestEmail", group: "Joining and invites",
    label: "Request to connect", audience: "A company already on SubSub",
    when: "An account asks a company already on SubSub to work together.",
    logKinds: ["connect_request"],
    sample: { account: ACCOUNT, company: "T&V Sons Construction", message: "We'd like to add you for roofing.", link: LINK } },

  // Compliance pack
  { key: "doc_request", composer: "docRequestEmail", group: "Compliance pack",
    label: "Document request", audience: "A contractor on the roster",
    when: "An account asks for the documents still missing.",
    logKinds: ["doc_request"],
    sample: { company: { company: "T&V Sons Construction", insurance: 0, bond: 0, contract: 0, w9: 0 },
      contact: "Tomas Vega", docReview: {}, account: ACCOUNT } },
  { key: "doc_findings", composer: "docFindingsEmail", group: "Compliance pack",
    label: "Document sent back to fix", audience: "A contractor on the roster",
    when: "A reviewer marks things wrong on a document.",
    logKinds: ["doc_findings"],
    sample: { company: { company: "T&V Sons Construction" }, contact: "Tomas Vega", account: ACCOUNT,
      kind: "insurance", review: {}, note: "Please add us as additional insured." } },
  { key: "doc_uploaded", composer: "docUploadedEmail", group: "Compliance pack",
    label: "A contractor added a document", audience: "Hiring accounts' admins and project managers",
    when: "A company on the roster uploads insurance, a bond, a W-9, a license number or a signed agreement.",
    logKinds: ["doc_uploaded_insurance", "doc_uploaded_bond", "doc_uploaded_w9", "doc_uploaded_license", "doc_uploaded_contract"],
    sample: { firstName: "Richard", companyName: "T&V Sons Construction", kind: "insurance",
      label: "certificate of insurance", link: `${LINK}?open=sub&id=c1` } },
  { key: "doc_expiry", composer: "docExpiryEmail", group: "Compliance pack",
    label: "Document expiring", audience: "A contractor on the roster",
    when: "Nightly, before and on the day a certificate or bond expires.",
    logKinds: ["doc_expiry"],
    sample: { company: { company: "T&V Sons Construction" }, contact: "Tomas Vega", kind: "insurance",
      expiresOn: "2026-12-15", daysOut: 14, account: ACCOUNT, jobs: [] } },
  { key: "license_expiry", composer: "licenseExpiryEmail", group: "Compliance pack",
    label: "License expiring", audience: "The contractor",
    when: "Nightly, 30, 7 and 0 days before the state register's expiry.",
    logKinds: ["license_expiry"],
    sample: { company: "T&V Sons Construction", contact: "Tomas Vega", number: "TVSONSC123AB",
      expiresOn: "2026-12-15", daysOut: 30, registry: "Washington L&I", link: LINK } },
  { key: "doc_pack", composer: "docPackEmail", group: "Compliance pack",
    label: "Compliance pack sent", audience: "Whoever a subcontractor sends their pack to",
    when: "A subcontractor sends their compliance pack.",
    logKinds: [],
    sample: { company: "T&V Sons Construction", contact: "Tomas Vega", note: "", link: "https://app.subsub.work/?pack=abc",
      days: 30, kinds: ["insurance", "bond"] } },
  { key: "doc_renewed", composer: "docRenewedEmail", group: "Compliance pack",
    label: "Compliance pack renewed", audience: "Whoever was sent the pack before",
    when: "A document they were sent renews.",
    logKinds: ["doc_renewed"],
    sample: { company: "T&V Sons Construction", contact: "Tomas Vega", kind: "insurance", expiresOn: "2027-12-15",
      link: "https://app.subsub.work/?pack=abc", days: 30 } },
  { key: "doc_inbox", composer: "docInboxEmail", group: "Compliance pack",
    label: "Every pack sent to you", audience: "Somebody who was sent packs",
    when: "They ask for every pack sent to their address.",
    logKinds: ["doc_inbox"],
    sample: { senders: ["T&V Sons Construction"], count: 1, link: "https://app.subsub.work/?inbox=abc", days: 7 } },

  // Agreements
  { key: "agreement_sent", composer: "agreementSentEmail", group: "Agreements",
    label: "Agreement to sign", audience: "A contractor on the roster",
    when: "An account issues an agreement, or resends it.",
    logKinds: ["agreement_sent", "agreement_resent"],
    sample: { company: "T&V Sons Construction", contact: "Tomas Vega", account: ACCOUNT, source: "subsub_standard" } },
  { key: "auto_schedule_request", composer: "autoScheduleRequestEmail", group: "Agreements",
    label: "Asked to turn on auto-schedule", audience: "A contractor on the roster",
    when: "An account asks a contractor to book its jobs automatically.",
    logKinds: ["auto_schedule_request"],
    sample: { company: "T&V Sons Construction", contact: "Tomas Vega", account: ACCOUNT, note: "" } },

  // Work and scheduling
  { key: "wo_issued", composer: "workOrderIssuedEmail", group: "Work and scheduling",
    label: "Work order issued", audience: "The contractor it was issued to",
    when: "An account assigns a trade on a job.",
    logKinds: ["wo_issued"],
    sample: { company: "T&V Sons Construction", contact: "Tomas Vega", job: { title: "Roof repair", address: "12 Main St", date: "2026-12-02" },
      trade: "Roofing", woNumber: "WO-1042", account: ACCOUNT, respondBy: "2026-11-24T17:00:00Z" } },
  { key: "overflow_post", composer: "overflowPostEmail", group: "Work and scheduling",
    label: "Overflow work offered", audience: "Companies opted in to overflow",
    when: "An account broadcasts a job nobody on its roster can take.",
    logKinds: ["overflow_post"],
    sample: { company: { company: "T&V Sons Construction" }, contact: "Tomas Vega", account: ACCOUNT,
      job: { area: "Tacoma", zip: "98402", date: "2026-12-02" }, trade: "Roofing", severity: "urgent",
      split: { gross: 450000 }, expiresAt: "2026-11-25T17:00:00Z", scope: "Leak over the kitchen" } },
  { key: "action_reminder", composer: "actionReminderEmail", group: "Work and scheduling",
    label: "Something is waiting on you", audience: "Whoever's move it is",
    when: "Nightly, on days 1, 2, 4, 7, 11 and 15 of a wait.",
    logKinds: ["action_reminder"],
    sample: { firstName: "Tomas", lines: ["Confirm the time for Roof repair (waiting 2 days)."], link: LINK, fromName: "Outerhome" } },

  // Tenants and buildings
  { key: "tenant_invite", composer: "tenantInviteEmail", group: "Tenants and buildings", required: true,
    label: "Tenant invitation", audience: "A tenant a manager added",
    when: "A manager adds a tenant.",
    logKinds: ["tenant_invite"],
    sample: { firstName: "Ana", account: ACCOUNT, propertyName: "Ballard Apts", unit: "4B", link: `${LINK}?invite=abc` } },
  { key: "tenant_status", composer: "tenantStatusEmail", group: "Tenants and buildings",
    label: "Your report moved", audience: "The tenant who reported it",
    when: "Their report is approved, scheduled, done, put on hold or closed.",
    logKinds: ["tenant_status"],
    sample: { firstName: "Ana", account: ACCOUNT, title: "Leaking sink", stage: "approved", link: LINK, detail: null } },
  { key: "building_notice", composer: "buildingNoticeEmail", group: "Tenants and buildings",
    label: "Building notice", audience: "Tenants of one building",
    when: "A manager posts a notice and ticks Also email the tenants.",
    logKinds: ["building_notice"],
    sample: { firstName: "Ana", account: ACCOUNT, propertyName: "Ballard Apts", title: "Water off Tuesday",
      body: "The water will be off from 9 to noon.", endsOn: "2026-12-02", important: true, link: LINK } },

  // Messages
  { key: "message_notify", composer: "messageNotifyEmail", group: "Messages",
    label: "Unread messages", audience: "Anybody with a message waiting",
    when: "A message has sat unread for 20 minutes.",
    logKinds: ["message_notify"],
    sample: { firstName: "Richard", threads: [{ who: "Tomas Vega", about: "Roof repair", preview: "Can we do Thursday?", count: 1 }],
      link: LINK, fromName: "Outerhome" } },

  // Signup and account
  { key: "welcome", composer: "welcomeEmail", group: "Signup and account",
    label: "Welcome to SubSub", audience: "A new account's owner",
    when: "Right after signing up.",
    logKinds: ["welcome"],
    sample: { firstName: "Richard", companyName: "Outerhome", email: "owner@example.com", planName: "Basic",
      needsConfirmation: true, hasPassword: false, viaGoogle: false, kind: "general_contractor" } },
  { key: "founder_intro", composer: "founderIntroEmail", group: "Signup and account",
    label: "Note from the founder (hiring account)", audience: "A new hiring account on Basic",
    when: "Right after signing up, after the welcome.",
    logKinds: ["founder_intro"],
    sample: { firstName: "Richard", companyName: "Outerhome", kind: "general_contractor" } },
  { key: "founder_sub", composer: "founderSubEmail", group: "Signup and account",
    label: "Note from the founder (subcontractor)", audience: "A new subcontractor account",
    when: "Right after signing up, after the welcome.",
    logKinds: ["founder_intro"],
    sample: { firstName: "Tomas", companyName: "T&V Sons Construction" } },
  { key: "demo_booked", composer: "demoBookedEmail", group: "Signup and account",
    label: "Demo booked", audience: "Whoever booked a demo",
    when: "A demo is booked on the website.",
    logKinds: [],
    sample: { name: "Richard Braun", start: "2026-12-01T17:00:00Z", end: "2026-12-01T17:30:00Z",
      timeZone: "America/Los_Angeles", meetingUrl: "https://meet.google.com/abc-defg-hij" } },
  { key: "embed_nudge", composer: "embedNudgeEmail", group: "Signup and account",
    label: "Put the sign-up form on your website", audience: "A hiring account's admins",
    when: "Once, when the roster reaches the nudge size.",
    logKinds: ["embed_nudge"],
    sample: { name: "Richard", accountName: "Outerhome", subdomain: "outerhome", subs: 5 } },

  // Passport
  { key: "passport_access_request", composer: "passportAccessRequestEmail", group: "Passport",
    label: "Request to see Passport files", audience: "The subcontractor",
    when: "A hiring account asks to open their certificate and W-9.",
    logKinds: ["passport_access_request"],
    sample: { company: "T&V Sons Construction", contact: "Tomas Vega", accountName: "Outerhome",
      requesterName: "Richard Braun", message: "", link: LINK } },
  { key: "passport_access_decision", composer: "passportAccessDecisionEmail", group: "Passport",
    label: "Passport request answered", audience: "Whoever asked",
    when: "The subcontractor approves or declines.",
    logKinds: ["passport_access_decision"],
    sample: { firstName: "Richard", companyName: "T&V Sons Construction", approved: true, link: LINK } },

  // Lien waivers
  { key: "waiver_request", composer: "waiverRequestEmail", group: "Lien waivers",
    label: "Lien waiver to sign", audience: "A subcontractor or supplier",
    when: "A waiver is requested.",
    logKinds: [],
    sample: { toName: "Tomas Vega", fromName: "Outerhome", kindTitle: "Conditional waiver on progress payment",
      conditional: true, amount: 450000, through: "2026-11-30", job: "Roof repair", link: LINK } },

  // Inspections
  { key: "inspection_report", composer: "inspectionReportEmail", group: "Inspections",
    label: "Inspection report", audience: "The building's owner",
    when: "A manager sends a finished inspection.",
    logKinds: [],
    sample: { firstName: "Pat", account: ACCOUNT, kindLabel: "Move-out", propertyName: "Ballard Apts", unit: "4B",
      walkedOn: "Nov 20", tenantName: null, rooms: 8, flagged: 2, link: LINK } },
];

export const NOTICE_KEYS = NOTICES.map((n) => n.key);
export const noticeByKey = (key) => NOTICES.find((n) => n.key === key) || null;
export const noticeByComposer = (name) => NOTICES.find((n) => n.composer === name) || null;

// The values a template can name. Scalars as they are, one level of object
// with a dot, plain lists joined with commas. Booleans are left out: there are
// no conditions in a template, so "true" would only ever print the word.
export function noticeVars(args) {
  const out = {};
  const put = (k, v) => {
    if (v === null || v === undefined) return;
    if (typeof v === "string" || typeof v === "number") out[k] = String(v);
    else if (Array.isArray(v) && v.every((x) => typeof x === "string" || typeof x === "number")) out[k] = v.join(", ");
  };
  for (const [k, v] of Object.entries(args || {})) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v)) put(`${k}.${k2}`, v2);
    } else put(k, v);
  }
  return out;
}

export const noticePlaceholders = (key) => Object.keys(noticeVars(noticeByKey(key)?.sample || {}));

const PH = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

// Every {{name}} a template uses that this notice cannot fill. Refused on
// save rather than printed as nothing, because a sentence with a hole in it
// is read and believed.
export function unknownPlaceholders(key, ...templates) {
  const known = new Set(noticePlaceholders(key));
  const bad = new Set();
  for (const t of templates) for (const m of String(t || "").matchAll(PH)) if (!known.has(m[1])) bad.add(m[1]);
  return [...bad];
}

// A missing value prints as nothing, never as the braces.
export function renderNotice(template, vars) {
  return String(template || "").replace(PH, (_, name) => (vars && vars[name] != null ? vars[name] : ""));
}

// A required notice (an invite) must keep its link, or the email arrives with
// no way in. Asked of the BODY.
export function noticeNeedsLink(key) {
  const n = noticeByKey(key);
  return !!n && noticePlaceholders(key).includes("link") && !!n.required;
}

export const NOTICE_SUBJECT_MAX = 200;
export const NOTICE_BODY_MAX = 4000;
