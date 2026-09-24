// Checking a contractor's licence, with more than one place to ask.
//
// Six states and DC are wired directly to their own open data, which is free
// and authoritative and should always win. Everything else -- forty-three
// states -- has never been checkable at all. Two commercial verifiers now
// fill that gap, and stand behind the state sources when one of those is
// down.
//
// The order is the point:
//
//   1. The state's own registry, where there is one. If it answers -- found
//      or genuinely not found -- that is the answer. A paid aggregator
//      saying "active" over a state registry saying "no such licence" is
//      worse than no aggregator at all, so a provider is never allowed to
//      overrule a working state source.
//   2. Otherwise, each configured provider in turn, first definite answer
//      wins.
//   3. Otherwise, honestly unsupported.
//
// ---------------------------------------------------------------------
// On reading what a provider sends back.
//
// These clients were written without ever having seen a real response:
// there was no way to reach either vendor from where this was built. So
// the one rule here is that a status is never inferred. Field *names* are
// read in the two or three spellings a verifier of this kind uses --
// status, license_status, licenseStatus all unambiguously mean the same
// thing -- but if none of them is present, this reports a check that did
// not complete and logs the body. It never decides a licence is active
// because a payload did not say otherwise.
//
// That matters more here than anywhere else in this codebase. Five of the
// six wired states already carry fieldMappingVerified: false because their
// mappings were never checked against real records, and a licence wrongly
// shown as active is how somebody uninsured ends up on a roof.
// ---------------------------------------------------------------------

export const PROVIDERS = [
  {
    id: "statelicense",
    label: "StateLicense.io",
    keyVar: "STATELICENSE_API_KEY",
    baseVar: "STATELICENSE_API_BASE",
    defaultBase: "https://api.statelicense.io/v1",
    // Documented: GET /v1/verify?state=CA&license_number=1078456
    //             Authorization: Bearer <key>
    request: (base, key, { state, license }) => ({
      url: `${base}/verify?state=${encodeURIComponent(state)}&license_number=${encodeURIComponent(license)}`,
      headers: { Authorization: `Bearer ${key}` },
    }),
  },
  {
    id: "tradesapi",
    label: "TradesAPI",
    keyVar: "TRADESAPI_API_KEY",
    baseVar: "TRADESAPI_API_BASE",
    defaultBase: "https://www.tradesapi.com/v1",
    // NOT documented here. No request shape for this one was available when
    // it was wired, so this is a guess at the conventional one and is
    // expected to be corrected: /api/platform/license-probe prints what each
    // provider actually answers, which is how the real path gets pinned
    // without anybody needing a terminal.
    unverifiedRequest: true,
    request: (base, key, { state, license }) => ({
      url: `${base}/licenses/verify?state=${encodeURIComponent(state)}&license=${encodeURIComponent(license)}`,
      headers: { Authorization: `Bearer ${key}` },
    }),
  },
];

export const configuredProviders = (env) => PROVIDERS
  .map((p) => {
    const key = String(env?.[p.keyVar] ?? "").trim();
    return key ? { ...p, key, base: String(env?.[p.baseVar] ?? "").trim() || p.defaultBase } : null;
  })
  .filter(Boolean);

const firstString = (o, keys) => {
  for (const k of keys) {
    const v = o?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
};

// What a provider said, or null if this does not recognise the shape.
//
// Null is not a failure to handle gracefully elsewhere -- it is the whole
// safety mechanism. A payload nobody has mapped yet produces no status at
// all rather than a plausible-looking one.
export function readVerify(payload) {
  const d = payload?.data ?? payload?.result ?? payload;
  if (!d || typeof d !== "object" || Array.isArray(d)) return null;
  const lic = (d.license && typeof d.license === "object") ? d.license
    : (d.licence && typeof d.licence === "object") ? d.licence
    : d;

  const status = firstString(lic, ["status", "license_status", "licenseStatus", "licenseState"]);
  const explicitFound = typeof d.found === "boolean" ? d.found
    : typeof lic.found === "boolean" ? lic.found : null;

  // Recognised only when the payload actually says one of the two things
  // that matter. Neither present means nobody has mapped this vendor yet.
  if (explicitFound === null && !status) return null;
  if (explicitFound === false) return { found: false, status: status || "NOT_FOUND" };
  if (!status) return null;   // says it found something, will not say what

  return {
    found: true,
    status,
    businessName: firstString(lic, ["business_name", "businessName", "legal_name", "legalName", "name"]),
    licenseNumber: firstString(lic, ["license_number", "licenseNumber", "number"]),
    licenseType: firstString(lic, ["license_type", "licenseType", "classification", "type"]),
    effectiveDate: firstString(lic, ["effective_date", "effectiveDate", "issue_date", "issueDate"]),
    expirationDate: firstString(lic, ["expiration_date", "expirationDate", "expires_at", "expires", "expiry"]),
    suspendDate: firstString(lic, ["suspend_date", "suspendDate", "suspended_at"]),
  };
}

// One provider, one question. Never throws: a verifier being down is an
// ordinary Tuesday and must not take a nightly sweep with it.
export async function askProvider(provider, { state, license }) {
  const { url, headers } = provider.request(provider.base, provider.key, { state, license });
  let res, text = "";
  try {
    res = await fetch(url, { headers: { accept: "application/json", ...headers } });
    text = await res.text();
  } catch (err) {
    console.error(`[license] ${provider.id} unreachable:`, err?.message || err);
    return { ok: false, found: false, status: "CHECK_FAILED", source: provider.id,
      error: "unreachable", fieldMappingVerified: false };
  }
  if (res.status === 404) {
    // A verifier answering "no such licence" is an answer, not a failure --
    // so long as it is the licence that was not found and not the endpoint.
    // Which of the two this is cannot be told apart without knowing the
    // vendor, so it is reported as a check that did not complete and the
    // body is logged. It is never reported as "this contractor has no
    // licence", which is a sentence with consequences.
    console.warn(`[license] ${provider.id} 404 for ${state}/${license}:`, text.slice(0, 300));
    return { ok: false, found: false, status: "CHECK_FAILED", source: provider.id,
      error: "not_found_or_bad_endpoint", fieldMappingVerified: false };
  }
  if (!res.ok) {
    console.error(`[license] ${provider.id} refused (${res.status}):`, text.slice(0, 300));
    return { ok: false, found: false, status: "CHECK_FAILED", source: provider.id,
      error: `http_${res.status}`, fieldMappingVerified: false };
  }

  let data = null;
  try { data = JSON.parse(text); } catch { /* not JSON */ }
  const read = readVerify(data);
  if (!read) {
    console.error(`[license] ${provider.id} answered a shape this does not know:`, text.slice(0, 600));
    return { ok: false, found: false, status: "CHECK_FAILED", source: provider.id,
      error: "unmapped_response", fieldMappingVerified: false };
  }
  return {
    ok: true, ...read, source: provider.id,
    // Never true for a provider: no response from either has been seen
    // against a real record, so nothing here has been checked against one.
    fieldMappingVerified: false,
    checkedAt: new Date().toISOString().slice(0, 10),
  };
}

// Did the state's own registry actually answer? Found is obviously yes.
// A clean "no such licence" is also an answer, and an authoritative one.
// Only a failed call or an unsupported state falls through to a provider.
export const stateAnswered = (r) =>
  !!r && r.status !== "CHECK_FAILED" && r.status !== "UNSUPPORTED_STATE";

// The chain. `askState` is passed in rather than imported so this file does
// not need to know how the open-data sources work.
export async function verifyWithFallback(env, { state, license, askState }) {
  const fromState = await askState(state, license);
  if (stateAnswered(fromState)) return { ...fromState, source: fromState.source || `state:${state}` };

  for (const provider of configuredProviders(env)) {
    const r = await askProvider(provider, { state, license });
    if (r.ok) return r;
  }
  // Nobody could answer. Say which kind of nothing this is: a state nobody
  // covers reads differently from a registry that was briefly down.
  return { ...fromState, triedProviders: configuredProviders(env).map((p) => p.id) };
}
