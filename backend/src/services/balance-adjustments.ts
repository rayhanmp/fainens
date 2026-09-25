import type { PreparedJournalEntry } from "./ledger";
import {
  getOrCreateBalanceAdjustmentEquityAccount,
  prepareJournalEntry,
  type JournalLineInput,
} from "./ledger";

export type BalanceAdjustmentInput = {
  accountId: number;
  accountName: string;
  accountType: "asset" | "liability";
  liquidityClass: string;
  difference: number;
};

/** Build a neutral journal that aligns account balances without inventing P&L or ordinary cash flow. */
export function buildBalanceAdjustmentLines(
  items: BalanceAdjustmentInput[],
  equityAccountId: number,
): JournalLineInput[] {
  const lines: JournalLineInput[] = [];
  for (const item of items) {
    if (item.difference === 0) continue;
    const amount = Math.abs(item.difference);
    const debit = item.accountType === "asset" ? item.difference > 0 : item.difference < 0;
    lines.push({
      accountId: item.accountId,
      debit: debit ? amount : 0,
      credit: debit ? 0 : amount,
      description: "Balance reconciliation adjustment",
      cashFlowClass: item.liquidityClass === "cash_equivalent" ? "recovery" : null,
    });
  }
  const debitTotal = lines.reduce((total, line) => total + line.debit, 0);
  const creditTotal = lines.reduce((total, line) => total + line.credit, 0);
  const difference = debitTotal - creditTotal;
  if (difference !== 0) {
    lines.push({
      accountId: equityAccountId,
      debit: difference < 0 ? -difference : 0,
      credit: difference > 0 ? difference : 0,
      description: "Balance reconciliation adjustment",
    });
  }
  return lines;
}

export async function prepareBalanceAdjustmentJournal(input: {
  date: number;
  description: string;
  note?: string | null;
  items: BalanceAdjustmentInput[];
}): Promise<PreparedJournalEntry | null> {
  const changedItems = input.items.filter((item) => item.difference !== 0);
  if (changedItems.length === 0) return null;
  const equity = await getOrCreateBalanceAdjustmentEquityAccount();
  const lines = buildBalanceAdjustmentLines(changedItems, equity.id);
  return prepareJournalEntry({
    date: input.date,
    description: input.description,
    notes: input.note ?? null,
    txType: "balance_adjustment",
    lines,
  });
}
