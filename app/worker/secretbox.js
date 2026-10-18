// Credentials an account hands SubSub to reach its own systems, sealed at
// rest.
//
// Until CompanyCam, SubSub held no outside credential of an account's: the
// CRM door is a webhook precisely so nobody's CRM key is stored here. Reading
// a CompanyCam project needs the account's token, so that stops being true,
// and the token is stored ENCRYPTED: AES-GCM under INTEGRATION_SECRET_KEY,
// a Worker secret that is never in the database. A copy of the table is then
// ciphertext and nothing else -- the same reason api_tokens keeps a hash.
//
// The key may be any long random string; SHA-256 of it is the AES key, so
// nobody has to produce exactly 32 bytes of base64 on an iPad. Without it,
// connecting is refused by name (`not_configured`) rather than storing the
// token in the clear, which would be the one thing this file exists to stop.

const enc = new TextEncoder();
const dec = new TextDecoder();

const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const unb64 = (str) => Uint8Array.from(atob(str), (ch) => ch.charCodeAt(0));

export const sealingConfigured = (env) => String(env?.INTEGRATION_SECRET_KEY || "").length >= 16;

async function aesKey(env) {
  if (!sealingConfigured(env)) {
    const err = new Error("not_configured");
    err.code = "not_configured";
    throw err;
  }
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(String(env.INTEGRATION_SECRET_KEY)));
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

// "v1:<iv>:<ciphertext>", both base64. The version is there so a future key
// rotation can tell old rows from new ones without guessing.
export async function sealSecret(env, plaintext) {
  const key = await aesKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(String(plaintext))));
  return `v1:${b64(iv)}:${b64(ct)}`;
}

// Null for anything that does not open: a different key, a tampered row, an
// unknown version. The caller reads that as "not connected", never as a
// token, because a wrong key decrypting to garbage must not be sent anywhere.
export async function openSecret(env, sealed) {
  const parts = String(sealed || "").split(":");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  try {
    const key = await aesKey(env);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(parts[1]) }, key, unb64(parts[2]));
    return dec.decode(pt);
  } catch {
    return null;
  }
}
