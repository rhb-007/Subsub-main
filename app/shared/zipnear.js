// EVERY ZIP WITHIN A DISTANCE OF A PLACE, for filling a market in.
//
// A market lists the ZIPs it covers, and typing forty of them off a map is the
// whole cost of setting one up. So a market can be filled from a center (a
// town and its state, or a ZIP) and a radius: every ZIP whose center is within
// that many miles.
//
// THE CENTER OF A ZIP IS THE CENTER OF ITS CENSUS AREA (a ZCTA), not of every
// address in it, so a ZIP whose area straddles the line is in or out by where
// its middle falls. That is the honest limit of a radius, and the screen says
// these are added to a list somebody can still edit, never a fence.
//
// Cross-state on purpose: a Portland market at 25 miles reaches Vancouver, WA,
// and that is where the work is.
// The pure half: what was typed, the radius, merging into a list. The distance
// half, which reads the 650 KB ZIP table, is shared/zipgeo.js, so the browser
// bundle never carries the table.
export const RADIUS_CHOICES = [5, 10, 15, 25, 50];
export const MAX_RADIUS_MILES = 100;

// What somebody typed as the center: a five-digit ZIP, or "Town, ST".
export function parseCenter(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return { ok: false, error: "center_required" };
  if (/^\d{5}$/.test(s)) return { ok: true, zip: s };
  if (/^\d+$/.test(s)) return { ok: false, error: "bad_zip" };
  const m = s.match(/^(.*?),\s*([A-Za-z]{2})$/);
  if (!m || !m[1].trim()) return { ok: false, error: "city_needs_state" };
  return { ok: true, city: m[1].trim().replace(/\s+/g, " "), state: m[2].toUpperCase() };
}

export function validRadius(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= MAX_RADIUS_MILES ? n : null;
}

// Added into what the market already lists: nothing listed is dropped, a ZIP
// listed twice is listed once, and past the cap the nearest are kept and the
// rest are counted rather than silently lost.
export function mergeZips(existing = [], found = [], cap = Infinity) {
  const have = [...new Set(existing.map((z) => String(z).trim()).filter(Boolean))];
  const seen = new Set(have);
  const fresh = found.map((f) => f.zip ?? f).filter((z) => !seen.has(z));
  const room = Math.max(0, cap - have.length);
  const added = fresh.slice(0, room);
  return { zips: [...have, ...added], added: added.length, already: found.length - fresh.length, left: fresh.length - added.length };
}

export function zipNearErrText(e) {
  const code = e?.body?.error || e?.error;
  if (code === "center_required") return "Type a town and state, like \"Tacoma, WA\", or a ZIP code.";
  if (code === "city_needs_state") return "Add the state after the town, like \"Tacoma, WA\".";
  if (code === "bad_zip") return "A ZIP code is five digits.";
  if (code === "bad_radius") return `Pick a distance from 1 to ${MAX_RADIUS_MILES} miles.`;
  if (code === "zip_not_found") return "That ZIP isn't one the Census has an area for. Try a nearby one, or the town.";
  if (code === "place_not_found") return "Couldn't find that town in that state. Check the spelling, or use a ZIP there.";
  if (code === "rate_limited") return "That's a lot of lookups. Try again in a few minutes.";
  if (code === "office_only") return "Only an admin or project manager can change markets.";
  return "Couldn't look those ZIPs up just now. Try again, or type them in.";
}
