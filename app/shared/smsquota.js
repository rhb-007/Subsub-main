// How many text messages an account may send in a month, and what happens
// past that.
//
// Scale includes 2,500 a month. Past that, texts KEEP GOING and the month is
// charged in blocks of 5,000 COUNTED FROM THE FIRST TEXT, not from the 2,500th:
// a month that ends at 7,000 is two blocks, $100, and one that ends at 12,000
// is three, $150. A month at or under 2,500 is nothing. The charge is an
// invoice of its own on the 1st, charged to the card on file -- the same day
// for every account, monthly or yearly, because "billed on the 1st" is the
// promise and a yearly plan has no monthly bill to ride on. Basic includes
// none, which is what the pricing page has always said.
//
// THE BLOCKS COUNT FROM ZERO, AND THAT IS THE OWNER'S CALL RATHER THAN AN
// ARITHMETIC SLIP. "Each extra 5,000 past 2,500" would make 7,000 one block;
// the stated price is two. So 2,501 to 5,000 is $50, 5,001 to 10,000 is $100,
// and the 2,500 are included in the sense that a month under them costs
// nothing at all. The examples are pinned in test:smsquota in those words.
//
// AN ACCOUNT CAN TURN TEXTS OFF, and that is what makes billing automatically
// fair: nobody is charged for a channel they did not want. Off means off --
// emails still go -- except an emergency call-out, which is the one text that
// goes whatever the switch says (below).
//
// Here rather than in the Worker because the route that sends a text, the
// nightly sweep that bills the overage, the billing panel and the pricing
// page's FAQ all describe these figures -- and four copies of "2,500" is how
// the screen and the bill come to disagree.
//
// THIS REPLACED A PRE-BOUGHT ADD-ON, and the reason is worth keeping. The
// first version paused texts at the cap and sold 5,000 more as a monthly line
// somebody had to buy in advance. That makes the account guess its volume and
// pay for the guess every month, and it makes running out a silent failure --
// a work order not texted on the 28th because nobody topped up.
//
// TWO PLACES THE CAP STILL PAUSES, both because there is nobody to charge or
// something has gone wrong:
//
//   * An account with no subscription to bill -- a comped Scale account, most
//     often. It gets the included 2,500 and then texts pause until the 1st,
//     with the email still going. Charging an account we gave the plan to is
//     not a decision a sweep should make.
//
//   * A runaway. SMS_OVERAGE_MAX_BLOCKS blocks in one month is a loop, not a
//     busy month, and a loop billing a customer $50 every 5,000 texts with
//     nobody watching is the worst thing this file could do. Past it texts
//     pause and the account is told why.
//
// AN EMERGENCY CALL-OUT IS SENT WHATEVER THE COUNT OR THE SWITCH. A tenant
// reporting a flood at 2am and the emergency contractor not being told because
// of a cap is the most expensive failure this file could produce. It still
// counts, so the number on the screen and the bill are true.
//
// Counted in MESSAGES, not segments. Carriers bill per 160-character segment
// and sms_log keeps that figure for the console, but a price people read in
// their own words is a price in messages -- "2,500 texts" -- and a count that
// spent three units on one long notice would be a bill nobody could predict.

export const SMS_INCLUDED_SCALE = 2500;
export const SMS_BLOCK_MESSAGES = 5000;
export const SMS_BLOCK_PRICE_CENTS = 5000;          // $50 a block of 5,000
export const SMS_OVERAGE_MAX_BLOCKS = 20;           // a runaway guard: 100,000 texts, $1,000

// Kinds that are sent past every limit. Named, not a flag at the call site:
// an "urgent" boolean anybody can pass is a cap anybody can switch off.
export const SMS_UNCAPPED_KINDS = ["emergency_dispatch"];

// The first instant of a calendar month, as the string sms_log.at compares
// against. sms_log.at is CURRENT_TIMESTAMP ("YYYY-MM-DD HH:MM:SS", UTC), and a
// bare "YYYY-MM-01" sorts below every timestamp on that day and above every one
// before it -- one format compared with itself, which is the 057 lesson kept.
export function monthStart(now = new Date()) {
  return `${now.toISOString().slice(0, 7)}-01`;
}

// The month before `now`, as "YYYY-MM", with its first day and the first day
// of the month after -- the window the nightly sweep bills.
export function previousMonth(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const month = d.toISOString().slice(0, 7);
  return { month, from: `${month}-01`, to: monthStart(now) };
}

// What the account gets included this month.
export function smsAllowance({ onScale = false } = {}) {
  return onScale ? SMS_INCLUDED_SCALE : 0;
}

// How many blocks a month's count comes to. Nothing at or under the
// allowance; past it, one block for every 5,000 sent COUNTED FROM THE FIRST,
// and any part of one: 2,501 is one, 7,000 is two, 12,000 is three.
const blocksAt = (allowance, used) =>
  allowance > 0 && used > allowance ? Math.ceil(used / SMS_BLOCK_MESSAGES) : 0;

export function smsOverageBlocks({ allowance = 0, used = 0 } = {}) {
  return Math.min(SMS_OVERAGE_MAX_BLOCKS, blocksAt(allowance, used));
}

export const smsOverageCents = (blocks) => Math.max(0, Math.round(blocks)) * SMS_BLOCK_PRICE_CENTS;

// Whether this one may go, with the figures behind the answer.
//
//   allowance  what is included this month
//   used       what has already been sent this month
//   billable   whether there is a card on a subscription to charge
//   off        the account has turned text messages off
//
// `startsBlock` is true on the text that opens a new $50 block -- the moment
// worth telling the account about, once, rather than on every text after it.
export function smsVerdict({ allowance = 0, used = 0, kind = "", billable = false, off = false } = {}) {
  const left = Math.max(0, allowance - used);
  if (SMS_UNCAPPED_KINDS.includes(kind)) return { ok: true, uncapped: true, allowance, used, left };
  if (off) return { ok: false, reason: "sms_off", allowance, used, left };
  if (allowance <= 0) return { ok: false, reason: "sms_not_on_plan", allowance, used, left };
  if (used < allowance) return { ok: true, allowance, used, left };
  if (!billable) return { ok: false, reason: "sms_quota", allowance, used, left: 0 };
  // This text is message number used + 1.
  const blocks = blocksAt(allowance, used + 1);
  if (blocks > SMS_OVERAGE_MAX_BLOCKS) {
    return { ok: false, reason: "sms_overage_ceiling", allowance, used, left: 0 };
  }
  return { ok: true, overage: true, blocks, startsBlock: blocks > blocksAt(allowance, used),
    allowance, used, left: 0 };
}

const n = (x) => Math.round(x).toLocaleString("en-US");
const usd = (cents) => `$${(Math.round(cents) / 100).toLocaleString("en-US")}`;

// One phrase for how going over is priced, read by the panel and the activity
// line, so the two cannot quote two prices.
export const SMS_OVERAGE_TERMS =
  `${usd(SMS_BLOCK_PRICE_CENTS)} for every ${n(SMS_BLOCK_MESSAGES)} texts sent in the month, `
  + `or part of ${n(SMS_BLOCK_MESSAGES)} — `
  + `${n(7000)} is ${usd(smsOverageCents(2))}, ${n(12000)} is ${usd(smsOverageCents(3))}`;

// The usage line on the billing panel, in words.
export function smsUsageText({ allowance = 0, used = 0 } = {}) {
  if (allowance <= 0) return "Text messages are part of Scale.";
  if (used <= allowance) return `${n(used)} of ${n(allowance)} text messages used this month.`;
  return `${n(used)} text messages this month — past the ${n(allowance)} included.`;
}

// What the 1st will charge for this month so far, in words.
export function smsOverageText({ allowance = 0, used = 0 } = {}) {
  const blocks = smsOverageBlocks({ allowance, used });
  if (!blocks) return "";
  return `So far this month comes to ${usd(smsOverageCents(blocks))} `
    + `(${blocks === 1 ? "one block" : `${blocks} blocks`} of ${n(SMS_BLOCK_MESSAGES)}), `
    + `charged automatically on the 1st.`;
}

// Why a text did not go, said where it shows up on a screen.
export function smsRefusalText(reason) {
  if (reason === "sms_quota") return "this month's included text messages are used up; they start again on the 1st";
  if (reason === "sms_overage_ceiling") return "this month's text messages hit the safety limit; contact SubSub";
  if (reason === "sms_not_on_plan") return "text messages are part of Scale";
  if (reason === "sms_off") return "text messages are turned off for this account";
  return "";
}
