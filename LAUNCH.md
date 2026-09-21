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
- [x] **2. Embedded checkout** — the card form renders inside the SubSub
      page. Needed the publishable key on the **subsub-app** Pages project
      rather than on the API, and `ui_mode: embedded_page` — Stripe renamed
      the old value and refused the session outright.
- [~] **3. Stripe live mode** — the actual gate on taking money. Everything
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
- Nothing in the app handled a confirmation or reset link, so a working one
  did nothing and a failed one looked identical.
- Stripe moved `current_period_end` onto subscription items, so the renewal
  date was never stored and the plan line had no date to show.
