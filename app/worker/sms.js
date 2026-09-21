// Text messages, through Twilio.
//
// Written for tenants. A notice goes up in a lobby, a managing agent types in
// three hundred people, and a good proportion of them will read a text and
// never open an email from an address they do not recognise. Email is still
// the default because it is free and carries a link that survives being
// forwarded; text is what actually gets answered.
//
// Unconfigured, every call here returns { ok: false, error: "sms_not_configured" }
// and nothing is sent. That is deliberate: a product that silently does not
// text people is worse than one that says it cannot, and the console's setup
// check reads the same three settings this does.

const API = "https://api.twilio.com/2010-04-01";

export function smsConfig(env) {
  const clean = (v) => String(v ?? "").trim();
  const sid = clean(env.TWILIO_ACCOUNT_SID);
  const token = clean(env.TWILIO_AUTH_TOKEN);
  const from = clean(env.TWILIO_FROM);
  if (!sid || !token || !from) return null;
  return { sid, token, from, base: clean(env.TWILIO_API_BASE) || API };
}

// Twilio wants +E.164. The rest of this codebase stores numbers the way the
// forms show them -- (206)555-1234 -- so this converts for sending and does
// not replace that; two spellings for two jobs, one of which is a wire format.
//
// US and Canada, which is what this sells into. Ten digits is a local number,
// eleven beginning with 1 is the same number written out, and anything
// already in +E.164 is left alone. Everything else is refused rather than
// guessed at -- a number Twilio rejects costs a support call, and a number it
// accepts but nobody owns costs more.
export function toE164(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (/^\+[1-9]\d{7,14}$/.test(s)) return s;
  const digits = s.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export async function sendSms(env, { to, body }) {
  const cfg = smsConfig(env);
  if (!cfg) return { ok: false, error: "sms_not_configured" };
  const number = toE164(to);
  if (!number) return { ok: false, error: "bad_number" };
  if (!body) return { ok: false, error: "no_body" };

  let res, payload;
  try {
    res = await fetch(`${cfg.base}/Accounts/${cfg.sid}/Messages.json`, {
      method: "POST",
      headers: {
        // Twilio takes the account SID and auth token as basic auth.
        Authorization: `Basic ${btoa(`${cfg.sid}:${cfg.token}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: number, From: cfg.from, Body: body }),
    });
    payload = await res.json().catch(() => ({}));
  } catch (err) {
    return { ok: false, error: "unreachable", detail: String(err?.message || err) };
  }
  if (!res.ok) {
    // Twilio's own message is the useful part -- "is not a mobile number",
    // "unverified", "blocked by carrier" -- so it is kept rather than
    // flattened into a status code somebody then has to look up.
    return { ok: false, error: `twilio_${res.status}`,
      detail: payload?.message || payload?.detail || "" };
  }
  return { ok: true, id: payload?.sid || null, to: number };
}
