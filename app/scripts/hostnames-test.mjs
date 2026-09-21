// Branded-hostname provisioning, against a stand-in for Cloudflare's API.
//
// The real thing cannot be called from a test: it would create DNS records in
// a live zone. So this fakes the four endpoints involved and checks the two
// properties that matter -- that a retry is harmless, and that a hostname
// which could take over api.subsub.work is refused however it got stored.
//
//   node scripts/hostnames-test.mjs
import { provisionHostname, deprovisionHostname, checkHostname, brandedHost, hostnameConfig }
  from "../worker/hostnames.js";

const env = { CF_API_TOKEN: "t", CF_ZONE_ID: "z1", CF_ACCOUNT_ID: "a1",
              CF_PAGES_PROJECT: "subsub-app", APP_DOMAIN: "subsub.work" };

let calls = [];
let world = { dns: [], domains: {} };
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  const m = init.method || "GET";
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push(`${m} ${u.pathname}${u.search}`);

  if (u.pathname === "/client/v4/zones/z1/dns_records" && m === "GET") {
    const name = u.searchParams.get("name");
    return json({ success: true, result: world.dns.filter(r => r.name === name) });
  }
  if (u.pathname === "/client/v4/zones/z1/dns_records" && m === "POST") {
    if (world.dns.some(r => r.name === body.name)) {
      return json({ success: false, errors: [{ code: 81057, message: "Record already exists." }] }, 400);
    }
    const rec = { id: "rec" + world.dns.length, ...body };
    world.dns.push(rec);
    return json({ success: true, result: rec });
  }
  if (/^\/client\/v4\/zones\/z1\/dns_records\/rec\d+$/.test(u.pathname) && m === "DELETE") {
    const id = u.pathname.split("/").pop();
    world.dns = world.dns.filter(r => r.id !== id);
    return json({ success: true, result: { id } });
  }
  if (u.pathname === "/client/v4/accounts/a1/pages/projects/subsub-app/domains" && m === "POST") {
    if (world.domains[body.name]) {
      return json({ success: false, errors: [{ message: "Domain already exists" }] }, 409);
    }
    world.domains[body.name] = { name: body.name, status: "pending" };
    return json({ success: true, result: world.domains[body.name] });
  }
  const dm = u.pathname.match(/^\/client\/v4\/accounts\/a1\/pages\/projects\/subsub-app\/domains\/(.+)$/);
  if (dm) {
    const name = decodeURIComponent(dm[1]);
    if (m === "DELETE") {
      if (!world.domains[name]) return json({ success: false, errors: [{ message: "not found" }] }, 404);
      delete world.domains[name];
      return json({ success: true, result: null });
    }
    if (!world.domains[name]) return json({ success: false, errors: [{ message: "not found" }] }, 404);
    return json({ success: true, result: world.domains[name] });
  }
  throw new Error("unexpected call " + m + " " + u.pathname);
};

const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  console.log(g === w ? `  ok   ${label}` : `  FAIL ${label}\n       got  ${g}\n       want ${w}`);
  if (g !== w) process.exitCode = 1;
};

console.log("brandedHost");
const cfg = hostnameConfig(env);
eq("normal", brandedHost(cfg, "outerhome"), "outerhome.subsub.work");
eq("reserved 'api' refused", brandedHost(cfg, "api"), null);
eq("reserved 'admin' refused", brandedHost(cfg, "admin"), null);
eq("dotted refused", brandedHost(cfg, "a.b"), null);
eq("path injection refused", brandedHost(cfg, "x/../y"), null);
eq("uppercase normalized", brandedHost(cfg, "OuterHome"), "outerhome.subsub.work");

console.log("provision");
let r = await provisionHostname(env, "outerhome");
eq("first run pending", { ok: r.ok, status: r.status, host: r.host }, { ok: true, status: "pending", host: "outerhome.subsub.work" });
eq("dns proxied", world.dns[0].proxied, true);
eq("dns target", world.dns[0].content, "subsub-app.pages.dev");

calls = [];
r = await provisionHostname(env, "outerhome");
eq("second run still ok (idempotent)", { ok: r.ok, status: r.status }, { ok: true, status: "pending" });
eq("no duplicate dns record", world.dns.length, 1);

console.log("check");
world.domains["outerhome.subsub.work"].status = "active";
r = await checkHostname(env, "outerhome");
eq("goes active", { ok: r.ok, status: r.status }, { ok: true, status: "active" });

console.log("deprovision");
r = await deprovisionHostname(env, "outerhome");
eq("removed", { ok: r.ok, status: r.status }, { ok: true, status: "removed" });
eq("dns gone", world.dns.length, 0);
eq("domain gone", Object.keys(world.domains).length, 0);
r = await deprovisionHostname(env, "outerhome");
eq("second removal still ok", { ok: r.ok, status: r.status }, { ok: true, status: "removed" });

console.log("hand-made dns record is left alone");
world.dns.push({ id: "rec99", name: "keepme.subsub.work", comment: "set up by a person" });
world.domains["keepme.subsub.work"] = { name: "keepme.subsub.work", status: "active" };
await deprovisionHostname(env, "keepme");
eq("kept", world.dns.length, 1);

console.log("not configured");
r = await provisionHostname({}, "outerhome");
eq("no credentials", { ok: r.ok, status: r.status }, { ok: false, status: "unconfigured" });

console.log("reserved subdomain cannot be provisioned even if stored");
r = await provisionHostname(env, "api");
eq("refused", { ok: r.ok, status: r.status, error: r.error }, { ok: false, status: "failed", error: "subdomain_not_allowed" });

console.log("cloudflare refuses");
globalThis.fetch = async () => json({ success: false, errors: [{ code: 10000, message: "Authentication error" }] }, 403);
r = await provisionHostname(env, "newco");
eq("failure reported verbatim", { ok: r.ok, status: r.status, error: r.error },
   { ok: false, status: "failed", error: "dns: Authentication error" });

console.log("cloudflare unreachable");
globalThis.fetch = async () => { throw new Error("connect ETIMEDOUT"); };
r = await provisionHostname(env, "newco");
eq("network failure reported", { ok: r.ok, status: r.status }, { ok: false, status: "failed" });
