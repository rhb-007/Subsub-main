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
  // 066. Two more, and they are not variants of the three above.
  //
  // CANCELLED is terminal and is the one a job the account raised itself
  // could not reach at all: `withdraw` is the requester's own move and most
  // jobs have no requester, `decline` refuses anything already approved. So
  // the only way out was to record that work had been done.
  cancelled: { label: "Cancelled", why: "This work is not being done." },
  // AND COMPLETE WITH NOTHING DONE, which is a completion and must not read
  // as verified work. Same colour as completed, told apart by the words --
  // the rule `docs.js` keeps about expired and never-added.
  no_work: { label: "Closed, no work done",
    why: "This was closed out with no work done to it." },
};

// 066. THE THREE ENDINGS SOMEBODY CHOOSES BETWEEN, and the row that undoes a
// deferral. `resumed` is deliberately in the same vocabulary rather than being
// a delete: *we put this off in January and picked it up in March* is two
// facts, and the first is the one anybody asks about later.
export const ENDING_KINDS = {
  cancelled: {
    id: "cancelled", label: "Cancel this job", terminal: true, needsNote: true,
    short: "Cancelled",
    // What pressing it says, in the words somebody deciding needs.
    note: "This work is not going ahead. The job and its history stay; anybody booked is stood down.",
  },
  deferred: {
    id: "deferred", label: "Put it on hold", terminal: false, needsNote: false,
    short: "On hold",
    note: "Not now. It comes off the schedule and nobody can be assigned until it is back.",
  },
  no_work: {
    id: "no_work", label: "Close it — no work needed", terminal: true, needsNote: true,
    short: "No work done",
    note: "Finished with, because there was nothing to do. Nothing can be paid against it.",
  },
  resumed: { id: "resumed", label: "Take it off hold", terminal: false, needsNote: false,
    short: "Resumed", note: "Back on the schedule." },
};
export const ENDING_IDS = Object.keys(ENDING_KINDS);
// The three a person chooses from. `resumed` is not an ending somebody picks,
// it is how a hold stops -- so it is in the vocabulary and off the picker.
export const CHOOSABLE_ENDINGS = ["cancelled", "deferred", "no_work"];
export const isEndingKind = (k) => ENDING_IDS.includes(String(k || ""));

// READS BOTH SPELLINGS ON PURPOSE. The browser holds `withdrawnAt` and the
// Worker holds a raw row with `withdrawn_at`, and both call this. Normalising
// at each call site instead would be a conversion to forget at the twenty-first
// one, which is exactly how the job scope ended up enforced in the list
// endpoints and not in the route -- and a missed conversion here reads as
// "not closed", which is the direction that opens the gate.
const at = (job, camel, snake) => job?.[camel] ?? job?.[snake] ?? null;

// 066. WHAT THE NEWEST `job_endings` ROW SAYS, read the same two-spelling way
// as everything else here: the Worker passes a raw row with `ending_kind` and
// the browser holds `endingKind`. Flat on both sides on purpose -- a nested
// object one side and columns the other is a conversion to forget, which this
// file already records as the direction that opens the gate.
export function jobEnding(job) {
  if (!job) return { kind: null, note: null, until: null, at: null };
  const kind = at(job, "endingKind", "ending_kind");
  return {
    kind: isEndingKind(kind) ? kind : null,
    note: at(job, "endingNote", "ending_note"),
    until: at(job, "endingUntil", "ending_until"),
    at: at(job, "endingAt", "ending_at"),
  };
}

// IS IT ON HOLD RIGHT NOW, which is not the same as having been deferred.
//
// A hold with a date comes off BY ITSELF when that date passes, which is what
// "defer until March" means and is why this needs no nightly sweep to undo
// it. A hold with no date is indefinite and only a `resumed` row ends it.
//
// `today` is passed in rather than read from the clock, because the Worker
// answers in UTC and the browser in the reader's own zone -- and a job coming
// off hold a few hours early or late on one of the two is not worth two
// different answers to "is this live".
export function jobHold(job, today = null) {
  const e = jobEnding(job);
  if (e.kind !== "deferred") return { held: false, until: null, note: null, lapsed: false };
  const until = e.until || null;
  // Strictly past: a hold until the 6th is still a hold ON the 6th, because
  // somebody who picked a date meant the work happens then and not before.
  const lapsed = !!(until && today && String(until) < String(today));
  return { held: !lapsed, until, note: e.note || null, lapsed };
}

export function jobClosure(job) {
  if (!job) return { closed: false, reason: null, label: "", why: "" };
  const e = jobEnding(job);
  // Withdrawn and declined are checked FIRST. A job can carry a status of
  // completed and a withdrawal both -- reopening writes `status` back and
  // leaves the other columns alone -- and "withdrawn" is the more specific
  // thing to have happened to it.
  //
  // CANCELLED SITS WITH THEM and above `completed` for the same reason: it is
  // the more specific thing, and a cancelled job that was once marked
  // complete should read as cancelled.
  //
  // `no_work` is checked only ALONGSIDE a completed status, never instead of
  // it. The row says why the completion happened; it is not a way to be
  // closed without one, and reopening writes `status` back and must take this
  // reading with it.
  const reason = at(job, "withdrawnAt", "withdrawn_at") ? "withdrawn"
    : at(job, "declinedAt", "declined_at") ? "declined"
      : e.kind === "cancelled" ? "cancelled"
        : job.status === "completed" ? (e.kind === "no_work" ? "no_work" : "completed")
          : null;
  if (!reason) return { closed: false, reason: null, label: "", why: "" };
  return { closed: true, reason, ...CLOSED_REASONS[reason],
    // The reason somebody typed, where there is one. A cancellation with no
    // words on the card is indistinguishable from a mis-press.
    note: reason === "cancelled" || reason === "no_work" ? (e.note || null) : null };
}

export const jobIsClosed = (job) => jobClosure(job).closed;

// LIVE: not finished with, and not on hold. THE predicate for anything that
// treats a job as work still to come -- the schedule, the overdue count, the
// fortnight strip, the calendar dots, the undated count and auto-turnaround.
//
// A separate name from `jobIsClosed` rather than folding a hold into it,
// because the two answer different questions and both have callers. A held job
// is NOT closed: it keeps its phase on the Jobs screen, it can be resumed, and
// the list must not file it under completed. What it must not do is appear as
// something anybody is expecting.
export const jobIsLive = (job, today = null) =>
  !jobIsClosed(job) && !jobHold(job, today).held;

// WHY A JOB CANNOT BE ENDED THE WAY SOMEBODY ASKED, in one place, read by the
// route and by the screen so neither can offer what the other refuses.
//
// MONEY IS THE HARD BOUNDARY and it is deliberately not overridable. Once a
// funding has landed against this job, cancelling is a refund question --
// there is real money sitting in a balance with this job's name on it, and a
// route that quietly cancelled around it would leave the only record of that
// money saying the work was called off. Named rather than refused silently, so
// the screen can send somebody to the money instead of to a dead button.
//
// A hold is deliberately NOT refused on funded money: putting work off does
// not spend or release anything, and the funding is still there when it comes
// back.
export function whyNotEnd(job, kind, { fundedCents = 0, today = null } = {}) {
  if (!job) return "job_not_found";
  if (!isEndingKind(kind) || kind === "resumed") return "bad_kind";
  const shut = jobClosure(job);
  // Already finished with. Said by name, because "cancel" on a job somebody
  // else withdrew last week needs a different sentence from a refusal.
  if (shut.closed) return `already_${shut.reason}`;
  // A request nobody has approved is not a job yet -- `decline` is its door,
  // and it takes a reason the way this does. Two doors onto one act is how
  // the two come to disagree about what they wrote.
  if (at(job, "requestedBy", "requested_by") && !at(job, "approvedAt", "approved_at")) {
    return "not_approved";
  }
  if (kind === "deferred" && jobHold(job, today).held) return "already_deferred";
  if (kind !== "deferred" && Math.round(fundedCents) > 0) return "money_funded";
  return null;
}

// And the reverse: a hold can only be taken off something that is on hold.
export function whyNotResume(job, { today = null } = {}) {
  if (!job) return "job_not_found";
  const shut = jobClosure(job);
  if (shut.closed) return `already_${shut.reason}`;
  if (!jobHold(job, today).held) return "not_deferred";
  return null;
}

export const ENDING_REFUSALS = {
  job_not_found: "That job isn't here any more.",
  bad_kind: "That isn't one of the ways a job can end.",
  not_approved: "This is still a request nobody has approved. Decline it instead.",
  already_cancelled: "This job was already cancelled.",
  already_completed: "This job is already complete. Reopen it first.",
  already_no_work: "This job is already closed out. Reopen it first.",
  already_withdrawn: "Whoever asked for this took it back already.",
  already_declined: "This request was declined already.",
  already_deferred: "This job is already on hold.",
  not_deferred: "This job isn't on hold.",
  reason_required: "Say why, so somebody reading this in six months knows.",
  money_funded: "There is money funded against this job, so cancelling it is a refund"
    + " rather than a tidy-up. Refund what is unspent first, on the work order.",
};

// WHAT PRESSING IT COSTS, so the confirmation can say it rather than ask "are
// you sure". The same shape `completionEffects` already answers for the
// completion modal, and for the same reason: a job nobody was assigned to is
// the commonest way this gets pressed by mistake, and a crew booked for
// Tuesday is the one thing somebody has to be told before they press.
export function endingEffects(job = {}, { openQuotes = 0, openOverflow = 0,
  fundedCents = 0, hasVisit = false } = {}) {
  const trades = Array.isArray(job.trades) ? job.trades : [];
  const assignments = job.assignments && typeof job.assignments === "object" ? job.assignments : {};
  // Anybody who would be stood down. Accepted AND pending, because a pending
  // work order is an offer somebody may be about to accept, and standing one
  // down silently is how a contractor prices an afternoon for nothing.
  const booked = trades.filter((t) => assignments[t] && assignments[t].status !== "declined");
  const accepted = booked.filter((t) => assignments[t]?.status === "accepted" || assignments[t]?.auto);
  return { booked, accepted, openQuotes, openOverflow,
    fundedCents: Math.round(fundedCents), hasVisit: !!hasVisit };
}

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
