// Talking to CompanyCam's Core API v2 over plain fetch, the same trade
// billing.js makes with Stripe: one named helper per provider and no SDK.
// Paths and parameters are the ones in CompanyCam's published OpenAPI spec.
//
// COMPANYCAM_API_BASE exists so the suite can stub at fetch and read the
// request it actually makes; it is never set in production.
import { CC_API_BASE } from "../shared/companycam.js";

const base = (env) => String(env?.COMPANYCAM_API_BASE || CC_API_BASE).replace(/\/+$/, "");

// {ok, status, data} for a JSON read. A refusal keeps CompanyCam's own words
// (the spec's Error is {errors: [..]}) so the panel can show them to the
// admin who pasted the token, who is the one person who can act on them.
export async function ccGet(env, token, path, query = {}) {
  const u = new URL(base(env) + path);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v));
  }
  let res;
  try {
    res = await fetch(u.toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return { ok: false, status: 0, data: null, words: "" };
  }
  let data = null;
  try { data = await res.json(); } catch { /* not json */ }
  const words = Array.isArray(data?.errors) ? data.errors.join(" ") : "";
  return { ok: res.ok, status: res.status, data, words };
}

// A refused token is the account's to fix (paste a new one); anything else is
// CompanyCam being unreachable or unwell, which nobody here can fix.
export const ccRefused = (r) => r.status === 401 || r.status === 403;

// The bytes behind a URL CompanyCam's own API handed back. NO Authorization
// header: these are static file URLs on CompanyCam's storage, and sending the
// account's token to whatever host a URL names would hand it to that host.
// Checked against the measurement-document rules by the caller-supplied
// `allowType` and `maxBytes`, declared length first so a large file is never
// streamed at all, real length after because Content-Length can lie.
export async function ccDownload(url, { allowType, maxBytes, fallbackType }) {
  let res;
  try {
    res = await fetch(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(30000) });
  } catch {
    return { error: "download_failed" };
  }
  if (!res.ok) return { error: "download_failed", status: res.status };
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared > maxBytes) return { error: "too_big", max: maxBytes };
  let type = String(res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  // Object storage often answers octet-stream for a file it was told the type
  // of elsewhere; the API's own content_type is the better answer then.
  if ((!type || type === "application/octet-stream") && fallbackType) type = fallbackType;
  if (!allowType(type)) return { error: "not_a_document", type };
  const body = await res.arrayBuffer();
  if (body.byteLength > maxBytes) return { error: "too_big", max: maxBytes };
  if (body.byteLength === 0) return { error: "empty" };
  return { body, type };
}
