// Two commercial licence verifiers, behind the states' own registries.
//
// Forty-three states have never been checkable at all. Two paid verifiers
// now cover them, and stand behind the six wired states when one of those
// is down. The order matters and is asserted here: a provider is never
// allowed to overrule a state registry that answered. "Active" from an
// aggregator over "no such licence" from the state is worse than having no
// aggregator.
//
// The rest of this file is about one rule, and it is the rule that matters
// most in this part of the product: a status is never inferred. Both
// clients were written without ever having seen a real response -- neither
// vendor was reachable from where this was built -- so a payload nobody has
// mapped must produce no status at all, not a plausible-looking one. Five
// of the six wired states already carry fieldMappingVerified: false for
// exactly this reason, and a licence wrongly shown as active is how
// somebody uninsured ends up on a roof.
//
//   node scripts/license-provider-test.mjs

import http from "node:http";
import { readVerify, askProvider, verifyWithFallback, configuredProviders, PROVIDERS } from "../worker/licenses.js";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

// A stand-in for a verifier, so the HTTP layer is exercised rather than
// mocked away. What it answers is set per request by the query string.
let asked = [];
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  asked.push({ path: u.pathname, query: Object.fromEntries(u.searchParams), auth: req.headers.authorization });
  const mode = u.searchParams.get("mode") || "ok";
  const send = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
  if (mode === "500") return send(500, { error: "upstream" });
  if (mode === "404") return send(404, { error: "not found" });
  if (mode === "html") { res.writeHead(200, { "content-type": "text/html" }); return res.end("<html>nope</html>"); }
  if (mode === "unmapped") return send(200, { ok: true, payload: { some: "shape", nobody: "mapped" } });
  if (mode === "missing") return send(200, { data: { license_number: "1078456", business_name: "Acme Roofing" } });
  if (mode === "notfound") return send(200, { data: { found: false } });
  if (mode === "nested") return send(200, { data: { found: true, license: {
    status: "Active", license_number: "1078456", business_name: "Acme Roofing",
    license_type: "General Contractor", expiration_date: "2027-03-01" } } });
  return send(200, { data: { found: true, status: "ACTIVE", license_number: "1078456",
    business_name: "Acme Roofing", license_type: "General Contractor",
    expiration_date: "2027-03-01", effective_date: "2021-03-01" } });
});
await new Promise((r) => server.listen(8907, r));
const BASE = "http://127.0.0.1:8907";

const stub = (mode, id = "statelicense") => ({
  id, label: "Stub", key: "test-key", base: BASE, request: (base, key) => ({
    url: `${base}/verify?state=CA&license_number=1078456&mode=${mode}`,
    headers: { Authorization: `Bearer ${key}` },
  }),
});

try {
  console.log("\n-- reading an answer, and refusing to invent one --");
  ck("a flat payload with a status", readVerify({ data: { found: true, status: "ACTIVE" } })?.status === "ACTIVE");
  ck("a nested one", readVerify({ data: { found: true, license: { status: "Active" } } })?.status === "Active");
  ck("camelCase is the same word", readVerify({ licenseStatus: "EXPIRED" })?.status === "EXPIRED");
  ck("snake_case too", readVerify({ license_status: "SUSPENDED" })?.status === "SUSPENDED");
  ck("a clean no", readVerify({ data: { found: false } })?.found === false);

  // The whole safety mechanism. Each of these could plausibly be read as
  // "nothing is wrong, so it must be active"; none of them may be.
  ck("a shape nobody mapped yields nothing", readVerify({ ok: true, payload: { a: 1 } }) === null);
  ck("found with no status yields nothing", readVerify({ data: { found: true } }) === null);
  ck("details with no status yields nothing",
    readVerify({ data: { business_name: "Acme", license_number: "1" } }) === null);
  ck("an empty body yields nothing", readVerify(null) === null && readVerify({}) === null);
  ck("a list yields nothing", readVerify([{ status: "ACTIVE" }]) === null);
  ck("a string yields nothing", readVerify("ACTIVE") === null);

  console.log("\n-- asking one, over HTTP --");
  asked = [];
  let r = await askProvider(stub("ok"), { state: "CA", license: "1078456" });
  ck("it answers", r.ok === true, JSON.stringify(r).slice(0, 90));
  ck("with the status", r.status === "ACTIVE", r.status);
  ck("and the expiry", r.expirationDate === "2027-03-01", r.expirationDate);
  ck("and says which source", r.source === "statelicense", r.source);
  // Never true for a provider: no real response has been seen against a
  // real record, so nothing here has been checked against one.
  ck("and does not claim its mapping is verified", r.fieldMappingVerified === false);
  ck("the key travels as a bearer", /^Bearer test-key$/.test(asked[0]?.auth || ""), asked[0]?.auth);

  console.log("\n-- and every way it can go wrong --");
  for (const [mode, why] of [["500", "http_500"], ["unmapped", "unmapped_response"],
                             ["missing", "unmapped_response"], ["html", "unmapped_response"]]) {
    r = await askProvider(stub(mode), { state: "CA", license: "1078456" });
    ck(`${mode}: reported as a check that did not complete`, r.ok === false && r.status === "CHECK_FAILED",
      `${r.ok} / ${r.status}`);
    ck(`${mode}: says why`, r.error === why, r.error);
    ck(`${mode}: and never as a licence`, r.found === false);
  }
  // A 404 is the ambiguous one: no such licence, or a guessed endpoint that
  // does not exist. Saying "this contractor has no licence" on the strength
  // of that would be a sentence with consequences.
  r = await askProvider(stub("404"), { state: "CA", license: "1078456" });
  ck("a 404 is not read as 'no licence'", r.error === "not_found_or_bad_endpoint", r.error);
  ck("and is not a definite answer", r.ok === false);

  console.log("\n-- the state's own registry wins when it answers --");
  const withKeys = { STATELICENSE_API_BASE: BASE, STATELICENSE_API_KEY: "k" };
  let providerCalls = 0;
  const countingAsk = async (state, license) => {
    providerCalls = asked.length;
    return state === "WA" ? { found: true, status: "ACTIVE", fieldMappingVerified: true }
      : state === "OR" ? { found: false, status: "NOT_FOUND" }
      : state === "ZZ" ? { found: false, status: "UNSUPPORTED_STATE" }
      : { found: false, status: "CHECK_FAILED", error: "lni down" };
    void license;
  };

  asked = [];
  r = await verifyWithFallback(withKeys, { state: "WA", license: "X", askState: countingAsk });
  ck("a found licence is the answer", r.status === "ACTIVE" && r.found === true, r.status);
  ck("and no provider was asked", asked.length === 0, `${asked.length} calls`);
  ck("its own verification survives", r.fieldMappingVerified === true);

  asked = [];
  r = await verifyWithFallback(withKeys, { state: "OR", license: "X", askState: countingAsk });
  // The one that matters: the state says no such licence. A paid verifier
  // saying "active" over that is worse than having no verifier at all.
  ck("a state saying 'no such licence' is also the answer", r.status === "NOT_FOUND", r.status);
  ck("and still nobody is asked to disagree", asked.length === 0, `${asked.length} calls`);

  console.log("\n-- and it falls through when the state could not answer --");
  asked = [];
  r = await verifyWithFallback(withKeys, { state: "ZZ", license: "1078456", askState: countingAsk });
  ck("an unsupported state reaches a provider", asked.length === 1, `${asked.length} calls`);
  ck("which answers", r.status === "ACTIVE" && r.source === "statelicense", `${r.status} / ${r.source}`);

  asked = [];
  r = await verifyWithFallback(withKeys, { state: "IL", license: "1078456", askState: countingAsk });
  ck("so does a registry that was down", asked.length === 1 && r.source === "statelicense",
    `${asked.length} / ${r.source}`);

  console.log("\n-- with no keys set, nothing changes and nothing pretends --");
  asked = [];
  r = await verifyWithFallback({}, { state: "ZZ", license: "1078456", askState: countingAsk });
  ck("no provider is called", asked.length === 0, `${asked.length} calls`);
  ck("and the honest answer stands", r.status === "UNSUPPORTED_STATE", r.status);
  ck("naming that none were tried", Array.isArray(r.triedProviders) && r.triedProviders.length === 0,
    JSON.stringify(r.triedProviders));
  ck("configuredProviders is empty without keys", configuredProviders({}).length === 0);
  ck("and both are known about", PROVIDERS.length === 2, PROVIDERS.map((p) => p.id).join(", "));
  // The second one's request shape was never documented to us, and saying so
  // in the code is what stops it being mistaken for something that was.
  ck("the unverified request shape is marked as such",
    PROVIDERS.find((p) => p.id === "tradesapi")?.unverifiedRequest === true);
  ck("and the documented one is not", !PROVIDERS.find((p) => p.id === "statelicense")?.unverifiedRequest);

  console.log("\n-- the documented request is sent as documented --");
  asked = [];
  const real = PROVIDERS.find((p) => p.id === "statelicense");
  const { url, headers } = real.request(BASE, "k", { state: "CA", license: "1078456" });
  ck("path is /verify", new URL(url).pathname === "/verify", new URL(url).pathname);
  ck("state and license_number, as their docs show",
    new URL(url).searchParams.get("state") === "CA"
    && new URL(url).searchParams.get("license_number") === "1078456", url);
  ck("with a bearer token", headers.Authorization === "Bearer k", headers.Authorization);
} finally {
  server.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
