// "IS YOUR SUB LEGIT?" -- the free licence checker on the marketing site.
//
// Public, no account, rate-limited, and backed by the state's OWN public
// registry. The rules live here because four places describe them: the
// Worker route, the generated pages at /check and /check/<state>, the
// site README, and the tests.
//
// WHERE IT CAN ANSWER, AND WHY ONLY THERE. The Worker already reads seven
// registries (SOCRATA_STATES), and exactly one -- Washington's -- carries
// `fieldMappingVerified: true`. The other six have never been exercised against
// a live response. A public page answering "Active" from a mapping nobody has
// checked is the confident-and-wrong answer this product refuses everywhere,
// and on a page whose whole promise is telling you whether somebody is legit
// it would be the worst thing the site could say. So `LIVE_STATES` is WA, and
// every other state's page says where its own board's lookup is instead.
//
// THE PROVIDER IS SWAPPABLE, AND THAT IS THE SEAM. The Worker resolves a state
// to a provider with two questions -- by licence number, and by business name
// -- and a 50-state verification partner plugs in as one more provider
// (LICENSE_LOOKUP_PARTNER names it, its key comes from the same env vars
// `worker/licenses.js` already reads). Adding a state to LIVE_STATES is the
// decision to show a partner's answer to the public, which is a decision, not a
// config change: do it when somebody has seen its responses against real
// records, the same bar WA cleared.
//
// THE GATE IS AN EMAIL, NOT A PAYWALL. The preview says whether there is a
// match and names it; the status, the expiry, the bond and the insurance come
// back with an email address. The data is the state's and is free at the
// source -- the page says so and links it -- so the gate is lead capture and
// never pretends to be anything else.

import { checkView, licenseActive } from "./licensecheck.js";
import { stateName, normalizeState } from "./states.js";

export const LIVE_STATES = ["WA"];
export const isLiveState = (s) => LIVE_STATES.includes(normalizeState(s) || "");

export const NAME_MIN = 3;
export const MAX_MATCHES = 10;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const validLeadEmail = (e) => EMAIL_RE.test(String(e || "").trim()) && String(e).length <= 200;

// What was asked, tidied, or the reason it cannot be asked.
export function readLookup({ state, license, name } = {}) {
  const st = normalizeState(state);
  if (!st) return { error: "state_required" };
  const lic = String(license || "").trim().toUpperCase().replace(/\s+/g, "");
  const nm = String(name || "").trim().replace(/\s+/g, " ");
  if (!lic && !nm) return { error: "license_or_name_required" };
  if (lic && !/^[A-Z0-9*\-]{3,30}$/.test(lic)) return { error: "bad_license" };
  if (!lic && nm.length < NAME_MIN) return { error: "name_too_short" };
  return { state: st, license: lic || null, name: lic ? null : nm.slice(0, 80) };
}

// The preview: enough to say "yes, there is a record and this is whose", and
// nothing that answers the question the email buys.
export const previewOf = (r) => ({
  name: r.businessName || r.name || null,
  license: r.licenseNumber || r.license || null,
  city: r.city || null,
});

// The full answer, read through `checkView` so the bond and the insurance come
// back in the one shape every screen in SubSub already draws.
export function fullOf(r, today = new Date().toISOString().slice(0, 10)) {
  const v = checkView(r, r?.licenseNumber || null) || {};
  return {
    found: !!v.found,
    name: v.businessName || null,
    license: v.licenseNumber || null,
    status: v.status || (v.found ? null : "NOT_FOUND"),
    active: licenseActive(v, today),
    licenseType: v.licenseType || null,
    effectiveDate: v.effectiveDate || null,
    expirationDate: v.expirationDate || null,
    suspendDate: v.suspendDate || null,
    bond: v.bond || null,
    insurance: v.insurance || null,
    checkedAt: today,
  };
}

// The headline, in words. Three answers, because "no such number" and
// "registered but not active" need opposite actions -- the same
// expired-versus-never-added rule docs.js draws in colour.
export function verdictText(full, state) {
  const where = stateName(state) || state;
  if (!full?.found) return { tone: "bad", head: `No ${where} record for that number`,
    why: "Check the number with them. A registration that cannot be found is not one you can rely on." };
  if (full.active) return { tone: "ok", head: "Active registration",
    why: full.expirationDate ? `Good through ${full.expirationDate}, according to the state.` : "According to the state, as of today." };
  return { tone: "bad", head: `Not active${full.status ? `: ${full.status}` : ""}`,
    why: full.suspendDate ? `Suspended ${full.suspendDate}.`
      : full.expirationDate && full.expirationDate < full.checkedAt ? `Expired ${full.expirationDate}.`
        : "The state does not show this registration as active." };
}

export const LEAD_TOOLS = ["check", "handyman_limits"];
export const isLeadTool = (t) => LEAD_TOOLS.includes(String(t || ""));
