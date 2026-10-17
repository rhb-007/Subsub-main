// The one call to the BBB API. Off until BBB_API_TOKEN is set, which needs an
// approved registration at developer.bbb.org; until then nothing here runs and
// the Passport draws no rating.
//
// NOT VERIFIED against a live answer: the path and the parameter names are
// the organization search the BBB API publishes (BBBID + BusinessId), and the
// reply is read by readBbbAnswer, which accepts several spellings and draws
// nothing rather than a guess. BBB_API_BASE overrides the host for the tests,
// the way ANTHROPIC_API_BASE does.

import { readBbbAnswer } from "../shared/bbb.js";

const API = "https://api.bbb.org";

export function bbbLive(env) {
  return !!(env && env.BBB_API_TOKEN && String(env.BBB_API_TOKEN).trim());
}

export async function fetchBbbRating(env, { bbbId, businessId }) {
  if (!bbbLive(env)) return { ok: false, error: "not_live" };
  const base = (env.BBB_API_BASE || API).replace(/\/+$/, "");
  const q = new URLSearchParams({ BBBID: String(bbbId), BusinessId: String(businessId) });
  let res;
  try {
    res = await fetch(`${base}/api/orgs/search?${q}`, {
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
  return readBbbAnswer(body);
}
