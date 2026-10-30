-- 101. A second business made before this release copied the first one's
-- page titles into its own theme, so its sign-in and sign-up tabs named the
-- other company ("Sound-Property-Management-Sign-in" on Sound Maintenance).
-- Take each title off the second account where it is still exactly the
-- first account's, which is the copy and not something anybody typed since.
-- With them off, the pages fall back to titles built from the account's own
-- name. Safe to run twice.
UPDATE accounts SET theme = json_remove(theme, '$.signInTitle')
 WHERE theme IS NOT NULL AND json_valid(theme)
   AND json_extract(theme, '$.signInTitle') IS NOT NULL
   AND id IN (SELECT l.account_b FROM business_links l JOIN accounts a ON a.id = l.account_a
               WHERE json_valid(a.theme)
                 AND json_extract(a.theme, '$.signInTitle') = json_extract(accounts.theme, '$.signInTitle'));
UPDATE accounts SET theme = json_remove(theme, '$.applyTitle')
 WHERE theme IS NOT NULL AND json_valid(theme)
   AND json_extract(theme, '$.applyTitle') IS NOT NULL
   AND id IN (SELECT l.account_b FROM business_links l JOIN accounts a ON a.id = l.account_a
               WHERE json_valid(a.theme)
                 AND json_extract(a.theme, '$.applyTitle') = json_extract(accounts.theme, '$.applyTitle'));
