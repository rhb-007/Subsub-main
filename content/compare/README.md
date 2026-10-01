# Comparison pages and the roundup

Source for `/compare/` and `/blog/`. Edit the Markdown in `pages/`, then:

    cd app && npm run compare

That rewrites `compare/` and `blog/` at the repo root and `compare/sitemap.xml`.
Both directories are **generated output** — wiped and rewritten, never
hand-edited. `npm run test:compare` checks what came out.

## Before you change a price

These pages name seven competitors' pricing, and two of them — Buildertrend and
Procore — do not publish any, so those are ranges somebody read on a particular
day. When you re-check:

1. Open each vendor's own pricing page.
2. Correct the figures in `pages/`.
3. Move that file's `updated:` to today.

`npm run compare` prints a review queue of anything past its window, and
`test:compare` fails on it, so this cannot be quietly skipped.

## Three things the tests hold you to

- **Licence checks are Washington's.** Only WA carries
  `fieldMappingVerified: true` in the Worker, and the site says WA L&I. A page
  may not say "the state registry" without naming Washington. If SubSub ever
  verifies another state live, that is when the copy widens.
- **Paying subcontractors has not shipped.** The site says *Coming soon*; no
  page may offer it as working. The guard is an allow list, so a new sentence
  using the word trips it until it is either qualified or named as a different
  sense (seat fees, a competitor's billing).
- **SubSub's own prices come from `pricing.html`** — free up to 3
  subcontractors, $99/mo, $990/yr. No page may quote a different one.

## Adding a comparison

Drop a `.md` in `pages/` with the same frontmatter (`title`, `slug`,
`meta_description`, `updated`), link it from `pages/index.md`, and re-run. A
`subsub-vs-*` name lands under `/compare/`; anything else lands under `/blog/`.
