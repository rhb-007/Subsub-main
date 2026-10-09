// 075. REFERRALS, BOTH WAYS ROUND.
//
// Every subcontractor company and every hiring account has a code and a link.
// A sub who brings in a hiring account that goes on to PAY earns $100 and a
// "Preferred Sub" badge; a hiring account that brings in another earns a month
// free for both of them. The rules live here because five places describe them
// and must agree: the Worker that records touches and writes the ledger, the
// billing webhook that decides "became paying", the screens that show a code,
// the console that approves and pays, and the tests.
//
// LAST TOUCH WINS, AND THAT IS A RULE ABOUT THE REWARD. A visitor may open a
// sub's link in March, a general contractor's in May and sign up in June; the
// June signup is credited to May. It is deliberately not 074's rule, which
// keeps the FIRST account whose work order a sub claimed -- that answers which
// customer recruited a contractor, and this answers whose referral is paid.
//
// A REWARD IS EARNED BY MONEY, NOT BY A SIGNUP. Signing up costs nothing and
// can be done twenty times from one kitchen table. A referred account's first
// PAID invoice is what creates a reward row, and a sub's cash is approved by a
// person before it is paid -- the only gate on paying somebody real money that
// nobody can talk their way round by creating accounts.

export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";   // no 0/O, 1/I/L, U
export const CODE_LENGTH = 8;
export const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);

// What somebody types off a flyer or a truck door: spaces, a dash, lower case.
// Those are tidied. A character the alphabet left out (0, O, 1, I, L, U) is
// NOT translated into a lookalike: none of them can appear in a real code, so
// "no such code" is the honest answer and a guess would credit the wrong
// person. Tidy, then validate, never translate.
export function normalizeCode(raw) {
  const c = String(raw || "").toUpperCase().replace(/[\s-]/g, "");
  return CODE_RE.test(c) ? c : null;
}

export function mintCode(randomBytes) {
  // `randomBytes` is a Uint8Array from crypto.getRandomValues. Modulo bias on
  // a 30-letter alphabet from 256 values is under 3% per character and buys
  // nothing an attacker can use: codes are looked up whole, rate-limited, and
  // a guess at one earns nothing without a paying signup behind it.
  let s = "";
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[randomBytes[i] % CODE_ALPHABET.length];
  return s;
}

export const REFERRAL_CHANNELS = ["link", "code", "claim", "passport"];
export const isChannel = (c) => REFERRAL_CHANNELS.includes(String(c || ""));

// THE HIRING SIDE. "GC" in the request means the side that pays for SubSub and
// hires contractors, which is every kind that can create a job. A general
// contractor, a property manager, a portfolio manager and a building owner all
// count; a subcontractor account does not, because it pays for nothing and is
// the other side of the loop.
export const GC_KINDS = ["general_contractor", "property_manager", "building_owner", "portfolio_manager"];
export const isGcKind = (k) => GC_KINDS.includes(String(k || ""));
export const referrerKindForAccount = (accountKind) =>
  (String(accountKind) === "subcontractor" ? "sub" : isGcKind(accountKind) ? "gc" : null);

// WHERE A LINK LANDS. Both kinds of referrer are bringing in a HIRING account,
// so both links open the hiring-side landing page; the code rides in the query
// and the page writes the cookie. SubSub's own front door, never a customer's
// branded host -- the same reason the claim link is.
export const REFERRAL_ORIGIN = "https://subsub.work";
export const referralLink = (code) => (normalizeCode(code) ? `${REFERRAL_ORIGIN}/gc?ref=${code}` : null);

// THE COOKIE THAT CARRIES A TOUCH ACROSS SUBDOMAINS. The touch happens on
// subsub.work (a link, a tool page) or app.subsub.work (a claim, a Passport),
// and the signup happens on subsub.work -- two origins, so localStorage cannot
// carry it. A first-party cookie on the parent domain can. It holds the last
// touch and nothing else; each new touch overwrites it, which IS the
// last-touch rule.
export const REF_COOKIE = "ss_ref";
export const REF_COOKIE_DAYS = 60;
export function refCookieValue({ code, channel, at }) {
  const c = normalizeCode(code);
  if (!c || !isChannel(channel)) return null;
  const secs = Math.floor((Number(at) || Date.now()) / 1000);
  return `${c}.${channel}.${secs}`;
}
export function parseRefCookie(v) {
  const m = /^([A-Z0-9]{8})\.(link|code|claim|passport)\.(\d{9,11})$/.exec(String(v || ""));
  if (!m || !normalizeCode(m[1])) return null;
  return { code: m[1], channel: m[2], at: new Date(Number(m[3]) * 1000).toISOString() };
}

// The latest of several touches. A typed code at signup is a touch made NOW,
// so it beats anything the cookie carried, which is exactly last-touch.
export function lastTouch(touches) {
  const ok = (touches || []).filter((t) => t && normalizeCode(t.code) && isChannel(t.channel));
  if (!ok.length) return null;
  return ok.slice().sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")))[0];
}

// ---- the money --------------------------------------------------------------

export const SUB_CASH_CENTS = 10000;          // $100
// A month of Scale, in cents: $99 monthly, $990 a year (so $82.50 a month).
// Kept beside the reward that spends it, and asserted against billing's own
// figures in the test, because a credit worth more than the month it is meant
// to cover is money given away.
export const SCALE_MONTH_CENTS = { monthly: 9900, annual: 8250 };
export const monthCreditCents = (billing) =>
  (billing === "annual" ? SCALE_MONTH_CENTS.annual : SCALE_MONTH_CENTS.monthly);

// What a referred account's first paid invoice earns, and for whom.
//
// Only a HIRING account earns anything: a subcontractor account never pays, so
// "became paying" can never happen to one. A sub's code earns the sub $100. A
// hiring account's code earns both sides a month free, each at their OWN
// billing cycle's month.
export function rewardsFor({ codeKind, referredKind, referredBilling, referrerBilling }) {
  if (!isGcKind(referredKind)) return [];
  if (codeKind === "sub") {
    return [{ kind: "sub_cash", beneficiary: "referrer", amountCents: SUB_CASH_CENTS }];
  }
  if (codeKind === "gc") {
    return [
      { kind: "gc_credit", beneficiary: "referred", amountCents: monthCreditCents(referredBilling) },
      { kind: "gc_credit", beneficiary: "referrer", amountCents: monthCreditCents(referrerBilling) },
    ];
  }
  return [];
}

// ---- the ledger's moves -----------------------------------------------------
//
// sub_cash:  pending -> approved -> paid, by a person in the console.
// gc_credit: pending -> applied, by the billing code once Stripe has taken it.
// Either:    -> void, with a reason, from any state that has not moved money.
//
// A paid reward and an applied credit are never voided here: money has gone,
// and undoing that is a refund or a debit, not a status. Saying so is the
// refusal rather than quietly marking a paid row void.
export const REWARD_STATUSES = ["pending", "approved", "paid", "applied", "void"];
const MOVES = {
  sub_cash: { approve: { pending: "approved" }, pay: { approved: "paid" }, void: { pending: "void", approved: "void" } },
  gc_credit: { apply: { pending: "applied" }, void: { pending: "void" } },
};
export function rewardMove(reward, action) {
  const to = MOVES[reward?.kind]?.[action]?.[reward?.status];
  if (to) return { ok: true, to };
  if (!MOVES[reward?.kind]?.[action]) return { ok: false, error: "not_for_this_kind" };
  if (reward.status === "paid" || reward.status === "applied") return { ok: false, error: "money_has_moved" };
  return { ok: false, error: "wrong_status" };
}

// THE BADGE IS THE REWARD, NOT A SECOND RECORD OF IT. A sub is a Preferred Sub
// while they hold a cash reward that has not been voided -- earned the moment
// the account they brought in paid, and withdrawn if a person voids it as a
// self-referral. A flag beside the ledger would be two records of one fact,
// and the one nobody updated would be the badge.
export const PREFERRED_SUB = "Preferred Sub";
export const isPreferredSub = (rewards) =>
  (rewards || []).some((r) => r.kind === "sub_cash" && r.status !== "void");

// ---- inviting somebody -------------------------------------------------------

export const INVITE_DAILY_LIMIT = 25;
export const INVITE_REPEAT_DAYS = 30;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const validInviteEmail = (e) => EMAIL_RE.test(String(e || "").trim());

// The pre-written invitation. Written in the sub's voice, because it goes from
// their phone or under their name, and a GC reads a message from somebody they
// already work with very differently from one from a software company.
export function inviteText({ fromName, company, link }) {
  const who = company ? `${fromName ? fromName + " at " : ""}${company}` : (fromName || "A sub you work with");
  return `Hi, it's ${who}. I keep my insurance, W-9 and license on SubSub so you always have the current copy, `
    + `and you can run your subs and schedule jobs there too. Free to try: ${link}`;
}
export function inviteEmail({ fromName, company, link }) {
  const who = company || fromName || "A subcontractor you work with";
  return {
    subject: `${who} invited you to SubSub`,
    text: [
      "Hi,",
      "",
      `${who} keeps their compliance documents on SubSub -- certificate of insurance, W-9 and license -- so the copy you have is always the current one, with the expiry date live rather than in a PDF.`,
      "",
      "SubSub also runs the subcontractors you already have: their documents, their availability, scheduling and work orders, in one place.",
      "",
      `Have a look: ${link}`,
      "",
      `You're getting this because ${who} entered your address. SubSub won't email you again unless you sign up.`,
    ].join("\n"),
  };
}

// The SMS deep link. iOS reads `sms:NUMBER&body=`, Android `sms:NUMBER?body=`;
// `?&body=` is the spelling both accept. The message goes from the sub's own
// phone, which is the point: SubSub does not text strangers on anybody's
// behalf, and a text from somebody you know is the one that gets read.
export function smsHref(phone, body) {
  const n = String(phone || "").replace(/[^\d+]/g, "");
  return `sms:${n}?&body=${encodeURIComponent(body)}`;
}

// ---- the console's metric -----------------------------------------------------

// Monday of the week a date falls in, UTC, as YYYY-MM-DD.
export function weekStart(iso) {
  const d = new Date(String(iso).slice(0, 10) + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return null;
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

// "City, ST" from what the account's company row holds. Not a metropolitan
// statistical area -- nothing here maps towns to metros -- and it says Unknown
// rather than guess for the kinds with no company row (a property manager types
// a city at signup and nothing keeps it; CLAUDE.md records that as open).
export function metroOf({ city, state } = {}) {
  const c = String(city || "").trim(), s = String(state || "").trim().toUpperCase();
  if (!c && !s) return "Unknown";
  return c && s ? `${c.replace(/\b\w/g, (x) => x.toUpperCase())}, ${s}` : (c || s);
}

// NEW HIRING ACCOUNTS PER EXISTING ONE, BY WEEK AND BY METRO.
//
// `accounts` is every account with {id, kind, createdAt, city, state};
// `attributions` maps an account id to the KIND of the code it came in on
// ('sub' | 'gc'). For each week: how many hiring accounts existed when it
// began, how many were new in it, how many of those a hiring account referred
// and how many a sub did, and new-per-existing. The ratio is the request's
// metric; the referred counts are what says whether the referral loop is the
// thing moving it.
export function acquisitionByWeek({ accounts = [], attributions = {}, weeks = 12, today = new Date().toISOString().slice(0, 10) }) {
  const gcs = accounts.filter((a) => isGcKind(a.kind) && a.createdAt)
    .map((a) => ({ ...a, day: String(a.createdAt).slice(0, 10), metro: metroOf(a) }));
  const last = weekStart(today);
  const list = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(last + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - 7 * i);
    list.push(d.toISOString().slice(0, 10));
  }
  const nextWeek = (w) => { const d = new Date(w + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 7); return d.toISOString().slice(0, 10); };
  const ratio = (n, of) => (of > 0 ? Math.round((n / of) * 100) / 100 : null);
  const row = (week, pool) => {
    const end = nextWeek(week);
    const existing = pool.filter((a) => a.day < week).length;
    const fresh = pool.filter((a) => a.day >= week && a.day < end);
    const byGc = fresh.filter((a) => attributions[a.id] === "gc").length;
    const bySub = fresh.filter((a) => attributions[a.id] === "sub").length;
    return { week, existing, newGc: fresh.length, referredByGc: byGc, referredBySub: bySub,
      perExisting: ratio(fresh.length, existing), referredPerExisting: ratio(byGc, existing) };
  };
  const overall = list.map((w) => row(w, gcs));
  const metros = [...new Set(gcs.map((a) => a.metro))].sort((a, b) =>
    (a === "Unknown") - (b === "Unknown") || a.localeCompare(b));
  const byMetro = metros.map((m) => {
    const pool = gcs.filter((a) => a.metro === m);
    const rows = list.map((w) => row(w, pool));
    return { metro: m, total: pool.length, rows,
      newInRange: rows.reduce((s, r) => s + r.newGc, 0) };
  }).filter((m) => m.newInRange > 0 || m.total > 0)
    .sort((a, b) => b.newInRange - a.newInRange || b.total - a.total);
  return { weeks: list, overall, byMetro };
}
