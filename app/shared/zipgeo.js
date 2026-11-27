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

