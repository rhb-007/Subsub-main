// 074. "SENT VIA SUBSUB" ON EVERY WORK ORDER, AND THE FREE LOGIN BEHIND IT.
//
// Every work order a hiring account sends a subcontractor carries one line
// saying where it came from and one link: /claim/<token>. The sub opens it on
// a phone, reads the work order, and makes a free login with their mobile and
// a texted code. The account that sent it is recorded as the one that brought
// them in.
//
// The rules live here because four places describe them and must agree: the
// Worker that mints and checks the link, the email and the text that carry it,
// the work order drawn in the app, and the page the link opens.
//
// THE FOOTER IS NOT A SETTING. There is no flag anywhere that removes it, on
// any plan, and that is deliberate: white-labelling on Scale changes whose
// colours a page wears, never whether it says how it was sent. Nothing in the
// Worker or the browser reads a plan before drawing it, and a test pins that.

// SubSub's own front door, never the sending account's branded hostname. The
// link exists to introduce SubSub to somebody who has never heard of it, and a
// company's own address saying "SubSub" in the footer would be the
// white-label failure from the other side -- the account's name over our
// signup.
export const CLAIM_ORIGIN = "https://app.subsub.work";

// 32 random bytes, hex. The same shape as an invite token, checked before any
// database read so a garbage path costs nothing.
export const CLAIM_TOKEN_RE = /^[0-9a-f]{64}$/;
export const validClaimToken = (t) => CLAIM_TOKEN_RE.test(String(t || ""));

export const claimUrl = (token) => (validClaimToken(token) ? `${CLAIM_ORIGIN}/claim/${token}` : null);

// The path the app is opened on. A trailing slash is tolerated because a link
// pasted into a text often gains one; anything else is not a claim page.
export function claimPathToken(pathname) {
  const m = /^\/claim\/([0-9a-f]{64})\/?$/.exec(String(pathname || ""));
  return m ? m[1] : null;
}

// What the footer says, everywhere it says it. Two sentences, because the
// second is the one that gets a roofer to tap: nobody signs up for software
// they think they will be billed for.
export const SENT_VIA = "Sent via SubSub";
export const FREE_LINE = "SubSub is free for subcontractors, forever.";

// The plain-text footer for an email or a downloaded copy. With no link -- a
// database without 074 -- it still says how it was sent, because the line is
// the attribution and the link is the way in.
export function footerText(url) {
  return url
    ? `${SENT_VIA}. ${FREE_LINE}\nSee this work order and claim your free profile:\n  ${url}`
    : `${SENT_VIA}. ${FREE_LINE}`;
}

// One line for a text message, where every character is read on a lock
// screen.
export function footerSms(url) {
  return url ? `Sent via SubSub (free for subs): ${url}` : "Sent via SubSub.";
}

// ---- phone numbers ---------------------------------------------------------
//
// The login is a mobile and a texted code. Supabase wants E.164, which the
// Worker's own toE164 (worker/sms.js) already makes -- one conversion, not a
// second copy here. This product stores "(206)555-0101". US numbers only, the
// same rule normalizePhone in the Worker keeps: ten digits, a leading 1
// dropped.

export function phoneDigits(v) {
  let d = String(v ?? "").replace(/\D/g, "");
  if (d.length === 11 && d[0] === "1") d = d.slice(1);
  return d.length === 10 ? d : null;
}

export const samePhone = (a, b) => {
  const x = phoneDigits(a);
  return !!x && x === phoneDigits(b);
};

// Shown on the claim page so the sub knows which number to use without the
// page handing the whole number to whoever holds a forwarded link.
export function maskPhone(v) {
  const d = phoneDigits(v);
  return d ? `(•••) •••-${d.slice(6)}` : null;
}

// WHICH MOBILE MAY CLAIM THIS COMPANY.
//
// A claim link travels: it is in an email, a text and a downloaded work order,
// and any of those can be forwarded. So when the sending account holds a
// mobile for the company, the code goes to THAT number and no other -- the
// same number the work order was texted to. Holding the link is not enough to
// become the company; holding the phone is.
//
// With no number on record there is nothing to check against, and refusing
// would leave a sub nobody ever texted unable to claim the work order they
// were emailed. That is the same trust the invite link already extends: the
// token was sent to them.
export function claimPhoneProblem({ entered, onRecord }) {
  if (!phoneDigits(entered)) return "bad_phone";
  if (phoneDigits(onRecord) && !samePhone(entered, onRecord)) return "phone_mismatch";
  return null;
}

// WHAT THE PAGE CAN OFFER, from what the Worker found.
//
//   claimable      nobody can sign in as this company yet: make a login
//   claimed        this link was already used to make one: sign in
//   on_subsub      the company already has a login, from this account or
//                  another: sign in, and nothing is attributed
//
// "On SubSub already" is not a failure and must not read as one -- it is the
// commonest answer once this works, and the person holding the link is one
// press from their work order either way.
export function claimState({ claimedAt, companyHasLogin }) {
  if (claimedAt) return "claimed";
  if (companyHasLogin) return "on_subsub";
  return "claimable";
}

// Per sending account, for the console. Rates are only drawn over a real
// denominator: "0% opened" over nothing sent is a number about nothing.
export function claimFunnel({ sent = 0, opened = 0, claimed = 0 } = {}) {
  const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : null);
  return { sent, opened, claimed, openRate: pct(opened, sent), claimRate: pct(claimed, opened) };
}

// ---- or an email address ---------------------------------------------------
//
// The same login by a code sent to an address instead of a mobile. It exists
// so a sub can claim before any SMS provider is set up -- and some people would
// rather type an address than a number anyway. Supabase sends the code from
// the email it already sends confirmations from, so nothing new is configured
// on our side.
//
// The rule is the phone rule: when the sending account holds an address for
// the company, only THAT address may claim, because a forwarded link is
// exactly a link sitting in somebody else's inbox. With none on record any
// real address will do, which is the trust an emailed invite already extends.

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const cleanEmail = (v) => {
  const e = String(v ?? "").trim().toLowerCase();
  return EMAIL_SHAPE.test(e) && !e.endsWith("@no-email.invalid") ? e : null;
};
export const sameEmail = (a, b) => {
  const x = cleanEmail(a);
  return !!x && x === cleanEmail(b);
};

// The first letter and the domain, so the page can say which address to use
// without handing a forwarded-link holder the whole of it.
export function maskEmail(v) {
  const e = cleanEmail(v);
  if (!e) return null;
  const [user, domain] = e.split("@");
  return `${user[0]}•••@${domain}`;
}

export function claimEmailProblem({ entered, onRecord }) {
  if (!cleanEmail(entered)) return "bad_email";
  if (cleanEmail(onRecord) && !sameEmail(entered, onRecord)) return "email_mismatch";
  return null;
}
