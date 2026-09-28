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
export const applyLink = (subdomain) =>
  `https://${subdomain}.subsub.work/?apply=1`;

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

// Every class is prefixed and every rule is scoped under the root, because
// this lands in somebody else's stylesheet. A bare `.field` or `input{...}`
// would restyle their whole site, which is the fastest way to have a customer
// rip the snippet back out.
export function applyFormHtml({ subdomain, accountName, trades = [],
  apiOrigin = API_ORIGIN } = {}) {
  const sub = String(subdomain || "").trim().toLowerCase();
  if (!sub) return "";
  const name = accountName || sub;
  const options = trades
    .map((t) => `        <option value="${esc(t.id)}">${esc(t.label)}</option>`)
    .join("\n");

  return `<!-- Subcontractor application form for ${esc(name)} -->
<div id="subsub-apply">
  <form class="ss-form" novalidate>
    <label class="ss-f"><span>Company <b>*</b></span>
      <input name="company" required autocomplete="organization" /></label>
    <label class="ss-f"><span>Your name <b>*</b></span>
      <input name="contact" required autocomplete="name" /></label>
    <label class="ss-f"><span>Email <b>*</b></span>
      <input name="email" type="email" required autocomplete="email" /></label>
    <label class="ss-f"><span>Mobile</span>
      <input name="phone" type="tel" autocomplete="tel" /></label>
    <label class="ss-f"><span>What you do</span>
      <select name="categories" multiple size="6">
${options}
      </select>
      <em>Hold Ctrl (or Cmd) to pick more than one.</em></label>
    <button type="submit">Apply to work with ${esc(name)}</button>
    <p class="ss-msg" role="status" aria-live="polite"></p>
    <noscript><a href="${esc(applyLink(sub))}">Open the application form</a></noscript>
  </form>
  <div class="ss-done" role="status" aria-live="polite" hidden>
    <svg class="ss-tick" viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"
      fill="none" stroke="currentColor" stroke-width="2.5"
      stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
    <h3>That&rsquo;s with ${esc(name)}</h3>
    <p>They read every application themselves. Nobody joins their roster until they
      say so, and they will come back to you directly.</p>
    <p class="ss-done-sub">If there is anything for you to do next, it arrives at
      <b class="ss-done-em"></b>.</p>
  </div>
</div>
<style>
#subsub-apply .ss-form{display:flex;flex-direction:column;gap:14px;max-width:460px;
  font:inherit;color:inherit}
#subsub-apply .ss-f{display:flex;flex-direction:column;gap:5px;font-size:14px}
#subsub-apply .ss-f > span{font-weight:600}
#subsub-apply .ss-f b{color:#b5442e;font-weight:600}
#subsub-apply .ss-f em{font-size:12px;opacity:.7;font-style:normal}
#subsub-apply input,#subsub-apply select{font:inherit;font-size:15px;padding:9px 11px;
  border:1px solid #c9d2cc;border-radius:8px;background:#fff;color:#16241d;width:100%}
#subsub-apply input:focus,#subsub-apply select:focus{outline:2px solid #1f6b4a;
  outline-offset:1px;border-color:#1f6b4a}
#subsub-apply button{font:inherit;font-size:15px;font-weight:600;padding:11px 18px;
  border:0;border-radius:8px;background:#1f6b4a;color:#fff;cursor:pointer}
#subsub-apply button:hover:not(:disabled){background:#14523a}
#subsub-apply button:disabled{opacity:.6;cursor:default}
#subsub-apply .ss-msg{margin:0;font-size:14px;line-height:1.45}
#subsub-apply .ss-msg.ok{color:#1f6b4a}
#subsub-apply .ss-msg.bad{color:#b5442e}
/* The hidden attribute is a UA rule at the weakest specificity, and .ss-form
   sets display:flex -- which beats it, so the form would stay on screen under
   the confirmation. Anything toggled with [hidden] here has to say so itself.
   (No backticks in this file's comments: it is all one template literal.) */
#subsub-apply .ss-form[hidden],#subsub-apply .ss-done[hidden]{display:none}
#subsub-apply .ss-done{max-width:460px;text-align:center;padding:30px 22px;
  border:1px solid #c9d2cc;border-radius:12px;background:#f5faf7}
#subsub-apply .ss-tick{display:block;margin:0 auto 14px;width:44px;height:44px;padding:7px;
  box-sizing:border-box;border-radius:50%;background:#1f6b4a;color:#fff}
#subsub-apply .ss-done h3{margin:0 0 10px;font:inherit;font-size:19px;font-weight:700;
  line-height:1.3;color:#16241d}
#subsub-apply .ss-done p{margin:0;font-size:14.5px;line-height:1.55;color:#4a5a51}
#subsub-apply .ss-done-sub{margin-top:10px !important;font-size:13px !important}
#subsub-apply .ss-done b{color:#16241d}
</style>
<script>
(function () {
  var root = document.getElementById("subsub-apply");
  var form = root.querySelector(".ss-form");
  var msg = root.querySelector(".ss-msg");
  var done = root.querySelector(".ss-done");
  var btn = root.querySelector("button");
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var d = new FormData(form);
    var cats = [].slice.call(form.categories.selectedOptions || []).map(function (o) { return o.value; });
    if (!d.get("company") || !d.get("contact") || !d.get("email")) {
      msg.className = "ss-msg bad"; msg.textContent = "Company, your name and email are needed.";
      return;
    }
    btn.disabled = true; msg.className = "ss-msg"; msg.textContent = "Sending\\u2026";
    fetch("${esc(apiOrigin)}/api/apply/${esc(sub)}", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company: d.get("company"), contact: d.get("contact"),
        email: d.get("email"), phone: d.get("phone") || null,
        categories: cats, notifyEmail: true
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
    }).then(function () { btn.disabled = false; });
  });
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
