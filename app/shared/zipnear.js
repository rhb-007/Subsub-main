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

// A town as a market lists it, and the key two towns are compared on.
export const townText = (t) => `${t.city}, ${t.state}`;
export const townKey = (t) => `${String(t.city ?? "").trim().replace(/\s+/g, " ").toLowerCase()}|${String(t.state ?? "").trim().toUpperCase()}`;
const parseTownLine = (s) => {
  const m = String(s ?? "").trim().match(/^(.*?),\s*([A-Za-z]{2})$/);
  return m ? { city: m[1].trim(), state: m[2].toUpperCase() } : null;
};
export const splitZips = (raw) => String(raw ?? "").split(/[\s,;]+/).map((z) => z.trim()).filter(Boolean);
export const splitTowns = (raw) => String(raw ?? "").split(/\n|;/).map((x) => x.trim()).filter(Boolean);

// What every OTHER market already has: the ZIPs, the towns, and which market
// each belongs to, so a new one can leave them out and say whose they are.
export function takenBy(markets = [], exceptId = null) {
  const zips = new Map(), towns = new Map();
  for (const m of markets || []) {
    if (!m || (exceptId && m.id === exceptId)) continue;
    for (const z of m.zips || []) if (!zips.has(z)) zips.set(z, m.name);
    for (const t of m.cities || []) { const k = townKey(t); if (!towns.has(k)) towns.set(k, m.name); }
  }
  return { zips, towns };
}

// ZIPs found near a place, each carrying its town, added INTO what the form
// lists. With skipTaken (the default) a ZIP or town another market already
// has is left out and counted. The towns added are the towns of the ZIPs that
// were actually added -- never a town only a skipped ZIP is in.
export function fillZipsAndTowns({ zips = "", cities = "" } = {}, found = [], { taken = null, skipTaken = true, cap = Infinity } = {}) {
  const t = taken || { zips: new Map(), towns: new Map() };
  const skipped = skipTaken ? found.filter((f) => t.zips.has(f.zip ?? f)) : [];
  const use = skipTaken ? found.filter((f) => !t.zips.has(f.zip ?? f)) : found;
  const m = mergeZips(splitZips(zips), use, cap);
  const addedSet = new Set(m.zips.slice(m.zips.length - m.added));
  const lines = splitTowns(cities);
  const have = new Set(lines.map((l) => townKey(parseTownLine(l) || { city: l, state: "" })));
  const townsAdded = [], townsSkipped = [];
  for (const f of use) {
    if (!addedSet.has(f.zip) || !f.city || !f.state) continue;
    const k = townKey(f);
    if (have.has(k)) continue;
    have.add(k);
    if (skipTaken && t.towns.has(k)) { townsSkipped.push(townText(f)); continue; }
    townsAdded.push(townText(f));
  }
  return { zips: m.zips.join(", "), cities: [...lines, ...townsAdded].join("\n"), added: m.added, already: m.already,
    left: m.left, skipped: skipped.length, skippedIn: [...new Set(skipped.map((f) => t.zips.get(f.zip ?? f)))],
    townsAdded, townsSkipped };
}

// Towns for typed ZIPs: the towns of {zip, city, state} rows not yet listed,
// leaving out (with skipTaken) the ones another market has.
export function townsForTyped(cities = "", rows = [], { taken = null, skipTaken = true } = {}) {
  const lines = splitTowns(cities);
  const have = new Set(lines.map((l) => townKey(parseTownLine(l) || { city: l, state: "" })));
  const add = [], skipped = [];
  for (const r of rows) {
    if (!r?.city || !r?.state) continue;
    const k = townKey(r);
    if (have.has(k)) continue;
    have.add(k);
    if (skipTaken && taken?.towns.has(k)) { skipped.push(townText(r)); continue; }
    add.push(townText(r));
  }
  return { cities: [...lines, ...add].join("\n"), added: add, skipped };
}

// For Where you work, whose cities are names only: the towns of the ZIPs
// found, in the order found, not already listed (case ignored).
export function citiesFromFound(cities = [], found = [], { state = "" } = {}) {
  const have = new Set(cities.map((c) => c.toLowerCase()));
  const added = [];
  for (const f of found) {
    if (!f.city) continue;
    // A town in another state is named with it, so "Vancouver" in Washington
    // is not read as one in Oregon by a reader of the list.
    const name = state && f.state && f.state !== state ? `${f.city}, ${f.state}` : f.city;
    if (have.has(name.toLowerCase())) continue;
    have.add(name.toLowerCase());
    added.push(name);
  }
  return { cities: [...cities, ...added], added };
}
