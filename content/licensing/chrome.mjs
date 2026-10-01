// The site's own header, footer and stylesheet, lifted from a real page.
//
// Copying them into a template would mean the generated pages drift the first
// time somebody changes the nav. Reading them out of an existing page at build
// time means they cannot: change the site, re-run the generator, done.
//
// The one thing that needs doing is depth. The chrome links to `index.html`
// and `favicon.svg` relatively, and these pages live two directories down, so
// every relative reference is rewritten for where the page actually sits.

import { readFileSync } from "node:fs";

const between = (src, open, close) => {
  const a = src.indexOf(open);
  if (a < 0) return "";
  const b = src.indexOf(close, a);
  return b < 0 ? "" : src.slice(a, b + close.length);
};

export function readChrome(fromFile) {
  const src = readFileSync(fromFile, "utf8");
  return {
    // NOTE: each of these carries its own tags -- `css` is a whole
    // `<style>...</style>` block, not its contents. Wrapping it in another
    // `<style>` closes it at the inner tag and renders the rest of the
    // stylesheet to the page as text, on an unstyled page. Emit it bare.
    css: between(src, "<style>", "</style>"),
    header: between(src, '<header class="site">', "</header>"),
    footer: between(src, '<footer class="site">', "</footer>"),
    icons: (src.match(/<link rel="(?:icon|apple-touch-icon|manifest)"[^>]*>/g) || []).join("\n"),
    fonts: (src.match(/<link[^>]*fonts\.(?:googleapis|gstatic)\.com[^>]*>/g) || []).join("\n"),
  };
}

// Relative hrefs and srcs, moved down `depth` directories. Anything already
// absolute, a fragment, a full URL or a mailto is left alone.
export function atDepth(html, depth) {
  if (!depth) return html;
  const up = "../".repeat(depth);
  return html.replace(/\b(href|src)="([^"]+)"/g, (whole, attr, val) => {
    if (/^(https?:|mailto:|tel:|#|\/|data:)/.test(val)) return whole;
    return `${attr}="${up}${val}"`;
  });
}
