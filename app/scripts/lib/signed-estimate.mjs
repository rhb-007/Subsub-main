// 115. A sale is a signed estimate, so a suite that marks an appointment sold
// by hand needs one on file first. This writes the row signing would have
// written: a lead (the appointment's own, or one made for it), and a signed
// estimate for that appointment. Returns the estimate's id.
import { randomUUID } from "node:crypto";
export function signEstimateFor(db, apptId, { totalCents = 1000000 } = {}) {
  const a = db.prepare("SELECT account_id FROM sales_appointments WHERE id = ?").get(apptId);
  if (!a) throw new Error(`signEstimateFor: no appointment ${apptId}`);
  let lead = db.prepare("SELECT lead_id FROM sales_lead_links WHERE appointment_id = ?").get(apptId)?.lead_id;
  if (!lead) {
    lead = randomUUID();
    db.prepare("INSERT INTO sales_leads (id, account_id, stage) VALUES (?, ?, 'opportunity')").run(lead, a.account_id);
    db.prepare("INSERT INTO sales_lead_links (appointment_id, lead_id, account_id) VALUES (?, ?, ?)").run(apptId, lead, a.account_id);
  }
  const id = randomUUID(), now = new Date().toISOString();
  db.prepare(`INSERT INTO sales_proposals (id, account_id, lead_id, appointment_id, token, title, items, total_cents, status,
    signed_at, signer_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'Estimate', '[]', ?, 'signed', ?, 'Homeowner', ?, ?)`)
    .run(id, a.account_id, lead, apptId, randomUUID().replace(/-/g, ""), totalCents, now, now, now);
  return id;
}
