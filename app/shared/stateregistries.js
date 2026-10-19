// The state licence registries SubSub reads directly, and how to read each one.
//
// EVERY FIELD NAME HERE WAS READ OFF THE REGISTRY'S OWN RESPONSE, not off a
// search result. The build container cannot reach any state portal, so
// scripts/probe-license-sources.mjs runs from a GitHub runner (the "Probe
// license registries" workflow) and prints each dataset's columns, sample rows,
// and the answer to the exact URLs built below. The first probe found that only
// one of the six wired mappings had its field names right -- and that even
// Washington's, the one marked verified, read its bond and insurance through
// names the dataset does not have, so the bond shown could be one canceled
// years ago. A mapping is only as good as the last time somebody looked at a
// real row, which is why the probe is a button rather than a memory.
//
// Pure: URLs out, rows in. The Worker does the fetching (worker/index.js), so
// this file can be tested against the rows the probe returned.

// "2027-08-15T00:00:00.000", "02/06/2028" and "7/1/2029" are all one day.
// "Until Canceled" (a WA bond) is no expiry at all, which is null here.
export function isoDay(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

const num = (v) => {
  const n = Number(String(v ?? "").replace(/[$,\s]/g, ""));
  return String(v ?? "").trim() !== "" && Number.isFinite(n) ? n : null;
};
const today0 = () => new Date().toISOString().slice(0, 10);
const q = (v) => String(v).replace(/'/g, "''");

// The newest row still in force: not canceled, not expired. A row with no
// expiry (or "Until Canceled") is in force until canceled.
function current(rows, { cancel, expires, effective }, today) {
  return (rows || [])
    .filter((r) => !isoDay(r[cancel]))
    .filter((r) => { const e = isoDay(r[expires]); return !e || e >= today; })
    .sort((a, b) => String(isoDay(b[effective]) || "").localeCompare(String(isoDay(a[effective]) || "")))[0] || null;
}

const soda = (base, id, params) => `${base}/${id}.json?${params}`;
const eq = (field, v) => `${field}=${encodeURIComponent(v)}`;
const where = (w) => `$where=${encodeURIComponent(w)}`;

export const REGISTRIES = {
  WA: {
    label: "Washington State L&I",
    base: "https://data.wa.gov/resource",
    normalize: (n) => String(n).trim().toUpperCase(),
    lookups(n) {
      const b = this.base;
      return {
        general: soda(b, "m8qx-ubtq", eq("contractorlicensenumber", n)),
        insurance: soda(b, "ciwg-agsx", eq("contractorlicensenumber", n)),
        bond: soda(b, "bzff-4fmt", eq("contractorlicensenumber", n)),
      };
    },
    map(rows, today = today0()) {
      const lic = rows.general?.[0];
      if (!lic) return null;
      const ins = current(rows.insurance, { cancel: "canceldate", expires: "expirationdate", effective: "effectivedate" }, today);
      const bond = current(rows.bond, { cancel: "bondcanceldate", expires: "bondexpirationdate", effective: "bondeffectivedate" }, today);
      return {
        businessName: lic.businessname, status: lic.contractorlicensestatus,
        licenseType: lic.contractorlicensetypecodedesc, ubi: lic.ubi,
        effectiveDate: isoDay(lic.licenseeffectivedate), expirationDate: isoDay(lic.licenseexpirationdate),
        suspendDate: isoDay(lic.contractorlicensesuspenddate), principal: lic.primaryprincipalname || null,
        insurance: ins ? { carrier: ins.insurancecompany || null, policy: ins.insurancepolicyno || null,
          coverage: num(ins.insuranceamt), expires: isoDay(ins.expirationdate) } : null,
        bond: bond ? { surety: bond.bondfirmname || null, number: bond.bondaccountid || null,
          amount: num(bond.bondamt), expires: isoDay(bond.bondexpirationdate) } : null,
      };
    },
    nameSearch(name) {
      return soda(this.base, "m8qx-ubtq", `${where(`upper(businessname) like '%${name}%'`)}&$order=businessname`);
    },
    nameRow: (r) => ({ businessName: r.businessname || null, licenseNumber: r.contractorlicensenumber || null, city: r.city || null }),
  },

  // Two boards. The Construction Contractors Board licenses contractors by a
  // plain number; Building Codes Division licenses electricians, plumbers and
  // their businesses with a letter prefix ("C-1234", "PB123"). The shape of the
  // number decides which one is asked. The CCB dataset is ACTIVE licences only,
  // so a number missing from it is not a licence in force.
  OR: {
    label: "Oregon CCB and Building Codes Division",
    base: "https://data.oregon.gov/resource",
    normalize: (n) => String(n).trim().toUpperCase().replace(/^CCB\s*#?\s*/, ""),
    lookups(n) {
      return /^\d+$/.test(n)
        ? { ccb: soda(this.base, "g77e-6bhs", eq("license_number", n)) }
        : { bcd: soda(this.base, "vhbr-cuaq", eq("licnbr", n)) };
    },
    map(rows) {
      const c = rows.ccb?.[0];
      if (c) {
        return {
          businessName: c.full_name, status: "ACTIVE", activeOnlyDataset: true,
          licenseType: c.endorsement_text || c.license_type,
          effectiveDate: isoDay(c.orig_regis_date), expirationDate: isoDay(c.lic_exp_date),
          suspendDate: null, principal: c.rmi_name || null,
          insurance: c.ins_company ? { carrier: c.ins_company, policy: null, coverage: num(c.ins_amount), expires: isoDay(c.ins_exp_date) } : null,
          bond: c.bond_company ? { surety: c.bond_company, number: null, amount: num(c.bond_amount), expires: isoDay(c.bond_exp_date) } : null,
        };
      }
      const b = rows.bcd?.[0];
      if (!b) return null;
      return {
        businessName: b.dba ? `${b.full_name} (${b.dba})` : b.full_name,
        status: String(b.lic_status || "").toUpperCase(), activeOnlyDataset: true,
        licenseType: b.lictype, effectiveDate: null, expirationDate: isoDay(b.expiration_date),
        suspendDate: null, principal: null, insurance: null, bond: null,
      };
    },
    nameSearch(name) {
      return soda(this.base, "g77e-6bhs", `${where(`upper(full_name) like '%${name}%'`)}&$order=full_name`);
    },
    nameRow: (r) => ({ businessName: r.full_name || null, licenseNumber: r.license_number || null, city: r.city || null }),
  },

  // Home Improvement Contractor registrations, active and inactive. People
  // quote the number as "HIC.0631057"; the register stores 631057.
  CT: {
    label: "Connecticut Department of Consumer Protection",
    base: "https://data.ct.gov/resource",
    normalize: (n) => String(n).trim().toUpperCase().replace(/^[A-Z]+[.\s-]*/, "").replace(/^0+(?=\d)/, ""),
    lookups(n) { return { general: soda(this.base, "5r9m-qgni", eq("credentialnumber", n)) }; },
    map(rows) {
      const r = (rows.general || []).find((x) => String(x.credentialtype || "").toUpperCase() === "HIC") || rows.general?.[0];
      if (!r) return null;
      return {
        businessName: r.businessname || r.name, status: String(r.status || "").toUpperCase(),
        statusReason: r.statusreason || null, licenseType: r.credential || "Home Improvement Contractor",
        effectiveDate: isoDay(r.issuedate), expirationDate: isoDay(r.expirationdate),
        suspendDate: null, principal: null, insurance: null, bond: null,
      };
    },
    nameSearch(name) {
      return soda(this.base, "5r9m-qgni", `${where(`upper(businessname) like '%${name}%'`)}&$order=businessname`);
    },
    nameRow: (r) => ({ businessName: r.businessname || r.name || null, licenseNumber: r.credentialnumber || null, city: r.city || null }),
  },

  // Illinois licenses one construction trade statewide: roofing. The dataset
  // is every profession IDFPR licenses, so the lookup is pinned to roofing
  // contractors -- a nurse's number must not come back as a contractor.
  IL: {
    label: "Illinois IDFPR (roofing contractors)",
    base: "https://data.illinois.gov/resource",
    normalize: (n) => String(n).trim().toUpperCase().replace(/[^0-9A-Z]/g, ""),
    lookups(n) {
      return { general: soda(this.base, "pzzh-kp68",
        where(`license_type='ROOFING CONTRACTOR' AND license_number='${q(n)}'`)) };
    },
    map(rows) {
      const r = rows.general?.[0];
      if (!r) return null;
      const person = [r.first_name, r.last_name].filter(Boolean).join(" ");
      return {
        businessName: r.business_name || person || null, status: String(r.license_status || "").toUpperCase(),
        licenseType: r.description || "Roofing Contractor",
        effectiveDate: isoDay(r.effective_date || r.original_issue_date), expirationDate: isoDay(r.expiration_date),
        suspendDate: null, principal: person || null, insurance: null, bond: null,
        everDisciplined: r.ever_disciplined === "Y",
      };
    },
    nameSearch: null,
  },

  // TDLR licenses trades (electrical, A/C, elevators), not general
  // contractors. The register carries no status column, so the status is the
  // expiry read against today -- a fact, not a guess. Numbers repeat across
  // licence types; a contractor licence wins, and two that still collide are
  // reported as a check that could not settle rather than picked between.
  TX: {
    label: "Texas TDLR (trade licenses)",
    base: "https://data.texas.gov/resource",
    normalize: (n) => String(n).trim().toUpperCase().replace(/^(TACLA|TACLB|TECL|ECL)/, "").replace(/[A-Z]$/, "").replace(/^0+(?=\d)/, ""),
    lookups(n) { return { general: soda(this.base, "7358-krk7", eq("license_number", n)) }; },
    map(rows, today = today0()) {
      const all = rows.general || [];
      if (!all.length) return null;
      const contractors = all.filter((r) => /contractor/i.test(r.license_type || ""));
      const pool = contractors.length ? contractors : all.filter((r) => !/apprentice|CE Provider|apprenticeship/i.test(r.license_type || ""));
      if (pool.length !== 1) return { ambiguous: true, types: all.map((r) => r.license_type) };
      const r = pool[0];
      const exp = isoDay(r.license_expiration_date_mmddccyy);
      return {
        businessName: r.business_name || r.owner_name, status: exp && exp >= today ? "ACTIVE" : "EXPIRED",
        statusFromExpiry: true, licenseType: r.license_type, effectiveDate: null, expirationDate: exp,
        suspendDate: null, principal: r.owner_name || null, insurance: null, bond: null,
      };
    },
    nameSearch: null,
  },
};

export const REGISTRY_STATES = Object.keys(REGISTRIES);

// A name typed into a search: upper case, quotes doubled, wildcards removed.
export const cleanName = (name) => q(String(name).toUpperCase()).replace(/[%_]/g, "");
