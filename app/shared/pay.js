// Whether somebody can actually be paid, decided in one place.
//
// Shared by the Worker and the browser, for the reason `docs.js` is: a screen
// that works out "ready to be paid" for itself will eventually disagree with
// the route that refuses the transfer, and the disagreement shows up as a
// button that does nothing.
//
// Everything here reads a Stripe connected account and answers about it.
// Nothing here stores anything, and nothing here is a bank detail: account
// and routing numbers live with Stripe and never reach this database.

// What the row can say. `none` is the absence of a row -- nobody has started
// -- and is never written to one.
export const PAYOUT_STATES = ["none", "pending", "verified", "rejected"];

// Two different capabilities, and the difference matters.
//
//   transfers active  -- money may move INTO their Stripe balance.
//   payouts_enabled   -- money may move OUT of it, to their bank.
//
// A sub with the first and not the second would take a transfer and then sit
// on a balance they cannot reach, which looks from our side exactly like
// being paid and from theirs like nothing happening. So being payable needs
// both, and `payoutsReady` is the only thing that should ever gate a release.
export function transfersActive(acct) {
  return acct?.capabilities?.transfers === "active";
}

export function payoutsReady(acct) {
  return !!acct?.payouts_enabled && transfersActive(acct);
}

// Stripe disables an account it has rejected, and says so with a
// `disabled_reason` under `rejected.` -- fraud, terms of service, listed on a
// sanctions list, or other. It is not a state somebody can fix by uploading
// another document, so it must not be drawn as one.
export function isRejected(acct) {
  return /^rejected\./.test(acct?.requirements?.disabled_reason || "");
}

// The status we store. Mirrors Stripe rather than latching: an account that
// was payable last month can stop being payable when Stripe asks for more as
// volume grows, so this is re-derived on every webhook and never remembered.
export function payoutStatus(acct) {
  if (!acct) return "none";
  if (isRejected(acct)) return "rejected";
  if (payoutsReady(acct)) return "verified";
  return "pending";
}

// What Stripe is still waiting for.
//
// `past_due` and `currently_due` are the two that block; `eventually_due` is
// a heads-up and is deliberately left out, because a list that mixes "do this
// now" with "do this eventually" is a list nobody reads twice. Deduplicated,
// because the two overlap.
export function requirementsDue(acct) {
  const r = acct?.requirements || {};
  return [...new Set([...(r.past_due || []), ...(r.currently_due || [])])];
}

// Stripe's requirement keys are written for a machine: `individual
// .verification.document`, `company.tax_id`, `external_account`. Put one in
// front of a roofer and it reads as an error rather than as a thing to go and
// do, so the common ones are named and the rest are made readable rather than
// hidden -- an unknown key spelled out is still better than a shorter list
// that silently omits the one thing holding them up.
const LABELS = {
  "external_account": "Your bank account",
  "individual.verification.document": "A photo ID",
  "individual.verification.additional_document": "A second photo ID",
  "individual.id_number": "Your Social Security number",
  "individual.ssn_last_4": "The last four of your Social Security number",
  "individual.dob.day": "Your date of birth",
  "individual.address.line1": "Your address",
  "individual.phone": "Your phone number",
  "individual.email": "Your email address",
  "company.tax_id": "Your EIN",
  "company.verification.document": "A document proving the company exists",
  "company.address.line1": "The company address",
  "company.phone": "The company phone number",
  "business_profile.url": "Your website",
  "business_profile.mcc": "What kind of work you do",
  "tos_acceptance.date": "Accepting Stripe's terms",
  "tos_acceptance.ip": "Accepting Stripe's terms",
};

export function requirementLabel(key) {
  if (LABELS[key]) return LABELS[key];
  // `individual.dob.year` and `individual.dob.day` are one thing to a person.
  const trimmed = String(key || "").replace(/\.(day|month|year)$/, "");
  if (LABELS[trimmed]) return LABELS[trimmed];
  const words = trimmed.replace(/[._]/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Something else";
}

// The shape both the route and the screen read, built from a stored row.
// Never from a Stripe object directly: the row is what a page load gets, and
// a second derivation off a live fetch is the second opinion this module
// exists to prevent.
export function payoutSummary(row) {
  if (!row) return { status: "none", ready: false, requirements: [], disabledReason: null };
  let requirements = [];
  try {
    const parsed = JSON.parse(row.requirements || "[]");
    if (Array.isArray(parsed)) requirements = parsed;
  } catch { /* a column that cannot be parsed is an empty list, never a throw */ }
  return {
    status: PAYOUT_STATES.includes(row.kyc_status) ? row.kyc_status : "pending",
    ready: row.kyc_status === "verified",
    // Both halves, because "why can't I be paid yet" has two different
    // answers and one of them is not about documents at all.
    transfersActive: !!row.transfers_active,
    payoutsEnabled: !!row.payouts_enabled,
    requirements: requirements.map((k) => ({ key: k, label: requirementLabel(k) })),
    disabledReason: row.disabled_reason || null,
    startedAt: row.created_at || null,
  };
}

// What we write to the row, from what Stripe just told us. One function, so
// the create path, the refresh path and the webhook cannot record three
// different readings of the same account.
export function rowFromStripe(acct) {
  return {
    kycStatus: payoutStatus(acct),
    payoutsEnabled: acct?.payouts_enabled ? 1 : 0,
    transfersActive: transfersActive(acct) ? 1 : 0,
    requirements: JSON.stringify(requirementsDue(acct)),
    disabledReason: acct?.requirements?.disabled_reason || null,
  };
}
