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
| `privacy-policy.html` | `/privacy-policy` | Privacy Policy |
| `terms-of-use.html` | `/terms-of-use` | Terms of Use |
| `404.html` | — | Not-found page |

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

## Build stamp

Each page carries `<meta name="build" content="...">` and an HTML comment at the top of
`<head>`. View source on a published page to confirm which version is live.
