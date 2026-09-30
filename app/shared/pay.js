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
// The same question `payoutsReady` asks of a Stripe account, asked of OUR row.
//
// It exists because money has to be able to ask it. `ready` below is
// `kyc_status === 'verified'`, which happens to be derived from both
// capabilities -- so reading that would be relying on a derivation stored in
// another column at another time, and the first caller to need this asked for
// `.payable`, got `undefined`, and refused every payment on a fully verified
// account. Both halves, read directly, named once.
export const rowPayable = (row) => !!row && !!row.transfers_active && !!row.payouts_enabled;

export function payoutSummary(row) {
  if (!row) return { status: "none", ready: false, payable: false, requirements: [], disabledReason: null };
  let requirements = [];
  try {
    const parsed = JSON.parse(row.requirements || "[]");
    if (Array.isArray(parsed)) requirements = parsed;
  } catch { /* a column that cannot be parsed is an empty list, never a throw */ }
  return {
    status: PAYOUT_STATES.includes(row.kyc_status) ? row.kyc_status : "pending",
    ready: row.kyc_status === "verified",
    // Whether money can actually reach them, which is a different question
    // from whether Stripe has finished with their paperwork.
    payable: rowPayable(row),
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

// THE CONTROLLER EVERY CONNECTED ACCOUNT IS MINTED WITH, and the key that
// request goes out under. They are one value because they are one fact, and
// keeping them apart cost a day.
//
// `losses.payments` is `stripe` because Stripe validates the COMBINATION:
// with `stripe_dashboard: none` and `requirement_collection: stripe` it
// refuses anything else outright. The two alternatives are both refused in
// this product's own words -- `requirement_collection: "application"` moves
// the compliance obligation, the disputes and the negative balances onto
// SubSub, which is a different company; an Express dashboard hands the
// subcontractor a Stripe-branded website to be sent to, which is the whole
// thing the embedded onboarding exists to avoid.
export const PAYOUT_CONTROLLER = {
  fees: { payer: "application" },
  losses: { payments: "stripe" },
  requirement_collection: "stripe",
  stripe_dashboard: { type: "none" },
};

// Sorted, so reordering the literal above is not a change. Nested, so a
// property added inside `losses` counts as one.
const flatten = (o, prefix = "") =>
  Object.entries(o || {})
    .flatMap(([k, v]) => {
      const key = prefix ? `${prefix}.${k}` : k;
      return v && typeof v === "object" ? flatten(v, key) : [`${key}=${v}`];
    })
    .sort();

// The idempotency key a connected account is minted under.
//
// STRIPE SAVES THE STATUS AND BODY OF THE FIRST REQUEST MADE UNDER A KEY AND
// REPLAYS THEM FOR 24 HOURS -- a refusal as faithfully as a success. So a
// key that is only the company id outlives the fix for whatever it refused:
// the controller above was wrong once, it was corrected and deployed, and
// the panel drew the identical sentence afterwards because Stripe was
// answering the old request rather than the new one. Indistinguishable on
// screen, and it cost two rounds.
//
// So the SHAPE is in the key. Both halves survive:
//
//   Same company, same controller -> same key, so an ordinary double press
//   or two tabs on one screen still cannot mint two accounts, which is the
//   whole reason the key exists.
//
//   Controller changed -> different key, which is exactly the case where the
//   saved answer was given about terms we no longer offer.
//
// DERIVED RATHER THAN A VERSION SOMEBODY BUMPS, because a `v2` constant
// beside the controller is two records of one fact: the next person to
// change the controller gets a cached answer about the old one, silently,
// which is the failure this is fixing. Only the controller goes in -- never
// the company's email, which changes for its own reasons and would mint a
// second connected account when it did.
export function payoutAccountKey(companyId, controller = PAYOUT_CONTROLLER) {
  const shape = flatten(controller).join(";").replace(/[^a-zA-Z0-9]+/g, "-");
  return `payout-acct:${companyId}:${shape}`;
}
