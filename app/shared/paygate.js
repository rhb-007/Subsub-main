// Whether money may leave, as far as the paperwork is concerned.
//
// `settle` checked the waiver chain and nothing else. So "we refuse to pay a
// subcontractor whose insurance lapsed" -- which is one of the named reasons a
// general contractor would route payment through here rather than writing a
// cheque -- was a claim nothing enforced. A release against a company with no
// certificate on file went out exactly like one against a company fully
// covered, and no screen said a word.
//
// THE DATE THAT MATTERS IS THE JOB'S, NOT TODAY'S, and getting that backwards
// is the whole trap. It is the same rule shared/docs.js already states, and
// applying that rather than inventing a second one is deliberate:
//
//   A certificate that lapsed AFTER the work was finished does not make the
//   work uninsured. Refusing to pay for it punishes somebody for a renewal
//   that has nothing to do with this job, and the invoice is not the place to
//   chase it.
//
//   A certificate that was already lapsed ON THE DAY OF THE WORK is the real
//   exposure. The hiring account has an uninsured job on their record, and the
//   moment before the money goes is the last leverage they will ever have over
//   it.
//
// So the gate is the job's date. Today's position is still REPORTED, because a
// lapsed certificate on somebody you are about to pay is the moment to ask for
// the renewal -- but it never blocks, for the reason above.
//
// WHICH DOCUMENTS, and each for its own reason, because a gate that says
// "documents" is a gate nobody can clear:
//
//   insurance, bond   cover. In force on the job's date or the work was
//                     uninsured.
//   w9                not cover at all. It is the ability to report the
//                     payment -- there is no 1099 without a TIN, which is why
//                     the document-request mail has always said "we can't
//                     issue payment without it".
//   contract          NOT a bar. It is OPTIONAL_KINDS: the hiring account's
//                     own form, on their terms, which plenty of them never
//                     send. Holding payment over a document they themselves
//                     never issued is the permanently-amber failure docs.js
//                     exists to prevent, wearing its most expensive hat.
//
// AND VERIFICATION COUNTS HERE, unlike the send gate. Sending is about whether
// the subcontractor has a certificate to send, so presence is the question
// there. This is the hiring account's own money against the hiring account's
// own verdict: an unverified certificate is one nobody here has read, and
// paying against an unread certificate is precisely the thing.

import { DOC_KINDS, docStatus, isOptionalDoc } from "./docs.js";

// The kinds that stand between verified work and money, and why each one does.
export const PAY_GATE_KINDS = ["insurance", "bond", "w9"];
// Of those, the ones whose date is checked against the job. A W-9 does not
// expire -- docs.js says so in colour and this says so in money.
export const PAY_COVER_KINDS = ["insurance", "bond"];

// Sanity, not decoration: `contract` must stay out of the gate, and it stays
// out because it is optional rather than because somebody remembered to leave
// it off a list. If OPTIONAL_KINDS ever grows, this stops agreeing and the
// test says so.
export const payGateKindsAreRequired = () =>
  PAY_GATE_KINDS.every((k) => DOC_KINDS.includes(k) && !isOptionalDoc(k));

const day = (d) => String(d || "").slice(0, 10);
const verified = (docReview, kind) => docReview?.[kind]?.status === "verified";

// One reason money is being held, in the shape the screen and the mail read.
//
//   kind     which document
//   reason   missing | unverified | lapsed
//   until    the expiry, when there is one to name
const problem = (kind, reason, extra = {}) => ({ kind, reason, ...extra });

// May this release go out?
//
//   docs        the company's current document per kind (docShape's output)
//   docReview   this account's verdict per kind
//   jobDate     the day the work was done. The date the gate is about.
//   asOf        today, for the advisory half only.
//
// Returns { clear, problems, advisories }. `clear` is the only thing the route
// may branch on; `advisories` exists to be said out loud and never to block.
export function coverState({ docs = {}, docReview = {}, jobDate, asOf } = {}) {
  const on = day(jobDate) || day(asOf);
  const problems = [];
  for (const kind of PAY_GATE_KINDS) {
    const s = docStatus(docs[kind], on);
    if (s.state === "missing") { problems.push(problem(kind, "missing")); continue; }
    if (!verified(docReview, kind)) { problems.push(problem(kind, "unverified")); continue; }
    // Only the cover kinds are asked about the date. A W-9 with an expiry
    // typed onto it by mistake is not a reason to hold somebody's money.
    if (PAY_COVER_KINDS.includes(kind) && s.state === "expired") {
      problems.push(problem(kind, "lapsed", { until: s.until, days: s.days }));
    }
  }

  // What is true NOW and is not a bar: cover that was good for the work and
  // has since run out, or is about to. Worth a sentence beside the button,
  // because this is the one moment somebody will act on it.
  const advisories = [];
  const today = day(asOf);
  if (today) {
    for (const kind of PAY_COVER_KINDS) {
      const d = docs[kind];
      if (!d?.fileName) continue;
      if (problems.some((p) => p.kind === kind)) continue;
      const now = docStatus(d, today);
      if (now.state === "expired") advisories.push(problem(kind, "lapsed_since", { until: now.until, days: now.days }));
      else if (now.state === "expiring") advisories.push(problem(kind, "expiring", { until: now.until, days: now.days }));
    }
  }

  return { clear: problems.length === 0, problems, advisories, asOfJob: on };
}

const KIND_NAME = {
  insurance: "certificate of insurance",
  bond: "surety bond",
  contract: "signed subcontractor agreement",
  w9: "W-9",
};

const plural = (n) => (Math.abs(n) === 1 ? "" : "s");

// One reason, in words, for a screen and for an email.
//
// `lapsed` names the JOB'S date rather than today's, because "expired" with no
// date beside it reads as "expired now" -- and a reviewer who reads it that
// way will renew the certificate and expect the payment to unblock, which it
// will not. The work was uninsured; a new certificate cannot cover a day that
// has already happened.
export function coverProblemText(p, jobDate) {
  const name = KIND_NAME[p.kind] || p.kind;
  if (p.reason === "missing") return `No ${name} on file.`;
  if (p.reason === "unverified") return `Their ${name} has not been reviewed yet.`;
  if (p.reason === "lapsed") {
    return `Their ${name} had already expired on the day of the work`
      + (p.until ? ` — it ran out ${p.until}` : "")
      + (jobDate ? `, and the work was ${day(jobDate)}` : "") + ".";
  }
  if (p.reason === "lapsed_since") {
    return `Their ${name} has expired since the work`
      + (p.until ? ` — it ran out ${p.until}` : "") + ". The work itself was covered.";
  }
  if (p.reason === "expiring") {
    return `Their ${name} expires in ${p.days} day${plural(p.days)}`
      + (p.until ? ` (${p.until})` : "") + ".";
  }
  return `Something about their ${name} needs attention.`;
}

// Whether this problem can be fixed by the subcontractor uploading something.
//
// A missing or unreviewed document can. A lapse on a day that has already
// happened cannot -- which is why the override exists and why the screen must
// not offer "ask them to renew it" as the way through.
export const fixableByUpload = (p) => p.reason === "missing" || p.reason === "unverified";
