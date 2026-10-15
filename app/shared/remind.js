// WHO A JOB IS WAITING ON, AND WHEN TO REMIND THEM (080).
//
// Asked for as *"make sure everyone is getting notifications of all of these
// if there is an action item others are waiting on, there needs to be a
// sequence of emails that goes out until it's scheduled and cleared."*
//
// The nightly sweep in the Worker works out, for every open job, which party
// the next move belongs to -- the crew to reply, to say when they can come or
// to confirm a time; the hiring side to approve a time, to put a new one
// forward, or to put somebody on an approved request; the tenant to confirm --
// and emails them on a schedule that stops by itself the moment the move is
// made, because then the item no longer exists.
//
// Three rules worth keeping:
//
//   THE CLOCK STARTS WHEN THE WAIT DID, NOT WHEN THE JOB WAS RAISED. A crew
//   who accepted yesterday is one day into "propose a time", whatever the job's
//   age. `since` is part of the item's key, so a new proposal or a declined
//   window restarts the sequence rather than carrying the old one's count.
//
//   ONLY THE LATEST STEP IS SENT, never a backlog. A night the sweep did not
//   run must not become three emails the next night.
//
//   IT STOPS AFTER SIX. A reminder that never stops is a mailing list, and
//   people filter mailing lists -- which would take this one with it. The
//   dashboards keep the pulsing dot for as long as the item stands, and the
//   hiring side starts hearing about a crew that has not moved from day four.

// Hours from the start of the wait: day 1, 2, 4, 7, 11 and 15.
export const REMIND_AFTER_HOURS = [24, 48, 96, 168, 264, 360];
// When the hiring side is told a crew has not moved: day 4, 7, 11 and 15.
export const ESCALATE_AFTER_HOURS = [96, 168, 264, 360];

export const PARTIES = ["contractor", "manager", "tenant"];

// "2026-10-14 09:00:00" (CURRENT_TIMESTAMP, UTC) and an ISO string both parse;
// a bare date is the start of that day in UTC.
export function parseWhen(s) {
  if (!s) return NaN;
  const t = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return Date.parse(`${t}T00:00:00Z`);
  const iso = t.includes("T") ? t : t.replace(" ", "T");
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
}

// The latest of several timestamps, as the original string. Nulls ignored.
export function latestOf(...vals) {
  let best = null, bestMs = -Infinity;
  for (const v of vals) {
    const ms = parseWhen(v);
    if (Number.isFinite(ms) && ms > bestMs) { best = v; bestMs = ms; }
  }
  return best;
}

// Which step is due now and not yet sent, or null.
export function dueStep(since, nowMs, sentSteps = [], schedule = REMIND_AFTER_HOURS) {
  const start = parseWhen(since);
  if (!Number.isFinite(start)) return null;
  const hours = (nowMs - start) / 3.6e6;
  let reached = 0;
  schedule.forEach((h, i) => { if (hours >= h) reached = i + 1; });
  if (!reached) return null;
  const sent = Math.max(0, ...sentSteps.map(Number).filter(Number.isFinite));
  return reached > sent ? reached : null;
}

export const daysWaiting = (since, nowMs) =>
  Math.max(1, Math.floor((nowMs - parseWhen(since)) / 864e5));

export const itemKey = ({ reason, subject, since }) => `${reason}:${subject}:${since}`;

// One sentence per item, in the reader's terms. `who` is the company or the
// account named in the line, `win` a formatted window.
export function reminderLine(it, nowMs) {
  const t = `"${it.title}"`;
  const d = daysWaiting(it.since, nowMs);
  const ago = `${d} day${d === 1 ? "" : "s"}`;
  switch (it.reason) {
    case "reply":
      return `Accept or decline ${t} for ${it.accountName}. The offer is waiting on your answer.`;
    case "arrange":
      return `Propose a time for ${t} for ${it.accountName}. Nobody is booked to go until you do (waiting ${ago}).`;
    case "confirm":
      return it.party === "contractor"
        ? `Confirm ${it.win} for ${t} for ${it.accountName}, or propose another time.`
        : it.party === "tenant"
          ? `Confirm ${it.win} works for ${t}, or propose another time.`
          : `${it.companyName || "The crew"} proposed ${it.win} for ${t}. Approve it or propose another time.`;
    case "repropose":
      return `The proposed time for ${t} passed without being booked. Propose a new one.`;
    case "assign":
      return `${t} is approved and nobody is on it yet${it.tenantName ? ` — ${it.tenantName} is waiting` : ""}.`;
    case "chase":
      return `${it.companyName || "The crew"} has not ${it.chaseOf === "reply" ? "answered the offer for"
        : it.chaseOf === "confirm" ? "confirmed the time for" : "proposed a time for"} ${t} (${ago}).`;
    default:
      return `${t} is waiting on you.`;
  }
}
