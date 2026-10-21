// Talking to Google over plain fetch, the trade billing.js makes with Stripe:
// one named helper per provider and no SDK. Endpoints are Google's own:
// accounts.google.com's OpenID configuration for the three OAuth addresses,
// and the Calendar v3 discovery document for the rest.
//
// GOOGLE_OAUTH_API_BASE and GOOGLE_API_BASE exist so the suite can stub at
// fetch and read the requests actually made; neither is set in production.

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const oauthBase = (env) => String(env?.GOOGLE_OAUTH_API_BASE || "https://oauth2.googleapis.com").replace(/\/+$/, "");
const calBase = (env) => String(env?.GOOGLE_API_BASE || "https://www.googleapis.com").replace(/\/+$/, "") + "/calendar/v3";

export const googleConfigured = (env) =>
  !!String(env?.GOOGLE_CLIENT_ID || "").trim() && !!String(env?.GOOGLE_CLIENT_SECRET || "").trim();

// The consent address. `access_type=offline` and `prompt=consent` together are
// what make Google hand back a refresh token every time, including to somebody
// who connected once before -- without it a reconnect gets an access token
// that dies in an hour and a calendar that stops updating with no word why.
export function authUrl(env, { redirectUri, state, scopes, loginHint }) {
  const u = new URL(AUTH_URL);
  u.searchParams.set("client_id", String(env.GOOGLE_CLIENT_ID).trim());
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", scopes.join(" "));
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("include_granted_scopes", "false");
  u.searchParams.set("state", state);
  if (loginHint) u.searchParams.set("login_hint", loginHint);
  return u.toString();
}

async function tokenCall(env, form, fetchImpl = fetch) {
  let res;
  try {
    res = await fetchImpl(`${oauthBase(env)}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        client_id: String(env.GOOGLE_CLIENT_ID).trim(),
        client_secret: String(env.GOOGLE_CLIENT_SECRET).trim(),
        ...form,
      }).toString(),
      signal: AbortSignal.timeout(15000),
    });
  } catch { return { ok: false, status: 0, data: null }; }
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

export const exchangeCode = (env, { code, redirectUri }) =>
  tokenCall(env, { code, redirect_uri: redirectUri, grant_type: "authorization_code" });

// The console's health probe: a refresh token nobody issued, so nothing is
// granted either way, and Google's answer says only whether it knows the client.
export const tokenProbe = (env, fetchImpl) =>
  tokenCall(env, { refresh_token: "subsub-health-check", grant_type: "refresh_token" }, fetchImpl);

// Why a code exchange failed, as a short word safe to put in an address:
// Google's own error code, or "unreachable" when nothing answered.
export function exchangeReason(r) {
  if (!r || r.status === 0) return "unreachable";
  const e = String(r.data?.error || "").toLowerCase();
  return /^[a-z_]{1,40}$/.test(e) ? e : `http_${Number(r.status) || 0}`;
}

export const refreshAccess = (env, refreshToken) =>
  tokenCall(env, { refresh_token: refreshToken, grant_type: "refresh_token" });

// `invalid_grant` on a refresh is the person having revoked SubSub in their
// Google account, or the token having aged out: the connection is dead and
// only connecting again fixes it. Anything else is Google being unwell.
export const refreshDead = (r) => r.status === 400 && r.data?.error === "invalid_grant";

export async function revoke(env, token) {
  try {
    await fetch(`${oauthBase(env)}/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
      signal: AbortSignal.timeout(10000),
    });
  } catch { /* best effort: the row is deleted either way */ }
}

// The email inside an id_token. It arrived from Google's token endpoint over
// TLS in answer to our own client secret, so its payload is read rather than
// its signature checked -- the same trust the access token beside it gets.
export function idTokenEmail(idToken) {
  try {
    const part = String(idToken || "").split(".")[1];
    const json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
    return json.email_verified === false ? null : (json.email || null);
  } catch { return null; }
}

// One Calendar API call. {ok, status, data}.
export async function cal(env, accessToken, method, path, body = null, query = {}) {
  const u = new URL(calBase(env) + path);
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  let res;
  try {
    res = await fetch(u.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`, Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch { return { ok: false, status: 0, data: null }; }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

export const createCalendar = (env, at, { summary, description, timeZone }) =>
  cal(env, at, "POST", "/calendars", { summary, description, timeZone });

export const deleteCalendar = (env, at, calendarId) =>
  cal(env, at, "DELETE", `/calendars/${encodeURIComponent(calendarId)}`);

// `sendUpdates: none` because these events have no guests -- there is nobody
// to notify, and asking Google to would be a mail nobody wanted.
export const insertEvent = (env, at, calendarId, ev) =>
  cal(env, at, "POST", `/calendars/${encodeURIComponent(calendarId)}/events`, ev, { sendUpdates: "none" });
export const patchEvent = (env, at, calendarId, eventId, ev) =>
  cal(env, at, "PATCH", `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    ev, { sendUpdates: "none" });
export const deleteEvent = (env, at, calendarId, eventId) =>
  cal(env, at, "DELETE", `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    null, { sendUpdates: "none" });

// Busy periods on the person's PRIMARY calendar only. Never the SubSub Jobs
// calendar: SubSub knows its own bookings already, and reading its own events
// back as "busy" would block every job against itself.
export async function freeBusy(env, at, { timeMin, timeMax }) {
  const r = await cal(env, at, "POST", "/freeBusy", { timeMin, timeMax, items: [{ id: "primary" }] });
  if (!r.ok) return { ok: false, status: r.status };
  const calEntry = r.data?.calendars?.primary;
  if (!calEntry || calEntry.errors?.length) return { ok: false, status: r.status };
  return { ok: true, busy: Array.isArray(calEntry.busy) ? calEntry.busy : [] };
}
