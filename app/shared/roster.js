// Engagement lifecycle -- who is on this account's roster, and what it means
// when they are not.
//
// `engagements.status` has had four values since the schema was written and
// until now nothing ever WROTE one of them. Eleven places read `!= 'ended'`,
// nothing could produce it, and there was no way at all to remove somebody
// from a roster. This module is the one rule.
//
// THE TWO QUESTIONS ARE NOT THE SAME, and keeping them apart is the whole
// reason this is a module rather than a string comparison:
//
//   "Is there a relationship at all?"  -- `status != 'ended'`, which is what
//   the invite route, the company-document write check and issuing an
//   agreement each ask. A PAUSED contractor answers YES to that: they are
//   still your contractor, you are still their client, their certificate is
//   still yours to read. Those checks are deliberately left alone.
//
//   "Are they available to be given work?" -- `onRoster`, which is what this
//   module answers, and which paused answers NO to. That is the only thing
//   pausing means, and it is why a screen may offer it: a control whose state
//   nothing reads is a control that lies.
export const ENGAGEMENT_STATES = ["invited", "active", "paused", "ended"];

// Off the pickable roster. `invited` is NOT here: a contractor the account
// typed in and has not heard back from is the commonest row on any roster and
// is assigned work every day.
export const OFF_ROSTER = ["paused", "ended"];

// A DENY LIST, NOT AN ALLOW LIST, and that is the whole of why this is one
// line rather than the obvious `["invited","active"].includes(status)`. Every
// engagement written before this existed carries `invited` or `active`, and a
// row whose status did not come back -- an older shape, a projection that left
// the column out, a seeded fixture -- must not silently vanish off somebody's
// roster. Unknown means on.
export const onRoster = (status) => !OFF_ROSTER.includes(String(status ?? ""));

// One record, so a SQL guard and the browser's filter cannot disagree about
// which states are off.
export const onRosterSql = (col = "status") =>
  `${col} NOT IN (${OFF_ROSTER.map((s) => `'${s}'`).join(", ")})`;

// `ended` is final and `paused` is not, which is the only difference between
// them -- so the words have to carry it, because the effect does not.
export function offRosterText(status) {
  if (status === "ended") return "Removed from your roster";
  if (status === "paused") return "Paused — not offered work";
  return "";
}

// What pressing it will actually do, said before anybody presses. Live work is
// named and never blocks: a job going nowhere is very often WHY somebody is
// being removed, and refusing until it is finished hands the party you are
// leaving a hostage. Same call the building handover makes, for the same
// reason.
export function endConsequence({ status = "ended", word = "contractor", liveWork = [],
  seats = 0, isEmergency = false, invites = 0 } = {}) {
  const bits = [];
  bits.push(status === "paused"
    ? `They stay on your roster, keep their paperwork and keep their login, and they stop being offered work. Nothing already booked changes, and un-pausing puts them straight back.`
    : `They come off your roster. Their jobs, work orders, payments and document history stay exactly as they are — that record is what answers "were they insured on the day of that job".`);
  if (status !== "paused") {
    bits.push(`Their own company record and their certificates are theirs and are not touched.`);
  }
  // Only ending takes a login away, so only ending says so.
  if (seats > 0 && status !== "paused") {
    bits.push(seats === 1
      ? `The one person who can sign in to your account as this ${word} loses that access.`
      : `The ${seats} people who can sign in to your account as this ${word} lose that access.`);
  }
  // THE TWO THINGS THAT GO ON POINTING AT SOMEBODY AFTER THEY ARE OFF THE
  // ROSTER, both said here because both are invisible from the card. The
  // nomination refuses at dispatch, which is the moment a tenant is reporting
  // a flood; the invite is a live way back on to a roster they were taken off.
  if (isEmergency) {
    bits.push(status === "paused"
      ? `They are your emergency contractor, so automatic dispatch turns off — an urgent report will wait for somebody to assign it.`
      : `They are your emergency contractor. That comes off with them, so automatic dispatch is off until you name somebody else.`);
  }
  if (invites > 0 && status !== "paused") {
    bits.push(invites === 1
      ? `The invite still out to them stops working, so it cannot be used to join your account.`
      : `The ${invites} invites still out to them stop working, so they cannot be used to join your account.`);
  }
  if (liveWork.length) {
    bits.push(liveWork.length === 1
      ? `They are still booked on 1 job — that work order stays open, so somebody is still due on site. Cancel it first if that is not what you want.`
      : `They are still booked on ${liveWork.length} jobs — those work orders stay open, so somebody is still due on site. Cancel them first if that is not what you want.`);
  }
  if (status !== "paused") bits.push(`You can add them back at any time.`);
  return bits.join(" ");
}
