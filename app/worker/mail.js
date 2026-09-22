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
