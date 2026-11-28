// 112. MARKETS: the places an account sells in, and what it sells there.
//
// A market is a name, the ZIP codes and towns it covers, and the services
// offered in it. A lead belongs to the market its ZIP is in (or, with no ZIP
// match, its town and state), worked out when it is read rather than stored on
// the lead, so moving a ZIP from one market to another moves every lead with it
// and there is no second record of the fact to disagree.
//
// WHOLE VALUES ONLY. A ZIP matches a listed ZIP exactly and a town matches a
// listed town and state exactly (case and spaces ignored) -- never a prefix, so
// "981" is not a market for every ZIP in Seattle.
import { SERVICE_IDS } from "./salesappt.js";

export const MAX_MARKETS = 50;
export const MAX_MARKET_ZIPS = 500;
export const MAX_MARKET_CITIES = 100;

const cleanZip = (z) => String(z ?? "").trim().slice(0, 5);
const norm = (s) => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

// "98402, 98403 98404" or ["98402", ...]. Every entry must be five digits.
function zipList(raw) {
  const parts = Array.isArray(raw) ? raw : String(raw ?? "").split(/[\s,;]+/);
  return parts.map((z) => String(z ?? "").trim()).filter(Boolean);
}

// "Tacoma, WA" or {city, state}. A town needs its state: there are thirty
// towns called Springfield.
function cityList(raw) {
  const parts = Array.isArray(raw) ? raw : String(raw ?? "").split(/\n|;/);
  return parts.map((c) => {
    if (c && typeof c === "object") return { city: String(c.city ?? "").trim(), state: String(c.state ?? "").trim().toUpperCase() };
    const m = String(c ?? "").trim().match(/^(.*?),\s*([A-Za-z]{2})$/);
    return m ? { city: m[1].trim(), state: m[2].toUpperCase() } : { city: String(c ?? "").trim(), state: "" };
  }).filter((c) => c.city);
}

export function validMarket(b = {}) {
  const name = String(b.name ?? "").trim();
  if (!name) return { ok: false, error: "name_required", field: "name" };
  if (name.length > 80) return { ok: false, error: "name_too_long", field: "name" };
  const zips = [...new Set(zipList(b.zips))];
  const bad = zips.find((z) => !/^\d{5}$/.test(z));
  if (bad) return { ok: false, error: "bad_zip", field: "zips", value: bad };
  if (zips.length > MAX_MARKET_ZIPS) return { ok: false, error: "too_many_zips", field: "zips" };
  const seen = new Set();
  const cities = [];
  for (const c of cityList(b.cities)) {
    if (!/^[A-Z]{2}$/.test(c.state)) return { ok: false, error: "city_needs_state", field: "cities", value: c.city };
    const k = `${norm(c.city)}|${c.state}`;
    if (!seen.has(k)) { seen.add(k); cities.push({ city: c.city.slice(0, 80), state: c.state }); }
  }
  if (cities.length > MAX_MARKET_CITIES) return { ok: false, error: "too_many_cities", field: "cities" };
  if (!zips.length && !cities.length) return { ok: false, error: "coverage_required", field: "zips" };
  const services = [...new Set((Array.isArray(b.services) ? b.services : []).filter((s) => SERVICE_IDS.includes(s)))];
  if (!services.length) return { ok: false, error: "services_required", field: "services" };
  return { ok: true, market: { name, zips, cities, services, active: b.active !== false } };
}

// The market a homeowner is in: a ZIP match first, then their town and state.
// Markets are tried in name order so the answer never depends on the order a
// list happened to come back in. Inactive markets are skipped.
export function marketFor(markets = [], { zip, city, state } = {}) {
  const live = (markets || []).filter((m) => m && m.active !== false)
    .slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const z = cleanZip(zip);
  if (/^\d{5}$/.test(z)) {
    const hit = live.find((m) => (m.zips || []).includes(z));
    if (hit) return hit;
  }
  const c = norm(city), s = String(state ?? "").trim().toUpperCase();
  if (c && s) {
    const hit = live.find((m) => (m.cities || []).some((x) => norm(x.city) === c && x.state === s));
    if (hit) return hit;
  }
  return null;
}

// Services the homeowner wants that this market does not offer, so the rep can
// say so on the call rather than book an estimate nobody will run.
export function servicesNotOffered(market, services = []) {
  if (!market) return [];
  return (services || []).filter((s) => !(market.services || []).includes(s));
}

export function marketErrText(e) {
  const code = e?.body?.error || e?.error;
  if (code === "name_required") return "Give it a name.";
  if (code === "name_too_long") return "Keep the name under 80 characters.";
  if (code === "bad_zip") return `${e.body?.value ?? e.value ?? "That"} isn't a five-digit ZIP code.`;
  if (code === "too_many_zips") return `A market can list up to ${MAX_MARKET_ZIPS} ZIP codes.`;
  if (code === "city_needs_state") return `Add the state to ${e.body?.value ?? e.value ?? "that town"}, like "Tacoma, WA".`;
  if (code === "too_many_cities") return `A market can list up to ${MAX_MARKET_CITIES} towns.`;
  if (code === "coverage_required") return "Add at least one ZIP code or town.";
  if (code === "services_required") return "Pick at least one service offered there.";
  if (code === "too_many_areas") return `Where you work holds up to ${MAX_WORK_AREAS} areas.`;
  if (code === "invalid_coverage") return "That didn't save. Check each area has a name and a ZIP or a town.";
  if (code === "too_many_markets") return `An account can have up to ${MAX_MARKETS} markets.`;
  if (code === "office_only") return "Only an admin or project manager can change markets.";
  if (code === "mirrored_market_name") return "This market takes its name from its area in Where you work. Rename the area there.";
  if (code === "mirrored_market") return "This market follows Where you work. Change the places there, or turn off \"We sell in the same places we work\".";
  if (code === "no_coverage") return "Set Where you work first, then this market can follow it.";
  if (code === "no_company") return "Only an account that can be hired has a Where you work to follow.";
  if (code === "migration_needed") return `Markets aren't set up on this database yet. Run migration ${e.body?.migration || "112_markets"}.`;
  return "That didn't save. Try again.";
}

// One line a rep can say about the weather where the homeowner is, chosen
// from the reading and what they asked about. Small talk with a purpose: rain
// on a roofing call is the natural way into "any leaks or water spots?".
// Null when there is nothing worth saying, rather than a sentence about nothing.
export function weatherTalk(w, services = []) {
  if (!w || typeof w.tempF !== "number") return null;
  const code = Number(w.code), t = Math.round(w.tempF);
  const has = (s) => (services || []).includes(s);
  const wet = [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(code);
  const snow = [71, 73, 75, 77, 85, 86].includes(code);
  if (wet) return has("roofing") || has("gutters")
    ? "It's wet there right now. Ask whether they've seen any leaks, water spots or overflowing gutters."
    : "It's wet there right now. Ask how the house is holding up in it.";
  if (snow) return "It's snowing there. Ask about ice building up at the roof edge or in the gutters.";
  if (t >= 90) return has("windows") ? "It's hot there today. Ask whether some rooms run hotter than others, which old windows make worse."
    : "It's hot there today. Ask whether the upstairs gets uncomfortably warm.";
  if (t <= 35) return has("windows") || has("siding") ? "It's cold there today. Ask about drafts near the windows and walls."
    : "It's cold there today. Ask whether they've noticed drafts or high heating bills.";
  return "Good weather there for an estimate visit this week.";
}

// ---- 116. WHERE YOU WORK, AS AREAS ----------------------------------------------
// Where you work is built the same way as Where you sell: named areas, each a
// list of ZIP codes and towns (filled from a place and a distance), so the two
// halves of My markets are one editor and one shape. It is a third coverage
// mode beside the older "cities" and "radius", which still read.
//
// Each area keeps an id, because "we sell in the same places we work" turns
// every area into its own market, and the id is what keeps that market the
// same market when the area is renamed or its ZIPs change.
export const MAX_WORK_AREAS = 20;
const AREA_ID_RE = /^[a-z0-9]{6,24}$/;
export const newAreaId = () => {
  const b = new Uint8Array(8);
  (globalThis.crypto?.getRandomValues ? globalThis.crypto.getRandomValues(b) : b.forEach((_, i) => { b[i] = Math.floor(Math.random() * 256); }));
  return [...b].map((x) => x.toString(36).padStart(2, "0")).join("").slice(0, 12);
};
// Answers {ok, areas} or {ok:false, error, field, index}. An area is checked
// exactly as a market is, less the services: what is sold there is a market's
// question, and where you work is not about selling.
export function validWorkAreas(list) {
  if (!Array.isArray(list)) return { ok: false, error: "invalid_coverage" };
  if (list.length > MAX_WORK_AREAS) return { ok: false, error: "too_many_areas" };
  const out = [], ids = new Set();
  for (let i = 0; i < list.length; i++) {
    const a = list[i] || {};
    const v = validMarket({ name: a.name, zips: a.zips, cities: a.cities, services: [SERVICE_IDS[0]] });
    if (!v.ok) return { ...v, index: i };
    let id = AREA_ID_RE.test(String(a.id || "")) && !ids.has(a.id) ? a.id : newAreaId();
    while (ids.has(id)) id = newAreaId();
    ids.add(id);
    out.push({ id, name: v.market.name, zips: v.market.zips, cities: v.market.cities });
  }
  return { ok: true, areas: out };
}
// The area a job is in: the same rule as a lead's market (ZIP first, then town
// and state, in name order).
export const workAreaFor = (areas = [], where = {}) => marketFor((areas || []).map((a) => ({ ...a, active: true })), where);
// The id a mirrored market gets for an area: derived, so the same area is
// always the same market and nothing needs a second table to remember it.
export const mirrorMarketId = (accountId, areaId) => `mir_${accountId}_${areaId}`;
export const isMirrorMarketId = (accountId, id) => String(id || "").startsWith(`mir_${accountId}_`);
