// The fifty states, the District of Columbia, and nothing hardcoded anywhere
// else.
//
// SubSub was written in Washington and it showed: the subcontractor
// application opened with the state already set to WA, several forms carried
// "WA" as a placeholder, and the state was a free-text two-character box that
// accepted "XX" as readily as "OR". A pre-filled wrong answer is worse than
// an empty box -- a form that arrives looking answered is one nobody
// corrects -- and a typo here is silent, because the licence lookup keys on
// the state and simply finds nothing.
//
// Imported by the Worker and by the browser, so there is one list and the two
// cannot disagree about what a state is.
//
// Territories are deliberately absent. Contractor licensing in Puerto Rico,
// Guam and the USVI works differently enough that offering them here would
// promise something the rest of the product cannot keep. Add them when there
// is a reason to, not because a list looked incomplete.
export const US_STATES = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"],
  ["CA", "California"], ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"],
  ["DC", "District of Columbia"], ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"],
  ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"],
  ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"],
  ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"],
  ["MS", "Mississippi"], ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"],
  ["NV", "Nevada"], ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"],
  ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"],
  ["OK", "Oklahoma"], ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"],
  ["SC", "South Carolina"], ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"],
  ["UT", "Utah"], ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"],
  ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"],
];

const CODES = new Set(US_STATES.map(([code]) => code));

// Is this a state we will store? Empty is allowed everywhere -- somebody who
// has not said where they are is not an error, they are somebody who has not
// got to that field yet.
export const isState = (v) => CODES.has(String(v || "").trim().toUpperCase());

// What to store. Returns null for anything that is not a state, so a typo
// becomes an empty field rather than two characters that look like data and
// match no registry.
export const normalizeState = (v) => {
  const s = String(v || "").trim().toUpperCase();
  return CODES.has(s) ? s : null;
};

// "WA" -> "Washington", for anywhere a code is too terse to read.
export const stateName = (v) => {
  const s = String(v || "").trim().toUpperCase();
  return US_STATES.find(([code]) => code === s)?.[1] || null;
};
