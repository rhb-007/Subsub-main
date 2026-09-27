// Turning the dataset into pages.
//
// Every page answers its question in the first forty words, because that is
// what somebody searched for and burying it is the mistake every reference
// page makes. Then the facts, then the bridge -- "here is what you will be
// asked for whatever the state says" -- which is the only reason either kind
// of reader has to do anything.
//
// Two CTAs, because two people land here with opposite problems. A
// subcontractor checking what they need, and a hiring contractor checking what
// to ask for. Same facts, different door.

import { LEVEL_LABEL, answerFor, baselineOf, earnsPage, ASKED_ANYWAY, pageUrl }
  from "../../app/shared/licensing.js";

export const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

const SITE = "https://subsub.work";

// Extra rules the generated pages need, appended to the site's own stylesheet
// rather than replacing it. Everything is prefixed so nothing here can reach
// the rest of the site.
export const PAGE_CSS = `
.lic-wrap{max-width:720px;margin:0 auto;padding:26px 20px 60px}
.lic-crumb{display:flex;gap:7px;flex-wrap:wrap;font-size:12px;color:var(--muted);margin-bottom:16px}
.lic-crumb a{color:var(--muted);text-decoration:none}
.lic-crumb a:hover{text-decoration:underline}
.lic-wrap h1{font-size:clamp(27px,6vw,38px);line-height:1.1;letter-spacing:-.02em;margin:0 0 12px}
.lic-sub{margin:0 0 22px;font-size:17px;color:var(--muted);max-width:56ch}
.lic-answer{background:var(--forest);color:#EAF2ED;border-radius:14px;padding:22px 24px;margin-bottom:12px}
.lic-answer .lab{font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#8FBBA6;margin-bottom:9px}
.lic-answer .big{font-size:clamp(20px,4.4vw,25px);line-height:1.24;font-weight:600;margin:0 0 10px}
.lic-answer p{margin:0;font-size:14.5px;line-height:1.6;color:#C8DCD1}
.lic-stamp{font-size:11.5px;color:var(--muted);margin-bottom:30px}
.lic-stamp b{color:var(--ink);font-weight:500}
.lic-wrap h2{font-size:21px;letter-spacing:-.012em;margin:34px 0 10px}
.lic-facts{border:1px solid var(--rule);border-radius:12px;background:var(--white);overflow:hidden;margin:14px 0}
.lic-fact{display:flex;gap:14px;padding:13px 16px;border-bottom:1px solid var(--rule);font-size:14.5px}
.lic-fact:last-child{border-bottom:0}
.lic-fact .k{flex:0 0 42%;color:var(--muted);font-size:13.5px}
.lic-fact .v{flex:1;font-weight:500}
.lic-pill{display:inline-block;font-size:10.5px;font-weight:700;padding:2px 9px;border-radius:20px;
  letter-spacing:.03em;text-transform:uppercase}
.lic-pill.state{background:#E7F1EB;color:var(--forest-lift)}
.lic-pill.registration{background:#E7F1EB;color:var(--forest-lift)}
.lic-pill.local{background:#FCF4E6;color:#96600C}
.lic-pill.none{background:#FBEFEB;color:#9B3A22}
.lic-docs{display:grid;gap:9px;margin:14px 0;padding:0;list-style:none}
.lic-docs li{display:flex;gap:12px;align-items:flex-start;padding:13px 15px;background:var(--white);
  border:1px solid var(--rule);border-radius:11px}
.lic-docs .n{flex:none;width:22px;height:22px;border-radius:6px;background:var(--forest);color:#fff;
  font-size:11px;font-weight:700;display:grid;place-items:center;margin-top:1px}
.lic-docs b{display:block;font-size:14.5px}
.lic-docs span{display:block;font-size:13px;color:var(--muted);line-height:1.5}
.lic-cta{border-radius:14px;padding:20px 22px;margin:24px 0}
.lic-cta .who{font-size:10.5px;letter-spacing:.13em;text-transform:uppercase;margin-bottom:8px}
.lic-cta h3{font-size:19px;margin:0 0 8px;letter-spacing:-.01em}
.lic-cta p{font-size:14px;margin:0 0 14px}
.lic-cta .btn{display:inline-block;font-weight:600;font-size:14.5px;padding:11px 20px;border-radius:9px;
  text-decoration:none}
.lic-sub-cta{background:var(--forest);color:#DCE9E2}
.lic-sub-cta .who{color:#8FBBA6}
.lic-sub-cta h3{color:#fff}
.lic-sub-cta .btn{background:var(--gold);color:#241705}
.lic-gc-cta{background:#FCF4E6;border:1px solid #EEDCBC}
.lic-gc-cta .who{color:#96600C}
.lic-gc-cta p{color:var(--muted)}
.lic-gc-cta .btn{background:var(--forest);color:#fff}
.lic-chips{display:flex;flex-wrap:wrap;gap:7px;margin:12px 0;padding:0;list-style:none}
.lic-chips li span,.lic-chips li a{display:block;font-size:13px;padding:6px 12px;border:1px solid var(--rule);
  border-radius:20px;background:var(--white);color:var(--ink);text-decoration:none}
.lic-src{font-size:12.5px;color:var(--muted);border-left:2px solid var(--rule);padding-left:13px;margin:18px 0}
.lic-src b{color:var(--ink);font-weight:500}
.lic-src a{color:var(--forest-lift)}
.lic-quirk{background:#FCF4E6;border:1px solid #EEDCBC;border-radius:12px;padding:16px 18px;margin:18px 0}
.lic-quirk b{display:block;font-size:14.5px;margin-bottom:5px}
.lic-quirk p{margin:0;font-size:13.5px;line-height:1.55;color:var(--muted)}
.lic-rel{border-top:1px solid var(--rule);margin-top:40px;padding-top:20px}
.lic-rel h2{margin-top:0;font-size:16px}
.lic-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px}
.lic-grid a{display:block;padding:11px 13px;border:1px solid var(--rule);border-radius:10px;
  background:var(--white);text-decoration:none;color:var(--ink);font-size:13.5px}
.lic-grid a:hover{border-color:var(--forest-line)}
.lic-grid em{display:block;font-style:normal;font-size:11.5px;color:var(--muted);margin-top:2px}
@media (max-width:520px){.lic-fact{flex-direction:column;gap:3px}.lic-fact .k{flex:none}}
`;

// How far below the site root this page sits, taken from the canonical URL
// rather than passed in. Every page already declares where it lives, and two
// of the four kinds were given the wrong depth by hand -- the state hub and
// the licensing index each came up one short, so the site's own nav and every
// favicon 404ed on them. A number that has to agree with a path is a number
// that will stop agreeing with it; deriving it cannot.
export const depthOf = (canonical) => String(canonical)
  .replace(/^\/+|\/+$/g, "")          // "/licensing/tx/" -> "licensing/tx"
  .replace(/\/[^/]*\.\w+$/, "")        // ".../electrical.html" -> ".../tx"
  .split("/").filter(Boolean).length;

// Structured data, serialised for a <script> block.
//
// JSON.stringify does not escape "<", so a source name or a detail sentence in
// data.js containing "</script>" would close the block and turn the rest of the
// page into markup. That file is hand-edited prose, so this is a real path, not
// a theoretical one.
const ldJson = (obj) => JSON.stringify(obj)
  .replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");

// The page's own question-and-answer markup.
//
// These pages ARE questions -- the H1 of a trade page is the search query --
// and FAQPage is what lets an answer engine quote one rather than paraphrase
// around it. Two rules, both of which matter more than the traffic:
//
//   EVERY ANSWER IS TEXT THAT IS VISIBLE ON THE PAGE. Marking up an answer the
//   reader cannot see is what the FAQ rich-result guidelines call out, and it
//   is the kind of thing that costs a whole site its eligibility. So each pair
//   below is built from the same values the body renders, never from anything
//   extra.
//
//   AND NOTHING IS MARKED UP THAT IS NOT ASKED. A page with no real question on
//   it gets no FAQPage rather than a manufactured one.
export function page({ chrome, title, description, canonical, crumbs, body,
  faq = [], modified, citation }) {
  const { atDepth } = chrome;
  const depth = depthOf(canonical);
  const graph = [{
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem", position: i + 1, name: c.name,
      item: `${SITE}${c.url}`,
    })),
  }];
  // dateModified is the date somebody CHECKED the statute, which is the whole
  // claim these pages make. It is on the page in words ("Checked 2026-09-12");
  // this is the machine-readable half, and an answer engine deciding whether a
  // licensing answer is current has nothing else to go on.
  if (modified) {
    graph.push({
      "@type": "WebPage",
      "@id": `${SITE}${canonical}`,
      url: `${SITE}${canonical}`,
      name: title,
      description,
      dateModified: modified,
      isPartOf: { "@type": "WebSite", name: "SubSub", url: `${SITE}/` },
      ...(citation ? { citation: { "@type": "CreativeWork", name: citation.name,
        ...(citation.url ? { url: citation.url } : {}) } } : {}),
    });
  }
  if (faq.length) {
    graph.push({
      "@type": "FAQPage",
      mainEntity: faq.map(({ q, a }) => ({
        "@type": "Question", name: q,
        acceptedAnswer: { "@type": "Answer", text: a },
      })),
    });
  }
  const ld = { "@context": "https://schema.org", "@graph": graph };
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${SITE}${canonical}">
${atDepth(chrome.icons, depth)}
${chrome.fonts}
<meta name="theme-color" content="#103528">
${chrome.css}
<style>${PAGE_CSS}</style>
<script type="application/ld+json">${ldJson(ld)}</script>
</head>
<body>
${atDepth(chrome.header, depth)}
<main>
  <div class="lic-wrap">
    <nav class="lic-crumb">${crumbs.map((c, i) => i === crumbs.length - 1
      ? `<span>${esc(c.name)}</span>`
      : `<a href="${c.url}">${esc(c.name)}</a> <span>/</span>`).join("\n      ")}</nav>
${body}
  </div>
</main>
${atDepth(chrome.footer, depth)}
</body>
</html>
`;
}

// The one question every page on this section answers, and the only Q&A pair
// shared by all of them: its answer is the paragraph under "What you will be
// asked for anyway" followed by the four labels, which is what that block
// renders on every page.
const DOCS_QA = {
  q: "What documents will a hiring contractor ask for?",
  a: "No state requirement does not mean no paperwork. Every hiring contractor and "
    + "property manager worth working for asks for the same four things before anybody "
    + "starts, and asks again every time one expires: "
    + ASKED_ANYWAY.map(([, label]) => label).join(", ") + ".",
};

// Plain text from a value the body renders as HTML entities. The FAQ answer has
// to be the visible text, so it has to be the same words -- just without the
// markup the reader never sees.
const plain = (s) => String(s == null ? "" : s)
  .replace(/&mdash;/g, "\u2014").replace(/&ndash;/g, "\u2013")
  .replace(/&middot;/g, "\u00b7").replace(/&ldquo;|&rdquo;/g, '"')
  .replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

const pill = (lvl) => `<span class="lic-pill ${esc(lvl)}">${esc(LEVEL_LABEL[lvl] || lvl)}</span>`;

const sourceBlock = (e) => e && e.source ? `
    <div class="lic-src">
      <b>Where this comes from.</b> ${esc(e.source)}${e.sourceUrl
        ? ` &mdash; <a href="${esc(e.sourceUrl)}" rel="nofollow">the source</a>` : ""}.
      Checked ${esc(e.verifiedOn)}. This is a reference, not legal advice: if a contract
      turns on it, read the statute.
    </div>` : "";

const askedAnyway = (who) => `
    <h2>What you will be asked for anyway</h2>
    <p>No state requirement does not mean no paperwork. Every hiring contractor and
      property manager worth working for asks for the same four things before anybody
      starts, and asks again every time one expires.</p>
    <ul class="lic-docs">
${ASKED_ANYWAY.map(([, label, note], i) => `      <li><span class="n">${i + 1}</span>
        <div><b>${esc(label)}</b><span>${esc(note)}</span></div></li>`).join("\n")}
    </ul>`;

const SUB_CTA = `
    <div class="lic-cta lic-sub-cta">
      <div class="who">If you are the contractor</div>
      <h3>Send all four in one link, once.</h3>
      <p>Keep them in one place and answer the next contractor who asks in about six
        seconds &mdash; with a page showing your carrier, policy number, cover and
        expiry, that updates itself when you renew. Free, and whoever you send it to
        needs no account.</p>
      <a class="btn" href="https://app.subsub.work/">Set up your document pack</a>
    </div>`;

const GC_CTA = (what) => `
    <div class="lic-cta lic-gc-cta">
      <div class="who">If you are hiring one</div>
      <h3>Check the certificate before they start.</h3>
      <p>${esc(what)} What you can always check is the insurance, the bond, and whether
        either has lapsed since the day it was emailed to you. That last part is where it
        usually goes wrong: a PDF attached in March says nothing about July.</p>
      <a class="btn" href="https://app.subsub.work/">Keep a roster current</a>
    </div>`;

// ---- state + trade ------------------------------------------------------

export function tradePage({ chrome, state, trade, others }) {
  const a = answerFor(state, trade.id);
  const base = baselineOf(state);
  const needs = a.licence === "state" || a.licence === "registration";
  const title = `${trade.label} contractor licence in ${state.name} | SubSub`;
  const body = `
    <h1>Do ${trade.label.toLowerCase()} contractors need a licence in ${esc(state.name)}?</h1>
    <p class="lic-sub">What the state requires, and what a hiring contractor will ask you
      for either way.</p>

    <div class="lic-answer">
      <div class="lab">The short answer</div>
      <p class="big">${needs ? "Yes" : "No"}. ${esc(a.detail || LEVEL_LABEL[a.licence])}</p>
      <p>${needs
        ? `This is different from ${esc(state.name)}'s general position, which is
           &ldquo;${esc((LEVEL_LABEL[base.licence] || "").toLowerCase())}&rdquo; for trades
           the state does not single out.`
        : `That does not mean nothing is required &mdash; cities set their own rules, and
           the contractor hiring you will ask for insurance whatever the state says.`}</p>
    </div>
    <p class="lic-stamp">Last verified <b>${esc(a.verifiedOn)}</b>${a.body
      ? ` &middot; Administered by <b>${esc(a.body)}</b>` : ""}</p>

    <h2>What ${esc(state.name)} requires</h2>
    <div class="lic-facts">
      <div class="lic-fact"><span class="k">For ${esc(trade.label.toLowerCase())}</span>
        <span class="v">${pill(a.licence)}</span></div>
      <div class="lic-fact"><span class="k">Who administers it</span>
        <span class="v">${esc(a.body || "Nobody at state level")}</span></div>
      <div class="lic-fact"><span class="k">For trades the state is silent on</span>
        <span class="v">${pill(base.licence)}</span></div>
      <div class="lic-fact"><span class="k">Searchable state registry</span>
        <span class="v">${state.registry?.searchable
          ? `Yes &mdash; ${esc(state.registry.name)}` : "No"}</span></div>
    </div>
${sourceBlock(a.own || a)}
${askedAnyway()}
${SUB_CTA}
${GC_CTA(needs
    ? `A ${trade.label.toLowerCase()} licence in ${state.name} can be looked up, and should be.`
    : `There is no ${state.name} licence number to check for this trade, because there isn't one.`)}
${relatedBlock(state, trade, others)}`;
  // Each answer is the visible text of the block it names, in plain words.
  const faq = [
    { q: `Do ${trade.label.toLowerCase()} contractors need a licence in ${state.name}?`,
      a: `${needs ? "Yes" : "No"}. ${plain(a.detail || LEVEL_LABEL[a.licence])}` },
    { q: `Who administers ${trade.label.toLowerCase()} licensing in ${state.name}?`,
      a: a.body
        ? `${plain(a.body)} administers it.`
        : `Nobody at state level. ${state.name} does not administer a licence for this trade.` },
    { q: `Is there a searchable ${state.name} licence register?`,
      a: state.registry?.searchable
        ? `Yes — ${plain(state.registry.name)}.`
        : `No. ${state.name} publishes no searchable register for this trade.` },
    DOCS_QA,
  ];
  return page({ chrome, title, faq,
    modified: a.verifiedOn,
    citation: (a.own || a).source
      ? { name: plain((a.own || a).source), url: (a.own || a).sourceUrl } : null,
    description: `${needs ? "Yes" : "No"} — ${a.detail || LEVEL_LABEL[a.licence]} `
      + `What ${state.name} requires for ${trade.label.toLowerCase()} work, and what hiring `
      + `contractors ask for regardless.`,
    canonical: `/licensing/${state.code.toLowerCase()}/${trade.id}.html`,
    crumbs: [{ name: "SubSub", url: "/" }, { name: "Licensing", url: "/licensing/" },
      { name: state.name, url: `/licensing/${state.code.toLowerCase()}/` },
      { name: trade.label, url: `/licensing/${state.code.toLowerCase()}/${trade.id}.html` }],
    body });
}

// ---- state hub ----------------------------------------------------------

export function statePage({ chrome, state, trades, today }) {
  const base = baselineOf(state);
  const differs = trades.filter((t) => earnsPage(state, t.id, { today }).ok);
  const same = trades.filter((t) => !earnsPage(state, t.id, { today }).ok);
  const strict = base.licence === "state" || base.licence === "registration";
  const title = `Contractor licensing in ${state.name} | SubSub`;
  const body = `
    <h1>Contractor licensing in ${esc(state.name)}</h1>
    <p class="lic-sub">What the state requires, which trades are treated differently, and
      what you will be asked for whatever the answer is.</p>

    <div class="lic-answer">
      <div class="lab">The short answer</div>
      <p class="big">${esc(base.detail || LEVEL_LABEL[base.licence])}</p>
      <p>${differs.length
        ? `${differs.length} trade${differs.length === 1 ? " is" : "s are"} treated
           differently and ${differs.length === 1 ? "has" : "have"} their own page below.`
        : `No trade is singled out: the same answer applies across the board.`}</p>
    </div>
    <p class="lic-stamp">Last verified <b>${esc(base.verifiedOn)}</b>${base.body
      ? ` &middot; ${esc(base.body)}` : ""}</p>
${state.quirk ? `
    <div class="lic-quirk">
      <b>${esc(state.quirk.title)}</b>
      <p>${esc(state.quirk.body)}</p>
    </div>` : ""}

    <h2>Trades with their own rules</h2>
    ${differs.length ? `<div class="lic-grid">
${differs.map((t) => {
      const a = answerFor(state, t.id);
      return `      <a href="${t.id}.html">${esc(t.label)}<em>${esc(LEVEL_LABEL[a.licence])}${
        a.body ? ` &middot; ${esc(a.body)}` : ""}</em></a>`;
    }).join("\n")}
    </div>` : `<p>None. ${esc(state.name)} applies the same rule to every trade.</p>`}

    <h2>Everything else</h2>
    <p>These ${same.length} trades fall under ${esc(state.name)}'s general position above &mdash;
      ${esc((LEVEL_LABEL[base.licence] || "").toLowerCase())}. There is no separate rule for
      any of them, which is why there is no separate page.</p>
    <ul class="lic-chips">
${same.map((t) => `      <li><span>${esc(t.label)}</span></li>`).join("\n")}
    </ul>
${state.registry ? `
    <h2>Checking a licence</h2>
    <div class="lic-facts">
      <div class="lic-fact"><span class="k">Registry</span>
        <span class="v">${state.registry.searchable
          ? `<a href="${esc(state.registry.url)}" rel="nofollow">${esc(state.registry.name)}</a>`
          : "None"}</span></div>
      ${state.registry.note
        ? `<div class="lic-fact"><span class="k">Worth knowing</span>
             <span class="v">${esc(state.registry.note)}</span></div>` : ""}
    </div>` : ""}
${sourceBlock(base)}
${askedAnyway()}
${SUB_CTA}
${GC_CTA(strict
    ? `${state.name} registers contractors, so a licence number can be looked up.`
    : `${state.name} has no general contractor licence to look up.`)}
${state.cities?.length ? `
    <h2>Cities that add their own rules</h2>
    <p>Where the state is quiet, municipalities fill the gap, and they do not agree with
      each other. If you work across a metro you are dealing with several sets at once.</p>
    <ul class="lic-chips">
${state.cities.map((c) => `      <li><span>${esc(c)}</span></li>`).join("\n")}
    </ul>` : ""}`;
  const faq = [
    { q: `Does ${state.name} require a contractor licence?`,
      a: plain(base.detail || LEVEL_LABEL[base.licence]) },
    { q: `Which trades does ${state.name} treat differently?`,
      a: differs.length
        ? `${differs.length} of them: ${differs.map((t) => t.label).join(", ")}.`
        : `None. ${state.name} applies the same rule to every trade.` },
    // Only where there IS a register. Where there is none the page says "None"
    // in a table cell and nothing more, which is too thin to mark up as an
    // answer -- the same rule that keeps the index to one pair.
    ...(state.registry?.searchable ? [{
      q: `How do you check a ${state.name} contractor licence?`,
      a: `${plain(state.registry.name)}${state.registry.note
        ? `. ${plain(state.registry.note)}` : "."}` }] : []),
    DOCS_QA,
  ];
  return page({ chrome, title, faq,
    modified: base.verifiedOn,
    citation: base.source ? { name: plain(base.source), url: base.sourceUrl } : null,
    description: `${base.detail || LEVEL_LABEL[base.licence]} Which trades ${state.name} `
      + `treats differently, and what hiring contractors ask for regardless.`,
    canonical: `/licensing/${state.code.toLowerCase()}/`,
    crumbs: [{ name: "SubSub", url: "/" }, { name: "Licensing", url: "/licensing/" },
      { name: state.name, url: `/licensing/${state.code.toLowerCase()}/` }],
    body });
}

// ---- trade hub ----------------------------------------------------------

export function tradeHubPage({ chrome, trade, states, today }) {
  const rows = states
    .filter((st) => earnsPage(st, trade.id, { today }).ok)
    .map((st) => ({ st, a: answerFor(st, trade.id) }));
  const title = `${trade.label} licensing by state | SubSub`;
  const body = `
    <h1>${esc(trade.label)} licensing, state by state</h1>
    <p class="lic-sub">Where ${esc(trade.label.toLowerCase())} is treated differently from
      the rest of construction, and who administers it.</p>
    <div class="lic-grid">
${rows.map(({ st, a }) => `      <a href="../${st.code.toLowerCase()}/${trade.id}.html">${esc(st.name)}<em>${
      esc(LEVEL_LABEL[a.licence])}${a.body ? ` &middot; ${esc(a.body)}` : ""}</em></a>`).join("\n")}
    </div>
    <p class="lic-src"><b>Only the states with a specific rule are listed.</b> Where a state
      applies the same requirement to every trade, its own page says so once rather than
      repeating it twenty-nine times.</p>
${askedAnyway()}
${SUB_CTA}`;
  // The freshest date across the states listed: the hub is only as current as
  // its most recently checked row, and claiming the oldest would understate it
  // while claiming a date nothing was checked on would be a lie.
  const modified = rows.map(({ a }) => (a.own || a).verifiedOn).filter(Boolean).sort().pop();
  const faq = [
    { q: `Which states license ${trade.label.toLowerCase()} contractors separately?`,
      a: rows.length
        ? `${rows.map(({ st }) => st.name).join(", ")}. Where a state applies the same `
          + `requirement to every trade, its own page says so once.`
        : `None on record yet.` },
    DOCS_QA,
  ];
  return page({ chrome, title, faq, modified,
    description: `Which states treat ${trade.label.toLowerCase()} differently from other `
      + `construction work, who administers the licence, and what hiring contractors ask for.`,
    canonical: `/licensing/trade/${trade.id}.html`,
    crumbs: [{ name: "SubSub", url: "/" }, { name: "Licensing", url: "/licensing/" },
      { name: trade.label, url: `/licensing/trade/${trade.id}.html` }],
    body });
}

// ---- the index ----------------------------------------------------------

export function indexPage({ chrome, states, trades, today }) {
  const hubs = trades.filter((t) =>
    states.filter((st) => earnsPage(st, t.id, { today }).ok).length > 1);
  const body = `
    <h1>Contractor licensing, by state and trade</h1>
    <p class="lic-sub">What each state actually requires, who administers it, and what a
      hiring contractor will ask you for whatever the answer is. Every page says where its
      answer came from and when it was last checked.</p>

    <h2>By state</h2>
    <div class="lic-grid">
${states.map((st) => {
    const b = baselineOf(st);
    return `      <a href="${st.code.toLowerCase()}/">${esc(st.name)}<em>${
      esc(LEVEL_LABEL[b.licence])}</em></a>`;
  }).join("\n")}
    </div>
${hubs.length ? `
    <h2>By trade</h2>
    <div class="lic-grid">
${hubs.map((t) => `      <a href="trade/${t.id}.html">${esc(t.label)}<em>Licensed separately in several states</em></a>`).join("\n")}
    </div>` : ""}

    <p class="lic-src"><b>Why there is not a page for every combination.</b> Most states
      apply one rule to most trades, so a page per state per trade would be the same answer
      reworded 1,400 times. A trade gets its own page only where the state singles it out;
      everything else is on the state's page, once.</p>
${SUB_CTA}`;
  // One pair, and only because the answer is a section of the page. The index
  // is a directory of links, not a question -- manufacturing four to fill the
  // markup out is the thing the guidelines exist to stop.
  const faq = [
    { q: "Why is there not a page for every state and trade?",
      a: "Most states apply one rule to most trades, so a page per state per trade would "
        + "be the same answer reworded 1,400 times. A trade gets its own page only where "
        + "the state singles it out; everything else is on the state's page, once." },
    DOCS_QA,
  ];
  return page({ chrome, faq,
    title: "Contractor licensing by state and trade | SubSub",
    description: "What each state requires of contractors, which trades are licensed "
      + "separately, and what hiring contractors ask for regardless. Sourced and dated.",
    canonical: "/licensing/",
    crumbs: [{ name: "SubSub", url: "/" }, { name: "Licensing", url: "/licensing/" }],
    body });
}

// Internal linking is what makes a set of pages a section rather than a pile.
function relatedBlock(state, trade, others) {
  const sameState = others.sameState.filter((t) => t.id !== trade.id).slice(0, 3);
  const otherStates = others.otherStates.slice(0, 3);
  if (!sameState.length && !otherStates.length) return "";
  return `
    <div class="lic-rel">
      <h2>Related</h2>
      <div class="lic-grid">
${sameState.map((t) => `        <a href="${t.id}.html">${esc(t.label)} in ${esc(state.name)}<em>${
    esc(LEVEL_LABEL[answerFor(state, t.id).licence])}</em></a>`).join("\n")}
${otherStates.map((st) => `        <a href="../${st.code.toLowerCase()}/${trade.id}.html">${
    esc(trade.label)} in ${esc(st.name)}<em>${
    esc(LEVEL_LABEL[answerFor(st, trade.id).licence])}</em></a>`).join("\n")}
        <a href="./">Every trade in ${esc(state.name)}<em>What the state requires overall</em></a>
      </div>
    </div>`;
}
