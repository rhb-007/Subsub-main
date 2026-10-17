// The one call to the BBB API. Off until BBB_API_TOKEN is set, which needs an
// approved registration at developer.bbb.org; until then nothing here runs and
// the Passport draws no rating.
//
// Read off BBB's own Swagger page (api.bbb v1): the server
// https://api.bbb.org/v2, GET /orgs/search with a Bearer token, the query
// parameters BbbId and BusinessId, and a reply of searchResults[] carrying
// businessId, bbbId, bbbRating and isBBBAccredited. readBbbAnswer picks the
// result whose businessId is the one asked about, and draws nothing rather
// than a guess. BBB_API_BASE overrides the host for the tests, the way
// ANTHROPIC_API_BASE does.

import { readBbbAnswer } from "../shared/bbb.js";

const API = "https://api.bbb.org/v2";

export function bbbLive(env) {
  return !!(env && env.BBB_API_TOKEN && String(env.BBB_API_TOKEN).trim());
}

export async function fetchBbbRating(env, { bbbId, businessId }) {
  if (!bbbLive(env)) return { ok: false, error: "not_live" };
  const base = (env.BBB_API_BASE || API).replace(/\/+$/, "");
  const q = new URLSearchParams({ BbbId: String(bbbId), BusinessId: String(businessId) });
  let res;
  try {
    res = await fetch(`${base}/orgs/search?${q}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${String(env.BBB_API_TOKEN).trim()}`, Accept: "application/json" },
    });
  } catch (err) {
    return { ok: false, error: "unreachable", detail: String(err?.message || err).slice(0, 200) };
  }
  if (res.status === 404) return { ok: false, error: "not_found" };
  if (!res.ok) return { ok: false, error: `bbb_${res.status}` };
  let body;
  try { body = await res.json(); } catch { return { ok: false, error: "unreadable" }; }
  return readBbbAnswer(body, { businessId });
}
