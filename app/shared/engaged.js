// WHAT SOMEBODY IS TO THE ACCOUNT THAT ENGAGED THEM, in one place.
//
// A roofing company on a general contractor's roster is a subcontractor: they
// hold a licence, they carry their own cover, and they work under a prime
// contract. The person a managing agent calls to change a tap washer, reset a
// breaker and paint a bedroom wall is not that, and treating them as one is
// how a maintenance worker ends up permanently amber on a roster over a
// state licence their work does not require.
//
// So this is a per-ENGAGEMENT classification and never a column on
// `companies`. Three reasons, all of them already rules here:
//
//   `companies` is SHARED. One account's handyman is another account's
//   contractor, and writing the word onto the row would say it for both.
//
//   WHAT A HIRING ACCOUNT REQUIRES IS THEIR OWN CALL. This file already
//   refused to make insurance globally optional, and said the right answer if
//   it ever came up was "per-account, not a global default". An engagement is
//   exactly that, which is why this is the shape rather than a flag on
//   `DOC_KINDS`.
//
//   And it is reversible without touching anybody else's roster.

// The two. `subcontractor` is the default and is what every existing row is,
// which is what makes this safe to ship against a live database: a column
// that is NULL reads as the behaviour that is already in force.
export const ENGAGED_AS = {
  subcontractor: { id: "subcontractor", label: "Subcontractor",
    note: "Licensed trade company. Carries their own insurance and bond." },
  handyman: { id: "handyman", label: "Handyman",
    note: "Maintenance worker for small jobs. No contractor licence, and insurance is not required." },
};
export const isEngagedAs = (v) => Object.prototype.hasOwnProperty.call(ENGAGED_AS, String(v || ""));
// UNKNOWN AND ABSENT BOTH READ AS SUBCONTRACTOR, deliberately. Every row that
// exists today has no value at all, and a word nothing recognises must not
// quietly relax a compliance rule -- the direction that fails open is the one
// that stops asking for a certificate.
export const engagedAs = (v) => (isEngagedAs(v) ? String(v) : "subcontractor");
export const isHandyman = (v) => engagedAs(v) === "handyman";

// WHAT A CONTRACTOR SEAT IS CALLED, on the account that engaged them.
//
// Reported as: *"I updated pacific to handyman, but it's still showing
// contractor on [the] profile drop down"*. The chip under somebody's own name
// read `ROLES.contractor.label` flat -- a constant, ignoring both the
// engagement and the account kind -- so a handyman read Contractor, and a
// general contractor's roofer read Contractor where that account's own roster
// says Subcontractor.
//
// It composes rather than replaces: the hiring word is whatever
// `hiresLabel`/`rosterWords` already decided for that account kind, and this
// narrows it when the engagement says handyman. Passed in rather than imported,
// so this module does not take a dependency on `hires.js` to say one word.
//
// THE ROLE ID IS UNTOUCHED, which is the distinction this project already
// records: `contractor` stays the seat role -- a person signing in to the
// portal rather than a company on a roster -- and the staff console keeps
// describing SubSub's own data model. What changes is the word shown to that
// person about their seat HERE.
export const engagedSeatLabel = (engaged, hiringWord) =>
  isHandyman(engaged) ? ENGAGED_AS.handyman.label
    : (hiringWord || ENGAGED_AS.subcontractor.label);

// WHICH ACCOUNTS HAVE HANDYMAN WORK: the ones with buildings.
//
// Asked for as "under property manager, portfolio manager, and building
// owner", and that is not a coincidence -- a handyman is a maintenance worker
// for a *building*, so the kinds that keep a building list are exactly the
// kinds with anything for one to do. A general contractor works job to job
// and subs its trades out under a prime contract; a subcontractor account
// passing work further down is still passing it down a chain.
//
// Named here rather than imported because the Worker's own
// ACCOUNT_KINDS_WITH_PROPERTIES cannot cross into shared code. A test pins
// the two equal, which is this project's standard answer to a list that
// cannot be imported.
export const HANDYMAN_ACCOUNT_KINDS = ["property_manager", "building_owner", "portfolio_manager"];
// NAMED, never "not a subcontractor-hirer". An unknown kind must not inherit
// the permission: a filter that excludes the obvious exception is not the
// same as one that includes the intended set, which this project has already
// paid for once where `role <> 'contractor'` let an owner and a tenant in.
export const mayEngageHandyman = (accountKind) =>
  HANDYMAN_ACCOUNT_KINDS.includes(String(accountKind || ""));

// THE LIGHTER WORK, as a list of trades.
//
// "Restricted to lighter work, ie. simple sink leaks, fuse popped, painting a
// bedroom wall." The restriction is real and has to be enforced somewhere, and
// a trade list is the only axis this product already has -- every slot on a
// job is a trade, so it is what an assignment can be refused on.
//
// PLUMBING AND ELECTRICAL ARE ON IT, and that is the decision most worth
// writing down, because it is the one a later pass will want to reverse. A
// dripping tap and a tripped breaker were both named as the examples, and
// those are plumbing and electrical. The tension is real -- they are also the
// two trades where licensing bites hardest, and a handyman rewiring a panel
// is illegal in most states -- but the line this draws is small work in those
// trades, not the trades themselves, and no list of trade ids can express
// "small". Narrowing it is removing two entries; doing so would also refuse
// the two examples the feature was asked for.
export const HANDYMAN_TRADES = [
  "plumbing", "electrical", "painting", "drywall", "trim_carpentry",
  "flooring", "tile_stone", "cabinets_counters", "windows_doors",
  "gutters", "deck_fence", "landscaping", "cleaning",
];
export const handymanCovers = (trade) => HANDYMAN_TRADES.includes(String(trade || ""));
// What this engagement may be used for. A subcontractor is unrestricted, so
// `null` means "every trade" rather than an empty list -- the same asymmetry
// `jobScopeFrom` uses, and for the same reason: `[]` means narrowed to
// nothing, which is a different answer and the wrong one.
export const tradesAllowed = (as) => (isHandyman(as) ? HANDYMAN_TRADES : null);
export const mayCover = (as, trade) => !isHandyman(as) || handymanCovers(trade);

// WHAT THEY ARE ASKED FOR, which is the other half of the request.
//
// "A handyman does not need a contractor license and all of the insurance
// should be optional when reviewing for compliance."
//
// Insurance and a bond come off. A **bond** goes with insurance rather than
// being argued separately: a surety bond is a *contractor's* bond, posted
// against a licence, and asking for one from somebody who needs no licence is
// the permanently-amber row this product exists to prevent.
//
// A **W-9 STAYS REQUIRED**, and that is not an oversight. It is not cover at
// all -- it is the ability to report the payment, which is why the document
// request mail has always said payment cannot be issued without it, and why
// `paygate.js` reads it. Nothing about being a handyman changes who the IRS
// expects a 1099 from.
export const HANDYMAN_EXCUSED = ["insurance", "bond"];
export const excusedFor = (as) => (isHandyman(as) ? HANDYMAN_EXCUSED : []);

// The documents this engagement is judged on. Composed with whatever the
// caller already worked out -- `kindsFor(agreement)` decides whether a signed
// agreement counts, and this narrows that answer rather than replacing it, so
// there is still one place deciding what a document kind is.
export const requiredDocsFor = (as, kinds) =>
  (kinds || []).filter((k) => !excusedFor(as).includes(k));

// And the licence. Not a document kind -- it is a column somebody types -- so
// it is asked separately by the roster, the verification sweep and the
// set-up checklist.
export const needsLicense = (as) => !isHandyman(as);

// The words for a refused assignment, here beside the rule so a reason added
// later arrives with its sentence rather than falling through to "that did
// not work".
export const ENGAGED_REFUSALS = {
  trade_not_handyman: "That trade is heavier work than a handyman is engaged for. Assign a contractor instead.",
  not_a_handyman_account: "Handyman is for accounts that run buildings.",
  bad_engaged_as: "That is not a kind of working relationship.",
};
