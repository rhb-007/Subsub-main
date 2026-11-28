// The distance half of shared/zipnear.js: the Census ZIP centers and the
// radius search over them. Imported by the Worker only; the browser asks the
// route, so the table never ships in the app bundle.
import { ZIP_CENTROIDS, ZIP_COUNT, ZIP_SOURCE } from "./zipcentroids.js";

export { ZIP_COUNT, ZIP_SOURCE };

const RAD = Math.PI / 180;
let table = null; // Map zip -> [lat, lng], parsed once
function load() {
  if (table) return table;
  table = new Map();
  for (const rec of ZIP_CENTROIDS.split(",")) {
    const [z, la, lo] = rec.split(":");
    table.set(z, [Number(la) / 1000, Number(lo) / 1000]);
  }
  return table;
}

export function zipCenter(zip) {
  const p = load().get(String(zip ?? "").trim());
  return p ? { lat: p[0], lng: p[1] } : null;
}

export function milesBetween(a, b) {
  const dLat = (b.lat - a.lat) * RAD, dLng = (b.lng - a.lng) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Nearest first, each with its distance to a tenth of a mile. Ties go to the
// lower ZIP, so one center and radius always gives one list.
export function zipsNear(center, miles) {
  if (!center || !Number.isFinite(center.lat) || !Number.isFinite(center.lng)) return [];
  const r = Number(miles);
  if (!(r > 0)) return [];
  // A box first, so a 15-mile question is not 33,000 square roots.
  const dLat = r / 69, dLng = r / (69 * Math.max(0.05, Math.cos(center.lat * RAD)));
  const out = [];
  for (const [zip, [lat, lng]] of load()) {
    if (Math.abs(lat - center.lat) > dLat || Math.abs(lng - center.lng) > dLng) continue;
    const d = milesBetween(center, { lat, lng });
    if (d <= r) out.push({ zip, miles: Math.round(d * 10) / 10 });
  }
  return out.sort((a, b) => a.miles - b.miles || a.zip.localeCompare(b.zip));
}


// The town each ZIP belongs to (GeoNames), for filling a market's or a
// coverage area's towns from its ZIPs. Worker only, like the centers.
import { ZIP_TOWNS, ZIP_TOWN_OF, ZIP_TOWN_SOURCE } from "./zipcities.js";
export { ZIP_TOWN_SOURCE };
let towns = null;
function loadTowns() {
  if (towns) return towns;
  const names = ZIP_TOWNS.split(",").map((t) => { const [city, state] = t.split("|"); return { city, state }; });
  towns = new Map();
  for (const rec of ZIP_TOWN_OF.split(",")) {
    const [z, i] = rec.split(":");
    towns.set(z, names[parseInt(i, 36)]);
  }
  return towns;
}
export function townOfZip(zip) {
  const t = loadTowns().get(String(zip ?? "").trim());
  return t ? { city: t.city, state: t.state } : null;
}

// "We sell in the same places we work": Where you work, as a market. Cities
// are named towns in the company's state (or the state written after them);
// a radius becomes every ZIP within it and the towns those ZIPs are in.
// Nearest first and capped, so a 200-mile radius cannot write 4,000 ZIPs.
export function marketFromCoverage(coverage = {}, { state = "", maxZips = 500, maxCities = 100 } = {}) {
  const st = String(state || "").trim().toUpperCase();
  const zips = [], seenZ = new Set(), cities = [], seenC = new Set();
  const addTown = (city, s) => {
    const c = String(city || "").trim().replace(/\s+/g, " ");
    const S = String(s || "").trim().toUpperCase();
    if (!c || !/^[A-Z]{2}$/.test(S) || cities.length >= maxCities) return;
    const k = `${c.toLowerCase()}|${S}`;
    if (seenC.has(k)) return;
    seenC.add(k); cities.push({ city: c, state: S });
  };
  if (coverage?.mode === "radius") {
    const found = [];
    for (const r of coverage.radii || []) {
      const center = zipCenter(r.zip);
      if (center) found.push(...zipsNear(center, Math.min(100, Number(r.miles) || 0)));
    }
    found.sort((a, b) => a.miles - b.miles || a.zip.localeCompare(b.zip));
    for (const f of found) {
      if (seenZ.has(f.zip) || zips.length >= maxZips) continue;
      seenZ.add(f.zip); zips.push(f.zip);
      const t = townOfZip(f.zip);
      if (t) addTown(t.city, t.state);
    }
  } else {
    for (const raw of coverage?.cities || []) {
      const m = String(raw).match(/^(.*?),\s*([A-Za-z]{2})$/);
      if (m) addTown(m[1], m[2]); else addTown(raw, st);
    }
  }
  return { zips, cities };
}
