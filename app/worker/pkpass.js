// A signed Apple Wallet pass (.pkpass): a zip of pass.json, the images, a
// manifest of every file's SHA-1, and a detached PKCS#7 signature over that
// manifest made with the Pass Type ID certificate.
//
// The signature is built the way passkit-generator 3.5.0 builds it (its
// Signature.js, read rather than recalled): SignedData over the manifest bytes,
// Apple's WWDR intermediate and the signer certificate both included, SHA-1
// digest, and the contentType / messageDigest / signingTime authenticated
// attributes, detached, DER. node-forge does the ASN.1 because a Worker has no
// PKCS#7 of its own; it falls back to WebCrypto for randomness and never reaches
// for Node's crypto here (its isNodejs test is false on Workers).
import forge from "node-forge";
import { zipSync } from "fflate";

const enc = new TextEncoder();

// A PEM pasted into a dashboard arrives in several shapes: literal "\n" pairs,
// spaces where the line breaks were, or as it should be. Each is put back into
// the one shape the parser reads. Anything without BEGIN/END is returned as is
// and fails to parse, by name, below.
export function normalizePem(raw) {
  let s = String(raw || "").replace(/\\n/g, "\n").replace(/\r/g, "").trim();
  const m = /^(-----BEGIN [A-Z0-9 ]+-----)([\s\S]*?)(-----END [A-Z0-9 ]+-----)$/.exec(s);
  if (!m) return s;
  const head = m[2].trim();
  // Encrypted PKCS#1 keys carry "Proc-Type:" / "DEK-Info:" header lines that
  // must keep their own lines; everything else is base64 and may be rewrapped.
  const lines = head.split("\n").map((l) => l.trim()).filter(Boolean);
  const headers = lines.filter((l) => /^[A-Za-z-]+:/.test(l));
  const body = lines.filter((l) => !/^[A-Za-z-]+:/.test(l)).join("").replace(/\s+/g, "");
  const wrapped = body.match(/.{1,64}/g) || [];
  return [m[1], ...headers, ...(headers.length ? [""] : []), ...wrapped, m[3]].join("\n");
}

async function sha1Hex(bytes) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-1", bytes));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const toBinary = (u8) => {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return s;
};
const fromBinary = (s) => Uint8Array.from(s, (ch) => ch.charCodeAt(0) & 0xff);

// The certificate, its key and the intermediate, read once per call. A bad
// secret is reported by which one it is, because "the pass could not be
// signed" sends somebody to check five settings when one is wrong.
export function readSigner(env) {
  let cert, wwdr, key;
  try { cert = forge.pki.certificateFromPem(normalizePem(env.APPLE_PASS_CERT)); }
  catch { return { error: "bad_pass_cert" }; }
  try { wwdr = forge.pki.certificateFromPem(normalizePem(env.APPLE_WWDR_CERT)); }
  catch { return { error: "bad_wwdr_cert" }; }
  try {
    const pem = normalizePem(env.APPLE_PASS_KEY);
    const pass = String(env.APPLE_PASS_KEY_PASSPHRASE || "");
    key = pass ? forge.pki.decryptRsaPrivateKey(pem, pass) : forge.pki.privateKeyFromPem(pem);
  } catch { key = null; }
  if (!key) return { error: "bad_pass_key" };
  // The key must be the certificate's, or every pass is refused by the phone
  // with nothing on our side looking wrong.
  if (cert.publicKey.n.compareTo(key.n) !== 0) return { error: "key_does_not_match_cert" };
  return { cert, wwdr, key };
}

export function signManifest(signer, manifestBytes, when = new Date()) {
  const p7 = forge.pkcs7.createSignedData();
  p7.content = new forge.util.ByteStringBuffer(toBinary(manifestBytes));
  p7.addCertificate(signer.wwdr);
  p7.addCertificate(signer.cert);
  p7.addSigner({
    key: signer.key,
    certificate: signer.cert,
    digestAlgorithm: forge.pki.oids.sha1,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: when },
    ],
  });
  p7.sign({ detached: true });
  return fromBinary(forge.asn1.toDer(p7.toAsn1()).getBytes());
}

// files: { name: Uint8Array }, pass.json among them. Returns the .pkpass bytes.
export async function buildPkpass(signer, files) {
  const manifest = {};
  for (const [name, bytes] of Object.entries(files)) manifest[name] = await sha1Hex(bytes);
  const manifestBytes = enc.encode(JSON.stringify(manifest));
  const signature = signManifest(signer, manifestBytes);
  return zipSync({ ...files, "manifest.json": manifestBytes, signature }, { level: 6 });
}
