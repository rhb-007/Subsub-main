-- 087. Every account's subscription history starts with a 'created' row.
--
-- ONE PASTE, safe to run any number of times: it only adds a row for an
-- account that has none.
--
-- The console's Subscription history, its Signups count and its conversion
-- rate all read a 'created' event, and the demo data has always carried one.
-- No route ever wrote it, so a real Basic signup showed "No events recorded"
-- and the signup count read zero. The signup route and the console's account
-- create now write one; this fills in every account that already exists.
--
-- The plan it started on is the from_plan of its earliest event when it has
-- one (an account that upgraded started on whatever it upgraded from), and its
-- plan today otherwise. Dated when the account was created. Zero MRR, because
-- a signup is not revenue: the first payment is its own event.
INSERT INTO subscription_events (id, account_id, at, kind, from_plan, to_plan, cycle, mrr_delta_cents, source)
SELECT lower(hex(randomblob(16))), a.id,
       COALESCE(a.created_at, CURRENT_TIMESTAMP), 'created', NULL,
       COALESCE((SELECT e.from_plan FROM subscription_events e
                  WHERE e.account_id = a.id AND e.from_plan IS NOT NULL
                  ORDER BY e.at, e.rowid LIMIT 1), a.plan),
       a.billing, 0, 'system'
  FROM accounts a
 WHERE NOT EXISTS (SELECT 1 FROM subscription_events e
                    WHERE e.account_id = a.id AND e.kind = 'created');
