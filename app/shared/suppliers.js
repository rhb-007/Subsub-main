// Who the materials come from.
//
// One file, imported by the browser and by the Worker, for the same reason
// shared/emergency.js is: the two must not disagree about what is on the
// list. The browser draws the chooser from it; the Worker validates against
// it and composes the line that ends up on the work order, so the stored
// text is always something this file produced and never something a client
// typed at it.
//
// Why a list at all. The field was a free-text input, and free text means
// the same yard is spelled four ways inside one account -- "ABC", "ABC
// Supply", "abc supply ballard", "ABC - Ballard" -- so nothing can be
// counted, compared, or later handed to that supplier's own system. A
// closed list fixes the spelling. It must not, however, be a closed world:
// local yards are real and common, which is what `other` is for.

export const SUPPLIERS = [
  { id: "qxo", name: "QXO" },
  { id: "abc", name: "ABC Supply" },
  { id: "srs", name: "SRS Building Materials" },
  { id: "homedepot", name: "Home Depot" },
];

// The id the chooser uses for "somewhere else". Stored like any other, so a
// job sourced from a local yard is still a job whose supplier is recorded,
// rather than one with an empty column and the answer hidden in prose.
export const OTHER = "other";

export const supplierName = (id) => SUPPLIERS.find((s) => s.id === id)?.name || null;
export const isSupplier = (id) => id === OTHER || SUPPLIERS.some((s) => s.id === id);

const clean = (v) => String(v == null ? "" : v).trim();

// The one line a contractor reads on their work order: "ABC Supply —
// Ballard". An em dash with spaces, always, because parse() below splits on
// exactly that and a hand-typed hyphen would not round-trip.
export const materialLine = ({ supplier, branch, other } = {}) => {
  const name = supplier === OTHER ? clean(other) : supplierName(supplier);
  if (!name) return "";
  const b = clean(branch);
  return b ? `${name} — ${b}` : name;
};

// And the inverse.
//
// Every job written before this list existed holds free text in that column,
// and every one of them has to survive being looked at. A chooser that
// cannot represent its own starting value silently rewrites history the
// first time somebody opens an old job and saves it -- which is the same
// class of bug as a page that draws an empty account because a call failed.
// So: recognise what we can, and keep the rest verbatim under `other`
// rather than discarding it.
export const parseMaterialSource = (text) => {
  const raw = clean(text);
  if (!raw) return { supplier: "", branch: "", other: "" };
  // Longest name first: no current pair collides, but "ABC Supply" sitting
  // inside a longer name later would match the wrong one.
  const byLength = [...SUPPLIERS].sort((a, b) => b.name.length - a.name.length);
  for (const s of byLength) {
    if (raw.toLowerCase() === s.name.toLowerCase()) return { supplier: s.id, branch: "", other: "" };
    const prefix = s.name + " — ";
    if (raw.toLowerCase().startsWith(prefix.toLowerCase())) {
      return { supplier: s.id, branch: raw.slice(prefix.length).trim(), other: "" };
    }
  }
  return { supplier: OTHER, branch: "", other: raw };
};
