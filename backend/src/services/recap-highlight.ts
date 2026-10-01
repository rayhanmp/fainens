import { db } from "../db/client";
import { RecapPeriodError } from "./recap";

function requirePeriod(periodId: number) {
  const period = db.$client.prepare("SELECT id FROM salary_period WHERE id = ?").get(periodId);
  if (!period) throw new RecapPeriodError("This salary period does not exist", 404);
}

export function getRecapHighlightSeenAt(ownerEmail: string, periodId: number): number | null {
  requirePeriod(periodId);
  const row = db.$client.prepare("SELECT seen_at FROM recap_period_highlight_seen WHERE owner_email = ? AND period_id = ?")
    .get(ownerEmail, periodId) as { seen_at: number } | undefined;
  return row ? Number(row.seen_at) : null;
}

export function markRecapHighlightSeen(ownerEmail: string, periodId: number, now = Date.now()): number {
  requirePeriod(periodId);
  db.$client.prepare(`INSERT INTO recap_period_highlight_seen (owner_email, period_id, seen_at) VALUES (?, ?, ?)
    ON CONFLICT(owner_email, period_id) DO NOTHING`).run(ownerEmail, periodId, now);
  return getRecapHighlightSeenAt(ownerEmail, periodId)!;
}
