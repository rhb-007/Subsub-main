// Branded hostnames, provisioned without anyone touching a dashboard.
//
// A Scale account is sold its own address -- outerhome.subsub.work -- and
// until this existed that address was a dead link until a human went into
// Cloudflare, added a custom domain to the Pages project and waited for a
// certificate. One manual step per customer is one step nobody does on a
// Friday, and the customer sees a certificate warning on the thing they
// just paid for.
//
// Two calls make the address real, and both are idempotent:
//
//   1. A proxied CNAME in the zone, pointing the subdomain at the Pages
//      project. Proxied matters: an unproxied record would hand the visitor
//      straight to pages.dev with the wrong certificate.
//   2. The hostname registered as a custom domain on the Pages project, so
//      Cloudflare issues a certificate for it and routes it to the app.
//
// Neither is allowed to fail the request that triggered it. Signing up, or
// paying, must not depend on Cloudflare's API being reachable this second --
// the account's hostname_status records where it got to and the nightly
// sweep picks up whatever is still pending.

const CF_API = "https://api.cloudflare.com/client/v4";

// Reserved here as well as at signup, deliberately. This is the code that can
// actually point a hostname somewhere, so it does not trust that whatever
// wrote the row validated it: a stored subdomain of "api" would take
// api.subsub.work away from the API itself.
const NEVER_PROVISION = new Set([
  "app", "www", "admin", "api", "platform", "dashboard", "portal", "status",
  "mail", "smtp", "ftp", "cdn", "assets", "static", "help", "support",
  "docs", "blog", "billing", "account", "accounts", "login", "signup",
  "subsub", "test", "staging", "dev", "demo",
]);
const SUB_RE = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$/;

export function hostnameConfig(env) {
  // Trimmed, every one. These are pasted by hand into a dashboard, often on
  // a phone or tablet, and a trailing newline on the token turns into an
  // Authorization header Cloudflare rejects with a message about
  // authentication -- which sends you looking at permissions for an hour.
  const clean = (v) => String(v ?? "").trim();
  const token = clean(env.CF_API_TOKEN);
  const zoneId = clean(env.CF_ZONE_ID);
  const accountId = clean(env.CF_ACCOUNT_ID);
  const project = clean(env.CF_PAGES_PROJECT);
  const domain = (clean(env.APP_DOMAIN) || "subsub.work").toLowerCase();
  if (!token || !zoneId || !accountId || !project) return null;
  return { token, zoneId, accountId, project, domain };
}

export function brandedHost(cfg, subdomain) {
  const s = String(subdomain || "").trim().toLowerCase();
  if (!SUB_RE.test(s) || s.includes("--") || NEVER_PROVISION.has(s)) return null;
  return `${s}.${cfg.domain}`;
}

// One place that knows the envelope Cloudflare answers in, so every caller
// below reads the same shape whether the failure was HTTP, JSON or an API
// error inside a 200.
async function cf(cfg, path, init = {}) {
  let res, body;
  try {
    res = await fetch(`${CF_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
    });
    body = await res.json();
  } catch (err) {
    return { ok: false, status: 0, errors: [{ message: String(err?.message || err) }] };
  }
  return {
    ok: !!body?.success,
    status: res.status,
    result: body?.result,
    errors: body?.errors || [],
  };
}

const hasCode = (r, code) => (r.errors || []).some((e) => e?.code === code);
const errText = (r) =>
  (r.errors || []).map((e) => e?.message).filter(Boolean).join("; ")
  || `cloudflare_http_${r.status}`;

// The CNAME. 81057 is "record already exists", which is the answer we want
// from a retry, so it counts as success rather than as a failure to report.
async function ensureDnsRecord(cfg, host) {
  const found = await cf(cfg, `/zones/${cfg.zoneId}/dns_records?name=${encodeURIComponent(host)}`);
  if (found.ok && Array.isArray(found.result) && found.result.length) {
    return { ok: true, existed: true, id: found.result[0].id };
  }

  const made = await cf(cfg, `/zones/${cfg.zoneId}/dns_records`, {
    method: "POST",
    body: JSON.stringify({
      type: "CNAME",
      name: host,
      content: `${cfg.project}.pages.dev`,
      // Unproxied, the visitor reaches pages.dev directly and is shown a
      // certificate for the wrong name. The whole point is the orange cloud.
      proxied: true,
      ttl: 1,
      comment: "SubSub branded hostname — managed automatically, do not edit",
    }),
  });
  if (made.ok) return { ok: true, existed: false, id: made.result?.id };
  if (hasCode(made, 81057) || hasCode(made, 81058)) return { ok: true, existed: true };
  return { ok: false, error: errText(made) };
}

// The Pages custom domain. Already-registered is again the retry's answer.
async function ensurePagesDomain(cfg, host) {
  const made = await cf(cfg,
    `/accounts/${cfg.accountId}/pages/projects/${cfg.project}/domains`,
    { method: "POST", body: JSON.stringify({ name: host }) });
  if (made.ok) return { ok: true, status: made.result?.status || "pending" };
  if (/already|exists|duplicate/i.test(errText(made))) return { ok: true, status: "pending" };
  return { ok: false, error: errText(made) };
}

// What Cloudflare currently thinks of the hostname. "active" is the only
// answer that means a customer can open it and see their own app.
export async function checkHostname(env, subdomain) {
  const cfg = hostnameConfig(env);
  if (!cfg) return { ok: false, status: "unconfigured", error: "cloudflare_not_configured" };
  const host = brandedHost(cfg, subdomain);
  if (!host) return { ok: false, status: "failed", error: "subdomain_not_allowed" };

  const got = await cf(cfg,
    `/accounts/${cfg.accountId}/pages/projects/${cfg.project}/domains/${encodeURIComponent(host)}`);
  if (!got.ok) {
    if (got.status === 404) return { ok: true, status: "absent", host };
    return { ok: false, status: "failed", host, error: errText(got) };
  }
  const state = String(got.result?.status || "pending").toLowerCase();
  const detail = got.result?.validation_data?.error_message
    || got.result?.verification_data?.error_message || null;
  return {
    ok: true, host,
    status: state === "active" ? "active" : (state === "error" || state === "blocked" ? "failed" : "pending"),
    error: detail,
  };
}

// Which of the four settings is wrong.
//
// A provisioning failure reads as one line -- "Authentication failed" --
// and that one line is true of a mistyped token, a token whose permissions
// are too narrow, a zone id that belongs to a different zone, and an account
// id pasted where a zone id goes. Four causes, one message, and the only way
// to tell them apart by hand is to try each in turn. So try each in turn.
//
// Each probe uses exactly the permission provisioning needs, so a probe that
// passes is evidence the real call will too.
export async function diagnose(env) {
  const cfg = hostnameConfig(env);
  if (!cfg) {
    const missing = ["CF_API_TOKEN", "CF_ZONE_ID", "CF_ACCOUNT_ID", "CF_PAGES_PROJECT"]
      .filter((k) => !env[k]);
    return {
      configured: false, missing,
      checks: [{ id: "config", label: "Settings present", ok: false,
        detail: `Not set on this Worker: ${missing.join(", ")}` }],
    };
  }

  const probes = [
    ["token", "API token is valid", "/user/tokens/verify",
      "The token was rejected outright. Check you copied the token itself and not its ID, and that there is no stray space or line break at the end."],
    ["dns", `DNS access to the zone (${cfg.domain})`,
      `/zones/${cfg.zoneId}/dns_records?per_page=1`,
      "The token cannot read DNS in this zone. Either CF_ZONE_ID is not this zone's id — it is easy to paste the account id here, they look identical — or the token is missing Zone → DNS → Edit for subsub.work."],
    ["pages", `Pages project "${cfg.project}"`,
      `/accounts/${cfg.accountId}/pages/projects/${cfg.project}`,
      "The project could not be read. Either CF_PAGES_PROJECT is not its exact name, CF_ACCOUNT_ID is wrong, or the token is missing Account → Cloudflare Pages → Edit."],
  ];

  const checks = [];
  for (const [id, label, path, hint] of probes) {
    const r = await cf(cfg, path);
    checks.push({
      id, label, ok: r.ok,
      // Cloudflare's own words first: a paraphrase is not something anyone
      // can search for. The hint is what to do about them.
      detail: r.ok ? null : `${errText(r)} (HTTP ${r.status}) — ${hint}`,
    });
    // A bad token fails every probe after it for the same reason; saying so
    // three times buries the one that matters.
    if (!r.ok && id === "token") break;
  }

  return { configured: true, zone: cfg.domain, project: cfg.project, checks };
}

// Make the address real. Safe to call repeatedly -- both steps no-op once
// they have been done, which is what lets the nightly sweep retry blindly.
export async function provisionHostname(env, subdomain) {
  const cfg = hostnameConfig(env);
  if (!cfg) return { ok: false, status: "unconfigured", error: "cloudflare_not_configured" };
  const host = brandedHost(cfg, subdomain);
  if (!host) return { ok: false, status: "failed", error: "subdomain_not_allowed" };

  const dns = await ensureDnsRecord(cfg, host);
  if (!dns.ok) return { ok: false, status: "failed", host, error: `dns: ${dns.error}` };

  const dom = await ensurePagesDomain(cfg, host);
  if (!dom.ok) return { ok: false, status: "failed", host, error: `pages: ${dom.error}` };

  // Registering is not the same as being live: the certificate takes a
  // minute or two. Report what Cloudflare says now and let the sweep
  // promote it to active rather than claiming it early.
  return checkHostname(env, subdomain);
}

// Take it down again -- a downgrade, or a deleted account. Missing at either
// step is success: the end state is what matters, not who removed it.
export async function deprovisionHostname(env, subdomain) {
  const cfg = hostnameConfig(env);
  if (!cfg) return { ok: false, status: "unconfigured", error: "cloudflare_not_configured" };
  const host = brandedHost(cfg, subdomain);
  if (!host) return { ok: false, status: "failed", error: "subdomain_not_allowed" };

  const dropped = await cf(cfg,
    `/accounts/${cfg.accountId}/pages/projects/${cfg.project}/domains/${encodeURIComponent(host)}`,
    { method: "DELETE" });
  if (!dropped.ok && dropped.status !== 404) {
    return { ok: false, status: "failed", host, error: `pages: ${errText(dropped)}` };
  }

  // Only ever remove a record this code wrote. A CNAME somebody added by
  // hand for a reason we do not know about is not ours to delete.
  const found = await cf(cfg, `/zones/${cfg.zoneId}/dns_records?name=${encodeURIComponent(host)}`);
  for (const rec of (found.ok && Array.isArray(found.result) ? found.result : [])) {
    if (!/SubSub branded hostname/i.test(rec.comment || "")) continue;
    await cf(cfg, `/zones/${cfg.zoneId}/dns_records/${rec.id}`, { method: "DELETE" });
  }
  return { ok: true, status: "removed", host };
}
