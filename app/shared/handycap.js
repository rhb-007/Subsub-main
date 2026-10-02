// WHAT A HANDYMAN MAY BE CHARGED FOR WITHOUT A STATE LICENCE.
//
// `engaged_as = 'handyman'` says somebody is engaged for small work and needs
// no contractor licence. That left the obvious question open and CLAUDE.md
// recorded it as open: *there is no value or permit ceiling, so a handyman can
// be issued a $40,000 work order for painting*. The licence exemption every
// state offers is a DOLLAR FIGURE, so the ceiling is the thing that makes the
// relationship real rather than a label.
//
// This module is the figures and the rules for reading them. The figures are a
// supplied dataset, transcribed mechanically rather than by hand, because a
// digit typed wrong here is a wrong number on a screen somebody relies on --
// the `npm run paste` lesson, which this repository paid for once against a
// live database.
//
// IT WARNS. IT NEVER BLOCKS, AND THAT IS THE CENTRAL DECISION.
//
// Every other gate in this product refuses: `documents_incomplete`,
// `trade_not_handyman`, `cover_outstanding`. This one cannot, for a reason the
// dataset states about itself -- *"Compiled from secondary sources; verify each
// state against its licensing board before relying on it. Not legal
// advice."* Thirteen of the fifty-one carry `verify: true`, and several of the
// rest carry a note that moves the figure (Tennessee is $3,000 rather than
// $25,000 in nine named counties; Washington's exemption is void the moment
// you advertise). **A number nobody has checked must never be the thing that
// refuses a work order.** Refusing on one would stop real work over a figure
// read off somebody's web page, which is the licensing dataset's own
// `reviewed` rule pointed at money.
//
// So the shape is the one `docs.js` already uses for a certificate lapsing
// under booked work: say it, loudly, at the moment somebody can act on it, and
// never cancel anything. Which puts the warning BEFORE the press -- on the
// form where the figure is typed, because a warning that arrives with the 201
// is a warning about a commitment already made. The route records it anyway,
// so *they were told and issued it* survives in the log; that is a trail, not
// a gate, and the two halves read this one predicate so they cannot disagree.
//
// AND THE NOTE IS PART OF THE ANSWER, never a footnote. For a dozen entries
// the condition in `note` outranks the figure beside it, so anything that
// renders a cap renders its note.

import { stateName, normalizeState } from "./states.js";
import { isHandyman } from "./engaged.js";
import { TRADES } from "./trades.js";

export const HANDYCAP_AS_OF = "2026-10-02";
export const HANDYCAP_WHAT = "Max labor + materials a handyman can charge "
  + "without a state contractor license or registration";
export const HANDYCAP_DISCLAIMER = "Compiled from secondary sources; verify each state "
  + "against its licensing board before relying on it. Not legal advice.";

// True wherever there is a figure at all, so they are said once rather than
// per state. The first is the one that bears on this product's own decisions:
// see NEVER_EXEMPT_TRADES below.
export const HANDYMAN_GLOBAL_RULES = [
  "Electrical, plumbing, HVAC, gas and structural work are excluded from every exemption",
  "Work requiring a building permit usually voids the exemption",
  "Splitting one project into multiple invoices to stay under the cap is prohibited",
  "City/county licensing may apply on top of state rules",
];

// FOUR BASES, AND THEY ARE FOUR DIFFERENT SENTENCES rather than four numbers.
//
//   per_job           a ceiling on this piece of work
//   annual            a ceiling on their year, which SubSub can only ever see
//                     its own slice of -- see `handymanCapCheck`
//   none              no exemption at all: registration from the first dollar
//   no_state_license  the state licenses nobody, so only local rules apply
//
// Told apart by the words, not by the figure, which is `docs.js`'s
// expired-and-never-added rule: a cap of 0 and no cap at all are both "no
// number to compare" and they are opposite answers.
export const CAP_BASES = ["per_job", "annual", "none", "no_state_license"];
export const isCapBasis = (b) => CAP_BASES.includes(String(b || ""));

// TRADES NO EXEMPTION COVERS, AS TRADE IDS, and this is where the dataset
// speaks directly to a decision already recorded here.
//
// CLAUDE.md says of `HANDYMAN_TRADES`: *"PLUMBING AND ELECTRICAL ARE ON THE
// TRADE LIST, and that is the decision a later pass will want to reverse...
// the line being drawn is small work in those trades, not the trades
// themselves."* The dataset's first global rule says those trades sit outside
// every state's exemption.
//
// Both are kept, because reversing it would refuse the two examples this
// feature was asked for -- a dripping tap and a tripped breaker. What changes
// is that the screen now SAYS so when one of them is being assigned, at any
// figure, instead of the product holding the caveat privately. `hvac` is here
// for completeness and is already refused by `HANDYMAN_TRADES`; gas and
// structural work have no trade id to name.
export const NEVER_EXEMPT_TRADES = ["plumbing", "electrical", "hvac"];
export const neverExempt = (trade) => NEVER_EXEMPT_TRADES.includes(String(trade || ""));

// The figures. Keyed by the same codes `states.js` uses, and deliberately
// carrying NO state name: `stateName` already holds those, and a second copy
// is the two-records-of-one-fact shape this file keeps recording.
//
// `cap` is whole DOLLARS, as supplied. `capCentsFor` converts, because
// `money.js` is cents everywhere and a comparison between a dollar figure and
// a cents figure is wrong by a hundred with nothing looking odd.
//
// Known tension in the data, left as supplied rather than silently corrected:
// AK reads `basis: "none"` while its own note describes a handyman licence
// covering jobs up to $10,000. The note renders, so a reader sees both.
export const HANDYMAN_CAPS = {
  AL: { cap: 10000, basis: "per_job", aboveCap: "Home builder license", note: "Residential threshold", verify: false },
  AK: { cap: 0, basis: "none", aboveCap: "General contractor license", note: "Handyman license required; covers jobs up to $10,000", verify: false },
  AZ: { cap: 1000, basis: "per_job", aboveCap: "ROC contractor license", note: "No permit work", verify: false },
  AR: { cap: 2000, basis: "per_job", aboveCap: "Home improvement license", note: "Residential", verify: false },
  CA: { cap: 1000, basis: "per_job", aboveCap: "CSLB contractor license", note: "Void if permit required or employees used", verify: false },
  CO: { cap: null, basis: "no_state_license", aboveCap: null, note: "Local licensing only", verify: false },
  CT: { cap: 0, basis: "none", aboveCap: "HIC registration", note: "Small de minimis carve-out unconfirmed", verify: true },
  DE: { cap: 50000, basis: "per_job", aboveCap: "Contractor registration", note: "State business license always required", verify: true },
  DC: { cap: 0, basis: "none", aboveCap: "HIC license", note: "$25,000 bond", verify: false },
  FL: { cap: 2500, basis: "per_job", aboveCap: "DBPR contractor license", note: "Casual/minor work only; void if advertising as a contractor or permit required", verify: false },
  GA: { cap: 2500, basis: "per_job", aboveCap: "Residential-Basic contractor license", note: "", verify: false },
  HI: { cap: 1500, basis: "per_job", aboveCap: "Contractor license", note: "No permit work; bill pending to raise to $2,500", verify: false },
  ID: { cap: 2000, basis: "per_job", aboveCap: "Contractor registration", note: "", verify: false },
  IL: { cap: null, basis: "no_state_license", aboveCap: null, note: "Local licensing only (e.g. Chicago)", verify: false },
  IN: { cap: null, basis: "no_state_license", aboveCap: null, note: "Local licensing only", verify: false },
  IA: { cap: 2000, basis: "annual", aboveCap: "Contractor registration", note: "Annual earnings threshold", verify: false },
  KS: { cap: null, basis: "no_state_license", aboveCap: null, note: "Local licensing only", verify: false },
  KY: { cap: null, basis: "no_state_license", aboveCap: null, note: "Local licensing only", verify: false },
  LA: { cap: 7500, basis: "per_job", aboveCap: "Home improvement registration", note: "Sources conflict on upper tier ($50k vs $75k) for residential license", verify: true },
  ME: { cap: null, basis: "no_state_license", aboveCap: null, note: "Local rules only", verify: false },
  MD: { cap: 0, basis: "none", aboveCap: "MHIC license", note: "No dollar exemption per stricter sources; some guides cite $500", verify: true },
  MA: { cap: 0, basis: "none", aboveCap: "HIC registration", note: "Minor-work carve-out exists; amount unconfirmed", verify: true },
  MI: { cap: 600, basis: "per_job", aboveCap: "Maintenance & Alteration or Builder license", note: "", verify: false },
  MN: { cap: 15000, basis: "annual", aboveCap: "Residential remodeler license", note: "Gross annual receipts; single-skill contractors exempt", verify: false },
  MS: { cap: 10000, basis: "per_job", aboveCap: "Residential remodeling license", note: "", verify: false },
  MO: { cap: null, basis: "no_state_license", aboveCap: null, note: "Local licensing only", verify: false },
  MT: { cap: 2500, basis: "per_job", aboveCap: "Contractor registration", note: "Registration mainly triggered by having employees", verify: true },
  NE: { cap: 5000, basis: "annual", aboveCap: "Contractor registration", note: "Single-source figure", verify: true },
  NV: { cap: 1000, basis: "per_job", aboveCap: "NSCB contractor license", note: "No permit work", verify: false },
  NH: { cap: null, basis: "no_state_license", aboveCap: null, note: "Trade licenses only", verify: false },
  NJ: { cap: 0, basis: "none", aboveCap: "HIC registration", note: "$500,000 liability insurance required", verify: false },
  NM: { cap: 7200, basis: "annual", aboveCap: "Contractor license", note: "Annual earnings cap", verify: false },
  NY: { cap: null, basis: "no_state_license", aboveCap: null, note: "NYC, Nassau, Suffolk, Westchester and others require local HIC license", verify: false },
  NC: { cap: 40000, basis: "per_job", aboveCap: "General contractor license", note: "Older guides still cite $30,000", verify: true },
  ND: { cap: 4000, basis: "per_job", aboveCap: "Contractor license", note: "", verify: false },
  OH: { cap: null, basis: "no_state_license", aboveCap: null, note: "Local licensing only", verify: false },
  OK: { cap: null, basis: "no_state_license", aboveCap: null, note: "State regulates only trades and roofing", verify: false },
  OR: { cap: 1000, basis: "per_job", aboveCap: "CCB license", note: "Narrow casual/minor exemption; excludes most handyman businesses; some guides cite $500", verify: true },
  PA: { cap: 5000, basis: "annual", aboveCap: "HIC registration", note: "Annual home improvement volume", verify: false },
  RI: { cap: 500, basis: "per_job", aboveCap: "Contractor registration", note: "", verify: false },
  SC: { cap: 500, basis: "per_job", aboveCap: "Residential specialty contractor registration", note: "", verify: false },
  SD: { cap: null, basis: "no_state_license", aboveCap: null, note: "Contractor's excise tax license only", verify: false },
  TN: { cap: 25000, basis: "per_job", aboveCap: "Contractor license", note: "Cap is $3,000 in 9 counties: Bradley, Davidson, Hamilton, Haywood, Knox, Marion, Robertson, Rutherford, Shelby", verify: false },
  TX: { cap: null, basis: "no_state_license", aboveCap: null, note: "City registration common; trades state-licensed", verify: false },
  UT: { cap: 3000, basis: "per_job", aboveCap: "Contractor license", note: "Exemption filing + liability insurance required in upper band; sources conflict on band ($1k-$3k vs $3k-$7k)", verify: true },
  VT: { cap: 10000, basis: "per_job", aboveCap: "Residential contractor registration", note: "", verify: true },
  VA: { cap: 1000, basis: "per_job", aboveCap: "Class C contractor license", note: "", verify: false },
  WA: { cap: 500, basis: "per_job", aboveCap: "L&I contractor registration", note: "Exemption void if you advertise; effectively registration from first dollar", verify: true },
  WV: { cap: 5000, basis: "per_job", aboveCap: "Contractor license", note: "Residential; $25,000 commercial", verify: false },
  WI: { cap: 1000, basis: "per_job", aboveCap: "Dwelling Contractor certification", note: "Primarily permit-triggered; dollar figure from older sources", verify: true },
  WY: { cap: null, basis: "no_state_license", aboveCap: null, note: "Local registration only", verify: false },
};

export const capFor = (state) => HANDYMAN_CAPS[normalizeState(state) || ""] || null;
export const capCentsFor = (state) => {
  const row = capFor(state);
  return row && row.cap !== null ? Math.round(row.cap * 100) : null;
};
// Which jurisdictions carry a figure nobody has checked back against its
// board. Printed by the suite the way `reviewQueue()` is, so the work owed is
// a list rather than a feeling.
export const capVerifyQueue = () => Object.keys(HANDYMAN_CAPS)
  .filter((k) => HANDYMAN_CAPS[k].verify).sort();

const dollars = (n) => (n === null || n === undefined ? null : Number(n));
// Hand-rolled rather than `toLocaleString`, because ICU is not guaranteed in a
// Worker and a figure that renders differently on the server and in the browser
// is two answers to one question.
const money = (n) => "$" + String(Math.round(Math.abs(n)))
  .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const tradeLabel = (id) => (TRADES.find((t) => t.id === id) || {}).label || id;
const andList = (xs) => xs.length < 2 ? (xs[0] || "")
  : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

// WHAT TO SAY ABOUT ONE ASSIGNMENT.
//
// `jobDollars` is the ceiling of everything this company is being committed to
// ON THIS JOB, which includes work orders they already hold on it -- because
// the dataset's third global rule is that splitting one project across
// invoices to stay under a cap is prohibited, and a per-work-order comparison
// is a screen that teaches people to split. The caller adds them up; this
// decides what it means.
//
// `accountYearDollars` is what THIS ACCOUNT alone has committed to them this
// year, and is the only annual figure SubSub can ever know: the cap is on the
// handyman's whole business across every client, and this product sees one
// slice of it. So an annual row is never answered "under the cap" -- only
// "this account alone is already at X of Y", which is the same honesty the
// waiver roll-up keeps by never saying "clear", only "clear through a date".
// Passing null says SubSub has not been asked to work it out, and a single job
// over an annual cap is over it on its own, so that case still answers.
//
// Returns null when there is nothing to say at all, so callers never branch on
// a shape.
export function handymanCapCheck({
  engagedAs, state, trades = [], jobDollars = 0, accountYearDollars = null,
} = {}) {
  // Only a handyman. A licensed subcontractor holds the licence the exemption
  // exists to avoid needing, so none of this is about them -- which is exactly
  // `needsLicense` inverted, read through the one predicate rather than a
  // second spelling of it.
  if (!isHandyman(engagedAs)) return null;

  const code = normalizeState(state) || null;
  const row = code ? HANDYMAN_CAPS[code] : null;
  const list = (Array.isArray(trades) ? trades : [trades]).filter(Boolean).map(String);
  const excluded = list.filter(neverExempt);
  const base = {
    state: code, stateLabel: code ? stateName(code) || code : null,
    excluded, excludedLabels: excluded.map(tradeLabel),
  };

  // An unrecognised or missing state is a real state of the world -- a job at
  // no property, on a company row with no state typed in -- and it must say so
  // rather than invent a figure. `unknown_state` is its own answer for the
  // reason `no_file` is: only one of the two means "go and look something up".
  if (!row) {
    return {
      ...base, basis: null, capDollars: null, capCents: null, aboveCap: null,
      note: "", verify: true, compared: null, figureDollars: null, figureIs: null,
      over: false, overByDollars: 0,
      reason: excluded.length ? "trade_not_exempt" : "unknown_state",
      level: "warn",
    };
  }

  const capDollars = dollars(row.cap);
  const job = dollars(jobDollars) || 0;
  const year = dollars(accountYearDollars);
  // WHICH FIGURE THIS BASIS COMPARES AGAINST, and which figure that is, so the
  // sentence can say. `null` where there is nothing comparable rather than a
  // zero that would read as "under".
  let figureDollars = null;
  let figureIs = null;
  if (row.basis === "per_job" || row.basis === "none") {
    if (job > 0) { figureDollars = job; figureIs = "job"; }
  } else if (row.basis === "annual") {
    if (year !== null && year > 0) { figureDollars = year; figureIs = "year"; }
    else if (job > 0) { figureDollars = job; figureIs = "job"; }
  }
  const compared = figureDollars === null ? null : row.basis;

  // `none` means no exemption, so the amount is beside the point: engaging
  // somebody unlicensed there is the thing worth saying, at any figure and at
  // none. Six jurisdictions.
  const over = row.basis === "none"
    ? true
    : capDollars !== null && figureDollars !== null && figureDollars > capDollars;

  // ONE VERDICT, AND THE TRADE WINS IT ONLY WHEN THE MONEY IS ALSO WRONG.
  //
  // An excluded trade with a small figure on it is the case this feature was
  // asked for -- a dripping tap, a tripped breaker -- so leading with it there
  // would put a warning on every single one. *A red number that never clears is
  // how people learn to stop reading badges*, which this file already says
  // about the nav count, and then the one that matters ($8,000 of re-piping)
  // is drawn like a washer.
  //
  // So the COLOUR FOLLOWS THE MONEY and the trade is said quietly every time,
  // in `note`. Over the figure it leads, because then no amount would have been
  // exempt and being under would not have helped -- `docs.js`'s worst-wins
  // rule, on two axes instead of four documents.
  const reason = excluded.length && over ? "trade_not_exempt"
    : row.basis === "no_state_license" ? "no_state_license"
      : row.basis === "none" ? "no_exemption"
        : over ? (row.basis === "annual" ? "over_annual" : "over_per_job")
          : compared === null
            ? (row.basis === "annual" ? "cap_unmeasured" : "cap_known")
            : "under_cap";

  return {
    ...base,
    basis: row.basis, capDollars, capCents: capCentsFor(code),
    aboveCap: row.aboveCap, note: row.note || "", verify: !!row.verify,
    compared, figureDollars, figureIs,
    over,
    overByDollars: over && capDollars !== null && figureDollars !== null
      ? Math.max(0, figureDollars - capDollars) : 0,
    reason,
    // A WARNING IS SOMETHING TO ACT ON; A NOTE IS SOMETHING TO KNOW. Over the
    // figure, or a state with no exemption at all, is the first. Everything
    // else is the second, and is still said: Washington's cap is $500 and its
    // note is that the exemption goes the moment they advertise, which matters
    // more than the figure and matters under it too.
    level: over ? "warn" : "note",
  };
}

// THE WORDS, HERE RATHER THAN ON THE SCREEN, because the form, the route's
// recorded detail and the tests all describe the same thing -- the reason
// `docStatusText` lives in `docs.js`.
//
// Three fields with three jobs: `head` is the verdict, `why` is the figure and
// what it takes to go above it, `note` is the dataset's own caveat. A caller
// that renders only `head` has still said something true.
export function handymanCapText(chk) {
  if (!chk) return null;
  const where = chk.stateLabel || "this state";
  const cap = chk.capDollars === null ? null : money(chk.capDollars);
  const fig = chk.figureDollars === null ? null : money(chk.figureDollars);
  // The authority is a proper noun -- L&I, MHIC, CSLB -- so it is never
  // lowercased into a sentence. A colon sidesteps the grammar entirely.
  const above = chk.aboveCap ? `Above it: ${chk.aboveCap}.` : "";
  const them = andList(chk.excludedLabels || []);

  const head = {
    unknown_state: "Nobody has said where this work is.",
    trade_not_exempt: `${them} is outside every state's handyman exemption.`,
    no_state_license: `${where} does not license contractors.`,
    no_exemption: `${where} has no handyman exemption.`,
    over_per_job: `Over ${where}'s handyman limit for one job.`,
    over_annual: `Past ${where}'s annual handyman limit.`,
    under_cap: `Within ${where}'s handyman limit.`,
    cap_known: `${where}'s handyman limit is ${cap} for one job.`,
    cap_unmeasured: `${where} sets an annual handyman limit of ${cap}.`,
  }[chk.reason] || "";

  const why = {
    unknown_state: "Without a state there is no handyman limit to check. "
      + "Add the building's state, or the contractor's.",
    trade_not_exempt: "No state's handyman exemption covers it, whatever the amount — "
      + "it takes the trade licence. Small repairs are usually fine; anything a permit "
      + "would be pulled for is not.",
    no_state_license: "Only city or county rules apply, and they often do.",
    no_exemption: `Unlicensed work is not exempt at any amount. ${above}`.trim(),
    over_per_job: `${fig} on this job against a ${cap} limit — ${money(chk.overByDollars)} over. ${above}`.trim(),
    // NAMED AS THIS ACCOUNT'S SLICE when that is what was measured, because
    // that is all it is. The real cap counts every client they have, so
    // SubSub's figure is a floor and saying otherwise would be a number
    // pretending to be the answer.
    over_annual: (chk.figureIs === "year"
      ? `${fig} committed through this account this year, against a ${cap} limit across `
        + "their whole business — and SubSub cannot see their other clients."
      : `${fig} on this one job, against a ${cap} limit for their whole year.`)
      + (above ? ` ${above}` : ""),
    under_cap: chk.figureIs === "year"
      ? `${fig} committed through this account this year, of ${cap} across their whole business.`
      : `${fig} on this job against a ${cap} limit.`,
    cap_known: `Labour and materials together, per job. ${above}`.trim(),
    cap_unmeasured: "It counts their whole year across every client, which SubSub "
      + "cannot see all of.",
  }[chk.reason] || "";

  // The caveat, and whether anybody has checked the figure. Both ride on the
  // same line because they are read together: a note that moves the number is
  // worth as much as a flag saying the number is unconfirmed.
  const bits = [];
  if (chk.note) bits.push(chk.note.replace(/\.$/, ""));
  if (chk.verify && chk.reason !== "unknown_state") {
    bits.push("This figure has not been checked against the state board — confirm it before relying on it");
  }
  // Said here as well as in the head, because the head only leads with it when
  // nothing else outranks it and this must never be the thing that drops out.
  if (chk.excluded.length && chk.reason !== "trade_not_exempt") {
    bits.push(`${them} sits outside every state's handyman exemption whatever the amount`);
  }
  return { head, why, note: bits.length ? bits.join(". ") + "." : "" };
}
