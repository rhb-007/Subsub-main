// How many text messages an account may send in a month, and the add-on.
//
// Scale includes 2,500 a month. Each add-on is 5,000 more for $50 a month,
// billed as a line on the Scale subscription. Basic includes none, which is
// what the pricing page has always said ("SMS notifications — Scale"), and
// until this file nothing enforced it.
//
// Here rather than in the Worker because three things describe these figures
// -- the route that refuses a text, the billing panel that shows the count,
// and the pricing page's FAQ -- and three copies of "2,500" is how the
// screen and the bill come to disagree.
//
// WHAT HAPPENS AT THE CAP IS THAT THE TEXT IS NOT SENT AND THE EMAIL STILL IS.
// Every notice SubSub texts is also emailed where there is an address, so
// running out costs a channel rather than the notice. It is never a surprise
// charge: nothing is billed past the cap, the account buys an add-on or waits
// for the month to turn.
//
// EXCEPT AN EMERGENCY CALL-OUT, which is sent whatever the count says. A
// tenant reporting a flood at 2am and the emergency contractor not being told
// because of a quota is the single most expensive failure this file could
// produce. It still counts towards the month, so the number on the screen is
// true.
//
// Counted in MESSAGES, not segments. Carriers bill per 160-character segment
// and sms_log keeps that figure for the console, but a cap people read in
// their own words is a cap in messages -- "2,500 texts" -- and a quota that
// spent three units on one long notice would be a quota nobody could predict.

export const SMS_INCLUDED_SCALE = 2500;
export const SMS_ADDON_MESSAGES = 5000;
export const SMS_ADDON_PRICE_CENTS = 5000;          // $50 a month
export const SMS_ADDON_MAX_BLOCKS = 20;             // a typo guard, not a policy

// Kinds that are sent at the cap anyway. Named, not a flag at the call site:
// an "urgent" boolean anybody can pass is a cap anybody can switch off.
export const SMS_UNCAPPED_KINDS = ["emergency_dispatch"];

// The first instant of this calendar month, as the string sms_log.at compares
// against. sms_log.at is CURRENT_TIMESTAMP ("YYYY-MM-DD HH:MM:SS", UTC), and a
// bare "YYYY-MM-01" sorts below every timestamp on that day and above every one
// before it -- no datetime() needed, which is the 057 lesson kept rather than
// relearned: compare one format with itself.
export function monthStart(now = new Date()) {
  return `${now.toISOString().slice(0, 7)}-01`;
}

// What the account may send this month.
export function smsAllowance({ onScale = false, addonBlocks = 0 } = {}) {
  if (!onScale) return 0;
  const blocks = Math.max(0, Math.min(SMS_ADDON_MAX_BLOCKS, Math.floor(Number(addonBlocks) || 0)));
  return SMS_INCLUDED_SCALE + blocks * SMS_ADDON_MESSAGES;
}

// Whether this one may go, with the figures behind the answer.
export function smsVerdict({ allowance = 0, used = 0, kind = "" } = {}) {
  const left = Math.max(0, allowance - used);
  if (SMS_UNCAPPED_KINDS.includes(kind)) return { ok: true, uncapped: true, allowance, used, left };
  if (allowance <= 0) return { ok: false, reason: "sms_not_on_plan", allowance, used, left };
  if (used >= allowance) return { ok: false, reason: "sms_quota", allowance, used, left: 0 };
  return { ok: true, allowance, used, left };
}

const n = (x) => Math.round(x).toLocaleString("en-US");

// The usage line on the billing panel, in words.
export function smsUsageText({ allowance = 0, used = 0 } = {}) {
  if (allowance <= 0) return "Text messages are part of Scale.";
  return `${n(used)} of ${n(allowance)} text messages used this month.`;
}

// Why a text did not go, said where it shows up on a screen.
export function smsRefusalText(reason) {
  if (reason === "sms_quota") {
    return `this month's text messages are used up -- add ${n(SMS_ADDON_MESSAGES)} more in Account, Subscription`;
  }
  if (reason === "sms_not_on_plan") return "text messages are part of Scale";
  return "";
}
