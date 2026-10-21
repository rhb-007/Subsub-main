// The page a branded address shows before it is live: a subdomain of the app
// domain that belongs to nobody, or to an account not on Scale yet. Without
// it that address fails in the browser before any of our code runs ("Safari
// can't open the page because the server can't be found"), which reads as
// SubSub being down. Served by worker-unclaimed.js on the *.subsub.work route.
//
// It is one page for every such address. An unknown subdomain and a Basic
// account's look identical, deliberately: this must not be a way to ask
// which names are taken, so it names the address typed and nobody's company.

export const PRICING_URL = "https://subsub.work/pricing";

// What the route does with a host. "pass" sends it on untouched: anything
// that is not exactly one label under the domain (the apex, a deeper name),
// and every reserved name -- app, api, admin, www and the rest of the list
// hostnames.js will never provision. "check" means ask whether it is live.
export function hostDecision(host, domain, reserved) {
  const h = String(host || "").toLowerCase().replace(/\.$/, "");
  const d = String(domain || "subsub.work").toLowerCase();
  if (!h.endsWith(`.${d}`)) return { pass: true };
  const sub = h.slice(0, -(d.length + 1));
  if (!sub || sub.includes(".") || reserved.has(sub)) return { pass: true };
  return { check: true, sub };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function unclaimedPage(host) {
  const h = esc(String(host || "").toLowerCase());
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Not available yet · SubSub</title>
<link rel="icon" href="https://subsub.work/favicon.svg" type="image/svg+xml">
<style>
  :root{--forest:#103528;--forest-lift:#1B4835;--forest-line:#28563F;--gold:#E39B32;--gold-dk:#C07D1C;--bone:#F4F6F4}
  *{box-sizing:border-box}
  html,body{margin:0;min-height:100%;background:var(--forest);color:var(--bone)}
  body{font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;min-height:100vh;min-height:100dvh;display:flex;flex-direction:column}
  header{padding:22px 24px}
  header img{height:30px;width:auto;display:block}
  main{flex:1;display:flex;align-items:center;justify-content:center;padding:24px 16px 56px}
  .uc{width:100%;max-width:560px;background:var(--forest-lift);border:1px solid var(--forest-line);border-radius:20px;padding:40px 32px;text-align:center}
  .code{margin:0;font:800 clamp(30px,8vw,46px)/1.1 system-ui,-apple-system,sans-serif;letter-spacing:-.01em}
  .code .sep{color:var(--gold);padding:0 .2em}
  .code .what{display:block;font-size:.5em;letter-spacing:.04em;text-transform:uppercase;margin-top:10px;color:var(--gold)}
  h1{margin:26px 0 8px;font-size:clamp(24px,5vw,30px);line-height:1.2}
  .host{margin:0 0 22px;color:#C9D4CE;overflow-wrap:anywhere}
  .host b{color:#fff}
  .claim{margin:0 0 26px;color:#DCE3DF}
  .cta{display:inline-flex;align-items:center;justify-content:center;min-height:50px;padding:0 26px;border-radius:12px;background:var(--gold);color:#0C1C16;font-weight:700;font-size:17px;text-decoration:none}
  .cta:hover,.cta:focus-visible{background:var(--gold-dk)}
  .sub{margin:18px 0 0;font-size:14px;color:#A9BAB1}
  .sub a{color:#fff}
  footer{padding:18px 24px;text-align:center;font-size:13px;color:#8FA399}
  footer a{color:#C9D4CE}
</style>
</head>
<body>
<header><a href="https://subsub.work/"><img src="https://subsub.work/email-logo.png" alt="SubSub" width="180" height="30"></a></header>
<main>
  <section class="uc" aria-labelledby="uc-h">
    <p class="code">404<span class="sep">//</span><span class="what">Site under construction</span></p>
    <h1 id="uc-h">Not available yet!</h1>
    <p class="host"><b>${h}</b> isn't live on SubSub yet.</p>
    <p class="claim">Claim your branded SubSub URL: your own address, your logo and your colors on the page your subcontractors sign in to and apply from.</p>
    <a class="cta" href="${PRICING_URL}">See plans and sign up</a>
    <p class="sub">Already have an account? <a href="https://app.subsub.work/">Sign in</a></p>
  </section>
</main>
<footer>Powered by <a href="https://subsub.work/">SubSub</a></footer>
</body>
</html>`;
}
