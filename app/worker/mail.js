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
export function subInviteSms({ companyName, account, link, known = false }) {
  const who = account?.name || "A contractor";
  // Same split as the email: a text telling somebody to set up an account,
  // over a link that asks for a password, sends them looking for a form.
  if (known) return `${who} has added ${companyName || "you"} to SubSub. `
    + `Your details are in -- choose a password to sign in: ${link}`;
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
  cancelled: (detail) => `has been cancelled: ${detail}`,
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
    : stage === "cancelled" ? `${who}: "${title}" has been cancelled`
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
  return { subject: `${who} renewed their ${what.toLowerCase()}`, text };
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
  return { subject: `Let contractors apply to ${accountName} from your website`, text };
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
  return { subject: "Everything sent to you, on one page", text };
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
