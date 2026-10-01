// Whether a job is finished with, and WHY.
//
// `isClosed` lived in App.tsx and nowhere else, so it was a fact the browser
// knew and the server did not. The three doors that commit a contractor to
// work -- assign, ask for quotes, post to overflow -- each read the job row,
// and not one of them read `status`: the assign route selected
// `id, requested_by, approved_at, date` and nothing more. So a job closed out
// last week could still have a work order issued against it, and the only
// thing standing in the way was a button the screen happened not to draw.
//
// Except it drew them. The empty trade slot's action row had no `done` check
// at all, so a completed job offered Assign & issue WO, Ask for quotes and
// Overflow exactly as a live one did -- and every one of them worked. **A
// screen must not be stricter than the route behind it, any more than it may
// be looser**, and here it was neither: both halves were open.
//
// One predicate, read by the card and by all three routes.

// The three ways a job stops being work anybody should be committed to. They
// are told apart because they are different events and a person reading a card
// needs to know which happened -- the same reason expired and never-added
// share a colour in `docs.js` and are told apart by the words.
export const CLOSED_REASONS = {
  completed: { label: "Completed", why: "This job has been marked complete." },
  withdrawn: { label: "Withdrawn", why: "The person who asked for this withdrew it." },
  declined: { label: "Declined", why: "This request was declined." },
};

// READS BOTH SPELLINGS ON PURPOSE. The browser holds `withdrawnAt` and the
// Worker holds a raw row with `withdrawn_at`, and both call this. Normalising
// at each call site instead would be a conversion to forget at the twenty-first
// one, which is exactly how the job scope ended up enforced in the list
// endpoints and not in the route -- and a missed conversion here reads as
// "not closed", which is the direction that opens the gate.
const at = (job, camel, snake) => job?.[camel] ?? job?.[snake] ?? null;

export function jobClosure(job) {
  if (!job) return { closed: false, reason: null, label: "", why: "" };
  // Withdrawn and declined are checked FIRST. A job can carry a status of
  // completed and a withdrawal both -- reopening writes `status` back and
  // leaves the other columns alone -- and "withdrawn" is the more specific
  // thing to have happened to it.
  const reason = at(job, "withdrawnAt", "withdrawn_at") ? "withdrawn"
    : at(job, "declinedAt", "declined_at") ? "declined"
      : job.status === "completed" ? "completed"
        : null;
  if (!reason) return { closed: false, reason: null, label: "", why: "" };
  return { closed: true, reason, ...CLOSED_REASONS[reason] };
}

export const jobIsClosed = (job) => jobClosure(job).closed;

// What completing one costs, so the confirmation can say it rather than ask
// "are you sure". The answer is read off the job the person is standing on:
// a job nobody was ever assigned to is the commonest way this gets pressed by
// mistake, and it is invisible on a card that only counts filled slots.
export function completionEffects(job = {}, { openQuotes = 0, openOverflow = 0 } = {}) {
  const trades = Array.isArray(job.trades) ? job.trades : [];
  const assignments = job.assignments && typeof job.assignments === "object" ? job.assignments : {};
  const unassigned = trades.filter((t) => !assignments[t]);
  const awaiting = trades.filter((t) => assignments[t]?.status === "pending");
  return { unassigned, awaiting, openQuotes, openOverflow };
}
