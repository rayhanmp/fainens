import { eq, sql } from "drizzle-orm";

import { db as defaultDb } from "../db/client";
import { financialState } from "../db/schema";

const STATE_ID = 1;

/** Read the committed revision from the supplied Drizzle executor. */
export async function getFinancialRevision(dbLike: any = defaultDb): Promise<number> {
  const [state] = await dbLike
    .select({ revision: financialState.revision })
    .from(financialState)
    .where(eq(financialState.id, STATE_ID))
    .limit(1);
  return state?.revision ?? 0;
}

/** Synchronous read for an existing better-sqlite3 transaction. */
export function getFinancialRevisionSync(tx: any): number {
  const row = tx
    .select({ revision: financialState.revision })
    .from(financialState)
    .where(eq(financialState.id, STATE_ID))
    .limit(1)
    .all()[0];
  return row?.revision ?? 0;
}

/**
 * Bump the singleton revision inside the caller's write transaction.  The
 * revision is committed or rolled back with the financial mutation itself.
 */
export function bumpFinancialRevisionSync(tx: any): number {
  tx.insert(financialState)
    .values({ id: STATE_ID, revision: 1 })
    .onConflictDoUpdate({
      target: financialState.id,
      set: {
        revision: sql`${financialState.revision} + 1`,
        updatedAt: sql`(unixepoch('now') * 1000)`,
      },
    })
    .run();
  return getFinancialRevisionSync(tx);
}

/** Bump the revision as a standalone committed operation. */
export function bumpFinancialRevision(): number {
  return defaultDb.transaction((tx) => bumpFinancialRevisionSync(tx));
}
