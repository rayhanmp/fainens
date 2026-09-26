import { sql, type SQL } from "drizzle-orm";

/** The matched amount is applied on each transaction independently of report scope. */
export function personalExpenseAdjustment(transactionId: SQL): SQL<number> {
  return sql<number>`coalesce((select case when r.outgoing_transaction_id = ${transactionId} then -r.amount else r.amount end from transaction_reallocation r where r.outgoing_transaction_id = ${transactionId} or r.incoming_transaction_id = ${transactionId}), 0)`;
}

export function personalIncomeAdjustment(transactionId: SQL): SQL<number> {
  return sql<number>`-coalesce((select r.amount from transaction_reallocation r where r.incoming_transaction_id = ${transactionId}), 0)`;
}

/** Eligible reallocations have exactly one expense/revenue line, so apply once. */
export function personalExpenseLine(transactionId: SQL, debit: SQL, credit: SQL): SQL<number> {
  return sql<number>`${debit} - ${credit} + ${personalExpenseAdjustment(transactionId)}`;
}

export function personalIncomeLine(transactionId: SQL, debit: SQL, credit: SQL): SQL<number> {
  return sql<number>`${credit} - ${debit} + ${personalIncomeAdjustment(transactionId)}`;
}

export function adjustedPersonalEffects(expenseCents: number, incomeCents: number, role: "incoming" | "outgoing", amount: number) {
  return {
    personalExpenseCents: expenseCents === 0 ? 0 : expenseCents + (role === "outgoing" ? -amount : amount),
    personalIncomeCents: incomeCents === 0 ? 0 : incomeCents - amount,
  };
}
