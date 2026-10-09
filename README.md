# SubSub marketing site

Static HTML. No build step, no dependencies, no local assets — every page is a single
self-contained file (CSS inlined, logo inlined as SVG, favicon as a data URI). The only
external requests are Google Fonts.

## Pages

| File | URL | Purpose |
|---|---|---|
| `index.html` | `/` | Home — platform lifecycle, two-sided model, audiences |
| `pricing.html` | `/pricing` | Plans, monthly/annual toggle, comparison, FAQ |
| `book-a-demo.html` | `/book-a-demo` | Two-step demo booking: pick a time, then details |
| `get-started.html` | `/get-started` | 4-step signup flow (**noindex**) |
| `for-general-contractors.html` | `/for-general-contractors` | GC landing page |
| `for-property-managers.html` | `/for-property-managers` | Property manager landing page |
| `for-building-owners.html` | `/for-building-owners` | Building owner landing page |
| `for-portfolio-managers.html` | `/for-portfolio-managers` | Portfolio manager landing page |
| `for-subcontractors.html` | `/for-subcontractors` | Subcontractor landing page |
| `privacy-policy.html` | `/privacy-policy` | Privacy Policy |
| `terms-of-use.html` | `/terms-of-use` | Terms of Use |
| `404.html` | — | Not-found page |
| `subs.html` | `/subs` | Subcontractor landing page: the free profile, one CTA to signup (**generated**) |
| `gc.html` | `/gc` | GC landing page: the network pitch, one CTA to plans. Where every referral link lands (**generated**) |
| `check/` | `/check`, `/check/<state>/` | "Is your sub legit?" licence checker, hub + 51 state pages (**generated**) |
| `handyman-limits/` | `/handyman-limits`, `/handyman-limits/<state>/` | Handyman cap calculator, hub + 51 state pages (**generated**) |

Plus `robots.txt`, `sitemap.xml`, `_redirects`, `site.webmanifest` and the icon set
(`favicon.ico`, `favicon.svg`, `favicon-16x16.png`, `favicon-32x32.png`,
`apple-touch-icon.png`, `icon-192.png`, `icon-512.png`).

Icon and page paths are all relative, so the folder works served from a domain root, from
a subdirectory, or opened straight off disk for a local preview.

`favicon.svg` is black in a light browser UI and switches to brand gold in dark mode, so
it stays visible either way. The `.ico` and PNG fallbacks are gold for the same reason —
a black mark all but disappears on a dark tab bar.

## Deploying

Drop the whole folder in as the publish directory.

- **Cloudflare Workers (Static Assets)** — how this repo actually ships. `wrangler.jsonc`
  points `assets.directory` at `./` and deploys on push. `_redirects` is read
  automatically, same as Pages.
  **Do not add extensionless rewrites (`/pricing /pricing.html 200`) to `_redirects`
  here.** Workers static assets already serve clean URLs via `html_handling`
  (`auto-trailing-slash`), so those rules redirect onto themselves and every sub-page
  dies with "too many redirections". This took the site down once already.
- **Cloudflare Pages / Netlify** — `_redirects` is read automatically. There the
  extensionless block is safe, and it 301s the older draft filenames.
- **Vercel** — translate `_redirects` into `vercel.json` rewrites, or leave the `.html`
  URLs as they are.
- **S3 + CloudFront** — set the index document to `index.html` and the error document to
  `404.html`. Add the rewrites at the CloudFront function layer if you want clean URLs.
- **Apache** — add `Options +MultiViews` or convert `_redirects` to `.htaccess` rules.

### Before you go live

1. **Set the domain.** Canonicals, Open Graph URLs and `sitemap.xml` all point at
   `https://subsub.work`. If you launch elsewhere, find-and-replace that string.
2. **Canonicals include `.html`** so they match the files exactly. If your host serves
   extensionless URLs and you'd rather canonicalise to those, strip `.html` from the
   `<link rel="canonical">` and `og:url` tags and from `sitemap.xml` — but change both
   together, or you'll split signals.
3. **OG image** — `og-image.png` (1200×630) ships at the site root and is referenced as
   `og:image`/`twitter:image` on all ten content pages. `404.html` has no Open Graph
   block and is deliberately left out. (Favicons and app icons are done.)
4. **Wire up the forms.** The demo booking and the signup flow are front-end only —
   they validate and show a confirmation but post nothing. Point them at your backend,
   or at Formspree / Netlify Forms / Cal.com for the booking calendar.
5. **Sign-in links** point at `https://app.subsub.work`. Change if the app lives elsewhere.
6. **Submit the sitemap** in Google Search Console and Bing Webmaster Tools.

## Responsive behavior

Breakpoints at 1000px (tablet), 900px (mobile nav), 760px, 560px and 400px.

- Below 900px the header nav becomes a hamburger drawer: full-screen panel, body scroll
  locked while open, closes on link click, Escape, or resize back to desktop.
- All multi-column grids collapse to one column; the pricing comparison table scrolls
  horizontally rather than clipping.
- Buttons and nav links are at least 44px tall for touch.
- Below 400px the side gutters tighten and stacked CTAs go full width.

## SEO / AEO notes

- Unique title and meta description per page, all within display limits.
- Canonical, robots, Open Graph and Twitter Card tags on every page.
- JSON-LD on every page: `Organization` and `SoftwareApplication` (with both plan
  offers) sitewide, `WebPage` per page, `BreadcrumbList` on the audience and legal
  pages, and `FAQPage` on the home and pricing pages.
- The FAQ entries are written as direct question-and-answer pairs so answer engines can
  quote them: what SubSub does, whether subs pay, which documents are tracked, license
  verification, pricing, the free plan, the annual discount, what counts as a user.
- `robots.txt` explicitly allows GPTBot, ClaudeBot, PerplexityBot and Google-Extended,
  and disallows the signup flow.


## Free tools: /check and /handyman-limits

Both are **generated** by `cd app && npm run tools` (`app/scripts/build-tools.mjs`),
which also writes `subs.html`, `gc.html` and a sitemap for each tool
(`check/sitemap.xml`, `handyman-limits/sitemap.xml`, both declared in
`robots.txt`). Never hand-edit the output; re-run the generator. Like the
licensing pages, they take the header, footer and stylesheet from
`for-general-contractors.html`, so re-run after changing the site chrome.

- **The facts are the app's.** States come from `app/shared/states.js`, the
  handyman figures and wording from `app/shared/handycap.js` (via
  `handytool.js`, bundled into the page with esbuild), and each state's board and
  registry from `content/licensing/data.js`. Correct a figure there and re-run.
- **Licence checker, `/check`.** The page posts to the API
  (`POST /api/public/license-lookup`), which reads the state's own public
  registry, never SubSub's data. It answers only for `LIVE_STATES` in
  `app/shared/licenselookup.js`, today **Washington** (L&I), the one registry
  mapping verified against live records. Every other state's page names its
  board and links its lookup, and offers "tell me when it's live". Search is by
  registration number or business name. The preview says whose record it is;
  the status, the expiry, the bond and the insurance need an email address.
- **Swapping in a 50-state partner.** The Worker resolves a state to a provider
  (`LOOKUP_PROVIDERS` and `lookupProviderFor` in `app/worker/index.js`). A
  partner from `app/worker/licenses.js` (`PROVIDERS`) is used when
  `LICENSE_LOOKUP_PARTNER` names it and its key is set. A state only appears
  publicly once it is added to `LIVE_STATES`, which should wait until somebody
  has seen that partner's answers against real records.
- **Handyman calculator, `/handyman-limits`.** It runs in the browser. An
  excluded trade (electrical, plumbing, HVAC) answers **no** at any amount,
  because the page answers "can a handyman legally do this job?" and not the
  app's "is this work order over the line?". Every page says *Not legal advice.
  Verify with your state licensing board* and shows the data's date
  (`HANDYCAP_AS_OF`).

### Where captured emails go

Both tools store the email address in the **`leads`** table, tagged with the
tool (`check` or `handyman_limits`), the state, what was asked (never the
answer), and the referral code the visitor arrived with. Each lead is also
emailed to the address in the Worker setting **`LEADS_EMAIL`**, with the
visitor's address as reply-to. The calculator also emails the visitor the
answer they asked for.

Until then there was no lead capture anywhere: the demo form books through Cal
and stores nothing. To switch it on:

1. Paste `app/worker/migrations/076_leads.sql` into the D1 console. One
   statement block, safe to run twice. Until it is pasted, the checker still
   answers, and the email simply is not kept.
2. Add a Worker variable `LEADS_EMAIL` (for example `hello@subsub.work`) on the
   `subsub-api` Worker. Without it, leads are stored but nobody is emailed.

Read the leads in the D1 console with
`SELECT created_at, email, tool, state, detail FROM leads ORDER BY created_at DESC;`.

## Referral links on the site

A referral link is `subsub.work/gc?ref=CODE`. The `subsub-ref v1` snippet
(defined once in `content/tools/ref.mjs`) is on `gc.html`, `subs.html`,
`get-started.html`, `pricing.html` and every tool page. When the URL carries
`?ref=`, it:

- writes a cookie `ss_ref` on `.subsub.work`, so `app.subsub.work` can read it
  too, overwriting any earlier one (last touch wins);
- tells the API a link was opened (`POST /api/referrals/touch`);
- fills any element marked `data-ref-from` with "Bay Roofing invited you to
  SubSub."

`get-started.html` sends that cookie with the signup and has an optional
**Referral code** field; a code typed there beats the cookie. The copies in the
hand-written pages must stay byte-identical to the generated one, and
`app/scripts/site-tools-test.mjs` fails if they drift. To change the snippet,
edit `ref.mjs`, re-run `npm run tools`, and paste the new snippet into
`get-started.html` and `pricing.html`.

## Launch assets

Badges, the truck decal, the sticker, the supply-house flyer and the campaign
copy are in `marketing/` (see `marketing/README.md`). They are not published: the
site's `.assetsignore` is an allow-list and `marketing/` is not on it.

## Build stamp

Each page carries `<meta name="build" content="...">` and an HTML comment at the top of
`<head>`. View source on a published page to confirm which version is live.
