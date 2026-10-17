// A sub's BBB rating on their Passport.
//
// The sub links THEIR OWN BBB profile; SubSub never searches the BBB by a
// company's name. Name matching is fuzzy, and a grade drawn under the wrong
// company's name is the worst thing this line could say. So the profile
// address is a whole value the sub pastes, and the two ids the BBB API is
// asked about are read off it.
//
// It is reputation, not cover: it is not in the compliance pack, it is not
// part of SubSub Verified, and it gates nothing (assignment, payment).
//
// Read through the official BBB API (developer.bbb.org), which needs an
// approved registration. BBB's own terms say a downloaded rating is refreshed
// at least every 30 days, so a reading older than that is not drawn at all:
// an old grade shown as current is the stale-certificate failure in a new
// place. Until the API is switched on, a linked profile is kept and nothing
// is drawn on the public page.

export const BBB_STALE_DAYS = 30;

// BBB letter grades, plus NR (no rating) which BBB itself publishes.
export const BBB_GRADES = ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-", "F", "NR"];

// A BBB business profile address, e.g.
//   https://www.bbb.org/us/wa/tacoma/profile/roofing-contractors/orcas-roofing-1296-1000123456
// The last path segment ends in "<BBB id>-<business id>": the local bureau's
// number and the business's own. Whole URL on bbb.org only, never a search
// page, never a bare name.
export function parseBbbProfileUrl(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return { ok: false, error: "empty" };
  // Parsed by hand: shared modules get no environment globals, URL included.
  const m0 = /^(?:https?:\/\/)?([^/?#\s]+)(\/[^?#\s]*)?(?:[?#]\S*)?$/i.exec(s);
  if (!m0) return { ok: false, error: "not_a_bbb_profile" };
  const host = m0[1].toLowerCase();
  if (host !== "bbb.org" && host !== "www.bbb.org") return { ok: false, error: "not_a_bbb_profile" };
  const parts = (m0[2] || "").split("/").filter(Boolean);
  const at = parts.indexOf("profile");
  if (at < 0 || at === parts.length - 1) return { ok: false, error: "not_a_bbb_profile" };
  const last = parts[parts.length - 1];
  const m = /-(\d{3,5})-(\d{4,12})$/.exec(last);
  if (!m) return { ok: false, error: "not_a_bbb_profile" };
  const url = `https://www.bbb.org/${parts.join("/")}`;
  return { ok: true, url, bbbId: m[1], businessId: m[2] };
}

export function normalizeGrade(g) {
  const s = String(g ?? "").trim().toUpperCase().replace(/\s+/g, "");
  return BBB_GRADES.includes(s) ? s : null;
}

function daysBetween(fromIso, toIso) {
  const a = Date.parse(String(fromIso).slice(0, 10) + "T12:00:00Z");
  const b = Date.parse(String(toIso).slice(0, 10) + "T12:00:00Z");
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
  return Math.round((b - a) / 86400000);
}

// What the public page draws, or null. Only a real grade, read within the
// last BBB_STALE_DAYS, and only while the API is switched on.
export function bbbPublic(row, { live, today = new Date().toISOString().slice(0, 10) } = {}) {
  if (!live || !row || !row.profile_url) return null;
  const grade = normalizeGrade(row.rating);
  if (!grade || !row.checked_at) return null;
  if (daysBetween(row.checked_at, today) > BBB_STALE_DAYS) return null;
  return {
    url: row.profile_url,
    rating: grade,
    accredited: !!row.accredited,
    checkedOn: String(row.checked_at).slice(0, 10),
  };
}

// The sub's own view: what they linked, what was read, and why nothing shows
// when nothing does -- a blank there reads as a feature that is broken.
export function bbbOwnView(row, { live, today = new Date().toISOString().slice(0, 10) } = {}) {
  if (!row || !row.profile_url) return { linked: false, live: !!live };
  const shown = bbbPublic(row, { live, today });
  let why = null;
  if (!shown) {
    if (!live) why = "not_live";
    else if (!row.checked_at) why = row.last_failed_at ? "check_failed" : "not_checked";
    else if (!normalizeGrade(row.rating)) why = "no_grade";
    else why = "stale";
  }
  return {
    linked: true, live: !!live, url: row.profile_url,
    rating: normalizeGrade(row.rating), accredited: !!row.accredited,
    checkedOn: row.checked_at ? String(row.checked_at).slice(0, 10) : null,
    shown: !!shown, why,
  };
}

// Reads the API's answer. The field names are the BBB API's documented
// organization fields as far as anybody here could read them (BBBRating,
// IsBBBAccredited); several spellings are accepted, and an answer that names
// neither a grade nor accreditation is no answer -- it draws nothing rather
// than a wrong grade. The first live call is the real test.
export function readBbbAnswer(body, want = {}) {
  const list = Array.isArray(body) ? body
    : Array.isArray(body?.searchResults) ? body.searchResults
    : Array.isArray(body?.SearchResults) ? body.SearchResults
    : Array.isArray(body?.results) ? body.results
    : body && typeof body === "object" ? [body] : [];
  // A search can answer more than one business. Take the one whose
  // businessId is the one asked about, never simply the first: a grade drawn
  // under the wrong company's name is the worst thing this card could say.
  // A result carrying no businessId at all is taken only when it is alone.
  const idOf = (o) => o && (o.businessId ?? o.BusinessId);
  const wantId = want.businessId != null ? String(want.businessId).replace(/^0+/, "") : null;
  const orgs = list.filter((o) => o && typeof o === "object");
  const org = wantId == null ? orgs[0]
    : orgs.find((o) => idOf(o) != null && String(idOf(o)).replace(/^0+/, "") === wantId)
      || (orgs.length === 1 && idOf(orgs[0]) == null ? orgs[0] : null);
  if (!org) return { ok: false, error: "not_found" };
  const rating = normalizeGrade(org.bbbRating ?? org.BBBRating ?? org.Rating ?? org.rating);
  const accRaw = org.isBBBAccredited ?? org.IsBBBAccredited ?? org.IsAccredited ?? org.accredited;
  const accredited = accRaw === true || accRaw === "true" || accRaw === 1 || accRaw === "1";
  if (!rating && accRaw === undefined) return { ok: false, error: "unreadable" };
  return { ok: true, rating, accredited };
}
