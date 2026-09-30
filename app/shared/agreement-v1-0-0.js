// SubSub standard subcontractor agreement, VERSION 1.0.0 — SUPERSEDED, FROZEN.
//
// DO NOT EDIT ANY PROSE IN THIS FILE. Not a typo, not a comma, not a heading.
//
// A stored agreement names the template version it was rendered from, and the
// hash recorded at signature is a hash of THIS text. `renderAgreement` looks
// the version up exactly and throws on a miss, so reproducing a document
// signed under 1.0.0 means rendering it from here, unchanged, for as long as
// that document matters -- which for a contract is years after it ends.
//
// WHY IT IS A WHOLE COPY RATHER THAN A PATCH ON THE CURRENT ONE. 1.1.0 changes
// one section out of fifteen, so deriving one from the other is the obvious
// move and it is refused. Either direction leaves a trap: derive the current
// one from this and editing a clause means editing a frozen file; derive this
// one from the current and editing any OTHER clause silently rewrites what
// somebody already signed. Only a full copy is safe by construction, and
// CLAUDE.md already accepted that price in its own words -- superseded
// versions are never deleted.
//
// It lives in its own file so the living template stays one readable version
// rather than an archive with the current text somewhere inside it. Each
// superseded version gets a file; `TEMPLATES` imports them all.
//
// `agreement-test.mjs` renders this against a HARD-CODED hash, so drift here
// from any cause -- an edit, a shared helper changing under it, a dependency
// moving -- fails loudly rather than at the moment somebody disputes a job.
//
// What changed in 1.1.0, recorded here so the diff is not the only record:
// section 9 (Warranty) gained a response time for a defect notice, the warranty
// period renders as years where it is a whole number of them, and the default
// period moved from 12 months to 36.

import { US_STATES } from "./states.js";

const money = (cents) => {
  const n = Math.round(Number(cents) || 0) / 100;
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
};
const stateName = (code) =>
  (US_STATES.find(([c]) => c === String(code || "").toUpperCase()) || [])[1] || null;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// A party, written the way it should read in a contract: the name, then the
// address on one line, then the licence if there is one. Missing pieces are
// omitted rather than printed as blanks -- a contract with an empty bracket in
// it looks unfinished, which is the one thing a document being signed must not.
const partyLine = (p) => {
  const bits = [p?.name || "", [p?.street, p?.city, p?.state, p?.zip].filter(Boolean).join(", ")]
    .filter(Boolean);
  if (p?.license) bits.push(`licence no. ${p.license}`);
  return bits.join(" of ");
};

// WHO THE PARTIES ARE CALLED, WHICH IS NOT THE SAME QUESTION IN EVERY ACCOUNT.
//
// A general contractor holds the prime contract, so the people they engage
// work UNDER it and "Subcontractor" is the right defined term. A property
// manager, a portfolio manager and a building owner engage a plumber directly
// for their own building: nobody is sub to anything, and a document calling
// them a subcontractor describes a chain that does not exist. This is the same
// rule `hiresLabel` already applies to the roster, applied to the one place it
// matters most -- a contract's defined terms.
//
// A subcontractor account gets Contractor/Subcontractor too, because passing
// work further down is still passing it down a chain.
//
// IT LIVES INSIDE THE TEMPLATE, not beside it, and that is deliberate: these
// words are part of the document. Changing one changes what was signed, so it
// has to move the version with it, which is machinery that already exists.
const PARTY_TERMS = {
  general_contractor: { hiring: "Contractor", hired: "Subcontractor", doc: "Subcontractor Agreement" },
  subcontractor:      { hiring: "Contractor", hired: "Subcontractor", doc: "Subcontractor Agreement" },
  property_manager:   { hiring: "Manager",    hired: "Contractor",    doc: "Contractor Agreement" },
  portfolio_manager:  { hiring: "Manager",    hired: "Contractor",    doc: "Contractor Agreement" },
  building_owner:     { hiring: "Owner",      hired: "Contractor",    doc: "Contractor Agreement" },
};
// An unknown kind gets the neutral pair rather than nothing. A contract that
// renders with a blank where a party name belongs is worse than one using a
// slightly formal word.
const NEUTRAL_TERMS = { hiring: "Hiring Party", hired: "Contractor", doc: "Contractor Agreement" };
const partyTermsFor = (kind) => PARTY_TERMS[kind] || NEUTRAL_TERMS;

export const AGREEMENT_V1_0_0 = {
  id: "subsub-standard-subcontract",
  // Bumped whenever a word changes. A stored agreement names the version it
  // was rendered from, so editing this file can never change what somebody
  // already signed.
  version: "1.0.0",
  // IT IS SUBSUB'S FORM AND IT SAYS SO. Whose document this is, is the first
  // thing either party needs to know -- a form headed with the hiring
  // company's name reads as their own bespoke paper, which is the opposite of
  // what it is. The company is a party filled into it, not the identity of it.
  titleFor: (kind) => `SubSub Standard ${partyTermsFor(kind).doc}`,
  partyTerms: PARTY_TERMS,
  neutralTerms: NEUTRAL_TERMS,
  // { by, firm, on, states: [] } once somebody qualified has actually read it.
  reviewed: null,

  sections: [
    {
      id: "parties",
      heading: "1. The parties and this agreement",
      body: (x) => [
        `This agreement is made on ${x.issuedOn} between ${partyLine(x.hiring)} (the "${x.T.hiring}") and ${partyLine(x.sub)} (the "${x.T.hired}").`,
        `It is a master agreement. It does not by itself commit either party to any particular work. It sets the terms that apply whenever the ${x.T.hiring} issues, and the ${x.T.hired} accepts, a work order under it.`,
        `Where a work order and this agreement disagree, the work order governs for that work only, and only as to scope, schedule and price.`,
      ],
    },
    {
      id: "status",
      heading: (x) => `2. ${x.T.hired} status`,
      body: (x) => [
        `The ${x.T.hired} is an independent contractor and not an employee, agent, partner or joint venturer of the ${x.T.hiring}. Nothing here creates an employment relationship.`,
        `The ${x.T.hired} controls the manner and means of its own work, supplies its own tools, equipment and materials unless a work order says otherwise, and sets its own hours consistent with the schedule it has accepted.`,
        `The ${x.T.hired} is responsible for its own personnel, including their wages, taxes, benefits, workers' compensation and any withholding, and for anyone it engages to perform any part of the work.`,
      ],
    },
    {
      id: "work",
      heading: "3. The work",
      body: (x) => [
        `The ${x.T.hired} will perform each accepted work order in a good and workmanlike manner, in accordance with the drawings, specifications and scope stated in it, and in compliance with all applicable laws, codes and permit conditions.`,
        `The ${x.T.hired} will keep the site reasonably clean, and will remove its own debris and surplus material on completing the work.`,
        `The ${x.T.hired} will not perform work outside an accepted work order and expect payment for it. Additional or changed work must be authorised in writing, with its price and any schedule effect agreed, before it is carried out.`,
      ],
    },
    {
      id: "licensing",
      heading: "4. Licensing and compliance",
      body: (x) => {
        const st = stateName(x.terms.governingState);
        return [
          `The ${x.T.hired} represents that it holds, and will maintain throughout this agreement, every licence, registration, bond and permit required for the work it performs${st ? ` in ${st}` : ""}, and that it is in good standing under each.`,
          `The ${x.T.hired} will tell the ${x.T.hiring} promptly if any of those lapses, is suspended or is revoked.`,
          `The ${x.T.hired} will keep its records in SubSub current, and authorises the ${x.T.hiring} to verify its licence status with the issuing authority.`,
        ];
      },
    },
    {
      id: "insurance",
      heading: "5. Insurance",
      body: (x) => {
        const t = x.terms;
        const lines = [
          `The ${x.T.hired} will carry, at its own expense and throughout this agreement, at least the following:`,
        ];
        const items = [
          `commercial general liability of at least ${money(t.cglPerOccurrenceCents)} for each occurrence and ${money(t.cglAggregateCents)} in the aggregate;`,
        ];
        if (t.autoLiabilityCents > 0) {
          items.push(`business automobile liability of at least ${money(t.autoLiabilityCents)} combined single limit, covering owned, hired and non-owned vehicles;`);
        }
        if (t.umbrellaCents > 0) {
          items.push(`umbrella or excess liability of at least ${money(t.umbrellaCents)};`);
        }
        if (t.workersComp) {
          items.push(`workers' compensation at statutory limits, and employer's liability, for every person it employs.`);
        }
        lines.push(...items.map((s, i) => `(${"abcdefgh"[i]}) ${s}`));

        const endorse = [];
        if (t.additionalInsured) endorse.push(`name the ${x.T.hiring} as an additional insured on the general liability and automobile policies, for both ongoing and completed operations`);
        if (t.primaryNonContributory) endorse.push(`be primary and non-contributory with respect to any insurance the ${x.T.hiring} carries`);
        if (t.waiverOfSubrogation) endorse.push(`include a waiver of subrogation in favour of the ${x.T.hiring}`);
        if (endorse.length) {
          lines.push(`The ${x.T.hired}'s policies will ${endorse.join("; ")}.`);
        }
        lines.push(`The ${x.T.hired} will keep a current certificate of insurance on file with the ${x.T.hiring}, and will give the ${x.T.hiring} notice of cancellation, non-renewal or material reduction as its policies require.`);
        lines.push(`The ${x.T.hiring} may withhold payment for, and may decline to schedule, any work for which current evidence of the cover required here is not on file.`);
        return lines;
      },
    },
    {
      id: "payment",
      heading: "6. Payment",
      body: (x) => {
        const t = x.terms;
        const lines = [
          `The ${x.T.hiring} will pay the ${x.T.hired} the amount stated in each work order, on the terms stated in it.`,
          `The ${x.T.hired} will invoice for work it has completed. The ${x.T.hiring} will pay each approved invoice within ${plural(t.paymentDays, "day", "days")} of approval.`,
        ];
        if (t.retainageBps > 0) {
          lines.push(`The ${x.T.hiring} may retain ${(t.retainageBps / 100).toFixed(t.retainageBps % 100 ? 2 : 0)}% of each payment until the work under that work order is complete and accepted, at which point the retained amount becomes due.`);
        }
        lines.push(`The ${x.T.hiring} may withhold a reasonable amount on account of work that is defective, incomplete or not yet corrected, of claims by others arising from the ${x.T.hired}'s work, or of documents required by this agreement that are not on file. The ${x.T.hiring} will say in writing what is being withheld and why.`);
        lines.push(`Payment is not acceptance of defective work.`);
        return lines;
      },
    },
    {
      id: "safety",
      heading: "7. Safety",
      body: (x) => [
        `The ${x.T.hired} is responsible for the safety of its own personnel and for its own compliance with occupational safety law and with the site rules it has been given.`,
        `The ${x.T.hired} will report to the ${x.T.hiring}, promptly, any injury, near miss or dangerous condition arising out of or affecting its work.`,
      ],
    },
    {
      id: "indemnity",
      heading: "8. Indemnity",
      body: (x) => [
        `The ${x.T.hired} will indemnify and hold the ${x.T.hiring} harmless from claims, damages, losses and reasonable expenses, including reasonable legal fees, to the extent they are caused by the negligent act or omission of the ${x.T.hired}, anyone it employs, or anyone it engages to perform any part of the work.`,
        `This obligation does not extend to any part of a claim caused by the negligence or wilful misconduct of the ${x.T.hiring} or of anyone else the ${x.T.hiring} is responsible for, and it is limited in every case to the extent permitted by the law of the state that governs this agreement.`,
        `This obligation is not limited by the amount or type of insurance either party carries.`,
      ],
    },
    {
      id: "warranty",
      heading: "9. Warranty",
      body: (x) => [
        `The ${x.T.hired} warrants that its work will be free from defects in workmanship and, unless a work order says the ${x.T.hiring} supplies them, in materials.`,
        `This warranty runs for ${plural(x.terms.warrantyMonths, "month", "months")} from the date the work under a work order is completed, and is in addition to any manufacturer's warranty, which the ${x.T.hired} will pass through to the ${x.T.hiring}.`,
        `On notice of a defect within that period, the ${x.T.hired} will correct it at its own expense within a reasonable time. If it does not, the ${x.T.hiring} may have it corrected and recover the reasonable cost.`,
      ],
    },
    {
      id: "liens",
      heading: "10. Liens and waivers",
      body: (x) => [
        `The ${x.T.hired} will pay, when due, everyone it employs or engages and every supplier of material for the work.`,
        `As a condition of payment, the ${x.T.hired} will provide lien waivers, in the form required by the law of the state where the property is, from itself and from anyone below it whose claim could attach to the property.`,
        `Nothing here waives any lien right in advance of payment, and nothing here waives a right that the law of that state does not permit to be waived.`,
      ],
    },
    {
      id: "term",
      heading: "11. Term, suspension and termination",
      body: (x) => [
        `This agreement runs until either party ends it. Either party may end it for convenience on ${plural(x.terms.noticeDays, "day", "days")} written notice.`,
        `Ending this agreement does not affect a work order already accepted, which continues under these terms until it is completed or separately ended.`,
        `The ${x.T.hiring} may suspend or end a particular work order on written notice if the ${x.T.hired} fails to perform it and does not cure the failure within ${plural(x.terms.cureDays, "day", "days")} of being told of it in writing. In that case the ${x.T.hired} is paid for work properly performed up to that point, less the reasonable cost of completing or correcting it.`,
        `The ${x.T.hiring} may suspend scheduling, without ending this agreement, while the ${x.T.hired}'s licence or required insurance is not current.`,
      ],
    },
    {
      id: "flowdown",
      heading: "12. Assignment and lower tiers",
      body: (x) => [
        `The ${x.T.hired} will not assign this agreement or any work order without the ${x.T.hiring}'s written consent.`,
        `The ${x.T.hired} may engage others to perform part of the work, and remains fully responsible for their work and their conduct as if it were its own. It will bind each of them to terms no less protective of the ${x.T.hiring} than these.`,
      ],
    },
    {
      id: "records",
      heading: "13. Records and confidentiality",
      body: (x) => [
        `Each party will keep the other's pricing, customer information and business records confidential, and will use them only for the purpose of this agreement. This does not apply to anything already public, or to a disclosure required by law.`,
        `The ${x.T.hired} will keep records relating to its work under this agreement for ${plural(x.terms.recordsYears, "year", "years")} after the work is completed, and will make them available to the ${x.T.hiring} on reasonable request in connection with a claim about that work.`,
      ],
    },
    {
      id: "law",
      heading: "14. Governing law and disputes",
      body: (x) => {
        const st = stateName(x.terms.governingState);
        return [
          st
            ? `This agreement is governed by the law of ${st}, without regard to its conflict of laws rules.`
            : `This agreement is governed by the law of the state in which the work is performed, without regard to its conflict of laws rules.`,
          `The parties will attempt in good faith to resolve any dispute by discussion before starting proceedings.`,
          `Where the law of the state in which the property is located governs a particular question -- including lien rights and the enforceability of any indemnity -- that law applies to that question.`,
        ];
      },
    },
    {
      id: "whole",
      heading: "15. The whole agreement",
      body: (x) => [
        `This agreement, together with each accepted work order, is the entire agreement between the parties about its subject, and replaces any earlier understanding about it.`,
        `A change to this agreement is effective only if it is in writing and agreed by both parties. A party's failure to insist on a term on one occasion does not waive it.`,
        `If any provision is held unenforceable, the rest continues in force, and that provision applies to the greatest extent the law allows.`,
      ],
    },
  ],
};
