// What a stored registration check says, read the same way everywhere.
//
// A check comes from three places and arrives in three shapes: Washington's
// open data (bond and insurance as the registry's own rows, with field names
// like bond_amount and insurance_company), a paid verifier (no bond or
// insurance at all), and the demo seed (bond and insurance already in the
// shape the screen draws). The screen was written against the third and was
// handed the first, so a real L&I check drew its bond as an empty amount from
// an unnamed surety. checkView is the one translation, applied when a check is
// stored and again when one is read, so rows written before it existed read
// correctly too.

const first = (o, keys) => {
  for (const k of keys) {
    const v = o?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return null;
};
const day = (v) => (v ? String(v).slice(0, 10) : null);
const num = (v) => {
  const n = Number(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && v !== null && v !== undefined && String(v).trim() !== "" ? n : null;
};

export function bondView(b) {
  if (!b || typeof b !== "object") return null;
  return {
    surety: first(b, ["surety", "surety_company", "suretycompany", "bond_company"]),
    number: first(b, ["number", "bond_number", "bondnumber", "bond_account_id"]),
    amount: num(first(b, ["amount", "bond_amount", "bondamount"])),
    expires: first(b, ["expires"]) ?? day(first(b, ["bond_expiration_date", "expiration_date"])),
  };
}

export function insuranceView(i) {
  if (!i || typeof i !== "object") return null;
  return {
    carrier: first(i, ["carrier", "insurance_company", "insurancecompany", "insurer"]),
    policy: first(i, ["policy", "policy_number", "policynumber", "insurance_policy_number"]),
    coverage: num(first(i, ["coverage", "coverage_amount", "coverageamount", "insurance_amount"])),
    expires: first(i, ["expires"]) ?? day(first(i, ["insurance_expiration_date", "expiration_date"])),
  };
}

// The stored check with bond and insurance in the screen's shape and the
// number it was asked about on it. Everything else passes through untouched.
export function checkView(check, licenseNumber) {
  if (!check || typeof check !== "object") return check ?? null;
  const out = { ...check };
  if ("bond" in check) out.bond = bondView(check.bond);
  if ("insurance" in check) out.insurance = insuranceView(check.insurance);
  if (!out.licenseNumber && licenseNumber) out.licenseNumber = licenseNumber;
  return out;
}

// The one rule for "this registration is good": found, ACTIVE, not suspended,
// not past its expiry. The pack page had its own copy reading a lower-case
// "active" that no registry sends, so a real L&I check never once read as
// verified there.
export function licenseActive(check, today = new Date().toISOString().slice(0, 10)) {
  if (!check?.found) return false;
  if (String(check.status || "").toUpperCase() !== "ACTIVE" || check.suspendDate) return false;
  return !check.expirationDate || String(check.expirationDate).slice(0, 10) >= today;
}

// Did the registry answer? A found record is an answer, and so is a clean
// "no such number". A call that failed, or a state nobody can check, is not:
// it says nothing about the contractor.
export const checkAnswered = (r) =>
  !!r && r.status !== "CHECK_FAILED" && r.status !== "UNSUPPORTED_STATE";

// What to store after a check. A failed check never overwrites a real answer:
// L&I being down for an evening is not news about anybody's registration, and
// storing it would turn every contractor on every roster unassignable until
// the next night. The last answer stays, with when the later attempt failed.
export function nextStoredCheck(prev, result, today = new Date().toISOString().slice(0, 10)) {
  const fresh = { ...result, checkedAt: result?.checkedAt || today };
  if (checkAnswered(result)) return { stored: fresh, kept: false };
  if (checkAnswered(prev) && (prev.found === true || prev.status === "NOT_FOUND")) {
    return { stored: { ...prev, lastFailedAt: today, lastFailure: result?.status || "CHECK_FAILED" }, kept: true };
  }
  return { stored: fresh, kept: false };
}

// When to remind a sub that their licence is running out: 30, 7 and 0 days.
// The expiry is the registry's own date off the stored check, never one the
// sub typed. Same shape as the certificate chase in shared/docs.js -- the
// closest milestone passed and not yet sent -- and one reminder at most after
// it has lapsed, because a licence expired last month is not news every night.
export const LICENSE_CHASE_AT = [30, 7, 0];

export function licenseReminderDue({ expiresOn, today, alreadySent = [] }) {
  const e = String(expiresOn || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e)) return null;
  const t = String(today).slice(0, 10);
  const days = Math.round((Date.UTC(+e.slice(0, 4), +e.slice(5, 7) - 1, +e.slice(8, 10))
    - Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10))) / 86400000);
  const due = days < 0 ? 0 : LICENSE_CHASE_AT.filter((d) => days <= d).sort((a, b) => a - b)[0];
  if (due === undefined) return null;
  return alreadySent.includes(due) ? null : due;
}
