// TYPING A NAME TO CONFIRM SOMETHING, in one place.
//
// Four call sites across three features ask this question -- countersigning
// an agreement, deleting an account, deleting a company -- and until this
// module existed three of them had written their own, stricter version. The
// strict ones compared against the STORED value untrimmed, which is the bug
// that brought this here: a company whose name had picked up a trailing
// space rendered identically in the label (HTML collapses it) and never
// matched, so the button was dead for ever with nothing on the screen
// saying why. **The requirement a reader sees and the value the code
// compares have to be the same string**, and the only way to guarantee that
// is to normalise both sides.
//
// WHAT IT TOLERATES, AND WHY THAT IS NOT A WEAKENING. Leading and trailing
// space, a run of spaces inside, and case. A typed confirmation exists to
// make somebody stop, read the name, and decide -- that is the whole of what
// it buys, and this project already says so about `ConfirmRemove`: typed
// confirmation is for what cannot be undone. It is not a test of the shift
// key, and a name that has to be reproduced character-exact is one people
// learn to copy and paste, which defeats the point of asking.
//
// What it does NOT tolerate is a different name. Nothing here matches a
// prefix, a substring or an empty string.
export const typedNameMatches = (typed, expected) => {
  const norm = (s) => String(s || "").trim().replace(/\s+/g, " ").toLowerCase();
  return !!norm(typed) && norm(typed) === norm(expected);
};

// Why the button is dead, said beside it. A disabled control with no reason
// next to it is indistinguishable from a broken one -- which is exactly how
// this arrived: "can't delete subcontractors in admin console - stops here".
//
// It answers null while the box is EMPTY, because "that does not match" over
// a box nobody has typed in yet is telling somebody off for not having
// started.
export const typedNameHint = (typed, expected) => {
  if (!String(typed || "").trim()) return null;
  if (typedNameMatches(typed, expected)) return null;
  // TIDIED, because this is shown to a reader. Interpolating the stored
  // value raw printed "That does not match Roundhouse Kick Consgruction ."
  // -- a space before the full stop -- which is this whole bug's own shape
  // in miniature: the label collapses the space and nothing else did. What
  // the hint names has to be the string the label shows.
  const shown = String(expected || "").trim().replace(/\s+/g, " ");
  return `That does not match ${shown}. Spaces and capitals do not matter, the words do.`;
};
