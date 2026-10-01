// The comparison and roundup pages: Markdown in, a page wearing the site's own
// chrome out.
//
// WHY THESE ARE GENERATED RATHER THAN NINE HAND-WRITTEN FILES. The same reason
// the licensing pages are: the header, the footer and the stylesheet are
// sliced out of a real page at build time, so changing the site's nav cannot
// leave nine pages behind wearing last month's. That failure is already
// recorded here against the 71 licensing pages, and it is silent -- they
// render perfectly, and they are the pages a search engine sends people to.
//
// WHY THE SOURCE IS MARKDOWN RATHER THAN A DATA STRUCTURE, which is what
// `content/licensing/data.js` is. A licensing page is facts in a shape: an
// agency, a threshold, a URL. These are PROSE -- an argument about who should
// buy what -- and prose edited as a JavaScript object is prose nobody edits.
// So the body stays Markdown, and this file renders it.
//
// THE RENDERER IS DELIBERATELY SMALL AND CLOSED. It handles exactly what these
// nine files use: h1-h3, tables, bullet and ordered lists, bold, links, `---`
// and the italic disclosure line. No images, no code fences, no nesting. A
// general Markdown library would be a dependency this site does not otherwise
// need, and a bigger surface to be quietly wrong on; the test asserts every
// heading and every table cell in the source reaches the page, which is the
// only thing that makes a hand-rolled renderer safe to use.

const esc = (s) => String(s)
  .replace(/&(?!(?:[a-zA-Z]+|#\d+);)/g, "&amp;")
  .replace(/</g, "&lt;").replace(/>/g, "&gt;");

// `JSON.stringify` does not escape `<`, and these files are hand-edited prose,
// so a title containing `</script>` would close the block and turn the rest of
// the page into markup. Same guard the licensing pages use.
export const ldJson = (obj) => JSON.stringify(obj).replace(/</g, "\\u003c");

// ---- inline ---------------------------------------------------------------
// Order matters: escape first, then put the markup in, or the tags this adds
// would be escaped too.
export function inline(md) {
  let s = esc(md);
  // Links. An absolute URL is left alone; a site-root path like /compare/ is
  // rewritten by the caller, which is the only thing that knows the depth.
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, href) => `<a href="${href}">${text}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  s = s.replace(/(^|[\s(])\*([^*]+)\*/g, "$1<em>$2</em>");
  return s;
}

// ---- frontmatter ----------------------------------------------------------
export function parse(src) {
  const m = src.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error("no frontmatter");
  const meta = {};
  for (const line of m[1].split("\n")) {
    const k = line.indexOf(":");
    if (k < 0) continue;
    meta[line.slice(0, k).trim()] = line.slice(k + 1).trim().replace(/^"|"$/g, "");
  }
  return { meta, body: m[2] };
}

// ---- block ----------------------------------------------------------------
export function toHtml(body, { rewrite = (h) => h } = {}) {
  const lines = body.split("\n");
  const out = [];
  let i = 0;
  const flushLink = (h) => h.replace(/href="([^"]+)"/g, (w, href) => `href="${rewrite(href)}"`);

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }

    // A table: a header row, a separator, then rows. The first column of these
    // tables is deliberately empty (the feature name column has no heading),
    // so an empty cell is legitimate and is not treated as the end.
    if (/^\|/.test(line) && /^\|[\s:|-]+\|$/.test(lines[i + 1] || "")) {
      const row = (l) => l.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = row(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) { rows.push(row(lines[i])); i += 1; }
      out.push('<div class="cmp-tw"><table class="cmp-t"><thead><tr>'
        + head.map((c) => `<th>${flushLink(inline(c))}</th>`).join("")
        + "</tr></thead><tbody>"
        + rows.map((r) => "<tr>" + r.map((c, n) => (n === 0 ? "<th>"
          // The column's own heading, on the cell. At phone width the table
          // stacks and the header row is gone, so without this a reader sees
          // two bare answers and no way to tell which product each is.
          : `<td data-h="${String(head[n] || "").replace(/"/g, "&quot;")}">`)
          + flushLink(inline(c)) + (n === 0 ? "</th>" : "</td>")).join("") + "</tr>").join("")
        + "</tbody></table></div>");
      continue;
    }

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const n = h[1].length;
      out.push(`<h${n}>${flushLink(inline(h[2]))}</h${n}>`);
      i += 1;
      continue;
    }

    if (/^---+\s*$/.test(line)) { out.push('<hr class="cmp-rule">'); i += 1; continue; }

    if (/^[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(flushLink(inline(lines[i].replace(/^[-*]\s+/, "")))); i += 1;
      }
      out.push("<ul>" + items.map((x) => `<li>${x}</li>`).join("") + "</ul>");
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(flushLink(inline(lines[i].replace(/^\d+\.\s+/, "")))); i += 1;
      }
      out.push("<ol>" + items.map((x) => `<li>${x}</li>`).join("") + "</ol>");
      continue;
    }

    // A paragraph runs to the next blank line. A hard-wrapped FAQ answer sits
    // directly under its bolded question, which is why the lines are joined
    // with a space rather than each becoming its own paragraph.
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|[-*]\s|\d+\.\s|\||---+\s*$)/.test(lines[i])) {
      para.push(lines[i].trim()); i += 1;
    }
    if (para.length) out.push(`<p>${flushLink(inline(para.join(" ")))}</p>`);
  }
  return out.join("\n");
}

// ---- the questions, read back off the page --------------------------------
//
// EVERY MARKED-UP ANSWER MUST BE TEXT THE READER CAN SEE. The FAQ sections are
// a bolded question and the paragraph under it, so the pairs are READ OUT of
// the body rather than written a second time beside it -- a hand-kept copy is
// the shape that lets a page claim an answer it does not give, which is the
// one thing structured data must never do.
export function faqPairs(body) {
  const out = [];
  const lines = body.split("\n");
  let inFaq = false;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^##\s/.test(lines[i])) inFaq = /^##\s+FAQ/i.test(lines[i]);
    if (!inFaq) continue;
    const q = lines[i].match(/^\*\*(.+?)\*\*\s*$/);
    if (!q) continue;
    const a = [];
    let j = i + 1;
    while (j < lines.length && lines[j].trim() && !/^(\*\*|#{1,4}\s|---)/.test(lines[j])) {
      a.push(lines[j].trim()); j += 1;
    }
    if (a.length) out.push({ q: q[1], a: a.join(" ") });
  }
  return out;
}

// ---- the page -------------------------------------------------------------
export const PAGE_CSS = `
.cmp-wrap{max-width:46rem;margin:0 auto;padding:46px 22px 72px}
.cmp-wrap h1{font-size:clamp(28px,4.4vw,40px);line-height:1.12;letter-spacing:-.02em;margin:0 0 18px}
.cmp-wrap h2{font-size:22px;letter-spacing:-.01em;margin:38px 0 12px}
.cmp-wrap h3{font-size:17px;margin:26px 0 8px}
.cmp-wrap p{line-height:1.62;margin:0 0 14px}
.cmp-wrap ul,.cmp-wrap ol{line-height:1.62;margin:0 0 16px;padding-left:22px}
.cmp-wrap li{margin:0 0 7px}
.cmp-rule{border:0;border-top:1px solid var(--line,#e3e5e1);margin:34px 0 20px}
/* A SEVEN-ROW COMPARISON TABLE AGAINST A 390px PHONE. The table scrolls
   inside this box rather than the page scrolling sideways -- which is the
   right half of it, and developers.html is recorded in CLAUDE.md as still
   getting that wrong. The other half is that a clipped table with no cue
   reads as a table simply cut off, and nobody drags it.
   The shadows are the pure-CSS version: two background layers pinned to the
   element (local) and two pinned to the viewport of it (scroll), so the
   covering layer slides away as you scroll and the shadow appears only on the
   side there is more content on. No script, which this site has no build step
   to add. */
.cmp-tw{overflow-x:auto;margin:0 0 22px;-webkit-overflow-scrolling:touch;
  background:
    linear-gradient(to right,#fff 30%,rgba(255,255,255,0)) left center/26px 100% no-repeat local,
    linear-gradient(to left,#fff 30%,rgba(255,255,255,0)) right center/26px 100% no-repeat local,
    radial-gradient(farthest-side at 0 50%,rgba(16,53,40,.16),rgba(16,53,40,0)) left center/12px 100% no-repeat scroll,
    radial-gradient(farthest-side at 100% 50%,rgba(16,53,40,.16),rgba(16,53,40,0)) right center/12px 100% no-repeat scroll}
.cmp-t{border-collapse:collapse;width:100%;font-size:14.5px;min-width:30rem}
.cmp-t th,.cmp-t td{border:1px solid var(--line,#e3e5e1);padding:9px 12px;text-align:left;vertical-align:top}
.cmp-t thead th{background:#f6f7f5;font-weight:700}
.cmp-t tbody th{font-weight:600;background:#fbfbfa}
.cmp-meta{font-size:13px;color:#5d6560;margin:0 0 26px}
.cmp-wrap em{color:#5d6560}
.cmp-idx{list-style:none;padding:0}
.cmp-idx li{margin:0 0 10px}
/* AT PHONE WIDTH THE TABLE STACKS RATHER THAN SCROLLING. Three columns in
   358px clips the last one mid-word -- "Mid-size to enterprise commercial
   constructio" -- which reads as a broken page rather than as a table with
   more to the right, and the scroll shadow above is too quiet to argue
   otherwise. Each row becomes a small card: the row label is its heading, and
   every answer says which product it belongs to, from data-h. The markup is
   unchanged, so it is still a table to a crawler and to a screen reader on a
   wider screen. */
@media(max-width:560px){
  .cmp-wrap{padding:30px 16px 56px}
  .cmp-tw{overflow:visible;background:none}
  .cmp-t{min-width:0;font-size:14px;display:block}
  .cmp-t thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
  .cmp-t tbody,.cmp-t tr,.cmp-t th,.cmp-t td{display:block;width:auto}
  .cmp-t tr{border:1px solid var(--line,#e3e5e1);border-radius:10px;margin:0 0 10px;overflow:hidden}
  .cmp-t tbody th{border:0;background:#f6f7f5;font-weight:700;padding:9px 12px}
  .cmp-t td{border:0;border-top:1px solid var(--line,#e3e5e1);padding:9px 12px}
  .cmp-t td:before{content:attr(data-h);display:block;font-size:11.5px;font-weight:700;
    text-transform:uppercase;letter-spacing:.04em;color:#5d6560;margin:0 0 2px}
  /* A heading-less first column happens on the index-style tables; an empty
     label would draw an empty line above the value. */
  .cmp-t td[data-h=""]:before{display:none}
}
`;

export function page({ meta, body, chrome, depth, rewrite, canonical, faq, reviewed }) {
  const html = toHtml(body, { rewrite });
  const graph = [{
    "@type": "WebPage", "@id": canonical, url: canonical, name: meta.title,
    description: meta.meta_description, dateModified: meta.updated,
  }];
  if (faq.length) {
    graph.push({
      "@type": "FAQPage",
      mainEntity: faq.map((f) => ({
        "@type": "Question", name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    });
  }
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(meta.title)} | SubSub</title>
<meta name="description" content="${esc(meta.meta_description)}">
<link rel="canonical" href="${canonical}">
${chrome.icons}
${chrome.fonts}
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(meta.title)}">
<meta property="og:description" content="${esc(meta.meta_description)}">
<meta property="og:url" content="${canonical}">
<script type="application/ld+json">${ldJson({ "@context": "https://schema.org", "@graph": graph })}</script>
${chrome.css}
<style>${PAGE_CSS}</style>
</head>
<body>
${chrome.header}
<main class="cmp-wrap">
${html}
<p class="cmp-meta">Reviewed ${reviewed}. Competitor pricing and features change often — check each vendor's own site before deciding.</p>
</main>
${chrome.footer}
</body>
</html>
`;
}
