# Launch list

The order things get done in, and what "done" means for each. Kept here
rather than in a chat thread because a long build generates a lot of side
issues, and a list that lives only in conversation is one that quietly
becomes whatever was most recently urgent.

**The rule: side issues do not reorder this list.** A bug found while doing
item 2 gets fixed if it blocks item 2, and otherwise gets written down under
"Found along the way" and left there until the blocking items are done.

Status: `[ ]` not started · `[~]` in progress · `[x]` done

---

## Blocking launch

- [x] **1. Console UI** — dashboard, range picker, trend chart, forms,
      responsive layout.
- [~] **2. Embedded checkout** — makes payment feel like part of SubSub
      instead of a redirect to Stripe. Code shipped. Waiting on
      `VITE_STRIPE_PUBLISHABLE_KEY` being set on the **subsub-app** Pages
      project (it is currently on **subsub-api**, where it does nothing —
      `VITE_` values are baked in at build time by whatever builds the
      page), then a **Retry deployment**.
      *Done when:* upgrading shows the card form inside the SubSub page.
- [ ] **3. Stripe live mode** — the actual gate on taking money. Everything
      today is test mode, so no real card can pay. Recreate the two prices
      in live mode, swap the secret key and webhook secret, take one real
      charge.
      *Done when:* a real card has paid and the account shows Scale.
- [ ] **4. Two-factor on Cloudflare** — the whole business sits behind that
      one login. Ten minutes, highest value per minute of anything left.
      *Done when:* 2FA is on for Cloudflare, and for the Google account if
      it can reach Cloudflare.

## Parked — deliberately not before launch

SMS notifications (Twilio) · bot protection on the signup form (Turnstile) ·
daily stats rollup in the console · contractor licence verification outside
Washington.

## Found along the way

Fixed as encountered, because each one blocked something on the list:

- Branded hostnames were a manual Cloudflare step per customer — now
  provisioned automatically, with a retry sweep and status in both consoles.
- The nightly cron had never run once: `wrangler.toml` declared a schedule
  and the Worker exported a Hono app, which has no `scheduled` handler.
- "Sign in as this account" set the browser's idea of who it was and handed
  over no session the API would accept.
- Password reset asked for a user called `undefined` — the row carries
  `userId`, the caller read `u.id`.
- Console-created users had no Supabase account, so reset had nothing to
  send to.
- Revenue reporting dropped downgrades entirely, so logged MRR drifted above
  the real figure and never came back.
