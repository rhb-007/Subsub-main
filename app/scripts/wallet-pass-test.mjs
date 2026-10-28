// THE PASSPORT AS AN APPLE WALLET CARD, through the real Worker, with the
// signature checked by openssl rather than by the code that made it.
//
// What is pinned is what a later pass would undo, or get wrong quietly:
//
//   THE CARD CARRIES NO STATUS. No "Verified", no license or insurance state,
//   no expiry: a pass sits on a phone for years and a printed claim outlives
//   the facts behind it. The QR code opens the live Passport instead.
//
//   THE SIGNATURE IS REAL. A .pkpass whose signature does not verify is
//   refused by the phone with nothing on our side looking wrong, so openssl
//   verifies the detached PKCS#7 against the manifest and the test chain, and
//   every file's SHA-1 is checked against the manifest.
//
//   MEMBER SINCE IS THE EARLIEST DATE THE COMPANY WAS HERE, the same rule
//   overflow's three-months bar reads.
//
//   ONLY A PUBLISHED PASSPORT, AND ONLY WHEN SIGNING IS SET UP. A wrong
//   setting is named (which one), never its value.
//
//   node --no-warnings scripts/wallet-pass-test.mjs

import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { memberSinceText, earliestDay, tradesText, walletPassJson, walletConfigured,
  WALLET_SETTINGS } from "../shared/walletpass.js";
import { normalizePem } from "../worker/pkpass.js";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

// ---- a test chain: a CA standing in for Apple's WWDR, a pass certificate it
// signed, and a second key that is not that certificate's -----------------------
const dir = mkdtempSync(join(tmpdir(), "wallet-"));
const ossl = (...args) => execFileSync("openssl", args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
ossl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca.key", "-out", "ca.pem", "-days", "30",
  "-subj", "/CN=Test WWDR");
ossl("req", "-newkey", "rsa:2048", "-nodes", "-keyout", "pass.key", "-out", "pass.csr",
  "-subj", "/UID=pass.work.subsub.passport/CN=Pass Type ID: pass.work.subsub.passport/OU=TEAM123/O=SubSub");
ossl("x509", "-req", "-in", "pass.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial",
  "-out", "pass.pem", "-days", "30");
ossl("genrsa", "-out", "other.key", "2048");
// The same key, encrypted the way an exported .p12 often leaves it.
ossl("rsa", "-in", "pass.key", "-aes256", "-traditional", "-passout", "pass:hunter2", "-out", "pass-enc.key");
const read = (f) => readFileSync(join(dir, f), "utf8");
const KEYS = { APPLE_PASS_TYPE_ID: "pass.work.subsub.passport", APPLE_TEAM_ID: "TEAM123",
  APPLE_PASS_CERT: read("pass.pem"), APPLE_PASS_KEY: read("pass.key"), APPLE_WWDR_CERT: read("ca.pem") };

// ---- the rules, on their own ---------------------------------------------------
console.log("\nthe rules");
ck("member since reads a timestamp as a month and year", memberSinceText("2026-03-05 10:00:00") === "Mar 2026");
ck("and an ISO one", memberSinceText("2024-12-31T23:59:00.000Z") === "Dec 2024");
ck("never through Date, so no timezone moves it", memberSinceText("2025-01-01T00:00:00.000Z") === "Jan 2025");
ck("garbage is nothing, not Invalid Date", memberSinceText("soon") === null && memberSinceText(null) === null);
ck("earliest of ISO and CURRENT_TIMESTAMP text, by day",
  earliestDay("2025-06-01T09:00:00.000Z", "2025-06-01 08:00:00", "2026-01-01") === "2025-06-01");
ck("a blank date is skipped", earliestDay(null, "", "2026-02-02 00:00:00") === "2026-02-02");
ck("nothing at all is null", earliestDay(null, undefined) === null);
ck("three trades and a count", tradesText(["A", "B", "C", "D", "E"]) === "A, B, C +2 more");
ck("no trades is no field", tradesText([]) === null);
ck("five settings make it configured", walletConfigured(KEYS) && WALLET_SETTINGS.length === 5);
ck("four do not", !walletConfigured({ ...KEYS, APPLE_WWDR_CERT: " " }));

const view = { slug: "bay-roofing-abcde", name: "Bay Roofing", city: "Tacoma", state: "WA",
  trades: [{ id: "roofing", label: "Roofing" }], years: "12 years", contact: "Rae Bay", contactTitle: "Owner",
  phone: "2065550100", email: null, license: { number: "BAYROR*123", text: "Washington L&I registration active", ok: true },
  insurance: { carrier: "Acme", expiresOn: "2027-01-01", text: "Insurance on file through Jan 1, 2027" },
  badge: { verified: true, name: "SubSub Verified", line: "..." } };
const pj = walletPassJson({ view, companyId: "cmp_bay", memberSince: "2024-02-10", passTypeId: "p", teamId: "t" });
const front = JSON.stringify([pj.generic.headerFields, pj.generic.primaryFields, pj.generic.secondaryFields,
  pj.generic.auxiliaryFields]);
const all = JSON.stringify(pj);
ck("the card says who and since when", /Bay Roofing/.test(front) && /Feb 2024/.test(front) && /Tacoma, WA/.test(front));
ck("and carries no verdict anywhere on it", !/Verified|active|through|ACTIVE|expire/i.test(front), front);
ck("the back carries no license status either, only the number",
  /BAYROR\*123/.test(all) && !/registration active|Insurance on file/.test(all));
ck("the QR code is the live Passport", pj.barcodes[0].message === "https://app.subsub.work/p/bay-roofing-abcde"
  && pj.barcodes[0].format === "PKBarcodeFormatQR");
ck("the serial is the company, so adding it twice replaces it", pj.serialNumber === "passport-cmp_bay");
ck("an empty field is left off rather than drawn blank", !pj.generic.backFields.some((f) => f.key === "ubi"));
ck("the card carries no contact, phone or email, even when the view does", !/Rae Bay|2065550100/.test(JSON.stringify(pj)));
ck("colors are Apple's rgb() form", /^rgb\(\d+, \d+, \d+\)$/.test(pj.backgroundColor));
ck("a PEM pasted with \\n pairs is put back",
  normalizePem(KEYS.APPLE_PASS_CERT.replace(/\n/g, "\\n")) === KEYS.APPLE_PASS_CERT.trim());
ck("and one pasted with spaces for line breaks",
  normalizePem(KEYS.APPLE_PASS_CERT.replace(/\n/g, " ")) === KEYS.APPLE_PASS_CERT.trim());

// ---- through the Worker --------------------------------------------------------
const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
globalThis.fetch = async () => new Response("{}");

const db = freshDb({ base: SCHEMA, migrations: [] });
db.exec(`
  INSERT INTO accounts(id,name,subdomain,kind,plan,created_at) VALUES
    ('acc_gc','Outerhome','outerhome','general_contractor','scale','2023-01-01 00:00:00'),
    ('acc_sub','Bay Roofing','bayroof','subcontractor','basic','2025-06-01 00:00:00');
  INSERT INTO companies(id,company,contact,email,phone,city,state,license,created_at) VALUES
    ('cmp_bay','Bay Roofing','Rae Bay','rae@bay.test','2065550100','Tacoma','WA','BAYROR*123','2026-01-01 00:00:00');
  UPDATE accounts SET company_id = 'cmp_bay' WHERE id = 'acc_sub';
  INSERT INTO engagements(id,account_id,company_id,status,categories,invited_at) VALUES
    ('en_bay','acc_gc','cmp_bay','active','["roofing"]','2024-02-10T15:00:00.000Z');
  INSERT INTO users(id,name,email) VALUES ('u_sub','Rae Bay','rae@bay.test');
  INSERT INTO memberships(id,user_id,account_id,role,company_id) VALUES ('m_sub','u_sub','acc_sub','admin',NULL);
`);
const base = { DB: makeD1(db), FILES: { get: async () => null, head: async () => null, put: async () => {} } };
let ip = 0;
const call = (env, path, auth = false) => worker.fetch(new Request(`https://api.subsub.work${path}`, {
  headers: { "CF-Connecting-IP": `10.0.0.${++ip % 250}`, ...(auth ? { "X-User-Id": "u_sub", "X-Account-Id": "acc_sub" } : {}) },
}), env);

console.log("\nnot set up");
let r = await call(base, "/api/my-passport", true);
const mine = await r.json();
const SLUG = mine.passport?.slug;
ck("the sub's tab is told there is no card to offer", r.status === 200 && mine.wallet === false, JSON.stringify(mine.wallet));
r = await call(base, `/api/public/passport/${SLUG}/wallet.pkpass`);
ck("and the route says so by name", r.status === 503 && (await r.json()).error === "wallet_not_configured");

console.log("\nset up");
const env = { ...base, ...KEYS };
r = await call(env, "/api/my-passport", true);
ck("the tab is told the button can work", (await r.json()).wallet === true);
r = await call(env, `/api/public/passport/${SLUG}/wallet.pkpass`);
ck("a published Passport gets a pass", r.status === 200, String(r.status));
ck("served as a pkpass", r.headers.get("content-type") === "application/vnd.apple.pkpass");
ck("and noindex, like the page", r.headers.get("x-robots-tag") === "noindex");
const zip = unzipSync(new Uint8Array(await r.arrayBuffer()));
const names = Object.keys(zip).sort();
ck("the zip holds the pass, the images, the manifest and the signature",
  ["icon.png", "icon@2x.png", "icon@3x.png", "logo.png", "manifest.json", "pass.json", "signature"]
    .every((n) => names.includes(n)), names.join(","));
const manifest = JSON.parse(strFromU8(zip["manifest.json"]));
const shaOk = names.filter((n) => n !== "manifest.json" && n !== "signature")
  .every((n) => manifest[n] === createHash("sha1").update(zip[n]).digest("hex"));
ck("every file's SHA-1 is in the manifest and matches", shaOk && !("signature" in manifest));
writeFileSync(join(dir, "manifest.json"), zip["manifest.json"]);
writeFileSync(join(dir, "signature"), zip.signature);
let verified = false, why = "";
try {
  ossl("smime", "-verify", "-binary", "-inform", "DER", "-in", "signature", "-content", "manifest.json",
    "-CAfile", "ca.pem", "-purpose", "any", "-out", "/dev/null");
  verified = true;
} catch (e) { why = String(e.stderr || e.message).slice(0, 300); }
ck("openssl verifies the signature against the manifest and the chain", verified, why);
const certs = ossl("pkcs7", "-inform", "DER", "-in", "signature", "-print_certs").toString();
// Counted, not searched for: the pass certificate names the WWDR one as its
// issuer, so a search for its name passes with the WWDR certificate missing.
ck("both the pass certificate and the WWDR one ride in it",
  (certs.match(/-----BEGIN CERTIFICATE-----/g) || []).length === 2 && /subject=.*Test WWDR/.test(certs), certs.slice(0, 200));
const asn = ossl("cms", "-cmsout", "-print", "-inform", "DER", "-in", "signature").toString();
ck("signed with SHA-1, as Wallet expects", /digestAlgorithm:\s*\n\s*algorithm: sha1/.test(asn));
ck("and detached: the manifest is not inside it", /eContent: <ABSENT>/.test(asn));
const p = JSON.parse(strFromU8(zip["pass.json"]));
ck("the pass names the type and team it was signed for",
  p.passTypeIdentifier === "pass.work.subsub.passport" && p.teamIdentifier === "TEAM123");
ck("member since is the first engagement, earlier than their own account",
  p.generic.headerFields[0]?.value === "Feb 2024", JSON.stringify(p.generic.headerFields));
ck("the QR code opens this Passport", p.barcodes[0].message === `https://app.subsub.work/p/${SLUG}`);

console.log("\nrefusals");
r = await call(env, "/api/public/passport/bay-roofing-zzzzz/wallet.pkpass");
ck("an unknown Passport is not found", r.status === 404);
db.prepare(`UPDATE passports SET published_at = NULL WHERE slug = ?`).run(SLUG);
r = await call(env, `/api/public/passport/${SLUG}/wallet.pkpass`);
ck("a Passport taken down gives no card", r.status === 404);
db.prepare(`UPDATE passports SET published_at = CURRENT_TIMESTAMP WHERE slug = ?`).run(SLUG);
r = await call({ ...env, APPLE_PASS_KEY: read("other.key") }, `/api/public/passport/${SLUG}/wallet.pkpass`);
let body = await r.json().catch(() => ({ status: r.status }));
ck("a key that is not the certificate's is named", r.status === 503 && body.detail === "key_does_not_match_cert", JSON.stringify(body));
ck("and no setting's value is in the reply", !JSON.stringify(body).includes("BEGIN"));
r = await call({ ...env, APPLE_WWDR_CERT: "not a cert" }, `/api/public/passport/${SLUG}/wallet.pkpass`);
ck("a bad WWDR certificate is named", (await r.json().catch(() => ({}))).detail === "bad_wwdr_cert");
r = await call({ ...env, APPLE_PASS_KEY: read("pass-enc.key") }, `/api/public/passport/${SLUG}/wallet.pkpass`);
ck("an encrypted key with no passphrase is named", (await r.json().catch(() => ({}))).detail === "bad_pass_key");
r = await call({ ...env, APPLE_PASS_KEY: read("pass-enc.key"), APPLE_PASS_KEY_PASSPHRASE: "hunter2" },
  `/api/public/passport/${SLUG}/wallet.pkpass`);
ck("and with its passphrase it signs", r.status === 200);
r = await call({ ...env, APPLE_PASS_CERT: KEYS.APPLE_PASS_CERT.replace(/\n/g, "\\n") },
  `/api/public/passport/${SLUG}/wallet.pkpass`);
ck("a certificate pasted with \\n pairs still signs", r.status === 200);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
