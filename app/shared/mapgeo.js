// WHERE A JOB OR A BUILDING IS, ON A MAP.
//
// Two maps, one per side of the product. A general contractor works job to
// job and keeps no buildings, so theirs is the Jobs map: where current work
// is and who is on it. A property manager, a portfolio manager and a
// building owner keep buildings, so theirs is the Properties map: the
// portfolio, its tenants and its open work. Neither is a map of anybody
// else's anything -- every pin is a row the caller can already list, and
// the route that places them is scoped exactly as those lists are.
//
// This module is the rules both the Worker and the browser read: which
// account kinds get which map, how an address becomes the one line a
// geocoder is asked about, how that line is keyed in the cache, and how a
// geocoder's answer becomes a point. Nothing here talks to the network.

import { normalizeState } from "./states.js";

// Which map an account kind gets. Named rather than derived: a general
// contractor with a building typed in still runs jobs, not a portfolio.
export const JOBS_MAP_KINDS = ["general_contractor"];
export const BUILDINGS_MAP_KINDS = ["property_manager", "portfolio_manager", "building_owner"];
export const jobsMapFor = (kind) => JOBS_MAP_KINDS.includes(kind);
export const buildingsMapFor = (kind) => BUILDINGS_MAP_KINDS.includes(kind);

// How many addresses one call may geocode. The rest come back as pending
// and the browser asks again, so a portfolio of three hundred buildings fills
// in over a minute rather than one request running for five.
export const GEOCODE_BATCH = 15;
export const GEOCODE_CONCURRENCY = 4;
// A failed lookup is cached too, or every open of the map asks again about
// the address nobody can place. It is retried after this long, because the
// address may since have been corrected -- a correction changes the line,
// and so the key, and is looked up at once anyway.
export const GEOCODE_RETRY_DAYS = 30;

// How sure a point is. An address match is the building; a ZIP or a town is
// somewhere near it, and the map draws those hollow and says so, because a
// pin dropped confidently in the middle of a ZIP reads as the address.
export const PRECISION = {
  address: { label: "Address", exact: true },
  zip: { label: "Placed by ZIP code", exact: false },
  city: { label: "Placed by town", exact: false },
};

const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim();

// The one line a geocoder is asked about. Street, town, state, ZIP -- in
// that order, the parts that exist. A street typed as a whole address
// ("123 Main St, Tacoma WA") is kept whole and only the ZIP is added if it is
// not already in it. Nothing that is not an address goes in: no building
// name, no tenant, no account. That line is the whole of what leaves.
export function addressLine({ address = "", city = "", state = "", zip = "" } = {}) {
  const street = clean(address);
  const town = clean(city);
  const st = normalizeState(state) || clean(state).toUpperCase().slice(0, 2);
  const z = clean(zip).slice(0, 5);
  const zipOk = /^\d{5}$/.test(z);
  if (!street && !town && !zipOk) return "";
  if (street.includes(",")) {
    return zipOk && !street.includes(z) ? `${street} ${z}` : street;
  }
  const tail = [town, [st, zipOk ? z : ""].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [street, tail].filter(Boolean).join(", ");
}

// The cache key: the line, case and spacing folded, so "123 Main St" and
// "123  main st" are one lookup.
export const addressKey = (line) => clean(line).toLowerCase();

// What a job's address is. A job at a building is at that building, and the
// building's columns are the fuller record (a job carries no state at all);
// otherwise the job's own street, its town label and its ZIP.
export function jobAddress(job, property) {
  if (property) {
    const line = addressLine(property);
    if (line) return { line, city: clean(property.city), state: clean(property.state), zip: clean(property.zip).slice(0, 5) };
  }
  return {
    line: addressLine({ address: job.address, city: job.area, zip: job.zip }),
    city: clean(job.area), state: "", zip: clean(job.zip).slice(0, 5),
  };
}

// The Census Bureau's answer, as a point. Its coordinates are x = longitude
// and y = latitude, which is the mistake this exists to make once. A match
// in a different state from the one the address names is refused: a pin in
// Louisiana for a building in Washington is read and believed.
export function censusPoint(json, state = "") {
  const matches = json?.result?.addressMatches;
  if (!Array.isArray(matches) || !matches.length) return null;
  const want = normalizeState(state);
  for (const m of matches) {
    const lng = Number(m?.coordinates?.x), lat = Number(m?.coordinates?.y);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const got = normalizeState(m?.addressComponents?.state);
    if (want && got && got !== want) continue;
    return { lat, lng, precision: "address" };
  }
  return null;
}

// Whether a cached failure is old enough to ask about again.
export function retryDue(checkedAt, now = Date.now()) {
  const t = Date.parse(String(checkedAt || "").replace(" ", "T") + (String(checkedAt || "").includes("Z") ? "" : "Z"));
  if (!Number.isFinite(t)) return true;
  return now - t > GEOCODE_RETRY_DAYS * 86_400_000;
}

// Several things at one point -- three jobs at one building, two buildings
// on one corner lot -- are one pin carrying all of them. Drawn as separate
// pins they sit exactly on top of each other and only the last is ever
// reachable. Rounded to about a metre.
export function groupPins(items) {
  const at = new Map();
  for (const it of items) {
    if (!it || !Number.isFinite(it.lat) || !Number.isFinite(it.lng)) continue;
    const k = `${it.lat.toFixed(5)},${it.lng.toFixed(5)}`;
    if (!at.has(k)) at.set(k, { key: k, lat: it.lat, lng: it.lng, exact: true, items: [] });
    const g = at.get(k);
    g.items.push(it);
    if (PRECISION[it.precision] && !PRECISION[it.precision].exact) g.exact = false;
  }
  return [...at.values()];
}

// The box every pin fits in, or null with none -- the map then opens on the
// whole country rather than on a guess.
export function pinBounds(pins) {
  const ok = pins.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (!ok.length) return null;
  let s = 90, w = 180, n = -90, e = -180;
  for (const p of ok) { s = Math.min(s, p.lat); n = Math.max(n, p.lat); w = Math.min(w, p.lng); e = Math.max(e, p.lng); }
  return [[w, s], [e, n]];
}
