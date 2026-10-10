// The Sub Passport: one public page a subcontractor owns and hands out.
//
// Migration 077 holds it. Everything a GC asks a sub for is already on the
// company row -- the licence and its nightly check, the certificate and its
// expiry, the W-9 flag, the service area -- so a Passport stores only what was
// missing: an address, the trades the sub says they do in public, the year
// they started, a short note and photographs of their work.
//
// Four decisions, each taken out loud before this was built:
//
//  1. THE ADDRESS IS SHAREABLE AND NOT GUESSABLE. `/p/acme-roofing-k7q2m`: the
//     name so a person can read it, a random suffix so nobody can find a
//     company by typing names, and noindex so search engines do not turn the
//     Passports into a directory of subs. SubSub is not a directory.
//
//  2. THE BADGE CLAIMS ONLY WHAT WAS CHECKED, and says so in a line under it.
//     A licence counts when the state registry SubSub reads said ACTIVE, or
//     when the state issues no contractor licence for the work this sub does.
//     A licence somebody typed that SubSub cannot check never earns it. The
//     insurance counts when a certificate is on file with an expiry date that
//     has not passed. SubSub does not ring the carrier, so the line says "on
//     file through", never "insured".
//
//  3. THE FILES ARE BEHIND AN ACCOUNT AND THE SUB'S YES. The public page says
//     a W-9 is on file and names the insurer and the expiry; the certificate
//     and the W-9 themselves open only for a signed-in account the sub has
//     approved. A W-9 can carry a sole proprietor's Social Security number.
//
//  4. REMINDERS: the certificate's existing schedule gains a 7-day reminder,
//     and the licence gets one of its own at 30, 7 and 0 days.

import { TRADE_IDS, tradeLabel } from "./trades.js";
import { normalizeState, stateName } from "./states.js";
import { capFor, NEVER_EXEMPT_TRADES } from "./handycap.js";
import { licenseActive, checkAnswered } from "./licensecheck.js";
import { LIVE_STATES } from "./licenselookup.js";

// ---- the address -------------------------------------------------------------

// The same unambiguous alphabet as referral codes, lower-cased: no 0/o, 1/i/l
// or u, so a suffix read off a flyer is typed right the first time.
export const SLUG_SUFFIX_ALPHABET = "23456789abcdefghjkmnpqrstvwxyz";
export const SLUG_SUFFIX_LENGTH = 5;
export const SLUG_BASE_MAX = 40;

export function slugBase(name) {
  const s = String(name || "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const cut = s.slice(0, SLUG_BASE_MAX).replace(/-+$/g, "");
  return cut || "sub";
}

export function slugSuffix(randomBytes) {
  let out = "";
  for (let i = 0; i < SLUG_SUFFIX_LENGTH; i++) {
    out += SLUG_SUFFIX_ALPHABET[randomBytes[i] % SLUG_SUFFIX_ALPHABET.length];
  }
  return out;
}

export const mintSlug = (name, randomBytes) => `${slugBase(name)}-${slugSuffix(randomBytes)}`;

// A slug always ends in the random part, so a bare name is never one.
export const SLUG_RE = new RegExp(
  `^[a-z0-9]+(?:-[a-z0-9]+)*-[${SLUG_SUFFIX_ALPHABET}]{${SLUG_SUFFIX_LENGTH}}$`);
export const isSlug = (s) => typeof s === "string" && s.length <= SLUG_BASE_MAX + 1 + SLUG_SUFFIX_LENGTH
  && SLUG_RE.test(s);

// /p/<slug>, read the way /claim/<token> is: a path, because it is printed on
// a decal and typed off a business card.
export function passportPathSlug(pathname) {
  const m = /^\/p\/([a-z0-9-]+)\/?$/.exec(String(pathname || ""));
  return m && isSlug(m[1]) ? m[1] : null;
}

export const PASSPORT_ORIGIN = "https://app.subsub.work";
export const passportUrl = (slug) => (isSlug(slug) ? `${PASSPORT_ORIGIN}/p/${slug}` : null);

// ---- what the sub may say ----------------------------------------------------

export const ABOUT_MAX = 600;
export const CAPTION_MAX = 140;
export const MAX_PHOTOS = 12;
export const FOUNDED_MIN = 1900;

// Returns { ok, value } or { ok:false, error }. Only the keys sent are
// checked and returned, so a save of the trades does not wipe the note.
export function validPassportEdit(b = {}, thisYear = new Date().getUTCFullYear()) {
  const out = {};
  if ("trades" in b) {
    if (!Array.isArray(b.trades)) return { ok: false, error: "invalid_trades" };
    const seen = [];
    for (const t of b.trades) {
      const id = String(t || "");
      if (!TRADE_IDS.has(id)) return { ok: false, error: "invalid_trades", trade: id };
      if (!seen.includes(id)) seen.push(id);
    }
    out.trades = seen;
  }
  if ("foundedYear" in b) {
    if (b.foundedYear === null || b.foundedYear === "") out.foundedYear = null;
    else {
      const y = Number(b.foundedYear);
      if (!Number.isInteger(y) || y < FOUNDED_MIN || y > thisYear) return { ok: false, error: "invalid_year" };
      out.foundedYear = y;
    }
  }
  if ("about" in b) {
    const a = String(b.about ?? "").trim();
    if (a.length > ABOUT_MAX) return { ok: false, error: "about_too_long", max: ABOUT_MAX };
    out.about = a || null;
  }
  return { ok: true, value: out };
}

// A stored year, never a stored "4 years": the count is worked out on read,
// so it is right next year too.
export function yearsInBusiness(foundedYear, today = new Date().toISOString().slice(0, 10)) {
  const y = Number(foundedYear);
  if (!Number.isInteger(y)) return null;
  const n = Number(String(today).slice(0, 4)) - y;
  return n >= 0 ? n : null;
}

export function yearsText(foundedYear, today) {
  const n = yearsInBusiness(foundedYear, today);
  if (n === null) return null;
  if (n === 0) return `In business since ${foundedYear}`;
  return `In business since ${foundedYear} · ${n} year${n === 1 ? "" : "s"}`;
}

// Where they work, as a sentence. The same record the roster reads.
export function areaText(coverage) {
  const c = coverage && typeof coverage === "object" ? coverage : {};
  const radii = Array.isArray(c.radii) ? c.radii : c.radius ? [c.radius] : [];
  const cities = Array.isArray(c.cities) ? c.cities : [];
  if (c.mode === "radius" || (!cities.length && radii.length)) {
    return radii.length ? radii.map((r) => `Within ${r.miles} mi of ${r.zip}`).join(" · ") : null;
  }
  return cities.length ? cities.join(", ") : null;
}

// ---- the badge -----------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// A bare date, read as one -- never through Date, which would move it a day
// for every reader west of Greenwich.
export function prettyDay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return null;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

// The registry SubSub actually reads, by name, for the line under the badge.
const REGISTRY_NAMES = { WA: "Washington L&I" };

// Does this state license contractors for this work at all? The handyman
// dataset records which states license nobody at state level. A trade that is
// state-licensed everywhere (plumbing, electrical, HVAC) is licensed there
// too, so a Texas plumber is not "no licence required".
export function noStateLicenseFor(state, trades = []) {
  const row = capFor(state);
  if (!row || row.basis !== "no_state_license") return false;
  return !trades.some((t) => NEVER_EXEMPT_TRADES.includes(t));
}

// The licence leg. Four answers, and only two earn the badge.
//   registry_active  the registry SubSub reads says ACTIVE
//   not_required     the state issues no contractor licence for this work
//   not_active       a registry answered and it is not active -- never badged,
//                    whatever state, because that is a check that failed
//   unchecked        anything SubSub cannot vouch for
export function licenseLeg({ state, licenseNumber, check, trades = [], today }) {
  const st = normalizeState(state);
  const where = st ? stateName(st) : null;
  const answered = check && checkAnswered(check);
  if (answered && check.found !== undefined && LIVE_STATES.includes(st)) {
    if (licenseActive(check, today)) {
      return { ok: true, kind: "registry_active",
        text: `${REGISTRY_NAMES[st] || where} registration active` };
    }
    return { ok: false, kind: "not_active", text: "License not active on the state register" };
  }
  if (st && noStateLicenseFor(st, trades)) {
    return { ok: true, kind: "not_required", text: `${where} issues no state contractor license` };
  }
  // A state that licenses no general contractor still licenses these trades,
  // and SubSub cannot read that register, so it says which and stops there.
  const licensedHere = capFor(st)?.basis === "no_state_license"
    ? trades.filter((t) => NEVER_EXEMPT_TRADES.includes(t)) : [];
  if (licensedHere.length) {
    return { ok: false, kind: "unchecked",
      text: `${licensedHere.map(tradeLabel).join(", ")} license not verified by SubSub` };
  }
  return { ok: false, kind: "unchecked",
    text: licenseNumber ? "License not verified by SubSub" : "No license on file" };
}

// The insurance leg: a certificate on file with a date that has not passed.
// A certificate with no date can be "on file" and cannot be "through" anything.
export function insuranceLeg({ onFile, expiresOn, today }) {
  if (!onFile) return { ok: false, kind: "missing", text: "No insurance certificate on file" };
  if (!expiresOn) return { ok: false, kind: "undated", text: "Insurance on file, no expiry date given" };
  if (String(expiresOn).slice(0, 10) < today) {
    return { ok: false, kind: "expired", text: `Insurance expired ${prettyDay(expiresOn)}` };
  }
  return { ok: true, kind: "current", text: `Insurance on file through ${prettyDay(expiresOn)}` };
}

export const BADGE_NAME = "SubSub Verified";

export function passportBadge({ state, licenseNumber, check, trades = [], insurance = {},
  today = new Date().toISOString().slice(0, 10) } = {}) {
  const license = licenseLeg({ state, licenseNumber, check, trades, today });
  const ins = insuranceLeg({ ...insurance, today });
  const verified = license.ok && ins.ok;
  return {
    verified,
    name: verified ? BADGE_NAME : null,
    // Exactly what the badge rests on, under it. Drawn whether or not it is
    // earned: a page without the badge still says what is and is not on file.
    line: [license.text, ins.text].join(" · "),
    license, insurance: ins,
  };
}

// ---- access to the files --------------------------------------------------------

// Which files an approved account may open. The bond and the agreement are not
// on the list: the request was for the certificate and the W-9.
export const ACCESS_KINDS = ["insurance", "w9"];
export const ACCESS_STATUSES = ["pending", "approved", "declined", "revoked"];
export const ACCESS_MESSAGE_MAX = 300;

// The only moves, and from where. A decided request is decided; revoking is
// the way back from a yes; a no is final for that request and a new one can be
// sent.
const MOVES = {
  approve: { from: ["pending"], to: "approved" },
  decline: { from: ["pending"], to: "declined" },
  revoke: { from: ["approved"], to: "revoked" },
};
export function accessMove(status, action) {
  const m = MOVES[action];
  if (!m) return { ok: false, error: "unknown_action" };
  if (!m.from.includes(status)) return { ok: false, error: "not_allowed", from: status };
  return { ok: true, to: m.to };
}

// ---- what the public page carries -----------------------------------------------

// Everything here is something the sub chose to publish. Not the contact's
// name, not a phone, not an email (the page has its own share buttons), not
// the clients they work for, not a document.
export function publicPassport({ passport, company, photos = [], docs = {}, refCode = null,
  today = new Date().toISOString().slice(0, 10) }) {
  const trades = (passport.trades || []).filter((t) => TRADE_IDS.has(t));
  const ins = docs.insurance || null;
  const insOnFile = !!(ins && ins.fileName) || !!company.insurance;
  const badge = passportBadge({
    state: company.state, licenseNumber: company.license, check: company.licenseCheck, trades,
    insurance: { onFile: insOnFile, expiresOn: ins?.expiresOn || null }, today,
  });
  return {
    slug: passport.slug,
    name: company.company,
    city: company.city || null,
    state: normalizeState(company.state),
    trades: trades.map((id) => ({ id, label: tradeLabel(id) })),
    area: areaText(company.coverage),
    foundedYear: passport.foundedYear ?? null,
    years: yearsText(passport.foundedYear, today),
    about: passport.about || null,
    license: company.license ? { number: company.license, text: badge.license.text, ok: badge.license.ok } : null,
    insurance: insOnFile
      ? { carrier: ins?.issuer || null, expiresOn: ins?.expiresOn || null, text: badge.insurance.text }
      : null,
    w9: !!(docs.w9 && docs.w9.fileName) || !!company.w9,
    photos: photos.map((p) => ({ id: p.id, caption: p.caption || null })),
    badge: { verified: badge.verified, name: badge.name, line: badge.line },
    refCode,
  };
}

export const PASSPORT_CTA = "Manage your whole sub network like this";
