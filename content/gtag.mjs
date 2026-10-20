// The Google tag for subsub.work (Google Analytics, G-3ZHHKNP0F2), exactly as
// Google gives it. Every marketing page carries it once, immediately after
// <head>: the hand-written pages hold a copy and the three generators import
// this, so the generated pages cannot drift. test:sitetools counts it per page.
export const GTAG_ID = "G-3ZHHKNP0F2";
export const GTAG = `<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${GTAG_ID}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());

  gtag('config', '${GTAG_ID}');
</script>`;
