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

import { footerText, footerSms } from "../shared/claim.js";
import { INSURANCE_LINES, BOND_MIN, checkItems, problemsIn,
  outcomeWords } from "../shared/doccheck.js";
// The kinds and their words come from shared/docs.js, which is the one list, for
// the same reason the checklist below does: an email naming a document by a word
// no screen uses is an email about a row the reader cannot find. Re-exported
// because this file's own exports were the copy.
// Imported and then re-exported, NOT `export ... from`: that re-exports
// without binding either name in this file, so `missingDocs` below throws on
// `DOC_KINDS` -- a module that loads fine and fails on the first email sent.
import { DOC_KINDS, DOC_LABELS } from "../shared/docs.js";
import { REPLY_MARKER } from "../shared/messaging.js";
import { hiresLabelFor } from "../shared/hires.js";
import { SMS_INCLUDED_SCALE } from "../shared/smsquota.js";
export { DOC_KINDS, DOC_LABELS };
// The schedule and the checklist come from shared/doccheck.js, which is the one
// list. They were copied here, and agreed with the app by luck -- which stopped
// being survivable the moment `docFindingsEmail` had to name the specific line a
// reviewer marked wrong: two lists means an email naming a line the screen never
// asked about.

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
${checkItems("insurance", who).map((a) => `  • ${a.label}`).join("\n")}
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

// A document that is nearly right, and what is wrong with it.
//
// This is the mail the review screen could not send. A reviewer who found the
// hiring account missing from the additional insured schedule had one move --
// reject the certificate -- and what went out was `docRequestEmail`, the
// generic "upload your compliance documents" notice, about a document the
// subcontractor had already uploaded. So the commonest correctable problem in
// construction compliance was reported as though nothing had arrived.
//
// Three things about it are decisions rather than layout.
//
// IT SAYS WHAT WAS RIGHT AS WELL AS WHAT WAS NOT. A list of four faults with no
// mention of the eight lines that were fine reads as "start again", and the
// commonest answer to that is a phone call asking what is actually wanted.
//
// EACH FAULT CARRIES ITS OWN INSTRUCTION. "Ask your agent to add Outerhome as
// an additional insured" is something somebody forwards to their broker in one
// go. The same sentence inside a paragraph about three other things is a
// paragraph that gets re-read and half-actioned.
//
// AND IT DOES NOT SAY "REJECTED" WHERE THERE ARE FINDINGS. The verdict stored
// is still `rejected` -- see shared/doccheck.js for why there is no fourth
// status -- but a subcontractor reading "your certificate of insurance was
// rejected" goes looking for a new policy, and what is wanted is an endorsement.
// The words follow the findings.
export function docFindingsEmail({ company, contact, account, kind, review, note }) {
  const who = account?.name || "our team";
  const name = DOC_LABELS[kind] || "your document";
  const inline = (DOC_LABELS[kind] || "document").toLowerCase();
  const problems = problemsIn(review, kind, who);
  const items = checkItems(kind, who);
  const words = outcomeWords(review, kind, who);
  // What they got right, which is the half that stops this reading as a refusal.
  const fine = items.filter((it) => !problems.some((p) => p.id === it.id)
    && (review?.findings?.[it.id]?.state === "ok" || review?.checks?.[it.id] === true));

  const problemBlock = problems.length ? `
WHAT NEEDS FIXING
${problems.map((p, i) => `  ${i + 1}. ${p.label}
     ${p.fix || "Please correct this and send it again."}`).join("\n\n")}
` : `
WHAT NEEDS FIXING
  ${note ? note : "See the note below."}
`;

  const fineBlock = fine.length ? `
WHAT IS ALREADY FINE
${fine.map((f) => `  \u2713 ${f.label}`).join("\n")}
` : "";

  const noteBlock = note && problems.length ? `
ALSO FROM ${who.toUpperCase()}
  ${note}
` : "";

  const text = `Hi ${contact || company.company},

${who} has read the ${inline} you sent and there ${problems.length === 1 ? "is one thing" : problems.length ? `are ${problems.length} things` : "is something"} to correct before it can be accepted. Everything else on it is fine \u2014 you do not need to start again.
${problemBlock}${fineBlock}${noteBlock}
WHEN YOU HAVE IT
  Upload the corrected ${inline} here \u2014 it replaces the one on file, and
  nothing else about your account changes.

  ${docsLink(account?.subdomain)}

  Your username: ${company.email || "(no email on file)"}

A photo from your phone is fine as long as the figures are readable.

\u2014 ${who}

This is an automated message from an unmonitored address. Replies aren't received, and documents emailed back won't be filed. Please upload them at the link above.`;

  return {
    // Not "rejected". The subject line is what decides whether this gets opened
    // today or next week, and one naming the document plus the number of fixes
    // is a task where "rejected" is bad news to be avoided.
    subject: problems.length
      ? `${name}: ${words.headline}`
      : `${name}: needs correcting`,
    text,
    html: textToHtml(text, docsLink(account?.subdomain)),
    problems,
    kind,
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
  // The link lands ON the switch (Job Settings, Availability tab, rung), and
  // the path is spelled out under it, because "open your account and go to
  // what you do" named no screen at all.
  const autoLink = `https://${portalUrl(account?.subdomain)}/?open=auto-schedule`;
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
  ${autoLink}
  That link opens the switch. To find it yourself after signing in:
  Menu > Job Settings > Availability > Auto-schedule.

— ${who}

This is an automated message from an unmonitored address. Replies aren't received.`;

  return {
    subject: `${who}: would you like jobs booked automatically?`,
    text,
    html: textToHtml(text, autoLink),
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

  These are NOT canceled. Nobody is stranding your crew over paperwork.
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

// 074. EVERY WORK ORDER SAYS HOW IT WAS SENT, AND CARRIES THE CLAIM LINK.
// `claimLink` is null on a database without 074, and the footer still says
// "Sent via SubSub" -- the line is the attribution, the link is the way in.
// There is no parameter that leaves the footer off, on purpose: no plan
// removes it.
export function workOrderIssuedEmail({ company, contact, job, trade, woNumber, account, respondBy,
  claimLink = null }) {
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

This is an automated message from an unmonitored address. Replies aren't received.

${footerText(claimLink)}`;
  return {
    subject: `${woNumber} — ${job?.title || "new work order"}`,
    text,
    html: linkAlso(textToHtml(text, `https://${portalUrl(account?.subdomain)}`), claimLink),
  };
}

// A second link in a message textToHtml only linked one of. Escaped the same
// way, so the claim URL it finds is the one the text printed.
export function linkAlso(html, link) {
  if (!link) return html;
  const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return html.replace(esc(link), `<a href="${esc(link)}" style="color:#1B4835">${esc(link)}</a>`);
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

// What somebody who signed up on the marketing site is sent, from us.
//
// Signing up sent nothing of SubSub's own. The only mail was Supabase's
// confirmation, from its own sender, which SubSub cannot see and which lands
// in Junk on an iCloud address as often as not -- so a new customer could
// finish the form, hear nothing, and have no way to find out why, while the
// console said "Nothing has been sent to this account yet". This one goes
// through our own domain, is logged like every other mail, and says how to
// get in, including what to do when the confirmation does not arrive.
//
// The way in follows what signup actually did, because the form no longer
// takes a password: with confirmation on it is the confirmation link; with it
// off, the password is one nobody was told, so it is "Forgot password?". A
// sentence telling somebody to "sign in with your password" over an account
// whose password nobody knows is the dead end this exists to remove.
// Sentences are not hard-wrapped here: the HTML keeps every newline, so a
// wrap at 80 columns breaks a sentence in half in every mail client.
export function welcomeEmail({ firstName, companyName, email, planName, needsConfirmation, hasPassword }) {
  const app = "https://app.subsub.work";
  const steps = needsConfirmation
    ? `To sign in for the first time:
  1. Open the confirmation email (it usually reads "Confirm your signup"). It is sent separately from this one, sometimes under the name "Supabase Auth", so check Junk if you don't see it.
  2. Press the link in it, then choose your password.
  3. After that, sign in any time at ${app}

If it hasn't arrived in ten minutes, go to ${app}, press "Forgot password?" and enter ${email}. That sends a fresh link.`
    : hasPassword
      ? `Sign in any time at ${app} with ${email} and the password you chose.`
      : `To sign in for the first time, go to ${app}, press "Forgot password?" and enter ${email}. You'll get a link to choose your password.`;
  const text = `Hi ${firstName || "there"},

Welcome to SubSub. ${companyName} is set up on the ${planName} plan${planName === "Basic" ? ", which is free, with no card and no expiry" : ""}.

${steps}

-- The SubSub team

This is an automated message from an unmonitored address. Replies aren't received.`;
  return { subject: `Welcome to SubSub: ${companyName} is set up`, text, html: textToHtml(text, app) };
}

// A note from the founder to a new Basic account, sent with the welcome.
//
// Only to an account that HIRES and chose Basic. Scale has already decided.
// A subcontractor account is free forever and is never shown an upgrade,
// which is the rule the signup form's free line follows; a Scale pitch to
// somebody who will never pay for one is the upsell that rule refuses.
//
// It is from Richard by name and replies reach him, because the whole point
// is a person to talk to. The demo link is SubSub's own booking page, which
// reads Richard's real Cal calendar and keeps the booking under SubSub's name.
// The photo is drawn only once FOUNDER.photo is set; until then the signature
// carries initials, never a broken image.
export const FOUNDER = {
  name: "Richard Braun",
  title: "Founder & CEO, SubSub",
  email: "rb@subsub.work",
  photo: null,   // e.g. "https://subsub.work/richard-braun.png"
  demoUrl: "https://subsub.work/book-a-demo.html?utm_source=email&utm_campaign=founder_intro",
};

// Shared by both versions of the founder's note: one look, one signature.
const FX = "font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif";
const fEsc = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fP = (v) => `<p style="margin:0 0 14px;${FX};font-size:15px;line-height:1.6;color:#12211C">${v}</p>`;
const fH = (v) => `<p style="margin:6px 0 8px;${FX};font-size:15px;font-weight:700;color:#103528">${v}</p>`;
const fList = (items, tag = "ul") => `<${tag} style="margin:0 0 18px;padding-left:22px;${FX};font-size:15px;line-height:1.55;color:#12211C">`
  + items.map((l) => `<li style="margin:0 0 6px">${fEsc(l)}</li>`).join("") + `</${tag}>`;
const fButton = (label) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 22px"><tr><td bgcolor="#E39B32" style="background:#E39B32;border-radius:8px">`
  + `<a href="${fEsc(FOUNDER.demoUrl)}" style="display:inline-block;padding:13px 22px;${FX};font-size:15px;font-weight:700;color:#103528;text-decoration:none">${fEsc(label)}</a></td></tr></table>`;
const FOOT = "SubSub, LLC, 4616 25th Ave NE, Seattle, WA 98105. You're getting this one note because you signed up for SubSub.";
function founderSignatureText() {
  return `${FOUNDER.name}\n${FOUNDER.title}\n${FOUNDER.email}\n\n${FOOT}`;
}
function founderHtml(inner) {
  const avatar = FOUNDER.photo
    ? `<img src="${fEsc(FOUNDER.photo)}" width="64" height="64" alt="${fEsc(FOUNDER.name)}" style="display:block;width:64px;height:64px;border-radius:32px;border:0">`
    : `<div style="width:64px;height:64px;border-radius:32px;background:#103528;color:#E39B32;${FX};font-size:22px;font-weight:700;line-height:64px;text-align:center">RB</div>`;
  const sig = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 6px;border-top:1px solid #DDE4E0"><tr>`
    + `<td style="padding:16px 14px 0 0;vertical-align:top">${avatar}</td>`
    + `<td style="padding-top:16px;vertical-align:top;${FX};font-size:14px;line-height:1.5;color:#12211C">`
    + `<div style="font-size:16px;font-weight:700">${fEsc(FOUNDER.name)}</div>`
    + `<div style="color:#5D6F67">${fEsc(FOUNDER.title)}</div>`
    + `<div><a href="mailto:${fEsc(FOUNDER.email)}" style="color:#1B4835">${fEsc(FOUNDER.email)}</a> · <a href="https://subsub.work" style="color:#1B4835">subsub.work</a></div>`
    + `</td></tr></table>`
    + `<p style="margin:18px 0 0;${FX};font-size:12px;line-height:1.5;color:#5D6F67">${FOOT}</p>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;border-collapse:collapse">`
    + `<tr><td bgcolor="#103528" style="background:#103528;padding:18px 24px;border-radius:10px 10px 0 0">`
    + `<img src="${EMAIL_LOGO_URL}" width="176" height="40" alt="SubSub" style="display:block;border:0;color:#FFFFFF;font:700 22px -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">`
    + `</td></tr><tr><td style="padding:24px;border:1px solid #DDE4E0;border-top:0;border-radius:0 0 10px 10px">${inner}${sig}</td></tr></table>`;
}
const founderSubject = (firstName) => `${firstName ? `${firstName}, a` : "A"} quick hello from SubSub's founder`;
const founderEnvelope = () => ({ replyTo: FOUNDER.email, fromName: `${FOUNDER.name} at SubSub` });

export function founderIntroEmail({ firstName, companyName, kind }) {
  if (kind === "subcontractor") return founderSubEmail({ firstName, companyName });
  const sub = hiresLabelFor(kind);          // "subcontractor" or "contractor"
  const subs = `${sub}s`;
  const texts = SMS_INCLUDED_SCALE.toLocaleString("en-US");
  const free = [
    `Every ${sub}'s insurance, bond, W-9 and license in one place, with the expiry date live, so a lapsed certificate is caught before the job rather than after.`,
    `A work order for each trade, sent, accepted and changed in the app, with every change order numbered.`,
    `Crews scheduled onto jobs, with the time confirmed by whoever has to be there.`,
    `Your ${subs} use SubSub free and keep their own documents current, so you stop chasing PDFs.`,
  ];
  const scale = [
    `Unlimited ${subs}, users and jobs. Basic covers 3 ${subs}, 1 user and 5 jobs a month.`,
    `Your own logo and sign-in address, yourcompany.subsub.work, on every screen and work order.`,
    `A recruiting QR code: a ${sub} you meet on site scans it and fills in their own details.`,
    `Lien waivers asked for and signed against each payment.`,
    `Jobs posted straight in from your CRM, with nothing retyped.`,
    `${texts} text messages a month for work orders and updates.`,
  ];
  const company = companyName || "your company";
  const text = `Hi ${firstName || "there"},

I'm ${FOUNDER.name}, founder and CEO of SubSub. Thanks for setting up ${company}.

I'd like to walk you through it myself. Pick a time that suits you and we'll spend 30 minutes on your own ${subs} and paperwork, not a slide deck:

${FOUNDER.demoUrl}

What SubSub does for you on Basic, today:
${free.map((l) => `  - ${l}`).join("\n")}

When you're ready for more, Scale starts at $99 a month and adds:
${scale.map((l) => `  - ${l}`).join("\n")}

If anything isn't working the way you need, reply to this email. It comes straight to me.

${founderSignatureText()}`;
  const inner = fP(`Hi ${fEsc(firstName || "there")},`)
    + fP(`I'm ${fEsc(FOUNDER.name)}, founder and CEO of SubSub. Thanks for setting up ${fEsc(company)}.`)
    + fP(`I'd like to walk you through it myself. Pick a time that suits you and we'll spend 30 minutes on your own ${fEsc(subs)} and paperwork, not a slide deck.`)
    + fButton("Pick a time with me")
    + fH("What SubSub does for you on Basic, today") + fList(free)
    + fH("When you're ready for more, Scale starts at $99 a month and adds") + fList(scale)
    + fP("If anything isn't working the way you need, reply to this email. It comes straight to me.");
  return { subject: founderSubject(firstName), text, html: founderHtml(inner), ...founderEnvelope() };
}

// The subcontractor's version. Same sender and signature, a different letter:
// they are free for good, so it names no plan, no price and no count -- the
// rule the signup form's free line follows -- and asks rather than sells.
// Three questions, numbered so a reply can answer "1. ..." on a phone.
export function founderSubEmail({ firstName, companyName }) {
  const company = companyName || "your company";
  const asks = [
    "Where did you hear about SubSub?",
    "What made you sign up? What were you hoping it would fix?",
    "What does a successful partnership with a general contractor or property manager look like to you?",
  ];
  const gets = [
    "Your compliance pack, sent as a live link rather than PDFs that go stale. When your insurance renews, everyone you sent it to sees the new one.",
    "Your own QR code. A GC on site scans it and asks to work with you, no business card needed.",
    "Job requests, times and work orders from every client in one place, with nothing to pay, ever.",
  ];
  const text = `Hi ${firstName || "there"},

I'm ${FOUNDER.name}, founder and CEO of SubSub. Thanks for setting up ${company}. SubSub is free for you, for good.

I'm building this for crews like yours, so I'd love to hear from you. Three quick questions, and a one-line answer to any of them helps:

${asks.map((q, i) => `  ${i + 1}. ${q}`).join("\n")}

Just reply to this email. It comes straight to me. If talking is easier, pick a time:

${FOUNDER.demoUrl}

What's in it for you:
${gets.map((l) => `  - ${l}`).join("\n")}

${founderSignatureText()}`;
  const inner = fP(`Hi ${fEsc(firstName || "there")},`)
    + fP(`I'm ${fEsc(FOUNDER.name)}, founder and CEO of SubSub. Thanks for setting up ${fEsc(company)}. SubSub is free for you, for good.`)
    + fP("I'm building this for crews like yours, so I'd love to hear from you. Three quick questions, and a one-line answer to any of them helps:")
    + fList(asks, "ol")
    + fP("<b>Just reply to this email.</b> It comes straight to me. If talking is easier, pick a time:")
    + fButton("Pick a time to talk")
    + fH("What's in it for you") + fList(gets);
  return { subject: founderSubject(firstName), text, html: founderHtml(inner), ...founderEnvelope() };
}

// A demo booked on book-a-demo.html, in SubSub's own voice and from SubSub's
// own address. Cal sends its confirmation as Cal, under Cal's logo; this is
// the one the person should read, so it says the time in their own zone, the
// link to join, and how to move it. The calendar invite itself comes from the
// host's Google Calendar, which is already SubSub's address.
export function demoBookedEmail({ name, start, end, timeZone, meetingUrl }) {
  const tz = timeZone || "America/Los_Angeles";
  const at = new Date(start);
  let when;
  try {
    const day = at.toLocaleDateString("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric", year: "numeric" });
    const t = (d) => d.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
    const zone = at.toLocaleTimeString("en-US", { timeZone: tz, timeZoneName: "short" }).split(" ").pop();
    const fin = end ? new Date(end) : new Date(at.getTime() + 30 * 60_000);
    when = `${day}, ${t(at)} to ${t(fin)} ${zone}`;
  } catch {
    when = at.toUTCString();
  }
  const first = String(name || "").trim().split(/\s+/)[0] || "there";
  const join = meetingUrl
    ? `Join on Google Meet: ${meetingUrl}`
    : "The Google Meet link is in the calendar invite.";
  const text = `Hi ${first},

Your SubSub demo is booked.

When: ${when}

${join}

A calendar invite is on its way too, so it lands on your calendar with the link in it. If you need a different time, reply to that invite or go to https://subsub.work/book-a-demo.html and pick another.

Thirty minutes, on your own paperwork rather than a slide deck. Bring the vendor list you're chasing.

-- The SubSub team`;
  return { subject: `Your SubSub demo: ${when}`, text, html: textToHtml(text, meetingUrl || "https://subsub.work") };
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
//
// `known` says the invite was raised from a contractor already ON the roster:
// the account typed their company, their contact and their trades in, so the
// link opens a password box and nothing else. Promising "a few minutes: your
// company details, the trades you cover" to that person describes a form they
// will never see, and is why an invite that only wanted a password read like
// a fresh application and went unopened. One predicate decides which wording
// runs and which screen renders (`inviteKnownEnough` in the Worker), because
// the email and the page disagreeing about it is the whole bug.
export function subInviteEmail({ contact, companyName, account, link, known = false }) {
  const who = account?.name || "A general contractor";
  const text = known ? `Hi ${contact || "there"},

${who} uses SubSub to keep subcontractor paperwork in one place, and has
already added ${companyName || "your company"} to theirs. Your details are in --
the only thing missing is a password of your own.

Choose one here:
  ${link}

That is the whole job. Once you are in you can upload your insurance, bond,
W-9 and signed agreement, and after ${who} has approved them you'll be sent
work orders through SubSub and can accept or decline them from your phone.

If anything ${who} typed is wrong, the same page lets you correct it.

Your documents stay yours -- keep them current here and they are current for
every contractor you work with on SubSub, not just this one.

This link works once and expires in 30 days.

-- ${who}, through SubSub

This is an automated message from an unmonitored address. Replies aren't received.` : `Hi ${contact || "there"},

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
    subject: known
      ? `${who} has added ${companyName || "you"} to SubSub — choose a password`
      : `${who} has invited ${companyName || "you"} to join SubSub`,
    text,
    html: textToHtml(text, link),
  };
}

// A subcontractor sending their own paperwork to somebody who asked for it.
//
// Written from the SUBCONTRACTOR, not from SubSub. The recipient asked a
// person for a certificate and a person is answering; a notification from a
// platform they have never heard of is a different, worse message, and it is
// the one that gets deleted.
//
// The hook is the expiry. Anybody can attach a PDF -- what an attachment can
// never do is tell you in eight months that the cover it showed has lapsed.
export function docPackEmail({ company, contact, toName, note, link, days, kinds = [] }) {
  const who = company || "A subcontractor";
  const what = kinds.length
    ? kinds.map((k) => DOC_LABELS[k] || k).join("\n  ")
    : "Their current paperwork";
  const text = `Hi ${toName || "there"},

${contact ? `${contact} at ${who}` : who} has sent you their current
compliance paperwork${note ? `:\n\n  "${note}"` : "."}

  ${what}

Open it here:
  ${link}

The page shows the carrier, the policy number, the coverage and the expiry
date on each one, and you can download them. Nothing to sign up for.

It stays current: when ${who} renews, this page shows the new certificate
rather than the one that has lapsed. That is the part an emailed PDF cannot
do, and it is the reason they sent it this way.

This link was made for you and expires in ${days} days. ${who} can withdraw
it at any time.

-- sent by ${who}, through SubSub

This is an automated message from an unmonitored address. Replies aren't received.`;
  return {
    subject: `${who} sent you their insurance and paperwork`,
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

SubSub is where ${who} keeps its subcontractors, their insurance and licenses,
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
export function subInviteSms({ companyName, account, link, known = false }) {
  const who = account?.name || "A contractor";
  // Same split as the email: a text telling somebody to set up an account,
  // over a link that asks for a password, sends them looking for a form.
  if (known) return `${who} has added ${companyName || "you"} to SubSub. `
    + `Your details are in -- choose a password to sign in: ${link}`;
  return `${who} has invited ${companyName || "you"} to join them on SubSub. `
    + `Set up your account and upload your insurance and license here: ${link}`;
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
  // THE DEFAULT BELONGS TO THE STAGE THAT WANTS IT, not to `stageWords`.
  //
  // It lived in the lookup as `w(detail || "a time to be confirmed")`, which
  // is right for exactly these two and wrong for every stage added after
  // them: a deferral with no date came out reading *"has been put on hold: a
  // time to be confirmed"*, which is nonsense on the one message telling
  // somebody their repair is not coming yet. Each function now answers for
  // its own missing detail.
  visit: (detail) => `has a visit proposed for ${detail || "a time to be confirmed"}.`
    + " Please confirm it in the app, or say if it doesn't work",
  scheduled: (detail) => detail ? `is scheduled for ${detail}` : "has been scheduled",
  declined: (detail) => `hasn't been approved: ${detail}`,
  done: "is done",
  // 066. THE THREE ENDINGS, and the tenant who reported it is the one person
  // who otherwise finds out by the repair never happening. The fallback below
  // answers "has been updated" for an unknown stage, which is true and
  // useless on the one message that has to say the work is not coming.
  cancelled: (detail) => `has been canceled: ${detail}`,
  // A hold without a date is honest about being open-ended rather than
  // promising a day nobody has picked.
  deferred: (detail) => detail
    ? `has been put on hold: ${detail}`
    : "has been put on hold -- your manager will be in touch when it is back",
  // NOT "cancelled". Somebody read the problem and decided there was nothing
  // to fix, which is a different thing from calling the work off, and a
  // tenant told the wrong one of those rings up.
  no_work: (detail) => `has been closed with no work needed: ${detail}`,
};
// `detail` is whatever that stage needs said with it -- the time for a
// visit, the reason for a decline.
const stageWords = (stage, detail) => {
  const w = TENANT_STAGE_WORDS[stage];
  return typeof w === "function" ? w(detail || "") : (w || "has been updated");
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
    // 066. A subject line decides whether this is read today or next week,
    // and "has moved" over a repair that is not happening is the one that
    // gets left.
    : stage === "cancelled" ? `${who}: "${title}" has been canceled`
    : stage === "deferred" ? `${who}: "${title}" is on hold`
    : stage === "no_work" ? `${who}: "${title}" — nothing needed doing`
    : `${who}: "${title}" has moved`;
  return { subject, text, html: textToHtml(text, link) };
}
// A notice a manager posted to one building, sent to the people who live
// there. The notice itself is the message, so it is quoted whole rather than
// summarised: "the water is off on Tuesday from 9 to 1" is exactly the line
// somebody needs and a paraphrase would lose the hours.
export function buildingNoticeEmail({ firstName, account, propertyName, title, body, endsOn, important, link }) {
  const who = account?.name || "Your building manager";
  const until = endsOn ? `\n(This notice is up until ${endsOn}.)` : "";
  const text = `Hi ${firstName || "there"},

${who} has posted a${important ? "n important" : ""} notice for ${propertyName || "your building"}:

${title}
${body ? `\n${body}\n` : ""}${until}

You can see it, and anything you've reported, here:
  ${link}

-- ${who}

This is an automated message from an unmonitored address. Replies aren't
received; to answer it, contact ${who} the way you usually would.`;
  const subject = `${important ? "Important: " : ""}${who}: ${title}`;
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
  return { subject: String(subject || "").trim(), text: body, html: textToHtml(body, link, { keepLines: true }) };
}

// A plain-text message rendered as minimal HTML. Deliberately not a designed
// template: these are operational notices, they have to survive every client,
// and the text part stays the source of truth.
// The plain-text copy of most emails is wrapped at 80 columns for mail
// clients that show text, and HTML keeps every newline, so inside the wider
// card those wraps split sentences in half. A prose line is joined back onto
// the one before it, in the HTML only. Never an indented line (the detail
// rows and links are indented on purpose), a list item, a signature, or a line
// after one ending in a colon, which introduces what is under it.
const STANDS_ALONE = /^(\s|[-*\u2022\u2014]|\d+[.)]\s|--)/;
export function unwrapProse(text) {
  const out = [];
  for (const line of String(text).split("\n")) {
    const prev = out.length ? out[out.length - 1] : "";
    if (line.trim() && prev.trim() && !STANDS_ALONE.test(line) && !STANDS_ALONE.test(prev)
      && !/:\s*$/.test(prev)) {
      out[out.length - 1] = prev.replace(/\s+$/, "") + " " + line;
    } else out.push(line);
  }
  return out.join("\n");
}
function bodyHtml(text, link, { keepLines = false } = {}) {
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const body = esc(keepLines ? text : unwrapProse(text)).replace(/\n/g, "<br>");
  const linked = link
    ? body.replace(esc(link), `<a href="${esc(link)}" style="color:#1B4835">${esc(link)}</a>`)
    : body;
  return `<div style="font:14px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#12211C;max-width:640px">${linked}</div>`;
}

// Every email wears SubSub's header: the logo on a forest band above the body.
// Asked for in so many words -- "generally most emails should have the SubSub
// logo, wrapped like this" -- after the welcome email got it first. One helper
// draws every message, so a new email gets the header by being written at all.
//
// The logo is a PNG on subsub.work rather than inline SVG, because Gmail and
// Outlook do not draw SVG. It sits on a forest band so the white wordmark
// reads, and the alt text is white for the same reason: a client that blocks
// images shows "SubSub" on the band instead of a broken box. Tables and
// bgcolor, because that is what every mail client agrees on.
//
// An account's own words still lead the body and its name still signs it;
// the header says which product carried the message, the same as the footer
// on a work order does.
export const EMAIL_LOGO_URL = "https://subsub.work/email-logo.png";
// `keepLines` is for a message whose words are a person's rather than ours --
// a message somebody wrote, an invite an account typed -- where every line
// break is theirs and joining two lines would rewrite what they said.
function textToHtml(text, link, opts) {
  const inner = bodyHtml(text, link, opts);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;border-collapse:collapse">`
    + `<tr><td bgcolor="#103528" style="background:#103528;padding:18px 24px;border-radius:10px 10px 0 0">`
    + `<img src="${EMAIL_LOGO_URL}" width="176" height="40" alt="SubSub" style="display:block;border:0;color:#FFFFFF;font:700 22px -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">`
    + `</td></tr><tr><td style="padding:24px;border:1px solid #DDE4E0;border-top:0;border-radius:0 0 10px 10px">${inner}</td></tr></table>`;
}
export const brandedHtml = textToHtml;

// Asking somebody to sign a lien waiver.
//
// Two readers and one template. A subcontractor on the roster gets it with a
// link that opens the waiver whether or not they sign in; a supply house at
// the bottom of a chain has no account and no reason to want one, and the
// link is the whole of how they answer -- the same way every other way into
// this product already works for somebody outside it.
//
// It says WHICH of the four it is, in words, because the difference between
// conditional and unconditional is the difference between "this takes effect
// when the money clears" and "you are giving this up now", and that is the
// sentence somebody reads before deciding whether to open it at all. And it
// names the amount and the through date, since a waiver is only ever for a
// payment and up to a day -- one that does not say which is one nobody can
// check against their own books.
export function waiverRequestEmail({ toName, fromName, kindTitle, conditional, amount,
  through, job, link, uploadOnly = false, stateName = null }) {
  const who = fromName || "A customer";
  const how = uploadOnly
    ? `${stateName || "This state"} sets the exact wording of a lien waiver, so sign
it on ${stateName ? `${stateName}'s` : "the state's"} own form and upload the signed copy at the link.`
    : "You can read it and sign it at the link, or decline it there with a note.";
  const text = `Hi ${toName || "there"},

${who} has asked you for a lien waiver.

  ${kindTitle}
  Job: ${job || "—"}
  Payment: ${amount}
  For work through: ${through}

${conditional
    ? "It is conditional: it only takes effect once you have actually received\nthe payment."
    : "It is UNCONDITIONAL: it takes effect when you sign it, whether or not the\npayment clears. Sign it only if the money has arrived."}

${how}

  ${link}

-- sent by ${who}, through SubSub

This is an automated message from an unmonitored address. Replies aren't received.`;
  return {
    subject: `${who} asked you for a lien waiver — ${amount}`,
    text,
    html: textToHtml(text, link),
  };
}

// ---- Delivery -------------------------------------------------------------

// Returns a result rather than throwing: a failed notification must not undo
// the action that triggered it, and the caller decides whether to surface it.
// The From line always carries a name. A bare notifications@subsub.work is
// drawn by mail apps as an "N" in a circle, and a sender with no display name
// reads as a script rather than a company, which spam filters weigh too. If
// MAIL_FROM already names itself it is used as set.
// The bare address out of a From line, whether or not it carries a name.
export function mailAddress(from) {
  const f = String(from || "").trim();
  const m = f.match(/<([^>]+)>/);
  return m ? m[1].trim() : f;
}
export function fromWithName(from, name = "SubSub") {
  const f = String(from || "").trim();
  if (!f || /<[^>]+>/.test(f)) return f;
  return `${name} <${f}>`;
}

export async function sendEmail(env, { to, subject, text, html, replyTo, fromName }) {
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
        from: fromName ? `${fromName} <${mailAddress(env.MAIL_FROM)}>` : fromWithName(env.MAIL_FROM),
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
send you work orders; your profile, crews, insurance and license go with you
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
export function workOrderIssuedSms({ job, trade, woNumber, account, respondBy, claimLink = null }) {
  const who = account?.name || "A contractor";
  const where = job?.address ? ` at ${job.address}` : "";
  const by = respondBy ? ` Reply by ${String(respondBy).slice(0, 10)}.` : "";
  return `${who} has sent you work order ${woNumber} — ${trade}${where}.${by} `
    + `Accept or decline it in SubSub. ${footerSms(claimLink)}`;
}

// A certificate renewed, to somebody who was already sent the old one.
//
// It leads with the thing they wanted -- the new expiry date -- and says why
// they are hearing from us in the first line, because the second most likely
// reaction to an unexpected email is "who is this". Short: they did not ask
// for a newsletter, they asked for a certificate.
export function docRenewedEmail({ company, contact, toName, kind, expiresOn, link, days }) {
  const who = company || "A subcontractor";
  const what = DOC_LABELS[kind] || kind;
  const text = `Hi ${toName || "there"},

${who} renewed their ${what.toLowerCase()}. It now runs to ${expiresOn}.

  ${link}

You are getting this because ${contact ? `${contact} at ${who}` : who} sent you
their paperwork through SubSub, and the page they sent expires. This is a fresh
link to the current documents \u2014 the carrier, the policy number, the coverage
and the expiry on each one. Nothing to sign up for.

The link lasts ${days} days. If you would rather not hear when their paperwork
renews, there is a line at the bottom of that page to say so.

-- sent on behalf of ${who}, through SubSub`;
  return { subject: `${who} renewed their ${what.toLowerCase()}`, text, html: textToHtml(text, link) };
}

// Told once, when an account has enough of a roster to want it to fill itself.
//
// It points at the screen rather than pasting eighty lines of HTML into an
// email: nobody copies code cleanly out of an email on a phone, and the panel
// has a Copy button and a preview.
export function embedNudgeEmail({ name, accountName, subdomain, subs }) {
  const text = `Hi ${name || "there"},

You have ${subs} contractors on ${accountName} now. Here is the quickest way to
get the next ones without chasing anybody.

There is a form you can paste onto your own website. A contractor fills it in,
and their application arrives on your Contractors screen with their trades and
their contact details already filled in \u2014 you say yes or no. No plugins,
nothing to host.

It is on your Contractors screen, under "Let contractors apply from your own
website". Copy the code, paste it where you want it, done.

  https://${subdomain}.subsub.work/

If you would rather just link to it, the same form is hosted for you at
https://${subdomain}.subsub.work/?apply=1 \u2014 worth putting in the bid
invitations you already send.

-- SubSub`;
  return { subject: `Let contractors apply to ${accountName} from your website`, text,
    html: textToHtml(text, `https://${subdomain}.subsub.work/`) };
}

// "Everything sent to you, on one page." Asked for from a pack page, delivered
// by email -- because holding a forwarded share proves somebody received mail
// at an address once, not that they control it now.
export function docInboxEmail({ toName, count, link, days }) {
  const n = Number(count) || 0;
  const many = n === 1 ? "one subcontractor has" : `${n} subcontractors have`;
  const text = `Hi ${toName || "there"},

You asked to see everything sent to this address. ${many} sent you their
compliance paperwork through SubSub:

  ${link}

One page, every certificate, and the expiry on each -- including the ones that
have already lapsed since they were sent to you. Nothing to sign up for.

This link was emailed rather than shown straight away because holding one
document link is not proof you still read this mailbox, and this one opens all
of them. It lasts ${days} days.

-- SubSub`;
  return { subject: "Everything sent to you, on one page", text, html: textToHtml(text, link) };
}

// A finished move-in or move-out report, to the owner of the building.
//
// IT CARRIES NO PHOTOGRAPHS, and that is the design rather than a saving. A
// unit is a dozen rooms and a phone fills each with four, so the attachment
// would be tens of megabytes and the thing worth looking at — a room, its
// verdict, its note and its pictures together — is not a thing an email can
// draw. What it does carry is the shape of the answer (how many rooms, how
// many flagged) and a link into their own seat, where the record lives and
// stays live.
//
// The counts are in the message because an owner reading on a phone decides
// from them whether to open it tonight or on Monday, and "0 flagged" is the
// commonest and best answer this product can give them.
export function inspectionReportEmail({ firstName, account, kindLabel, propertyName,
  unit, walkedOn, tenantName, rooms, flagged, link }) {
  const who = account?.name || "your property manager";
  const place = [propertyName, unit ? `Unit ${unit}` : null].filter(Boolean).join(", ");
  const verdict = flagged
    ? `${flagged} of the ${rooms} rooms ${flagged === 1 ? "needs" : "need"} something doing.`
    : `All ${rooms} rooms were fine — nothing flagged.`;
  const text = `Hi ${firstName || "there"},

${who} has finished the ${String(kindLabel || "").toLowerCase()} inspection of ${place || "your building"}${
  walkedOn ? `, walked on ${walkedOn}` : ""}${tenantName ? `, for ${tenantName}` : ""}.

${verdict}

Read it here, room by room, with the photographs:
  ${link}

It stays on your account, so it is there the next time anybody asks what the
place looked like on the day.

-- ${who}

This is an automated message from an unmonitored address. Replies aren't received.`;
  return {
    subject: `${who}: ${kindLabel || "Inspection"} report for ${place || "your building"}`,
    text,
    html: textToHtml(text, link),
  };
}

// ---- The Sub Passport (077) -------------------------------------------------

// A hiring account asking to open a sub's certificate and W-9. The sub decides;
// nothing opens until they say yes, and the email says so in those words,
// because "somebody wants your tax form" is the sentence a careful person
// stops at.
export function passportAccessRequestEmail({ company, contact, accountName, requesterName, message, link }) {
  const who = accountName || "A company";
  const text = `Hi ${contact || company?.company || "there"},

${who}${requesterName ? ` (${requesterName})` : ""} opened your SubSub Passport and asked to see
your certificate of insurance and your W-9.
${message ? `\nThey added: "${message}"\n` : ""}
Nothing opens until you say yes. Approve or decline here:
  ${link}

If you approve, they can open those two files while you leave it on. You can
take it back at any time from the same screen.

-- SubSub

This is an automated message from an unmonitored address. Replies aren't received.`;
  return { subject: `${who} asked to see your insurance and W-9`, text, html: textToHtml(text, link) };
}

// The answer, to the person who asked.
export function passportAccessDecisionEmail({ firstName, companyName, approved, link }) {
  const sub = companyName || "The subcontractor";
  const text = approved
    ? `Hi ${firstName || "there"},

${sub} approved your request. Their certificate of insurance and W-9 now
open from their Passport while you are signed in to SubSub:
  ${link}

They can take this back at any time.

-- SubSub

This is an automated message from an unmonitored address. Replies aren't received.`
    : `Hi ${firstName || "there"},

${sub} declined your request to see their certificate of insurance and W-9.
Their Passport still shows what is on file and when it runs out:
  ${link}

-- SubSub

This is an automated message from an unmonitored address. Replies aren't received.`;
  return {
    subject: approved ? `${sub} shared their insurance and W-9 with you` : `${sub} declined your document request`,
    text, html: textToHtml(text, link),
  };
}

// The licence running out, at 30, 7 and 0 days. The date is the state
// register's own, never one the sub typed, and the email says which register.
export function licenseExpiryEmail({ company, contact, number, expiresOn, daysOut, registry, link }) {
  const reg = registry || "the state";
  const lapsed = daysOut <= 0;
  const lead = lapsed
    ? `Your contractor license ${number ? `(${number}) ` : ""}runs out today (${expiresOn}) according to ${reg}.`
    : `Your contractor license ${number ? `(${number}) ` : ""}runs out on ${expiresOn} -- ${daysOut} day${daysOut === 1 ? "" : "s"} from now, according to ${reg}.`;
  const text = `Hi ${contact || company?.company || "there"},

${lead}

WHAT HAPPENS IF IT LAPSES
  The "SubSub Verified" badge comes off your Passport, and the GCs you work
  with see the license as not active.

WHAT TO DO
  Renew it with ${reg}. SubSub checks the register every night, so once it
  is renewed there, it shows here by itself -- nothing to upload.

  Your Passport: ${link}

-- SubSub

This is an automated message from an unmonitored address. Replies aren't received.`;
  return {
    subject: lapsed ? "Your contractor license runs out today" : `Your contractor license runs out in ${daysOut} days`,
    text, html: textToHtml(text, link),
  };
}

// 080. Everything waiting on one person, in one email. Sent nightly while an
// item stands (see app/shared/remind.js), so a crew with three jobs to time
// gets one message rather than three, and the subject says how many.
export function actionReminderEmail({ firstName, lines = [], link, fromName }) {
  const n = lines.length;
  const text = `Hi ${firstName || "there"},

${n === 1 ? "This is waiting on you:" : `These ${n} things are waiting on you:`}

${lines.map((l) => `  - ${l}`).join("\n")}

Nothing moves until it is answered, and the people on the other side can see
that it is waiting. Answer it here:
  ${link}

-- ${fromName || "SubSub"}

You'll get a reminder like this for a few days while something is waiting on
you; it stops by itself once it is answered. This is an automated message from
an unmonitored address. Replies aren't received.`;
  const subject = n === 1
    ? `Waiting on you: ${lines[0].replace(/\s*\(waiting \d+ days?\)\.?$/, "").slice(0, 90)}`
    : `${n} things are waiting on you`;
  return { subject, text, html: textToHtml(text, link) };
}
// 081. Somebody wrote to you and it has sat unread. One email covers every
// thread that is waiting, and it quotes the start of the last message so the
// reader can tell a "thanks!" from a "the water is coming through the
// ceiling" without opening anything. Replies go in the app, because this
// address is not read by anybody.
// 083. ONE MESSAGE, SENT THE MOMENT IT IS WRITTEN. It carries the whole
// message rather than a preview, because the point is that somebody can read
// it and answer without opening anything. With a reply address it says
// replying works and puts the marker above the quoted part; without one it
// says so, because a reply to an address nobody reads is a reply that vanishes.
export function messageEmail({ firstName, who, about, body, photoCount = 0, link, fromName, canReply }) {
  const photos = photoCount ? `\n\n(${photoCount === 1 ? "1 photo" : `${photoCount} photos`} attached in SubSub.)` : "";
  const said = String(body || "").trim() || (photoCount ? "Sent a photo." : "");
  const how = canReply
    ? "Reply to this email to answer. Your reply is added to the conversation in SubSub."
    : "Replies to this email aren't received; answer in SubSub instead.";
  const text = `${canReply ? `-- ${REPLY_MARKER} --\n\n` : ""}Hi ${firstName || "there"},

${who}${about ? ` (${about})` : ""} wrote:

${said}${photos}

${how}

Open the conversation:
  ${link}

-- ${fromName || "SubSub"}`;
  const subject = `${who}${about ? ` · ${about}` : ""}: ${String(said).replace(/\s+/g, " ").slice(0, 60)}${said.length > 60 ? "..." : ""}`;
  return { subject, text, html: textToHtml(text, link, { keepLines: true }) };
}

// 083. A reply by email that could not be added, told to the person it came
// from. Only ever sent to the address the reply address was issued to.
export function messageReplyRefusedEmail(reason) {
  const text = `Your email reply couldn't be added to the conversation:

${reason}

-- SubSub`;
  return { subject: "Your reply didn't reach SubSub", text, html: textToHtml(text) };
}

export function messageNotifyEmail({ firstName, threads = [], link, fromName }) {
  const n = threads.reduce((k, t) => k + (t.count || 1), 0);
  const quote = (s) => {
    const one = String(s || "").replace(/\s+/g, " ").trim();
    return one.length > 160 ? `${one.slice(0, 157)}...` : one;
  };
  const lines = threads.map((t) => `  - ${t.who}${t.about ? ` (${t.about})` : ""}: "${quote(t.preview) || "sent a photo"}"`);
  const text = `Hi ${firstName || "there"},

${n === 1 ? "You have a new message:" : `You have ${n} new messages:`}

${lines.join("\n")}

Read and reply here:
  ${link}

-- ${fromName || "SubSub"}

This is an automated message from an unmonitored address. Replies to this
email aren't received; answer in the app instead.`;
  const subject = threads.length === 1
    ? `New message from ${threads[0].who}`
    : `${n} new messages`;
  return { subject, text, html: textToHtml(text, link) };
}
