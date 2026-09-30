// WHAT THE PEOPLE AN ACCOUNT ENGAGES ARE CALLED.
//
// A general contractor holds the prime contract, so the people they engage
// work UNDER it and "subcontractor" is the right word. A property manager, a
// portfolio manager and a building owner engage a plumber directly for their
// own building: nobody is sub to anything, and "subcontractor" there describes
// a chain that does not exist.
//
// A subcontractor account gets "subcontractor" too, because passing work
// further down is still passing it down a chain -- which is what the lien
// waiver roll-up already models, at every tier.
//
// SHARED, because this was being decided in three places. The browser's
// `ACCOUNT_KINDS.hiresLabel` reads it, and so does anything that has to say
// what somebody IS to an account that hires them. An unknown kind gets
// "contractor": the neutral word is right more often than the specific one,
// and a word that describes a chain which does not exist is the failure this
// exists to prevent.
const SUB_HIRERS = ["general_contractor", "subcontractor"];

export const hiresLabelFor = (kind) =>
  SUB_HIRERS.includes(String(kind || "")) ? "subcontractor" : "contractor";

// The same fact from the other side: what THIS company is to an account that
// hires it. Reads the HIRER'S kind, never our own -- being a subcontractor is
// a fact about the relationship, not about the business.
export const hiredLabelFor = (hirerKind) => hiresLabelFor(hirerKind);

// And the verb, for the line a contractor reads about their own work.
// "Subcontracting for Cascade Management" is wrong when Cascade is a managing
// agent, and there is no verb that is right for a mixed list -- so a list that
// is not all one kind says the neutral thing rather than the flattering one.
export function workingForVerb(hirerKinds = []) {
  const kinds = [...hirerKinds].filter(Boolean);
  if (kinds.length && kinds.every((k) => SUB_HIRERS.includes(String(k)))) {
    return "Subcontracting for";
  }
  return "Working for";
}
