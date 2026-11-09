// Who has joined this account's roster on their own -- through the public
// application form or by accepting an invite -- and has not been looked at.
//
// Nobody on the account did anything when that happened, so without this the
// first anybody heard of a new contractor was finding them on the roster.
// A row stays until somebody on the account opens it or dismisses it, or until
// APPLICANT_DAYS have passed, because a list of last spring's joiners is a red
// count nobody can clear.

export const APPLICANT_DAYS = 30;

export function newApplicants(subs, nowMs = Date.now()) {
  const cutoff = nowMs - APPLICANT_DAYS * 86400000;
  return (subs || [])
    .filter((s) => {
      const at = Date.parse(s?.appliedAt || "");
      if (!Number.isFinite(at) || at < cutoff) return false;
      const seen = Date.parse(s.applicationSeenAt || "");
      // Seen BEFORE the newest application is not seen: somebody who applied
      // again (an invite accepted after a form) is news again.
      return !Number.isFinite(seen) || seen < at;
    })
    .sort((a, b) => Date.parse(b.appliedAt) - Date.parse(a.appliedAt));
}

export function applicantLine(s) {
  return s?.appliedVia === "invite" ? "Accepted your invite and joined your roster"
    : "Applied to join your roster";
}
