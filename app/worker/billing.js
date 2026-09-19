// Stripe, over plain fetch.
//
// Stripe's own SDK wants Node's crypto and http; a Worker has neither, so the
// three things we actually need -- a form-encoded POST, a webhook signature
// check, and a couple of reads -- are done directly against the REST API.
// That is less code than shimming the SDK, and the request shapes are stable.
//
// Stripe is the source of truth for money. Nothing here decides what somebody
// owes; it asks Stripe to decide and records the answer.

const API = "https://api.stripe.com/v1";

// Stripe takes form encoding, including for nested params: a[b][c]=1.
function encode(params, prefix = "", out = []) {
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object" && !Array.isArray(v)) encode(v, key, out);
    else if (Array.isArray(v)) v.forEach((item, i) => {
      if (typeof item === "object") encode(item, `${key}[${i}]`, out);
      else out.push(`${key}[${i}]=${encodeURIComponent(item)}`);
    });
    else out.push(`${key}=${encodeURIComponent(v)}`);
  }
  return out;
}

export async function stripeCall(env, path, { method = "POST", params, idempotencyKey } = {}) {
  if (!env.STRIPE_SECRET_KEY) throw new Error("stripe_not_configured");

  const headers = {
    Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  // Stripe deduplicates retries of the same key for 24 hours, which is what
  // stops a double-tapped upgrade button becoming two subscriptions.
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  const body = params ? encode(params).join("&") : undefined;
  const res = await fetch(`${API}${path}`, { method, headers, body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json?.error?.message || `stripe_${res.status}`);
    err.stripeCode = json?.error?.code;
    err.status = res.status;
    throw err;
  }
  return json;
}

// Constant-time compare. A webhook signature check that leaks timing is a
// theoretical problem here rather than a practical one, but the fix is three
// lines and the alternative is explaining why it was fine.
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Verifies Stripe's `Stripe-Signature` header against the raw request body.
// The body must be the exact bytes Stripe sent -- parse it only after this
// passes, because re-serialising JSON changes it and the signature is over
// the original.
//
// Returns the parsed event, or null. Null means "did not come from Stripe",
// and the caller must answer with a 400 rather than acting on it: this
// endpoint is unauthenticated and moves people between plans.
export async function verifyStripeWebhook(rawBody, signatureHeader, secret, toleranceSeconds = 300) {
  if (!signatureHeader || !secret) return null;

  const parts = Object.fromEntries(
    signatureHeader.split(",").map((p) => p.split("=", 2)).filter((p) => p.length === 2)
  );
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return null;

  // Replay window. Without this a captured webhook stays valid forever.
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > toleranceSeconds) return null;

  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const mac = await crypto.subtle.sign(
    "HMAC", key, new TextEncoder().encode(`${timestamp}.${rawBody}`)
  );
  const expected = Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");

  if (!safeEqual(expected, signature)) return null;
  try { return JSON.parse(rawBody); } catch { return null; }
}

// Which price a plan and cycle map to. Kept in configuration rather than in
// code: prices change, and a redeploy is the wrong way to change one.
export function priceFor(env, cycle) {
  return cycle === "annual" ? env.STRIPE_PRICE_SCALE_ANNUAL : env.STRIPE_PRICE_SCALE_MONTHLY;
}

// Stripe timestamps are seconds; everything stored here is ISO 8601.
export const stripeTime = (seconds) =>
  Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null;

// Which statuses mean "this account may use the paid features". `past_due`
// is deliberately included: the card failed, Stripe is retrying, and cutting
// somebody off mid-dunning loses the customer as well as the payment.
export const ENTITLED = new Set(["trialing", "active", "past_due"]);
