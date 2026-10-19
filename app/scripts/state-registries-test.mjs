// The state registers SubSub reads directly (shared/stateregistries.js),
// against rows copied verbatim from the registers' own answers -- the
// "Probe license registries" workflow printed them, because nothing in the
// build container can reach a state portal. A fixture invented here would be
// a test of its own fixture, which is exactly how Washington's bond and
// insurance went unread for so long: its test fed the mapping the same wrong
// field names the mapping asked for.
//
//   node --no-warnings scripts/state-registries-test.mjs

import { REGISTRIES, REGISTRY_STATES, isoDay, lookUpLicense, cleanName } from "../shared/stateregistries.js";

let pass = 0, fail = 0;
const ck = (name, ok, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok" : "FAIL"}  ${name}${detail && !ok ? `  -- ${detail}` : ""}`); };
const TODAY = "2026-10-19";

// Real rows (data.wa.gov, data.oregon.gov, data.ct.gov, data.illinois.gov,
// data.texas.gov), as the probe printed them on 2026-10-19.
const WA_GENERAL = { businessname: "04 CONSTRUCTION LLC", contractorlicensenumber: "04CONCL862CR",
  contractorlicensetypecodedesc: "CONSTRUCTION CONTRACTOR", ubi: "603320569", contractorlicensestatus: "ACTIVE",
  licenseeffectivedate: "2014-02-19T00:00:00.000", licenseexpirationdate: "2028-03-03T00:00:00.000",
  primaryprincipalname: "Ochoa, Eric James" };
const WA_INS = [{ businessname: "04 CONSTRUCTION LLC", contractorlicensenumber: "04CONCL862CR", licensestatus: "A",
  insurancecompany: "Ohio Security Ins Co", insurancepolicyno: "BKS57134937", insuranceamt: "1000000.0000",
  effectivedate: "2021-06-08T00:00:00.000", expirationdate: "2027-06-08T00:00:00.000",
  createdate: "2021-06-01T00:00:00.000", insuranceagencyname: "AIC INSURE AMERICA LLC" }];
const WA_BOND = [
  { bondfirmname: "Western Surety Co", bondaccountid: "64857039", bondamt: "30000.0000",
    receivedbyl_i: "2026-02-11T00:00:00.000", bondeffectivedate: "2026-03-03T00:00:00.000", bondexpirationdate: "Until Canceled" },
  { bondfirmname: "Western Surety Co", bondaccountid: "64857039", bondamt: "12000.0000",
    receivedbyl_i: "2019-11-18T00:00:00.000", bondeffectivedate: "2019-11-07T00:00:00.000", bondexpirationdate: "03/03/2026" },
];
const OR_CCB = { license_number: "100215", license_type: "RGC", lic_exp_date: "02/06/2028", orig_regis_date: "06/20/1994",
  bond_company: "WESTERN SURETY COMPANY", bond_amount: "25000", bond_exp_date: "02/06/2028",
  ins_company: "SCOTTSDALE INSURANCE CO", ins_amount: "1000000", ins_exp_date: "08/25/2027",
  full_name: "BRUCE HUIE", city: "BROOKINGS", rmi_name: "BRUCE HUIE", endorsement_text: "Residential General Contractor" };
const OR_BCD = { licnbr: "C2213", lictype: "C-Electrical Contractor", full_name: "STEVES ELECTRIC LLC",
  lic_status: "Active", expiration_date: "7/1/2029" };
const CT_ACTIVE = { credentialid: "1001126", name: "ARETE CONSTRUCTION LLC", businessname: "ARETE CONSTRUCTION LLC",
  fullcredentialcode: "HIC.0631057", credentialtype: "HIC", credentialnumber: "631057", credential: "HOME IMPROVEMENT CONTRACTOR",
  status: "ACTIVE", statusreason: "CURRENT", active: "1", issuedate: "2011-06-07T00:00:00.000",
  expirationdate: "2027-03-31T00:00:00.000" };
const CT_INACTIVE = { ...CT_ACTIVE, businessname: "YARDY CONTRACTORS LLC", credentialnumber: "631082",
  status: "INACTIVE", statusreason: "EXPIRED MORE THAN 3 YEARS - MUST REAPPLY", expirationdate: "2023-03-31T00:00:00.000" };
const IL_ROOF = { license_type: "ROOFING CONTRACTOR", description: "LICENSED ROOFING CONTRACTOR", license_number: "104018690",
  license_status: "ACTIVE", business_name: "BOTT EXTERIORS LLC", effective_date: "10/10/2025", expiration_date: "12/31/2027",
  ever_disciplined: "N" };
const TX_19400 = [
  { license_type: "A/C Contractor", license_number: "19400", business_name: "COOL AIR LLC", owner_name: "SMITH, ANN",
    license_expiration_date_mmddccyy: "05/01/2027" },
  { license_type: "Electrical Contractor", license_number: "19400", business_name: "SPARK CO", owner_name: "DOE, JON",
    license_expiration_date_mmddccyy: "01/15/2026" },
  { license_type: "VSF Employee", license_number: "19400", business_name: "ROE, PAT" },
];

// A stub register: answers whichever URL shape it is handed.
const asked = [];
const stub = (routes) => async (url) => {
  asked.push(url);
  for (const [frag, rows] of routes) if (url.includes(frag)) return { ok: true, data: rows };
  return { ok: true, data: [] };
};

console.log("\n-- dates come in three spellings --");
ck("ISO", isoDay("2027-08-15T00:00:00.000") === "2027-08-15");
ck("mm/dd/yyyy", isoDay("02/06/2028") === "2028-02-06");
ck("m/d/yyyy", isoDay("7/1/2029") === "2029-07-01");
ck("'Until Canceled' is no expiry", isoDay("Until Canceled") === null);

console.log("\n-- Washington: the bond and insurance in force, read by their real names --");
{
  const r = await lookUpLicense("WA", " 04concl862cr ", stub([
    ["m8qx-ubtq", [WA_GENERAL]], ["ciwg-agsx", WA_INS], ["bzff-4fmt", WA_BOND]]), TODAY);
  ck("found and active", r.found && r.status === "ACTIVE", JSON.stringify(r));
  ck("the number is asked for in upper case", asked.some((u) => u.includes("contractorlicensenumber=04CONCL862CR")));
  ck("the insurance carrier, policy and amount are read", r.insurance?.carrier === "Ohio Security Ins Co"
    && r.insurance?.policy === "BKS57134937" && r.insurance?.coverage === 1000000 && r.insurance?.expires === "2027-06-08",
    JSON.stringify(r.insurance));
  ck("the bond is the one in force, not the expired one", r.bond?.amount === 30000 && r.bond?.expires === null,
    JSON.stringify(r.bond));
  ck("the bond number is read", r.bond?.number === "64857039");
  const old = await lookUpLicense("WA", "04CONCL862CR", stub([
    ["m8qx-ubtq", [WA_GENERAL]], ["bzff-4fmt", [WA_BOND[1]]]]), TODAY);
  ck("an expired bond is no bond", old.bond === null, JSON.stringify(old.bond));
}

console.log("\n-- Oregon: the shape of the number picks the board --");
{
  asked.length = 0;
  const ccb = await lookUpLicense("OR", "CCB #100215", stub([["g77e-6bhs", [OR_CCB]]]), TODAY);
  ck("a plain number asks the CCB", asked.every((u) => u.includes("g77e-6bhs")) && asked.some((u) => u.includes("license_number=100215")));
  ck("and reads its bond and insurance", ccb.found && ccb.bond?.surety === "WESTERN SURETY COMPANY" && ccb.bond?.amount === 25000
    && ccb.insurance?.coverage === 1000000 && ccb.expirationDate === "2028-02-06", JSON.stringify(ccb));
  asked.length = 0;
  const bcd = await lookUpLicense("OR", "c2213", stub([["vhbr-cuaq", [OR_BCD]]]), TODAY);
  ck("a lettered number asks Building Codes", asked.every((u) => u.includes("vhbr-cuaq")) && asked.some((u) => u.includes("licnbr=C2213")));
  ck("and reads its status", bcd.found && bcd.status === "ACTIVE" && bcd.expirationDate === "2029-07-01", JSON.stringify(bcd));
  const none = await lookUpLicense("OR", "999999", stub([]), TODAY);
  ck("a number missing from the active list is not found", none.status === "NOT_FOUND");
}

console.log("\n-- Connecticut: HIC.0631057 is 631057 --");
{
  asked.length = 0;
  const r = await lookUpLicense("CT", "HIC.0631057", stub([["5r9m-qgni", [CT_ACTIVE]]]), TODAY);
  ck("the prefix and the zero come off", asked.some((u) => u.includes("credentialnumber=631057")), asked.join(" "));
  ck("active", r.found && r.status === "ACTIVE" && r.expirationDate === "2027-03-31");
  const gone = await lookUpLicense("CT", "631082", stub([["5r9m-qgni", [CT_INACTIVE]]]), TODAY);
  ck("an inactive registration says so, with the reason", gone.found && gone.status === "INACTIVE"
    && /REAPPLY/.test(gone.statusReason));
}

console.log("\n-- Illinois: only roofing contractors --");
{
  asked.length = 0;
  const r = await lookUpLicense("IL", "104.018690", stub([["pzzh-kp68", [IL_ROOF]]]), TODAY);
  ck("the query is pinned to roofing contractors", asked.some((u) => decodeURIComponent(u).includes("license_type='ROOFING CONTRACTOR'")
    && decodeURIComponent(u).includes("license_number='104018690'")), asked.join(" "));
  ck("found", r.found && r.status === "ACTIVE" && r.businessName === "BOTT EXTERIORS LLC");
  ck("Illinois and Texas offer no name search (their registers time out)", !REGISTRIES.IL.nameSearch && !REGISTRIES.TX.nameSearch);
}

console.log("\n-- Texas: the prefix says which licence --");
{
  const tx = stub([["7358-krk7", TX_19400]]);
  const ac = await lookUpLicense("TX", "TACLA00019400C", tx, TODAY);
  ck("TACLA is the A/C contractor", ac.found && ac.licenseType === "A/C Contractor" && ac.businessName === "COOL AIR LLC", JSON.stringify(ac));
  ck("its status comes from the expiry", ac.status === "ACTIVE" && ac.statusFromExpiry === true);
  const el = await lookUpLicense("TX", "TECL19400", tx, TODAY);
  ck("TECL is the electrical contractor", el.found && el.licenseType === "Electrical Contractor");
  ck("and a licence past its expiry is EXPIRED", el.status === "EXPIRED", el.status);
  const bare = await lookUpLicense("TX", "19400", tx, TODAY);
  ck("a bare number held by two contractors is not picked between", !bare.found && bare.status === "CHECK_FAILED"
    && /TACLA or TECL/.test(bare.error), JSON.stringify(bare));
}

console.log("\n-- the shape every caller relies on --");
{
  const down = await lookUpLicense("WA", "X", async () => ({ ok: false, error: "HTTP 503" }), TODAY);
  ck("a register that does not answer is a failed check, never not-found", down.status === "CHECK_FAILED");
  ck("five registers", REGISTRY_STATES.join(",") === "WA,OR,CT,IL,TX", REGISTRY_STATES.join(","));
  ck("a typed name cannot break the query", cleanName("O'Brien%_") === "O''BRIEN");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
