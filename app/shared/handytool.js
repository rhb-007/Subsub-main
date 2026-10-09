// THE PUBLIC HANDYMAN-LIMIT CALCULATOR'S ANSWER, at subsub.work/handyman-limits.
//
// The figures and the sentences are handycap.js's, unchanged -- one dataset,
// one set of words, so the calculator and the app cannot disagree about what
// a state allows. What differs is the QUESTION, and that is why this is its
// own function rather than a reading of `level`:
//
//   In the app, a handyman is already engaged and the question is whether
//   THIS work order is over the line. There the colour deliberately follows
//   the money and an excluded trade is said quietly, because a warning on
//   every tap washer teaches people to stop reading warnings.
//
//   Here, a stranger asks "can a handyman legally do this job?" -- yes or no.
//   An answer of "within the limit" over electrical work would be a public
//   page telling somebody an unlicensed electrician is fine. So an excluded
//   trade is a NO whatever the amount, which is the dataset's own first
//   global rule, said first.
//
// Three tones, because the honest answer is not always yes or no: a state with
// no state licence at all hands the question to the city, and an annual limit
// counts somebody's whole year, which one job cannot answer.

import { handymanCapCheck, handymanCapText, HANDYCAP_AS_OF, HANDYCAP_DISCLAIMER,
  HANDYMAN_GLOBAL_RULES, capFor } from "./handycap.js";

export { HANDYCAP_AS_OF, HANDYCAP_DISCLAIMER, HANDYMAN_GLOBAL_RULES, capFor };

export function handyVerdict({ state, jobValue, jobType } = {}) {
  const trades = jobType && jobType !== "general" ? [jobType] : [];
  const chk = handymanCapCheck({ engagedAs: "handyman", state, trades, jobDollars: Number(jobValue) || 0 });
  if (!chk) return null;
  const text = handymanCapText(chk);
  if (chk.reason === "unknown_state") return { tone: "maybe", answer: "Pick a state", ...text, chk };
  if (chk.excluded.length) {
    const t = handymanCapText({ ...chk, reason: "trade_not_exempt" });
    return { tone: "no", answer: "No — this trade needs its own license", head: t.head, why: t.why, note: text.note, chk };
  }
  const answer = {
    under_cap: chk.basis === "annual"
      ? ["maybe", "Probably — but it is a yearly limit"]
      : ["yes", "Yes — under the state's handyman limit"],
    over_per_job: ["no", "No — over the state's handyman limit"],
    over_annual: ["no", "No — over the state's yearly handyman limit"],
    no_exemption: ["no", "No — this state has no handyman exemption"],
    no_state_license: ["maybe", "No state license needed — check your city and county"],
    cap_known: ["maybe", "Enter the job value to compare"],
    cap_unmeasured: ["maybe", "Enter the job value to compare"],
  }[chk.reason] || ["maybe", ""];
  return { tone: answer[0], answer: answer[1], ...text, chk };
}

export const asOfLabel = (iso = HANDYCAP_AS_OF) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
