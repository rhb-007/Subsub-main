// Is each of SubSub's three front doors answering, and how fast.
//
// Three hostnames, three different things: admin.subsub.work is this console
// (a Worker behind Cloudflare Access), api.subsub.work is the API Worker every
// screen talks to, and app.subsub.work is the customer app on Pages. Any one
// of them can be down while the other two are fine, and the console being
// open says nothing about the other two -- which is why each gets a light.
//
// One module because the route decides the light and the screen draws it, and
// two opinions about what "slow" means would put a green box over a figure the
// route had called amber.

// Past this an answer is slow enough to be worth a look. A Worker answers in
// tens of milliseconds and a Pages document in low hundreds, so this is far
// past ordinary -- amber means something, rather than flickering every time a
// cold isolate starts.
export const SLOW_MS = 1500;

// Past this nothing came back at all, which is down rather than slow.
export const TIMEOUT_MS = 6000;

export const HEALTH_HOSTS = [
  // Behind Access, so a request with no Access cookie is answered with a
  // redirect to the login or a 401/403. That IS the console answering --
  // treating it as a failure would draw red over a healthy console every time.
  { id: "admin", host: "admin.subsub.work", label: "Staff console", path: "/", authGated: true },
  // The public ping, through the public hostname: what a customer's browser
  // reaches, not the service binding this route itself arrived through.
  { id: "api", host: "api.subsub.work", label: "API", path: "/api/ping" },
  { id: "app", host: "app.subsub.work", label: "Customer app", path: "/" },
];

// green: answering, quickly. amber: answering, but slowly or with a refusal
// that is not the expected one. red: an error, a timeout, or nothing at all.
// unknown: the check itself could not be made -- said rather than drawn red,
// because a red light over a site that is up is how people learn to ignore it.
export const LIGHTS = {
  green: { label: "Up" },
  amber: { label: "Slow" },
  red: { label: "Down" },
  unknown: { label: "Not checked" },
};

// One probe's outcome into a light and a sentence. `r` is what the route
// measured: {status, ms} for an answer, {error} for none, {blocked} when
// Cloudflare refused to let the check be made at all.
export function lightFor(host, r) {
  if (!r) return { light: "unknown", say: "Not checked yet." };
  if (r.blocked) return { light: "unknown", say: "Cloudflare would not let the API make this check from inside its own zone." };
  if (r.error || !r.status) {
    return { light: "red", say: r.timedOut ? `No answer within ${TIMEOUT_MS / 1000} seconds.` : `Did not answer${r.error ? `: ${r.error}` : "."}` };
  }
  const s = r.status;
  if (s >= 500) return { light: "red", say: `Answered with an error (${s}).` };
  const gated = host?.authGated && (s === 401 || s === 403);
  if (s >= 400 && !gated) return { light: "amber", say: `Answered, but with ${s}.` };
  if (r.ms >= SLOW_MS) return { light: "amber", say: `Answered in ${(r.ms / 1000).toFixed(1)} seconds, which is slow.` };
  return { light: "green", say: `Answered in ${Math.round(r.ms)} ms.` };
}

// Cloudflare's own refusal to route a Worker's fetch back into its own zone
// (error 1042 and its neighbours) comes back as an ordinary response with a
// short body. It is about the check, not about the site.
export function looksBlocked(status, body) {
  return status >= 400 && /error code:\s*10(?:42|19|16)\b/i.test(String(body || ""));
}

// ---- a light per integration --------------------------------------------
//
// The settings check says whether the NAMES are there; this says whether the
// thing behind them works. They are different facts -- a key copied with a
// stray space, a revoked token and a Stripe key from test mode all read
// "Configured" -- so each integration that has a safe, read-only call gets
// asked it, and the light is the answer.
//
// `state` is the settings check's own verdict for the group; `probe` is what
// the live call came back with, `undefined` when there is no call to make for
// that integration, and `null` while it is still being asked.
export const INTEGRATION_WORDS = {
  green: "Working", amber: "Check", red: "Failing", unknown: "Not checked", off: "Not set up",
};

export function integrationLight(state, probe) {
  if (state === "off") return { light: "off", word: "Not set up", say: "None of its settings are present." };
  // Half a setup is broken rather than absent: half a Stripe setup takes
  // payments it cannot record. Red whatever a probe would say.
  if (state === "partial") return { light: "red", word: "Half configured", say: "Some of its settings are missing." };
  if (probe === null) return { light: "unknown", word: "Checking", say: "Asking it now." };
  if (probe === undefined) {
    return { light: "green", word: "Configured",
      say: "Its settings are present. There is no safe read-only call to test it with, so it is not tested live." };
  }
  if (probe.blocked) return { light: "unknown", word: "Not checked", say: probe.say || "The check could not be made." };
  if (probe.error !== undefined || probe.timedOut) {
    return { light: "red", word: "Not answering",
      say: probe.timedOut ? `No answer within ${TIMEOUT_MS / 1000} seconds.` : `Did not answer${probe.error ? `: ${probe.error}` : "."}` };
  }
  if (probe.refused) return { light: "red", word: "Refused", say: probe.say || "It refused the credentials." };
  // Answered, accepted the key, and said the feature itself is switched off:
  // red, because the thing customers press does not work, and worded as what
  // it is rather than as a refusal nobody made.
  if (probe.off) return { light: "red", word: "Switched off", say: probe.say || "It is switched off." };
  if (probe.warn) return { light: "amber", word: "Check", say: probe.say };
  if (probe.ms >= SLOW_MS) return { light: "amber", word: "Slow", say: `Answered in ${(probe.ms / 1000).toFixed(1)} seconds.${probe.say ? " " + probe.say : ""}` };
  return { light: "green", word: "Working", say: probe.say || `Answered in ${Math.round(probe.ms)} ms.` };
}
