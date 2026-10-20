// The Google tag for subsub.work (Google Analytics, G-3ZHHKNP0F2), exactly as
// Google gives it, preceded by CONSENT. Every marketing page carries HEAD_TAGS
// once, immediately after <head>: the hand-written pages hold a copy and the
// three generators import this, so the generated pages cannot drift.
// test:discover checks every page; test:consent drives the banner.
//
// CONSENT has to come first, because Consent Mode reads its defaults from the
// dataLayer before the tag's config runs. Analytics cookies are granted by
// default and DENIED in the EU, the UK and Switzerland, where they need a yes
// first; Google decides the region from the visitor's address, so that half
// holds whatever the banner does. Ads storage is denied everywhere, because
// SubSub runs no advertising. The banner itself is shown to a device whose
// clock is set to a European zone, which is the only location the page can
// read without asking a server. Anybody anywhere can change their mind from
// the privacy policy (window.ssConsent.open()).
//
// No backtick may appear in either literal: it would close the template.
export const GTAG_ID = "G-3ZHHKNP0F2";

// ISO codes: the EU's 27, the rest of the EEA, the UK and Switzerland.
export const CONSENT_REGIONS = [
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE",
  "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  "IS", "LI", "NO", "GB", "CH",
];

export const CONSENT_KEY = "ss_consent";

export const CONSENT = `<!-- Cookie consent (EU, UK, Switzerland) -->
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('consent', 'default', {ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'granted'});
  gtag('consent', 'default', {analytics_storage: 'denied', region: ${JSON.stringify(CONSENT_REGIONS).replace(/"/g, "'")}});
  (function () {
    var KEY = '${CONSENT_KEY}', choice = null, tz = '';
    try { choice = localStorage.getItem(KEY); } catch (e) {}
    if (choice === 'granted' || choice === 'denied') gtag('consent', 'update', {analytics_storage: choice});
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
    var asks = /^Europe\\//.test(tz) || /^Atlantic\\/(Reykjavik|Canary|Madeira|Azores|Faroe)$/.test(tz);
    function clearGa() {
      document.cookie.split(';').forEach(function (c) {
        var n = c.split('=')[0].trim();
        if (!/^_ga/.test(n)) return;
        ['', '; domain=.subsub.work', '; domain=subsub.work'].forEach(function (d) {
          document.cookie = n + '=; Max-Age=0; path=/' + d;
        });
      });
    }
    function close() { var b = document.getElementById('ss-consent'); if (b) b.remove(); }
    function set(v) {
      try { localStorage.setItem(KEY, v); } catch (e) {}
      gtag('consent', 'update', {analytics_storage: v});
      if (v === 'denied') clearGa();
      close();
    }
    function open() {
      close();
      var b = document.createElement('div');
      b.id = 'ss-consent';
      b.setAttribute('role', 'dialog');
      b.setAttribute('aria-label', 'Cookie choice');
      b.style.cssText = 'position:fixed;left:16px;right:16px;bottom:16px;z-index:2147483647;max-width:560px;margin:0 auto;background:#fff;color:#14231c;border:1px solid #d5dcd8;border-radius:14px;box-shadow:0 12px 32px rgba(0,0,0,.18);padding:18px 20px;font:15px/1.45 system-ui,-apple-system,sans-serif';
      var p = document.createElement('p');
      p.style.cssText = 'margin:0 0 14px';
      p.appendChild(document.createTextNode('We use Google Analytics cookies to count visits and see which pages are read. Nothing is set unless you accept. '));
      var a = document.createElement('a');
      a.href = '/privacy-policy.html#cookies';
      a.textContent = 'Privacy policy';
      a.style.cssText = 'color:#1d5c41;text-decoration:underline';
      p.appendChild(a);
      b.appendChild(p);
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap';
      [['Accept analytics', 'granted'], ['Decline', 'denied']].forEach(function (x) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = x[0];
        btn.setAttribute('data-consent', x[1]);
        btn.style.cssText = 'flex:1 1 160px;min-height:44px;border-radius:10px;border:1px solid #14231c;background:#14231c;color:#fff;font:600 15px system-ui,-apple-system,sans-serif;cursor:pointer';
        btn.onclick = function () { set(x[1]); };
        row.appendChild(btn);
      });
      b.appendChild(row);
      document.body.appendChild(b);
    }
    window.ssConsent = {open: open, set: set};
    if (asks && !choice) {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', open);
      else open();
    }
  })();
</script>`;

export const GTAG = `<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${GTAG_ID}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());

  gtag('config', '${GTAG_ID}');
</script>`;

export const HEAD_TAGS = `${CONSENT}\n${GTAG}`;
