export type ValidatedJournalLine = {
  accountId: number;
  debit: number;
  credit: number;
  description?: string;
  cashFlowClass?: "operating" | "investing" | "financing" | "transfer" | "recovery" | null;
};

function assertNonNegativeInteger(value: unknown, fieldName: string): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }
}

export function validateJournalLines(lines: ValidatedJournalLine[]): {
  lines: ValidatedJournalLine[];
  totalDebit: number;
  totalCredit: number;
} {
  if (lines.length < 2) throw new Error("At least two lines required");

  const validated = lines.map((line) => {
    assertNonNegativeInteger(line.debit, "debit");
    assertNonNegativeInteger(line.credit, "credit");
    if (!Number.isInteger(line.accountId) || line.accountId <= 0) {
      throw new Error("accountId must be a positive integer");
    }
    if ((line.debit === 0 && line.credit === 0) || (line.debit > 0 && line.credit > 0)) {
      throw new Error("Each journal line must contain exactly one positive debit or credit");
    }
    if (line.cashFlowClass != null && !["operating", "investing", "financing", "transfer", "recovery"].includes(line.cashFlowClass)) {
      throw new Error("cashFlowClass must be operating, investing, financing, transfer, or recovery");
    }
    return { ...line };
  });

  const totalDebit = validated.reduce((sum, line) => sum + line.debit, 0);
  const totalCredit = validated.reduce((sum, line) => sum + line.credit, 0);
  if (!Number.isSafeInteger(totalDebit) || !Number.isSafeInteger(totalCredit)) {
    throw new Error("Journal totals must be safe integers");
  }
  if (totalDebit <= 0 || totalDebit !== totalCredit) {
    throw new Error(`Journal entry is not balanced: debits=${totalDebit} credits=${totalCredit}`);
  }

  return { lines: validated, totalDebit, totalCredit };
}
