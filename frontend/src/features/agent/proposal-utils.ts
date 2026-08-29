import type { AgentBudgetActionProposal, AgentTransactionActionProposal } from '../../lib/api';

export type AgentTransactionProposal = AgentTransactionActionProposal;

export type BudgetProposalStatus = 'pending' | 'restoring' | 'executing' | 'executed' | 'rejected' | 'expired' | 'superseded' | 'error';
export type TransactionProposalStatus = 'pending' | 'restoring' | 'editing' | 'saving' | 'executing' | 'executed' | 'rejected' | 'expired' | 'superseded' | 'error';

export type TransactionEditDraft = {
  name: string;
  amount: string;
  dateTime: string;
  categoryId: string;
  outgoingAccountId: string;
  incomingAccountId: string;
  place: string;
  reference: string;
  notes: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isTransactionProposal(value: unknown): value is AgentTransactionProposal {
  if (!isRecord(value) || value.kind !== 'transaction_journal_create' || typeof value.approvalId !== 'number') return false;
  return isRecord(value.details) && Array.isArray(value.details.lines) && typeof value.details.totalDebit === 'number';
}

export function isBudgetProposal(value: unknown): value is AgentBudgetActionProposal {
  if (!isRecord(value) || value.kind !== 'budget_plan_upsert' || typeof value.approvalId !== 'number') return false;
  if (!isRecord(value.input) || typeof value.input.periodId !== 'number' || !Array.isArray(value.input.plans)) return false;
  return value.input.plans.length > 0 && value.input.plans.every((plan) => isRecord(plan)
    && typeof plan.categoryId === 'number'
    && typeof plan.plannedAmountCents === 'number')
    && Array.isArray(value.details)
    && value.details.length > 0
    && value.details.every((row) => isRecord(row)
      && typeof row.categoryId === 'number'
      && typeof row.category === 'string'
      && typeof row.plannedAmountCents === 'number');
}

export function initialBudgetProposalStatus(status: string): BudgetProposalStatus {
  if (status === 'pending' || status === 'rejected' || status === 'expired' || status === 'superseded' || status === 'executed') return status;
  return 'error';
}

export function budgetProposalStatusLabel(status: BudgetProposalStatus): string {
  if (status === 'pending') return 'Needs your review';
  if (status === 'restoring') return 'Restoring review…';
  if (status === 'executing') return 'Saving…';
  if (status === 'executed') return 'Saved';
  if (status === 'rejected') return 'Dismissed';
  if (status === 'expired') return 'Expired';
  if (status === 'superseded') return 'Replaced';
  return 'Could not save';
}

export function initialTransactionProposalStatus(status: string): TransactionProposalStatus {
  if (status === 'pending' || status === 'rejected' || status === 'expired' || status === 'superseded' || status === 'executed') return status;
  return 'error';
}

export function transactionProposalStatusLabel(status: TransactionProposalStatus): string {
  if (status === 'pending') return 'Needs your review';
  if (status === 'restoring') return 'Restoring review…';
  if (status === 'executing') return 'Working…';
  if (status === 'executed') return 'Posted';
  if (status === 'rejected') return 'Dismissed';
  if (status === 'expired') return 'Expired';
  if (status === 'superseded') return 'Replaced';
  if (status === 'editing' || status === 'saving') return 'Editing';
  return 'Could not post';
}

export function transactionIntentLabel(intent: AgentTransactionProposal['input']['intent']): string {
  if (intent === 'expense') return 'Expense';
  if (intent === 'income') return 'Income';
  if (intent === 'transfer') return 'Transfer';
  return 'Transaction';
}

export function proposalUsesExpenseCategory(intent: AgentTransactionProposal['input']['intent']): boolean {
  return intent !== 'income' && intent !== 'transfer';
}

export function localDateTimeInput(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function allocationForAmount(
  allocations: AgentTransactionProposal['input']['categoryAllocations'],
  oldAmount: number,
  nextAmount: number,
): AgentTransactionProposal['input']['categoryAllocations'] {
  if (allocations.length === 0 || oldAmount === 0) return allocations;
  const sign = allocations.reduce((sum, allocation) => sum + allocation.amount, 0) < 0 ? -1 : 1;
  const target = sign * nextAmount;
  const scaled = allocations.map((allocation) => ({
    categoryId: allocation.categoryId,
    amount: Math.trunc((allocation.amount * target) / oldAmount),
  }));
  const remainder = target - scaled.reduce((sum, allocation) => sum + allocation.amount, 0);
  if (scaled[0]) scaled[0].amount += remainder;
  return scaled;
}

export function journalLinesForAmount(
  lines: AgentTransactionProposal['input']['lines'],
  nextAmount: number,
): AgentTransactionProposal['input']['lines'] {
  const oldDebit = lines.reduce((sum, line) => sum + line.debit, 0);
  const oldCredit = lines.reduce((sum, line) => sum + line.credit, 0);
  if (oldDebit <= 0 || oldCredit <= 0) return lines.map((line) => ({ ...line }));
  const scaled = lines.map((line) => ({ ...line,
    debit: Math.floor((line.debit * nextAmount) / oldDebit),
    credit: Math.floor((line.credit * nextAmount) / oldCredit),
  }));
  const addRemainder = (side: 'debit' | 'credit') => {
    let remainder = nextAmount - scaled.reduce((sum, line) => sum + line[side], 0);
    for (let index = 0; index < scaled.length && remainder > 0; index += 1) {
      if (lines[index][side] > 0) {
        scaled[index][side] += 1;
        remainder -= 1;
      }
    }
  };
  addRemainder('debit');
  addRemainder('credit');
  return scaled;
}

export function draftFromProposal(proposal: AgentTransactionProposal): TransactionEditDraft {
  const categoryId = proposal.input.categoryId ?? proposal.input.categoryAllocations[0]?.categoryId ?? null;
  return {
    name: proposal.input.description,
    amount: String(proposal.details.totalDebit),
    dateTime: localDateTimeInput(proposal.input.dateMs),
    categoryId: categoryId == null ? '' : String(categoryId),
    outgoingAccountId: String(proposal.input.lines.find((line) => line.credit > 0)?.accountId ?? ''),
    incomingAccountId: String(proposal.input.lines.find((line) => line.debit > 0)?.accountId ?? ''),
    place: proposal.input.place ?? '',
    reference: proposal.input.reference ?? '',
    notes: proposal.input.notes ?? '',
  };
}
