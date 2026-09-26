// ---------------------------------------------------------------------------
// Outbound email (Resend)
// ---------------------------------------------------------------------------
// The server composes every message, not the browser. The alternative — the
// client posting a body for the server to relay — would let any signed-in user
// send arbitrary text from your sending domain, which is a spam vector and a
// phishing one. It also keeps the admin's on-screen preview honest: the
// preview endpoint and the send endpoint build from the same function, so what
// was reviewed is what goes out.
//
// The platform has no inbox. Everything here is a one-way system notification
// that points the recipient back into their portal, and says so.

export const DOC_KINDS = ["insurance", "bond", "contract", "w9"];
export const DOC_LABELS = {
  insurance: "Certificate of insurance",
  bond: "Surety bond",
  contract: "Signed subcontractor agreement",
  w9: "IRS Form W-9",
};
const INSURANCE_LINES = [
  { label: "Commercial General Liability", sub: "per occurrence", min: 1000000 },
  { label: "General aggregate", sub: "", min: 2000000 },
  { label: "Products & completed operations", sub: "", min: 2000000 },
  { label: "Auto liability", sub: "combined single limit", min: 1000000 },
  { label: "Employer's liability", sub: "", min: 1000000 },
  { label: "Umbrella / excess", sub: "higher-risk or larger subs", min: 1000000, optional: true },
];
const INSURANCE_ATTEST = (who) => [
  `${who} named as additional insured on CGL`,
  "Primary & non-contributory wording present",
  "WA L&I workers' comp account active (or exempt)",
  "Policy period covers the work dates",
  "Carrier and policy number legible",
];
const BOND_MIN = 30000;

const money = (n) => "$" + Number(n).toLocaleString("en-US");

// Dates reach these templates in two shapes: a plain YYYY-MM-DD from jobs, and
// a full ISO timestamp from respond_by. Neither belongs in front of a customer
// as-is. Anything unparseable is passed through rather than swallowed.
function niceDate(v, withTime = false) {
  if (!v) return "";
  const iso = String(v);
  const d = new Date(iso.length === 10 ? iso + "T12:00:00Z" : iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString("en-US",
    { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  if (!withTime) return date;
  const time = d.toLocaleTimeString("en-US",
    { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
  return `${date} at ${time} UTC`;
}
export const portalUrl = (subdomain) => `${subdomain || "app"}.subsub.work`;
const docsLink = (subdomain) => `https://${portalUrl(subdomain)}/documents`;

// Which documents are not usable: absent, unreviewed, or rejected. Mirrors the
// app's own rule — a file on its own is not compliance, a human verdict is.
export function missingDocs(company, docReview) {
  return DOC_KINDS.filter((k) => {
    if (!company[k]) return true;
    return (docReview?.[k]?.status) !== "verified";
  });
}

// ---- Templates ------------------------------------------------------------

export function docRequestEmail({ company, contact, docReview, job, trade, account }) {
  const missing = missingDocs(company, docReview);
  const who = account?.name || "our team";
  const lead = job
    ? "You've been matched to a job, but we can't release the work order until your compliance documents are on file."
    : `Your ${who} contractor account is set up, but we can't send you work until your compliance documents are on file.`;

  const jobBlock = job ? `
THE JOB
  ${job.title || "New job"}
  Trade: ${trade || "—"}${job.address ? `
  Where: ${[job.address, job.area, job.zip].filter(Boolean).join(", ")}` : ""}${job.date ? `
  Starts: ${niceDate(job.date)}` : ""}
` : "";

  const insuranceBlock = missing.includes("insurance") ? `
INSURANCE REQUIREMENTS
${INSURANCE_LINES.map((l) =>
  `  ${l.label}${l.sub ? ` (${l.sub})` : ""}: ${money(l.min)}${l.optional ? " (if applicable)" : ""}`).join("\n")}
  Workers' compensation: WA L&I active account, as applicable
${INSURANCE_ATTEST(who).map((a) => `  • ${a}`).join("\n")}
` : "";

  const bondBlock = missing.includes("bond") ? `
BOND REQUIREMENT
  ${money(BOND_MIN)} minimum, surety licensed in Washington
` : "";

  const w9Block = missing.includes("w9") ? `
W-9
  Your TIN or EIN, tax classification, and a signature in Part II.
  We can't issue payment without it.
` : "";

  const text = `Hi ${contact || company.company},

${lead}
${jobBlock}
WHAT WE NEED
${missing.map((k) => `  • ${DOC_LABELS[k]}`).join("\n")}
${insuranceBlock}${bondBlock}${w9Block}
UPLOAD THEM HERE
  ${docsLink(account?.subdomain)}

  Your username: ${company.email || "(no email on file)"}

Tap the link, sign in, and upload. A photo from your phone is fine.${job ? "\n\nWe'll hold the job for you until then." : ""}

— ${who}

This is an automated message from an unmonitored address. Replies aren't received, and documents emailed back won't be filed. Please upload them at the link above.`;

  return {
    subject: job
      ? `Action needed: upload documents for ${job.title || "a job"}`
      : "Action needed: upload your compliance documents",
    text,
    html: textToHtml(text, docsLink(account?.subdomain)),
    missing,
  };
}

// Asking a subcontractor to turn auto-schedule on.
//
// The account cannot do this for them (shared/autoschedule.js says why), so
// this is the whole mechanism: a mail that explains what they would be
// agreeing to and points at the switch in their own account. It is written
// to be declinable. Overstating it -- "enable this to get more work" --
// would buy a yes from somebody who had not understood that jobs land
// already accepted, and the first surprise booking would cost more trust
// than the feature is worth.
export function autoScheduleRequestEmail({ company, contact, account, note }) {
  const who = account?.name || "our team";
  const text = `Hi ${contact || company.company},

${who} has asked whether you'd like to turn on auto-schedule for the work
they send you.${note ? `

THEIR NOTE
  ${note}` : ""}

WHAT IT MEANS
  Jobs ${who} assigns you are booked straight onto your calendar, already
  accepted. No response window, and nothing for you to approve.

  It cuts the back-and-forth on routine work, and it means you are not
  losing a job because a request sat unread for an afternoon.

WHAT TO KNOW BEFORE YOU SAY YES
  • You will not get an accept or decline step on those jobs.
  • Keep your availability and crew days current -- auto-schedule books
    against them, so a day you are not free needs to be marked not free.
  • It applies only to ${who}, not to anyone else you work with.
  • You can switch it back off whenever you like, and so can they.

THIS IS YOURS TO DECIDE
  ${who} cannot turn this on for you. If you would rather keep accepting
  each job by hand, do nothing -- that is the default and nobody is
  notified.

TO TURN IT ON
  https://${portalUrl(account?.subdomain)}
  Open your account, go to what you do, and switch on auto-schedule.

— ${who}

This is an automated message from an unmonitored address. Replies aren't received.`;

  return {
    subject: `${who}: would you like jobs booked automatically?`,
    text,
    html: textToHtml(text, `https://${portalUrl(account?.subdomain)}`),
  };
}

// A certificate is running out, or has.
//
// Sent to the SUBCONTRACTOR, because they are the only party who can fix it.
// The tone changes with how close it is: thirty days out is a reminder, three
// days is a request, and past the date with work already booked is the one
// that says so plainly -- their job is not cancelled, and that is exactly why
// somebody has to act rather than assume it was handled.
//
// `daysOut` is the milestone this was sent at: 30, 14, 3, 0, or -1 for
// "lapsed, and there is booked work over it".
export function docExpiryEmail({ company, contact, kind, expiresOn, daysOut, account, jobs = [] }) {
  const who = account?.name || "our team";
  const name = { insurance: "insurance certificate", bond: "bond",
    contract: "signed contract", w9: "W-9" }[kind] || kind;
  const lapsed = daysOut !== null && daysOut < 0;
  const urgent = daysOut === -1;

  const lead = urgent
    ? `Your ${name} expired on ${expiresOn}, and you have work booked with ${who} after that date.`
    : lapsed || daysOut === 0
      ? `Your ${name} expires today (${expiresOn}).`
      : `Your ${name} expires on ${expiresOn} — ${daysOut} day${daysOut === 1 ? "" : "s"} from now.`;

  const jobBlock = urgent && jobs.length ? `
WORK ALREADY BOOKED
${jobs.map((j) => `  ${j.date || "date not set"}  ${j.title || "Job"}`).join("\n")}

  These are NOT cancelled. Nobody is stranding your crew over paperwork.
  But they are not covered either, which is a problem for you as much as
  for ${who}.
` : "";

  const text = `Hi ${contact || company.company},

${lead}
${jobBlock}
WHAT HAPPENS IF IT LAPSES
  ${who} cannot issue you new work orders without current cover. Work
  already on your calendar stays on your calendar.

WHAT TO DO
  Upload the replacement at
  https://${portalUrl(account?.subdomain)}/documents

  Your renewal certificate from your ${kind === "bond" ? "surety" : "carrier"} is all that is
  needed. A photo or a PDF is fine.${urgent ? "\n\n  If it is already renewed and just not uploaded, that is a one-minute job\n  and worth doing now." : ""}

— ${who}

This is an automated message from an unmonitored address. Replies aren't received.`;

  return {
    subject: urgent
      ? `Action needed: your ${name} has expired and you have work booked`
      : lapsed || daysOut === 0
        ? `Your ${name} expires today`
        : `Your ${name} expires in ${daysOut} days`,
    text,
    html: textToHtml(text, `https://${portalUrl(account?.subdomain)}/documents`),
  };
}

// A broadcast landing on an opted-in contractor.
//
// This is a stranger's emergency, so it says what the work is, roughly where,
// what it pays and how long they have -- and nothing that would let anybody
// treat it as a lead list. It names the account, because a contractor being
// asked to drive somewhere on a Sunday is entitled to know who is asking.
//
// The street address is NOT here. Until they are picked they need the area, not
// the door; the account has not chosen to hand them a property.
export function overflowPostEmail({ company, contact, account, job, trade, severity, split, expiresAt, scope }) {
  const who = account?.name || "A SubSub account";
  const urgent = severity === "911" || severity === "urgent";
  const where = [job?.area, job?.zip].filter(Boolean).join(" ");
  const pay = split?.gross
    ? `  Up to ${money(split.gross / 100)}${split.fee ? ` (SubSub's fee ${money(split.fee / 100)}, you clear ${money(split.net / 100)})` : ""}`
    : "  Not stated — quote them";

  const text = `Hi ${contact || company.company},

${who} needs ${trade} cover${urgent ? " urgently" : ""} and has nobody on their
own list free. You are getting this because you opted in to overflow work.

THE JOB
  Trade: ${trade}${where ? `
  Area: ${where}` : ""}${job?.date ? `
  Date: ${niceDate(job.date)}` : ""}${scope ? `
  Scope: ${String(scope).slice(0, 400)}` : ""}

WHAT IT PAYS
${pay}

HOW LONG YOU HAVE
  ${niceDate(expiresAt, true)}

  After that the post closes. Answering is not a commitment -- ${who} still
  chooses, and nothing goes on your calendar until they do and a work order is
  issued.

TO ANSWER
  https://${portalUrl(account?.subdomain)}

  Say when you could be there and what you would do it for. If it is not for
  you, ignore this -- nothing happens and nothing is held against you.

— SubSub

This is an automated message from an unmonitored address. Replies aren't received.`;

  return {
    subject: urgent
      ? `${trade} needed${where ? ` in ${where}` : ""} — ${who}`
      : `Overflow work: ${trade}${where ? ` in ${where}` : ""}`,
    text,
    html: textToHtml(text, `https://${portalUrl(account?.subdomain)}`),
  };
}

export function workOrderIssuedEmail({ company, contact, job, trade, woNumber, account, respondBy }) {
  const who = account?.name || "our team";
  const text = `Hi ${contact || company.company},

${who} has issued you a work order.

  ${woNumber}
  ${job?.title || "Job"}
  Trade: ${trade || "—"}${job?.address ? `
  Where: ${[job.address, job.area, job.zip].filter(Boolean).join(", ")}` : ""}${job?.date ? `
  Starts: ${niceDate(job.date)}` : ""}${respondBy ? `
  Respond by: ${niceDate(respondBy, true)}` : ""}

Open it in your portal to accept or decline:
  https://${portalUrl(account?.subdomain)}

— ${who}

This is an automated message from an unmonitored address. Replies aren't received.`;
  return {
    subject: `${woNumber} — ${job?.title || "new work order"}`,
    text,
    html: textToHtml(text, `https://${portalUrl(account?.subdomain)}`),
  };
}

export function applicationReceivedEmail({ companyName, contact, account }) {
  const who = account?.name || "the team";
  const text = `Hi ${contact || companyName},

Thanks — ${who} has your application for ${companyName}.

They'll review it and come back to you. If they take you on, the next step is
uploading your compliance documents: a certificate of insurance, a surety bond,
a signed subcontractor agreement and a W-9. Nothing can be assigned to you until
all four are verified, so having them ready is the fastest route to work.

You'll be able to upload them here once your account is opened:
  https://${portalUrl(account?.subdomain)}

— ${who}

This is an automated message from an unmonitored address. Replies aren't received.`;
  return { subject: `We received your application to ${who}`, text, html: textToHtml(text, null) };
}

// What a tenant is sent when their building manager sets them up.
//
// It has one job, and it is not to explain a product: somebody who has just
// been told they can report a leak online needs to know who it is from, what
// it is for, and where to click. Everything else can wait until they are in.
// Inviting a subcontractor to join an account.
//
// This used to be a link the account copied out of SubSub and pasted into
// their own email, which put the one step that matters -- the message
// actually arriving -- outside the product, and left the contractor to
// discover a password screen they were never told about. SubSub sends it
// now, and the link lands on a form that takes their profile and their
// password together.
//
// Written to be read by somebody who has never heard of SubSub and has been
// asked for paperwork by a general contractor they do know. So it leads with
// who is asking, says what is wanted, and says what it is for.
export function subInviteEmail({ contact, companyName, account, link }) {
  const who = account?.name || "A general contractor";
  const text = `Hi ${contact || "there"},

${who} uses SubSub to keep subcontractor paperwork in one place, and has
invited ${companyName || "your company"} to join theirs.

Set up your account here:
  ${link}

It takes a few minutes: your company details, the trades you cover, and
your insurance, bond and W-9. Once ${who} has approved them you'll be sent
work orders through SubSub and can accept or decline them from your phone.

Your documents stay yours -- keep them current here and they are current for
every contractor you work with on SubSub, not just this one.

This link works once and expires in 30 days.

-- ${who}, through SubSub

This is an automated message from an unmonitored address. Replies aren't received.`;
  return {
    subject: `${who} has invited ${companyName || "you"} to join SubSub`,
    text,
    html: textToHtml(text, link),
  };
}

// Adding somebody who works at the account -- a manager, another admin, a
// building owner with a seat.
//
// Adding them used to send nothing at all: a users row, a membership, and
// silence. Whoever was added found out by being told, and got in by noticing
// a link on the sign-in screen that did not say it was for them. This is the
// third of the three invites and it completes the set.
export function userInviteEmail({ name, account, role, invitedBy, link }) {
  const who = account?.name || "your team";
  const what = {
    admin: "an admin, so you can change anything on the account",
    pm: "a manager, so you can raise jobs and assign contractors",
    owner: "a building owner, so you can see and request work at your buildings",
    contractor: "a contractor, so you can see and answer your work orders",
    tenant: "a resident, so you can report repairs",
  }[role] || "a member of the account";
  const by = invitedBy ? `${invitedBy} has` : "You have been";
  const text = `Hi ${name || "there"},

${by} ${invitedBy ? "added you to" : "added to"} ${who} on SubSub, as ${what}.

Choose a password and you're in:
  ${link}

SubSub is where ${who} keeps its subcontractors, their insurance and licences,
and the work orders that go out to them.

This link works once and expires in 30 days. If you weren't expecting it, you
can ignore it -- nothing happens until you use it.

-- ${who}, through SubSub

This is an automated message from an unmonitored address. Replies aren't received.`;
  return {
    subject: `${invitedBy ? `${invitedBy} added you to` : "You've been added to"} ${who} on SubSub`,
    text,
    html: textToHtml(text, link),
  };
}

// The same invite, short enough to survive one text message. Written to be
// read on a lock screen on a roof: who is asking, what it is, the link.
export function subInviteSms({ companyName, account, link }) {
  const who = account?.name || "A contractor";
  return `${who} has invited ${companyName || "you"} to join them on SubSub. `
    + `Set up your account and upload your insurance and licence here: ${link}`;
}

export function tenantInviteEmail({ firstName, account, propertyName, unit, link }) {
  const who = account?.name || "your building manager";
  const place = [propertyName, unit ? `Unit ${unit}` : null].filter(Boolean).join(", ");
  const text = `Hi ${firstName || "there"},

${who} has set you up to report repairs at ${place || "your building"}.

Choose a password and you're in:
  ${link}

After that you can report anything that needs fixing -- a leak, no heat, a
door that won't lock -- and see what's happening with it, without calling
anybody. Photos of the problem help, if you have them.

Only you can see what you report.

-- ${who}

This is an automated message from an unmonitored address. Replies aren't received.`;
  return {
    subject: `${who}: report repairs at ${place || "your building"}`,
    text,
    html: textToHtml(text, link),
  };
}

// The same, short enough to survive a single text message. Written to be
// read on a lock screen: who, what, link.
export function tenantInviteSms({ account, propertyName, unit, link }) {
  const who = account?.name || "Your building manager";
  const place = [propertyName, unit ? `Unit ${unit}` : null].filter(Boolean).join(", ");
  return `${who}: you can now report repairs at ${place || "your building"} online. `
    + `Set your password: ${link}`;
}

// What a tenant is told when something they reported moves. One sentence
// per stage, in the stage's own words -- the same words the portal shows,
// so the message and the screen never disagree about where a report is.
export const TENANT_STAGE_WORDS = {
  approved: "has been approved, and a contractor is being arranged",
  arranging: "has gone to a contractor, who is finding a time",
  booked: "has a contractor assigned -- a time still needs arranging with you",
  visit: (detail) => `has a visit proposed for ${detail}. Please confirm it in the app, or say if it doesn't work`,
  scheduled: (detail) => `is scheduled for ${detail}`,
  declined: (detail) => `hasn't been approved: ${detail}`,
  done: "is done",
};
// `detail` is whatever that stage needs said with it -- the time for a
// visit, the reason for a decline.
const stageWords = (stage, detail) => {
  const w = TENANT_STAGE_WORDS[stage];
  return typeof w === "function" ? w(detail || "a time to be confirmed") : (w || "has been updated");
};
// "Thu, Oct 2, 2026, 9 AM–11 AM": the date the way niceDate says it, the
// window in 12-hour clock, because that is how somebody says it aloud.
const clock12 = (hhmm) => {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  if (Number.isNaN(h)) return "";
  return `${((h + 11) % 12) + 1}${m ? ":" + String(m).padStart(2, "0") : ""} ${h >= 12 ? "PM" : "AM"}`;
};
export function visitWhen(v) {
  if (!v?.date) return "";
  const win = v.start_time || v.startTime
    ? `, ${clock12(v.start_time || v.startTime)}${(v.end_time || v.endTime) ? `–${clock12(v.end_time || v.endTime)}` : ""}` : "";
  return `${niceDate(v.date)}${win}`;
}
export function tenantStatusEmail({ firstName, account, title, stage, link, detail }) {
  const who = account?.name || "Your building manager";
  const what = stageWords(stage, detail);
  const text = `Hi ${firstName || "there"},

Your report "${title}" ${what}.

You can see where it is, and anything else you've reported, here:
  ${link}

-- ${who}

You're getting this because you asked to be told when a report changes.
You can switch it off under My account. This is an automated message from
an unmonitored address. Replies aren't received.`;
  const subject = stage === "visit" ? `${who}: a time for "${title}" — please confirm`
    : stage === "done" ? `${who}: "${title}" is done`
    : stage === "declined" ? `${who}: "${title}" wasn't approved`
    : `${who}: "${title}" has moved`;
  return { subject, text, html: textToHtml(text, link) };
}
export function tenantStatusSms({ account, title, stage, link, detail }) {
  const who = account?.name || "Your building manager";
  return `${who}: your report "${title}" ${stageWords(stage, detail)}. ${link}`;
}

// Where the link goes in a draft somebody is editing. The token is
// substituted at the moment of sending, not when the draft is composed,
// because the link does not exist yet: sending mints a fresh token and
// revokes whatever came before it.
export const INVITE_LINK_TOKEN = "{link}";

// Put the link back into wording somebody has edited. An invite with no way
// in is not an invite, so a draft that no longer mentions the token gets it
// appended rather than sent without one.
export function withInviteLink(text, link) {
  const body = String(text || "").trim();
  if (!body) return link;
  return body.includes(INVITE_LINK_TOKEN)
    ? body.split(INVITE_LINK_TOKEN).join(link)
    : `${body}\n\n${link}`;
}

// A manager's own wording, delivered exactly the way the default is: same
// plain text, same minimal HTML. An edited invite must not arrive looking
// like a different kind of message from an unedited one.
export function customInviteEmail({ subject, text, link }) {
  const body = withInviteLink(text, link);
  return { subject: String(subject || "").trim(), text: body, html: textToHtml(body, link) };
}

// A plain-text message rendered as minimal HTML. Deliberately not a designed
// template: these are operational notices, they have to survive every client,
// and the text part stays the source of truth.
function textToHtml(text, link) {
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const body = esc(text).replace(/\n/g, "<br>");
  const linked = link
    ? body.replace(esc(link), `<a href="${esc(link)}" style="color:#1B4835">${esc(link)}</a>`)
    : body;
  return `<div style="font:14px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#12211C;max-width:640px">${linked}</div>`;
}

// ---- Delivery -------------------------------------------------------------

// Returns a result rather than throwing: a failed notification must not undo
// the action that triggered it, and the caller decides whether to surface it.
export async function sendEmail(env, { to, subject, text, html, replyTo }) {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) {
    return { ok: false, error: "mail_not_configured" };
  }
  if (!to) return { ok: false, error: "no_recipient" };

  let res, body;
  try {
    // RESEND_API_BASE exists so this path can be exercised against a local
    // stand-in; unset, it is Resend.
    const base = env.RESEND_API_BASE || "https://api.resend.com";
    res = await fetch(`${base}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.MAIL_FROM,
        to: [to],
        subject,
        text,
        html,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });
    body = await res.json().catch(() => ({}));
  } catch (err) {
    return { ok: false, error: "unreachable", detail: String(err?.message || err) };
  }
  if (!res.ok) {
    return { ok: false, error: "send_failed", status: res.status,
      detail: body?.message || body?.name || "" };
  }
  return { ok: true, id: body?.id || null };
}

// Somebody wants to work with a contractor who is ALREADY on SubSub.
//
// This one is different from the invite above in the way that matters: they
// do not have to do anything to join, because they already have. Their
// profile, their crews, their insurance and their licence are on file and
// current. What is being asked is permission to see them.
//
// So the email says that plainly, and it says what accepting hands over.
// A contractor who cannot tell the difference between this and a signup
// will read it as more paperwork and leave it.
export function connectRequestEmail({ account, company, message, link }) {
  const who = account?.name || "A contractor";
  const text = `Hi ${company?.contact || "there"},

${who} wants to work with ${company?.company || "your company"} on SubSub.

You are already set up, so there is nothing to fill in. Say yes and they can
send you work orders; your profile, crews, insurance and licence go with you
exactly as they are.
${message ? `\n${who} added: "${message}"\n` : ""}
Answer here:
  ${link}

Accepting lets ${who} see your trades, your crews, your availability and the
compliance documents you keep on SubSub -- the same things every contractor
you work with here can see. It does not give them anything else, and you can
end it later.

If you were not expecting this, decline it. Nothing is shared until you accept.

-- ${who}, through SubSub

This is an automated message from an unmonitored address. Replies aren't received.`;
  return {
    subject: `${who} wants to work with you on SubSub`,
    text,
    html: textToHtml(text, link),
  };
}

// The same, on a lock screen. The one thing it must carry is that this is a
// yes/no, not a form.
export function connectRequestSms({ account, link }) {
  const who = account?.name || "A contractor";
  return `${who} wants to work with you on SubSub. You're already set up -- `
    + `nothing to fill in, just accept or decline: ${link}`;
}

// The account-user invite, short enough for one text message. Same rule as
// the subcontractor one: who is asking, what it is, the link.
export function userInviteSms({ account, role, link }) {
  const who = account?.name || "A company";
  const what = role === "contractor"
    ? "so you can see and answer your work orders"
    : role === "owner" ? "so you can see and request work at your buildings"
    : role === "tenant" ? "so you can report repairs"
    : "so you can use the account";
  return `${who} has added you on SubSub, ${what}. Choose a password here: ${link}`;
}

// A work order, on a lock screen. The three things that decide whether
// somebody turns up: who wants the work, what trade, and by when they have
// to answer.
export function workOrderIssuedSms({ job, trade, woNumber, account, respondBy }) {
  const who = account?.name || "A contractor";
  const where = job?.address ? ` at ${job.address}` : "";
  const by = respondBy ? ` Reply by ${String(respondBy).slice(0, 10)}.` : "";
  return `${who} has sent you work order ${woNumber} — ${trade}${where}.${by} `
    + `Accept or decline it in SubSub.`;
}
