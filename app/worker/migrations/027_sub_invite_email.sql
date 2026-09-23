-- Who a subcontractor invite was sent to, and when.
--
-- An invite was a token and an optional label. The account created one,
-- copied the URL out of SubSub, and pasted it into their own email -- which
-- put the only step that matters, the message arriving, outside the product
-- entirely. Nothing here knew whether it was ever sent, to whom, or whether
-- it bounced, and a general contractor onboarding twenty subcontractors did
-- twenty copy-pastes with twenty chances to send the wrong link to the wrong
-- company.
--
-- So the address is stored and SubSub does the sending. `label` stays: an
-- account may still want a link to hand over in person or in a text thread,
-- and taking that away would be removing something that works.
--
-- sent_at is separate from created_at on purpose. A link made to copy has
-- never been sent and should not claim to have been, and a send that failed
-- must leave this null so the row reads as what it is -- made, not
-- delivered -- rather than as a message somebody is waiting on.
ALTER TABLE sub_invites ADD COLUMN email TEXT;
ALTER TABLE sub_invites ADD COLUMN contact TEXT;
ALTER TABLE sub_invites ADD COLUMN company_name TEXT;
ALTER TABLE sub_invites ADD COLUMN sent_at TEXT;
