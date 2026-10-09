// THE MARKETING SITE'S FREE TOOLS, through the real Worker.
//
//   THE CHECKER ANSWERS ONLY WHERE A MAPPING HAS BEEN VERIFIED. Washington is
//   live; Oregon is wired in the Worker and unverified, so the public page
//   refuses it rather than showing an answer nobody has checked.
//
//   THE EMAIL IS THE GATE. Without one: whether there is a record, and whose.
//   With one: the status, the expiry, the bond and the insurance -- and the
//   address is kept as a lead, tagged with the tool and the state.
//
//   A NAME SEARCH LISTS MATCHES AND NEVER A STATUS, even with an email.
//
//   THE CALCULATOR'S LEAD keeps the address and emails the visitor the same
//   words the page drew, out of the shared module.
//
//   node --no-warnings scripts/public-tools-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { readLookup, fullOf, verdictText, LIVE_STATES, previewOf } from "../shared/licenselookup.js";
import { handyVerdict } from "../shared/handytool.js";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");

const asked = [];
const mail = [];
let waDown = false;
const LIC = { businessname: "BAY ROOFING LLC", contractorlicensenumber: "BAYRR*222", contractorlicensestatus: "ACTIVE",
  contractorlicensetypecodedesc: "Construction Contractor", licenseeffectivedate: "2024-01-02T00:00:00.000",
  licenseexpirationdate: "2027-01-02T00:00:00.000", city: "TACOMA", ubi: "604000000" };
globalThis.fetch = async (url, init = {}) => {
  const u = decodeURIComponent(String(url));
  const ok = (j, status = 200) => new Response(JSON.stringify(j), { status, headers: { "Content-Type": "application/json" } });
  if (u.includes("resend")) { mail.push(JSON.parse(init.body)); return ok({ id: "em" }); }
  if (u.includes("partner.test")) { asked.push(u); return ok({ found: true, status: "ACTIVE", business_name: "OR CO" }); }
  if (u.includes("data.wa.gov")) {
    asked.push(u);
    if (waDown) return ok({ message: "down" }, 503);
    if (u.includes("$where=upper(businessname) like '%BAY%'")) return ok([LIC, { ...LIC, businessname: "BAY VIEW HOMES", contractorlicensenumber: "BAYVH*111", contractorlicensestatus: "EXPIRED" }]);
    if (u.includes("$where")) return ok([]);
    if (u.includes("m8qx-ubtq") && u.includes("BAYRR*222")) return ok([LIC]);
    if (u.includes("m8qx-ubtq")) return ok([]);
    if (u.includes("ciwg-agsx")) return ok([{ insurance_company: "Cascade Mutual", coverage_amount: "1000000", insurance_expiration_date: "2027-03-01T00:00:00.000", effective_date: "2026-03-01" }]);
    if (u.includes("bzff-4fmt")) return ok([{ surety_company: "Western Surety", bond_amount: "15000", bond_expiration_date: "2027-01-02T00:00:00.000", effective_date: "2024-01-02" }]);
    return ok([]);
  }
  return ok({});
};

const seed = (leads = true) => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  if (!leads) db.exec("DROP TABLE leads");
  return { db, env: { DB: makeD1(db), RESEND_API_KEY: "re", MAIL_FROM: "SubSub <hi@subsub.work>",
    RESEND_API_BASE: "https://resend.test", LEADS_EMAIL: "sales@subsub.test" } };
};
let ipN = 0;
const post = (env, path, body, ip = `10.1.0.${++ipN}`) => worker.fetch(new Request(`https://api.subsub.work${path}`, {
  method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip }, body: JSON.stringify(body) }), env)
  .then(async (r) => [r.status, await r.json().catch(() => ({}))]);

try {
  console.log("\n-- the rules --");
  ck("Washington is the one live state, because it is the one verified mapping", JSON.stringify(LIVE_STATES) === '["WA"]');
  ck("a state is required", readLookup({ license: "X123" }).error === "state_required");
  ck("a number or a name", readLookup({ state: "WA" }).error === "license_or_name_required");
  ck("a name of two letters is not a search", readLookup({ state: "WA", name: "ab" }).error === "name_too_short");
  ck("a number wins over a name when both are given",
    readLookup({ state: "wa", license: "bayrr*222", name: "Bay" }).license === "BAYRR*222");
  const f = fullOf({ found: true, status: "ACTIVE", businessName: "X", licenseNumber: "1", expirationDate: "2027-01-01",
    bond: { surety_company: "S", bond_amount: "15000" } }, "2026-10-09");
  ck("the full answer reads the bond in the screen's shape", f.active && f.bond.surety === "S" && f.bond.amount === 15000);
  ck("three different headlines", verdictText(f, "WA").tone === "ok"
    && verdictText({ found: false }, "WA").head === "No Washington record for that number"
    && verdictText({ found: true, status: "EXPIRED", checkedAt: "2026-10-09" }, "WA").head === "Not active: EXPIRED");
  ck("the preview carries no status", !("status" in previewOf({ businessName: "X", licenseNumber: "1", status: "ACTIVE" })));
  const plumb = handyVerdict({ state: "WA", jobValue: 100, jobType: "plumbing" });
  ck("an electrician or a plumber is a NO on the public page, whatever the amount", plumb.tone === "no", plumb.answer);
  ck("WA $400 of general repairs is under the limit", handyVerdict({ state: "WA", jobValue: 400, jobType: "general" }).tone === "yes");
  ck("WA $800 is over it", handyVerdict({ state: "WA", jobValue: 800, jobType: "general" }).tone === "no");
  ck("a state with no exemption is a no at any amount", handyVerdict({ state: "NJ", jobValue: 50, jobType: "general" }).tone === "no");
  ck("a state that licenses nobody hands it to the city", handyVerdict({ state: "TX", jobValue: 50000, jobType: "general" }).tone === "maybe");
  ck("an annual limit is never a flat yes", handyVerdict({ state: "PA", jobValue: 100, jobType: "general" }).tone === "maybe");

  console.log("\n-- by number --");
  const S = seed();
  {
    const [st, r] = await post(S.env, "/api/public/license-lookup", { state: "WA", license: "bayrr*222" });
    ck("a number with no email says there is a record, and whose", st === 200 && r.found && r.preview?.name === "BAY ROOFING LLC", JSON.stringify(r));
    ck("and nothing the email buys", !JSON.stringify(r).includes("ACTIVE") && !JSON.stringify(r).includes("Western") && !r.full);
    ck("and keeps no lead without an address", S.db.prepare("SELECT COUNT(*) AS n FROM leads").get().n === 0);
    const [st2, r2] = await post(S.env, "/api/public/license-lookup", { state: "WA", license: "BAYRR*222", email: "gc@build.test", ref: "k7q2mxrb" });
    ck("with an email, the full record", st2 === 200 && r2.full?.active === true && r2.full.status === "ACTIVE"
      && r2.full.expirationDate === "2027-01-02", JSON.stringify(r2.full));
    ck("the bond and the insurance in words", r2.full.bond?.surety === "Western Surety" && r2.full.bond?.amount === 15000
      && r2.full.insurance?.carrier === "Cascade Mutual" && r2.full.insurance?.coverage === 1000000, JSON.stringify([r2.full.bond, r2.full.insurance]));
    ck("a headline in words", r2.verdict?.head === "Active registration" && r2.verdict.tone === "ok");
    const lead = S.db.prepare("SELECT * FROM leads").get();
    ck("the address is kept, tagged by tool and state", lead?.email === "gc@build.test" && lead.tool === "check" && lead.state === "WA"
      && JSON.parse(lead.detail).license === "BAYRR*222" && lead.ref_code === "K7Q2MXRB", JSON.stringify(lead));
    ck("and sales are told", mail.some((m) => (m.to === "sales@subsub.test" || m.to?.[0] === "sales@subsub.test") && /Licence check · WA/.test(m.subject))
      && lead.notified === 1);
    const [st3, r3] = await post(S.env, "/api/public/license-lookup", { state: "WA", license: "NOPE*1" });
    ck("a number the state does not know is a plain no", st3 === 200 && r3.found === false && !r3.preview);
    const [st4, r4] = await post(S.env, "/api/public/license-lookup", { state: "WA", license: "BAYRR*222", email: "not-an-email" });
    ck("a bad address is refused, not kept", st4 === 400 && r4.error === "bad_email");
  }

  console.log("\n-- by name --");
  {
    const [st, r] = await post(S.env, "/api/public/license-lookup", { state: "WA", name: "Bay" });
    ck("a name lists the matches", st === 200 && r.matches?.length === 2 && r.matches[0].license === "BAYRR*222", JSON.stringify(r));
    ck("and never a status, not even EXPIRED", !JSON.stringify(r).includes("ACTIVE") && !JSON.stringify(r).includes("EXPIRED"));
    const [, r2] = await post(S.env, "/api/public/license-lookup", { state: "WA", name: "Bay", email: "gc@build.test" });
    ck("even with an email: the full record is asked for by number", !r2.full && r2.matches?.length === 2);
    ck("the search is the state's, never SubSub's companies table", asked.some((u) => u.includes("data.wa.gov") && u.includes("businessname")));
    const [, r3] = await post(S.env, "/api/public/license-lookup", { state: "WA", name: "O'Brien%" });
    ck("a quote or a wildcard in a name cannot break the query", Array.isArray(r3.matches)
      && asked.some((u) => u.includes("like '%O''BRIEN%'")), JSON.stringify(r3));
  }

  console.log("\n-- where it cannot answer --");
  {
    const [st, r] = await post(S.env, "/api/public/license-lookup", { state: "OR", license: "123456" });
    ck("a state wired but unverified is refused, not answered", st === 404 && r.error === "state_not_live"
      && JSON.stringify(r.live) === '["WA"]', JSON.stringify(r));
    ck("and Oregon's registry was never asked", !asked.some((u) => u.includes("oregon")));
    // The discriminating fixture: a 50-state partner IS configured, and could
    // answer for Oregon. A partner nobody has seen answer against real records
    // is exactly what LIVE_STATES keeps off a public page, so it is still no.
    const partnered = { ...S.env, LICENSE_LOOKUP_PARTNER: "statelicense", STATELICENSE_API_KEY: "sk_partner",
      STATELICENSE_API_BASE: "https://partner.test/v1" };
    const [stP, rP] = await post(partnered, "/api/public/license-lookup", { state: "OR", license: "123456" });
    ck("even with a partner configured, a state nobody has verified is refused", stP === 404 && rP.error === "state_not_live",
      JSON.stringify(rP));
    waDown = true;
    const [st2, r2] = await post(S.env, "/api/public/license-lookup", { state: "WA", license: "BAYRR*222", email: "a@b.test" });
    ck("the state's lookup being down says so, and is not a 'no record'", st2 === 502 && r2.error === "registry_unavailable");
    waDown = false;
    let last = 200;
    for (let i = 0; i < 32; i++) last = (await post(S.env, "/api/public/license-lookup", { state: "WA", license: "BAYRR*222" }, "10.9.9.9"))[0];
    ck("rate-limited per IP", last === 429);
  }

  console.log("\n-- the calculator's lead --");
  {
    mail.length = 0;
    const [st, r] = await post(S.env, "/api/public/leads", { email: "pm@flats.test", tool: "handyman_limits", state: "wa",
      detail: { jobValue: 800, jobType: "general", junk: "x".repeat(500) } });
    ck("the address is kept", st === 200 && r.ok);
    const lead = S.db.prepare("SELECT * FROM leads WHERE tool = 'handyman_limits'").get();
    ck("tagged by tool and state, with the question and nothing else", lead?.state === "WA"
      && JSON.stringify(JSON.parse(lead.detail)) === '{"jobValue":800,"jobType":"general"}', lead?.detail);
    const copy = mail.find((m) => (m.to === "pm@flats.test" || m.to?.[0] === "pm@flats.test"));
    ck("the visitor gets the answer the page drew", copy && /No — over the state's handyman limit/.test(copy.text)
      && /Not legal advice/.test(copy.text), copy?.text);
    const [st2] = await post(S.env, "/api/public/leads", { email: "pm@flats.test", tool: "spam" });
    ck("an unknown tool is refused", st2 === 400);
  }

  console.log("\n-- a database without 076 --");
  {
    const B = seed(false);
    const [st, r] = await post(B.env, "/api/public/license-lookup", { state: "WA", license: "BAYRR*222", email: "gc@build.test" });
    ck("the checker still answers", st === 200 && r.full?.active === true && r.leadSaved === false, JSON.stringify(r).slice(0, 200));
    const [st2, r2] = await post(B.env, "/api/public/leads", { email: "a@b.test", tool: "handyman_limits", state: "WA" });
    ck("and the lead route names the migration", st2 === 503 && r2.migration === "076_leads", JSON.stringify(r2));
  }
} catch (err) {
  console.error(err);
  fail++;
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
