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
