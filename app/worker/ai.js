// Claude, over plain fetch.
//
// The same trade `billing.js` makes with Stripe and for the same reason: the
// official SDK is a dependency this Worker does not otherwise have, and what
// is actually needed here is one JSON POST. Every outbound provider in this
// Worker -- Stripe, Supabase, Open-Meteo, the state licence registries --
// goes through one named helper over `fetch`, and this is that helper for
// this one.
//
// WHAT LEAVES. A photograph of the inside of a rented home, its room name,
// and the manager's own note about that room. No tenant name, no address,
// no account, no person. That is a bigger step than the weather lookup --
// which this project deliberately runs server-side so that nothing about
// who is looking at SubSub leaves our origin, and which sends only a town
// and a state -- so it is a decision taken out loud, said on the screen
// where the button is, and never a default.

export const ANTHROPIC_API = "https://api.anthropic.com/v1";
const API = ANTHROPIC_API;
// Anthropic's version header, which is not a model version: it pins the
// shape of the request and response, so it must not follow the model.
export const ANTHROPIC_VERSION = "2023-06-01";
const VERSION = ANTHROPIC_VERSION;

export const aiConfigured = (env) => !!env?.ANTHROPIC_API_KEY;

// One call. Takes the body it is going to send rather than assembling it,
// because what to ask is the caller's business and getting there is this
// file's -- the same split `stripeCall` makes.
export async function claudeCall(env, body) {
  if (!aiConfigured(env)) throw new Error("ai_not_configured");

  // Overridable so the request shape can be asserted without making
  // Anthropic answer something. `STRIPE_API_BASE` was added for that and
  // sat unused for years; this one is spent by `photo-draft-test.mjs` from
  // the day it shipped.
  const base = (env.ANTHROPIC_API_BASE || API).replace(/\/+$/, "");

  const res = await fetch(`${base}/messages`, {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* answered with something that is not JSON */ }

  if (!res.ok) {
    // THE PROVIDER'S OWN WORDS, carried rather than flattened. A refusal
    // that reads "that didn't work" is a dead end on a screen somebody is
    // standing in front of; the thing that says what to do about an
    // overloaded model, a bad key or an image too large is the message they
    // sent. Logged rather than shown as-is, because the screen's wording is
    // this product's and the raw message can name their internals.
    const err = new Error(json?.error?.message || `claude_http_${res.status}`);
    err.status = res.status;
    err.code = json?.error?.type || "api_error";
    throw err;
  }
  return json;
}

// The text of the reply, read BY BLOCK TYPE rather than by position.
// `content[0]` is the obvious thing and it is wrong: a reply can open with a
// thinking block, and on a model where that is the default it would be read
// as the answer and fail to parse -- a feature that breaks the day somebody
// changes a thinking setting, with nothing in the request looking different.
export function replyText(msg) {
  const blocks = Array.isArray(msg?.content) ? msg.content : [];
  return blocks.filter((b) => b?.type === "text").map((b) => b.text || "").join("").trim();
}

// Structured outputs come back as JSON in a text block, so this is the one
// place that parses it. A throw here is a malformed answer rather than a
// transport failure and the caller tells them apart, because "try again"
// is right for one and not for the other.
export function replyJson(msg) {
  const text = replyText(msg);
  if (!text) throw new Error("empty_reply");
  return JSON.parse(text);
}
