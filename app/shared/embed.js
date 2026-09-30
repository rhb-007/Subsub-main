// The application form, as something a general contractor pastes on their own
// website.
//
// The public form at <sub>.subsub.work/?apply=1 has existed since the start and
// nobody knows it is there. It is the only subcontractor-acquisition channel
// that runs without the account doing anything: a roofer fills it in, lands on
// their roster, and is then one QuickSend away from putting SubSub in front of
// every OTHER general contractor who asks them for a certificate. Supply
// brings demand in, which in a product with no directory is the only flywheel
// available -- and this is the cheapest place to start it.
//
// So: a snippet, not a link. "Go to this URL" is a thing somebody means to do
// and never does; twelve lines they paste into their site is done in a minute
// and then works forever.
//
// Imported by the browser, which renders the copy panel. The Worker does not
// import it: the nudge email points at the panel rather than pasting eighty
// lines of HTML into an email nobody can copy from cleanly on a phone.

export const API_ORIGIN = "https://api.subsub.work";

// Where the hosted version lives, for the no-JavaScript fallback and for
// anybody who would rather link than embed.
//
// Defined in terms of `applyUrl` at the bottom of this file rather than
// alongside it, because two functions building the same URL is two records of
// one fact -- and they would drift the first time either address changed. This
// one always wants the account's OWN hostname: it goes on their website, where
// a link to app.subsub.work would read as sending their visitors somewhere
// else. `applyUrl` is what decides when that address is safe to hand out.
export const applyLink = (subdomain) => applyUrl(subdomain, { liveHost: true });

// The snippet's own copy of the branding defaults. It cannot import the app's
// DEFAULT_THEME -- this module is shared with the Worker and the app's lives in
// App.tsx -- and it only needs the two colours a form on somebody else's page
// should ever set.
export const EMBED_DEFAULT_ACCENT = "#1f6b4a";
export const EMBED_DEFAULT_BTN_TEXT = "#ffffff";

// A colour out of the database landing in a <style> block on a customer's
// website is an injection unless it is checked. Anything that is not six hex
// digits is not a colour, and the default is used instead -- never the string.
const HEX = /^#[0-9a-fA-F]{6}$/;
const hex = (v, fallback) => (typeof v === "string" && HEX.test(v) ? v : fallback);

// The pressed/hover shade, computed rather than stored: the branding editor
// asks for one accent and a second colour to maintain is a second colour to get
// wrong. Multiplied down in sRGB, which is crude and predictable -- it darkens
// every hue by the same proportion, so a customer who picks a pale accent still
// gets a visible change on hover.
const darken = (h, by = 0.78) => {
  const n = parseInt(h.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((v) => Math.max(0, Math.min(255, Math.round(v * by))));
  return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
};

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

// Every class is prefixed and every rule is scoped under the root, because
// this lands in somebody else's stylesheet. A bare `.field` or `input{...}`
// would restyle their whole site, which is the fastest way to have a customer
// rip the snippet back out.
export function applyFormHtml({ subdomain, accountName, trades = [], theme = null,
  apiOrigin = API_ORIGIN } = {}) {
  const sub = String(subdomain || "").trim().toLowerCase();
  if (!sub) return "";
  const name = accountName || sub;
  // The account's own colours, so the form on their site is not a green box in
  // the middle of a blue page. Two of them, and only two.
  //
  // The button and the focus ring take the accent; nothing else does. The page
  // background, the card and the text colour are deliberately NOT applied: this
  // form lands inside somebody's existing layout and inherits its font and its
  // colour already, and a snippet that paints a background is the "restyles
  // their whole website" failure every rule in this file is scoped to avoid.
  // Inputs stay white on dark ink because that is legible on any page, which a
  // customer's own surface/text pair is not once it is somewhere they did not
  // choose it for.
  const accent = hex(theme && theme.accent, EMBED_DEFAULT_ACCENT);
  const btnText = hex(theme && theme.btnText, EMBED_DEFAULT_BTN_TEXT);
  const accentDark = darken(accent);
  const chips = trades
    .map((t) => `        <button type="button" class="ss-chip" data-cat="${esc(t.id)}">${esc(t.label)}</button>`)
    .join("\n");

  return `<!-- Subcontractor application form for ${esc(name)} -->
<div id="subsub-apply">
  <form class="ss-form" novalidate>
    <div class="ss-steps"><span class="ss-dot on"></span><span class="ss-dot"></span></div>

    <div class="ss-step" data-step="1">
      <p class="ss-lede">Tell us about your company.</p>
      <label class="ss-f"><span>Company <b>*</b></span>
        <input name="company" required autocomplete="organization" /></label>
      <label class="ss-f"><span>Your name <b>*</b></span>
        <input name="contact" required autocomplete="name" /></label>
      <div class="ss-row">
        <label class="ss-f"><span>Email <b>*</b></span>
          <input name="email" type="email" required autocomplete="email" /></label>
        <label class="ss-f"><span>Mobile</span>
          <input name="phone" type="tel" autocomplete="tel" /></label>
      </div>
      <label class="ss-f"><span>Contractor license #</span>
        <input name="license" autocapitalize="characters" />
        <em>Optional. It speeds up approval &mdash; we check it against the state registry.</em></label>
    </div>

    <div class="ss-step" data-step="2" hidden>
      <p class="ss-lede">What do you do, and where?</p>
      <span class="ss-label">Trades you cover <b>*</b></span>
      <div class="ss-chips">
${chips}
      </div>
      <div class="ss-row">
        <label class="ss-f"><span>City</span>
          <input name="city" autocomplete="address-level2" /></label>
        <label class="ss-f"><span>ZIP</span>
          <input name="zip" inputmode="numeric" autocomplete="postal-code" /></label>
      </div>
    </div>

    <p class="ss-msg" role="status" aria-live="polite"></p>
    <div class="ss-actions">
      <button type="button" class="ss-back" hidden>Back</button>
      <button type="button" class="ss-next">Continue</button>
      <button type="submit" class="ss-go" hidden>Apply to work with ${esc(name)}</button>
    </div>
    <noscript><a href="${esc(applyLink(sub))}">Open the application form</a></noscript>
  </form>
  <div class="ss-done" role="status" aria-live="polite" hidden>
    <svg class="ss-tick" viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"
      fill="none" stroke="currentColor" stroke-width="2.5"
      stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
    <h3>Submitted</h3>
    <p class="ss-done-lede">Thanks for asking to work with us.</p>
    <p>We have sent a confirmation to <b class="ss-done-em"></b>. Follow the link in it to
      finish setting up your account &mdash; including your certificate of insurance,
      your surety bond and your W-9, which we need on file before we can schedule you
      for work.</p>
    <p class="ss-done-sub">We look forward to working with you.</p>
    <p class="ss-done-sig">&mdash; The ${esc(name)} team</p>
  </div>
  <a class="ss-by" href="https://subsub.work" target="_blank" rel="noopener"
    aria-label="Powered by SubSub — visit subsub.work">
    <span>Powered by</span>
    <svg viewBox="36 62 502 114" height="13" role="img" aria-hidden="true" fill="currentColor"><path d="M124.35,80.05l-78,36.53c-1.99,0.93-4.27-0.52-4.27-2.72V98.92c0-2.66,1.54-5.07,3.94-6.2L98.82,68c2.61-1.22,5.6-1.31,8.28-0.25l17.09,6.78C126.63,75.51,126.73,78.93,124.35,80.05z"/><path d="M43.81,156.95l78-36.53c1.99-0.93,4.27,0.52,4.27,2.72v14.93c0,2.66-1.54,5.07-3.94,6.2L69.34,169c-2.61,1.22-5.6,1.31-8.28,0.25l-17.09-6.78C41.53,161.49,41.43,158.07,43.81,156.95z"/><path d="M124.51,111.55l-57.06,26.43c-2.31,1.09-4.76,0.85-7.27-0.19l-16.4-6.7c-2.37-0.98-2.45-4.42-0.13-5.52l57.16-26.43c2.7-1.15,4.5-1.1,7.52-0.06l16.05,6.94C126.75,107.01,126.83,110.45,124.51,111.55z"/><path d="M159.95,151.25l6.62-14.87c6.31,4.18,15.27,7.03,23.52,7.03c8.35,0,11.61-2.34,11.61-5.8c0-11.3-40.53-3.05-40.53-29.53c0-12.73,10.39-23.11,31.57-23.11c9.27,0,18.84,2.14,25.86,6.21l-6.21,14.97c-6.82-3.67-13.54-5.5-19.75-5.5c-8.45,0-11.51,2.85-11.51,6.41c0,10.9,40.42,2.75,40.42,29.02c0,12.42-10.39,23.01-31.57,23.01C178.27,159.09,166.67,155.94,159.95,151.25z"/><path d="M281.36,104.58v53.14h-17.75v-5.69c-4.02,4.41-9.71,6.57-15.79,6.57c-13.04,0-22.55-7.45-22.55-24.32v-29.71h18.63v26.67c0,8.24,3.24,11.47,8.82,11.47c5.49,0,10-3.63,10-12.55v-25.59H281.36z"/><path d="M345.6,131.05c0,16.96-11.67,27.55-26.08,27.55c-6.96,0-12.16-1.96-15.69-6.18v5.29h-17.75V84.97h18.63v24.22c3.63-3.73,8.63-5.49,14.81-5.49C333.93,103.69,345.6,114.19,345.6,131.05z M326.78,131.05c0-8.04-4.9-12.55-11.18-12.55s-11.18,4.51-11.18,12.55c0,8.14,4.9,12.75,11.18,12.75S326.78,139.19,326.78,131.05z"/><path d="M345.41,151.25l6.62-14.87c6.31,4.18,15.27,7.03,23.52,7.03c8.35,0,11.61-2.34,11.61-5.8c0-11.3-40.53-3.05-40.53-29.53c0-12.73,10.39-23.11,31.57-23.11c9.27,0,18.84,2.14,25.86,6.21l-6.21,14.97c-6.82-3.67-13.54-5.5-19.75-5.5c-8.45,0-11.51,2.85-11.51,6.41c0,10.9,40.42,2.75,40.42,29.02c0,12.42-10.39,23.01-31.57,23.01C363.74,159.09,352.13,155.94,345.41,151.25z"/><path d="M466.81,104.58v53.14h-17.75v-5.69c-4.02,4.41-9.71,6.57-15.79,6.57c-13.04,0-22.55-7.45-22.55-24.32v-29.71h18.63v26.67c0,8.24,3.24,11.47,8.83,11.47c5.49,0,10-3.63,10-12.55v-25.59H466.81z"/></svg>
  </a>
</div>
<style>
#subsub-apply .ss-form{display:flex;flex-direction:column;gap:14px;max-width:460px;
  font:inherit;color:inherit}
/* The hidden attribute is a UA rule at the weakest specificity, and .ss-form
   sets display:flex -- which beats it, so the form would stay on screen under
   the confirmation. Anything toggled with [hidden] here has to say so itself.
   (No backticks in this file's comments: it is all one template literal.) */
#subsub-apply .ss-form[hidden],#subsub-apply .ss-done[hidden],#subsub-apply .ss-step[hidden],
#subsub-apply .ss-actions button[hidden]{display:none}
#subsub-apply .ss-steps{display:flex;gap:6px}
#subsub-apply .ss-dot{width:26px;height:4px;border-radius:2px;background:#d9e0db}
#subsub-apply .ss-dot.on{background:${accent}}
#subsub-apply .ss-step{display:flex;flex-direction:column;gap:14px}
#subsub-apply .ss-lede{margin:0;font-size:14px;opacity:.75}
#subsub-apply .ss-f{display:flex;flex-direction:column;gap:5px;font-size:14px}
#subsub-apply .ss-f > span,#subsub-apply .ss-label{font-weight:600;font-size:14px}
#subsub-apply .ss-f b,#subsub-apply .ss-label b{color:#b5442e;font-weight:600}
#subsub-apply .ss-f em{font-size:12px;opacity:.7;font-style:normal}
#subsub-apply .ss-row{display:flex;gap:12px;flex-wrap:wrap}
#subsub-apply .ss-row > .ss-f{flex:1 1 150px}
#subsub-apply input{font:inherit;font-size:15px;padding:9px 11px;
  border:1px solid #c9d2cc;border-radius:8px;background:#fff;color:#16241d;width:100%;
  box-sizing:border-box}
#subsub-apply input:focus{outline:2px solid ${accent};
  outline-offset:1px;border-color:${accent}}
#subsub-apply .ss-chips{display:flex;flex-wrap:wrap;gap:7px}
#subsub-apply .ss-chip{font:inherit;font-size:13px;padding:7px 12px;border-radius:20px;
  border:1px solid #c9d2cc;background:#fff;color:#16241d;cursor:pointer}
#subsub-apply .ss-chip.on{background:${accent};border-color:${accent};color:${btnText}}
#subsub-apply .ss-actions{display:flex;gap:10px;align-items:center}
#subsub-apply .ss-actions button{font:inherit;font-size:15px;font-weight:600;padding:11px 18px;
  border:0;border-radius:8px;background:${accent};color:${btnText};cursor:pointer}
#subsub-apply .ss-back{background:transparent !important;color:inherit !important;
  border:1px solid #c9d2cc !important;font-weight:500 !important}
#subsub-apply .ss-actions button:hover:not(:disabled){background:${accentDark}}
#subsub-apply .ss-back:hover{background:#f3f5f4 !important}
#subsub-apply .ss-actions button:disabled{opacity:.6;cursor:default}
#subsub-apply .ss-msg{margin:0;font-size:14px;line-height:1.45}
#subsub-apply .ss-msg.ok{color:${accent}}
#subsub-apply .ss-msg.bad{color:#b5442e}
#subsub-apply .ss-done{max-width:460px;text-align:center;padding:30px 22px;
  border:1px solid #c9d2cc;border-radius:12px;background:#f5faf7}
#subsub-apply .ss-tick{display:block;margin:0 auto 14px;width:44px;height:44px;padding:7px;
  box-sizing:border-box;border-radius:50%;background:${accent};color:${btnText}}
#subsub-apply .ss-done h3{margin:0 0 10px;font:inherit;font-size:19px;font-weight:700;
  line-height:1.3;color:#16241d}
#subsub-apply .ss-done p{margin:0 0 10px;font-size:14.5px;line-height:1.55;color:#4a5a51}
#subsub-apply .ss-done-lede{font-size:15.5px !important;color:#16241d !important;font-weight:600}
#subsub-apply .ss-done-sub{margin-top:14px !important}
#subsub-apply .ss-done-sig{margin:0 !important;font-size:13.5px !important;font-weight:600;
  color:#16241d !important}
#subsub-apply .ss-done b{color:#16241d}
/* Ours, and not the customer's to remove -- the same reason the hosted pages
   carry it. The real mark, drawn INLINE rather than fetched: a snippet that
   loads an image is a snippet with a dependency, and one that breaks leaves a
   broken-image icon on somebody's website. Mono, so it takes the colour of
   whatever page it lands on instead of asserting ours. */
#subsub-apply .ss-by{display:flex;align-items:center;justify-content:center;gap:6px;
  margin:16px 0 0;max-width:460px;font-size:11.5px;opacity:.55;color:inherit;
  text-decoration:none}
#subsub-apply .ss-by:hover{opacity:.9}
#subsub-apply .ss-by svg{height:13px;width:auto;display:block;flex:none}
</style>
<script>
(function () {
  var root = document.getElementById("subsub-apply");
  var form = root.querySelector(".ss-form");
  var msg = root.querySelector(".ss-msg");
  var done = root.querySelector(".ss-done");
  var steps = root.querySelectorAll(".ss-step");
  var dots = root.querySelectorAll(".ss-dot");
  var back = root.querySelector(".ss-back");
  var next = root.querySelector(".ss-next");
  var go = root.querySelector(".ss-go");
  var at = 1;

  root.querySelectorAll(".ss-chip").forEach(function (b) {
    b.addEventListener("click", function () {
      b.classList.toggle("on");
      b.setAttribute("aria-pressed", b.classList.contains("on") ? "true" : "false");
    });
  });
  function chosen() {
    return [].slice.call(root.querySelectorAll(".ss-chip.on"))
      .map(function (b) { return b.getAttribute("data-cat"); });
  }
  function show(n) {
    at = n;
    for (var i = 0; i < steps.length; i++) steps[i].hidden = (i + 1) !== n;
    for (var j = 0; j < dots.length; j++) {
      if (j < n) dots[j].classList.add("on"); else dots[j].classList.remove("on");
    }
    back.hidden = n === 1;
    next.hidden = n === steps.length;
    go.hidden = n !== steps.length;
    msg.className = "ss-msg"; msg.textContent = "";
  }
  // Said on the step it is about. Walking somebody to the end and then
  // telling them the first box was wrong is how a form gets abandoned.
  function trouble(n) {
    var d = new FormData(form);
    if (n === 1) {
      if (!d.get("company") || !d.get("contact") || !d.get("email")) {
        return "Company, your name and email are needed.";
      }
      if (!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(String(d.get("email")))) {
        return "That email address doesn't look right.";
      }
      return null;
    }
    if (!chosen().length) return "Pick at least one trade.";
    return null;
  }
  next.addEventListener("click", function () {
    var bad = trouble(at);
    if (bad) { msg.className = "ss-msg bad"; msg.textContent = bad; return; }
    show(at + 1);
  });
  back.addEventListener("click", function () { show(at - 1); });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var bad = trouble(1) || trouble(2);
    if (bad) { msg.className = "ss-msg bad"; msg.textContent = bad; return; }
    var d = new FormData(form);
    go.disabled = true; msg.className = "ss-msg"; msg.textContent = "Sending\\u2026";
    fetch("${esc(apiOrigin)}/api/apply/${esc(sub)}", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company: d.get("company"), contact: d.get("contact"),
        email: d.get("email"), phone: d.get("phone") || null,
        license: d.get("license") || null,
        city: d.get("city") || null, zip: d.get("zip") || null,
        categories: chosen(), notifyEmail: true
      })
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (body) {
        if (!r.ok) throw body;
        // The form is REPLACED, not reset. A blank form under "we got it"
        // reads as an invitation to send it again, which is how an account
        // ends up with the same applicant three times.
        var em = root.querySelector(".ss-done-em");
        if (em) em.textContent = String(d.get("email") || "");
        form.hidden = true;
        done.hidden = false;
        if (done.scrollIntoView) done.scrollIntoView({ block: "nearest" });
      });
    }).catch(function (err) {
      msg.className = "ss-msg bad";
      msg.textContent = err && err.error === "invalid_email"
        ? "That email address doesn't look right."
        : err && err.error === "rate_limited"
          ? "Too many applications from here just now. Try again shortly."
          : "That didn't send. Please try again in a moment.";
    }).then(function () { go.disabled = false; });
  });

  show(1);
})();
</script>`;
}


// How many contractors an account has before it is worth telling them the
// snippet exists. Nobody puts a hiring form on their website on day one: they
// have nothing to hire for and no reason to believe anybody will fill it in.
// Three is the point at which they have used the roster enough to want it to
// fill itself, and it is early enough that the habit is still forming.
export const EMBED_NUDGE_AT = 3;
export const shouldNudgeEmbed = (subCount, alreadyNudged) =>
  !alreadyNudged && Number(subCount) >= EMBED_NUDGE_AT;

// SubSub's own address, which belongs to nobody.
export const APP_HOST = "app.subsub.work";

// Is this a subdomain somebody could actually be applying to? Cheap shape
// check only -- the account lookup is what decides whether it exists.
export const applyTargetOk = (s) =>
  /^[a-z0-9][a-z0-9-]{0,62}$/.test(String(s || "").trim().toLowerCase())
  && !["app", "www", "admin", "api", "platform"].includes(String(s).trim().toLowerCase());

// THE ADDRESS A SCANNED CODE OR A PASTED LINK OPENS, decided in one place.
//
// `<sub>.subsub.work/?apply=1` is the one to hand out when it resolves: it is
// their own name, and it is what the preview on the Branding tab shows. But a
// custom hostname is Scale, and a QR CODE THAT ENCODES AN ADDRESS WHICH DOES
// NOT RESOLVE FAILS IN FRONT OF SOMEBODY, on a job site, holding a phone --
// which is worse than having no code at all. `liveHost` is the same flag the
// embed panel already withholds its hosted link behind, for the same reason.
//
// So the fallback names the account in the QUERY STRING instead of in the
// hostname. `app.subsub.work` belongs to nobody, which is exactly why
// `?apply=<sub>` is needed there: the form applies to a specific account, and
// without the subdomain the URL is the only thing that can say which.
//
// Recruiting is deliberately NOT plan-gated -- `POST /api/apply/:subdomain`
// looks an account up by subdomain and checks no plan -- so the code has to
// work on Basic. Withholding it there would make the cheapest growth lever a
// paid feature, which is the mistake the embed panel already records against
// itself.
export function applyUrl(subdomain, { liveHost = false, origin = null } = {}) {
  const sub = String(subdomain || "").trim().toLowerCase();
  if (!applyTargetOk(sub)) return null;
  if (liveHost) return `https://${sub}.subsub.work/?apply=1`;
  return `${origin || `https://${APP_HOST}`}/?apply=${encodeURIComponent(sub)}`;
}
