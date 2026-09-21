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
- [x] **5. Send invites, by email and text** — done for tenants: the account
      types in who lives where, or uploads the list it already keeps, and
      SubSub sends the invite. Email works today (Resend is configured).
      **Text needs Twilio credentials** — `TWILIO_ACCOUNT_SID`,
      `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` — and until they are set, a text is
      reported as not sent rather than silently dropped.
      Still to do: the same for **subcontractor** invites, which are still a
      link the account copies.
- [ ] **6. Subcontractor invites, sent the same way** — the tenant side is
      done; a subcontractor invite is still a link somebody copies. Same
      machinery, one audience along.
- [ ] **7. Photos on a tenant report** — a picture of the leak is worth more
      than the paragraph describing it: it decides which trade goes out, and
      often whether anyone needs to go out twice. Jobs already carry uploaded
      files and the bucket is already there, so this is a camera button on the
      report form, thumbnails on the job, and nothing new underneath.
      *Done when:* a tenant can attach photos from a phone, and they appear on
      the job the contractor is sent.

## Worth doing when tenants are in real use

- Telling a tenant when something changes. They see status when they look;
  they are not told, and "has anyone done anything" is the question the
  feature exists to stop being asked by phone.
- Whether a building is flats or offices is guessed from the account type,
  which is the only signal there is. A management company holding both gets the
  residential list when browsing; typing finds either. A flag on the property
  itself would settle it properly.

## Parked — deliberately not before launch

Bot protection on the signup form (Turnstile) ·
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
- An account's type (general contractor, property manager, and so on) could
  only be corrected in the database, so one picked wrongly at signup was
  stuck. The console can now change it — Accounts, open the account, Account
  type — and it is superadmin-only, because it decides whether the account
  keeps a building list.
- The logo and company name in both headers did nothing when clicked, which
  is the one thing every other site on the web has trained people to try.
- A job's property was never saved. The column existed and was cleared when a
  building was deleted, but nothing wrote it and nothing read it, so a job's
  building survived until the page reloaded. Owner scoping is built on that
  link, so it had to be real first.
- Two taps on a property picker in the same instant kept only the second.
- A seat's role read as "Property manager (property manager)" whenever the
  account's own type was the same word as the role.
- The tenant vocabulary shipped in British English — flat, tap, cupboard,
  lift, fuse box, mould. Rewritten: apartment, faucet, cabinet, elevator,
  breaker, mold. The unit field now asks an office for a suite and an
  apartment for an apartment.
- Switching an account's type to "general contractor" left any scoped seat on
  it with no building list, and their dashboard crashed on it rather than
  showing an empty one.
- The role called "Project Manager" is now "Property manager" throughout.
  These accounts are property businesses; project-manager was general
  contractor language that had been left on the role everywhere.

## Known, not blocking

- `scripts/hostnames-test.mjs` has three failing assertions in its `diagnose`
  section. They fail on the commit before this work too, and branded hostnames
  provision correctly in production, so this is test drift rather than a live
  fault. Worth a look before anyone trusts that file again.
- The Add menu has a "User" entry behind `can("users")`, and no role grants
  `users`, so it never renders. Users are managed from My account -> Users,
  which works. Dead branch, harmless.
