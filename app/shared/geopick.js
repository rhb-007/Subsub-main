// WHICH PLACE A TOWN NAME MEANS, out of the geocoder's list.
//
// Reported: a tenant in Ruston, WA was shown somebody else's weather. The
// weather route asked Open-Meteo's geocoder for one result by name and passed
// the state as `admin1` -- which that API does not take as a filter, so it was
// ignored and the top hit for "Ruston" was Ruston, LOUISIANA. Every town that
// shares a name with a bigger one elsewhere was wrong the same way, silently,
// because a temperature from the wrong state still looks like a temperature.
//
// So the route asks for several and this picks:
//   - only places in the building's own state, or none at all -- another
//     state's weather is worse than no weather, because it is read and believed;
//   - among those, the one whose postcodes include the building's ZIP, then
//     an exact name match, then the most populous.
// With no state to go by, a ZIP match is the only thing that decides; with
// neither, the top US result is the best that can be said.

import { stateName } from "./states.js";

const norm = (v) => String(v || "").trim().toLowerCase();

// A state as the geocoder spells it: "WA" -> "washington". A full name typed
// into the column is taken as it is.
const stateKey = (state) => {
  const s = String(state || "").trim();
  if (!s) return "";
  return norm(s.length === 2 ? stateName(s) || s : s);
};

export function pickPlace(results, { city = "", state = "", zip = "" } = {}) {
  let list = (Array.isArray(results) ? results : [])
    .filter((r) => r && typeof r.latitude === "number" && typeof r.longitude === "number")
    .filter((r) => !r.country_code || String(r.country_code).toUpperCase() === "US");
  const want = stateKey(state);
  if (want) list = list.filter((r) => norm(r.admin1) === want);
  if (!list.length) return null;
  const z = String(zip || "").trim().slice(0, 5);
  const score = (r) => {
    let s = 0;
    if (z && Array.isArray(r.postcodes) && r.postcodes.some((p) => String(p).startsWith(z))) s += 4;
    if (city && norm(r.name) === norm(city)) s += 2;
    return s;
  };
  return [...list].sort((a, b) => (score(b) - score(a))
    || ((Number(b.population) || 0) - (Number(a.population) || 0)))[0];
}
