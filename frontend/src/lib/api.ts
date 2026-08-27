// Typed API client for Fainens backend

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

// Generic fetch wrapper
async function fetchApi<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;

  // Only set Content-Type for requests with a body
  const headers: Record<string, string> = {};
  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      ...headers,
      ...options.headers,
    },
    credentials: 'include', // Include cookies for auth
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error', message: 'Something went wrong' }));
    const errorMessage = error.message || error.error || `HTTP ${response.status}`;
    const apiError = new Error(errorMessage) as Error & { response?: { data?: { error?: string; message?: string } } };
    apiError.response = { data: { error: error.error, message: error.message } };
    throw apiError;
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

export type AgentFinancialFacts = {
  tool: 'get_financial_facts';
  revision: number;
  readOnly: true;
  data: {
    scope: {
      periodId: number | null;
      startMs: number;
      endMs: number;
      periodName: string | null;
    };
    facts: {
      startMs: number;
      endMs: number;
      asOfMs: number;
      rows: Array<{
        id: number;
        date: number;
        description: string;
        categoryId: number | null;
        category: string | null;
        txType: string;
        expenseCents: number;
        incomeCents: number;
      }>;
      totalSpentCents: number;
      totalIncomeCents: number;
      walletBalanceCents: number;
      byCategory: Array<{ categoryId: number | null; category: string; spentCents: number }>;
    };
    coverage: {
      complete: number[];
      partial: number[];
      skipped: number[];
      unknown: number[];
      isComparable: boolean;
      warnings: string[];
    };
  };
};

export type AgentTransactionSearch = {
  tool: 'search_transactions';
  revision: number;
  readOnly: true;
  data: {
    scope: { periodId: number | null; startMs: number; endMs: number; periodName: string | null };
    transactions: Array<{
      id: number;
      date: number;
      description: string;
      reference: string | null;
      notes: string | null;
      txType: string;
      status: string;
      periodId: number | null;
      categoryId: number | null;
      category: string | null;
      debitCents: number;
      creditCents: number;
      expenseCents: number;
      incomeCents: number;
    }>;
    limit: number;
  };
};

export type BudgetPlan = {
  id: number;
  periodId: number;
  categoryId: number;
  plannedAmount: number;
  actualAmount: number;
  variance: number;
  percentUsed: number;
  categoryName: string;
};

export type BudgetSummary = {
  periodId: number;
  income: number;
  totalPlanned: number;
  percentOfIncome: number;
  coverageStatus: 'complete' | 'partial' | 'skipped' | 'unknown';
  coverageReason: string | null;
  coverage: {
    complete: number[];
    partial: number[];
    skipped: number[];
    unknown: number[];
    isComparable: boolean;
    warnings: string[];
  };
  plans: BudgetPlan[];
};

export type AgentQueryResponse = {
  answer: string | null;
  llmAvailable: boolean;
  context: unknown;
  scope?: unknown;
  revision?: number;
  conversationId?: number | null;
  userMessageId?: number | null;
  toolCalls: Array<{ id: string; name: string; input: unknown }>;
  toolResults: Array<{ id: string; name: string; result: unknown }>;
  pendingActions?: AgentActionProposal[];
  message?: string;
};

export type AgentStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool'; name: string }
  | { type: 'complete'; response: AgentQueryResponse }
  | { type: 'error'; error: string };

export type AgentMemory = {
  id: number;
  label: string;
  content: string;
  createdAt: number;
  updatedAt: number;
};

export type AgentActionProposal = {
  pendingActionId: number;
  approvalId: number;
  kind: 'budget_plan_upsert' | 'transaction_journal_create';
  status: string;
  input: unknown;
  assumptions: string[];
  missingFields: string[];
  details: unknown;
  baseFinancialRevision: number;
  createdAt: number;
  expiresAt: number;
  approvalToken: string | null;
  tokenAlreadyIssued: boolean;
};

export type AgentBudgetActionProposal = AgentActionProposal & {
  kind: 'budget_plan_upsert';
  input: { periodId: number; plans: Array<{ categoryId: number; plannedAmountCents: number }> };
  details: Array<{ categoryId: number; category: string; plannedAmountCents: number }>;
};

export type AgentTransactionActionProposal = AgentActionProposal & {
  kind: 'transaction_journal_create';
  input: {
    dateMs: number;
    description: string;
    reference: string | null;
    notes: string | null;
    place: string | null;
    periodId: number | null;
    categoryId: number | null;
    categoryAllocations: Array<{ categoryId: number; amount: number }>;
    lines: Array<{ accountId: number; debit: number; credit: number; description?: string; cashFlowClass?: 'operating' | 'investing' | 'financing' | 'transfer' | 'recovery' | null }>;
    tagIds: number[];
  };
  details: {
    dateMs: number;
    periodId: number | null;
    description: string;
    totalDebit: number;
    totalCredit: number;
    lines: Array<{ accountId: number; debit: number; credit: number; description?: string; cashFlowClass?: 'operating' | 'investing' | 'financing' | 'transfer' | 'recovery' | null; account: string }>;
    categoryAllocations: Array<{ categoryId: number; amount: number; category: string }>;
  };
};

async function streamAgentQuery(
  data: { question: string; periodId?: number; startDate?: number; endDate?: number; conversationId?: number; replaceMessageId?: number; images?: Array<{ filename: string; mimeType: string; data: string }> },
  onEvent: (event: AgentStreamEvent) => void,
): Promise<AgentQueryResponse> {
  const response = await fetch(`${API_BASE}/agent/query/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    credentials: 'include',
    body: JSON.stringify(data),
  });
  if (!response.ok || !response.body) {
    const error = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    throw new Error(error.message || error.error || `HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed: AgentQueryResponse | null = null;
  const consume = (event: string) => {
    const dataLine = event.split(/\r?\n/).find((line) => line.startsWith('data:'));
    if (!dataLine) return;
    try {
      const parsed = JSON.parse(dataLine.slice(5).trimStart()) as AgentStreamEvent;
      onEvent(parsed);
      if (parsed.type === 'complete') completed = parsed.response;
      if (parsed.type === 'error') throw new Error(parsed.error);
    } catch (error) {
      if (error instanceof Error) throw error;
      throw new Error('Could not read agent stream');
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() ?? '';
    for (const event of events) consume(event);
    if (done) break;
  }
  if (buffer) consume(buffer);
  if (!completed) throw new Error('Agent stream ended before a final response');
  return completed;
}

// API client object
export const api = {
  // Auth
  auth: {
    me: () => fetchApi<{ email: string }>('/auth/me'),
    logout: () => fetchApi<{ success: boolean }>('/auth/logout', { method: 'POST' }),
    onboardingStatus: () =>
      fetchApi<{ needsOnboarding: boolean }>('/auth/onboarding-status'),
  },

  // Accounts (wallets / GL — no user-facing codes)
  accounts: {
    list: (params?: { type?: string; search?: string; includeInactive?: boolean }) => {
      const query = params ? new URLSearchParams(Object.entries(params).reduce<Record<string, string>>((out, [key, value]) => { if (value !== undefined) out[key] = String(value); return out; }, {})).toString() : '';
      return fetchApi<Array<{
        id: number;
        name: string;
        type: string;
        icon: string | null;
        color: string | null;
        sortOrder: number;
        systemKey: string | null;
        isActive: boolean;
        balance: number;
        description: string | null;
        accountNumber: string | null;
        creditLimit: number | null;
        interestRate: number | null;
        billingDate: number | null;
        provider: string | null;
        parentId: number | null;
        liquidityClass: 'cash_equivalent' | 'receivable' | 'investment' | 'non_cash';
      }>>(`/accounts${query ? `?${query}` : ''}`);
    },
    get: (id: number) => fetchApi<{
      id: number;
      name: string;
      type: string;
      icon: string | null;
      color: string | null;
      sortOrder: number;
      systemKey: string | null;
      isActive: boolean;
      balance: number;
      description: string | null;
      accountNumber: string | null;
      creditLimit: number | null;
      interestRate: number | null;
      billingDate: number | null;
      provider: string | null;
      parentId: number | null;
      liquidityClass: 'cash_equivalent' | 'receivable' | 'investment' | 'non_cash';
    }>(`/accounts/${id}`),
    create: (data: {
      name: string;
      type: string;
      icon?: string | null;
      color?: string | null;
      sortOrder?: number;
      description?: string | null;
      accountNumber?: string | null;
      creditLimit?: number | null;
      interestRate?: number | null;
      billingDate?: number | null;
      provider?: string | null;
      parentId?: number | null;
      liquidityClass?: 'cash_equivalent' | 'receivable' | 'investment' | 'non_cash';
    }) => fetchApi('/accounts', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<{
      name: string;
      type: string;
      icon: string | null;
      color: string | null;
      sortOrder: number;
      isActive: boolean;
      description: string | null;
      accountNumber: string | null;
      creditLimit: number | null;
      interestRate: number | null;
      billingDate: number | null;
      provider: string | null;
      parentId: number | null;
      liquidityClass: 'cash_equivalent' | 'receivable' | 'investment' | 'non_cash';
    }>) => fetchApi(`/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: number) => fetchApi(`/accounts/${id}`, { method: 'DELETE' }),
    restore: (id: number) => fetchApi(`/accounts/${id}/restore`, { method: 'POST' }),
    dependencyPreview: (id: number) => fetchApi<{
      account: unknown;
      canArchive: boolean;
      canRestore: boolean;
      blockers: string[];
      dependencies: { postedTransactions: number; budgetPlans: number; childAccounts: number; linkedCategories: number };
    }>(`/accounts/${id}/dependency-preview`),
    reconcile: (balances: Array<{ accountId: number; actualBalance: number }>) => 
      fetchApi<{
        success: boolean;
        requiresClassification: boolean;
        message: string;
        session: { id: number; asOfDate: number; status: string; lifecycleStatus: 'active' | 'voided' };
        results: Array<{
          id: number;
          accountId: number;
          accountName: string;
          ledgerBalance: number;
          actualBalance: number;
          difference: number;
          status: string;
        }>;
      }>('/reconciliation', {
        method: 'POST', 
        body: JSON.stringify({ balances }) 
      }),
    voidReconciliation: (id: number, reason: string) =>
      fetchApi(`/reconciliation/${id}/void`, { method: 'POST', body: JSON.stringify({ reason }) }),
    recoveryReconcile: (data: {
      balances: Array<{ accountId: number; actualBalance: number }>;
      asOfDate: number;
      acknowledgement: string;
      note?: string | null;
      confirmed: true;
    }) => fetchApi<{
      success: boolean;
      message: string;
      session: { id: number; asOfDate: number; status: string; kind: 'recovery' };
      results: Array<{ accountId: number; ledgerBalance: number; actualBalance: number; difference: number }>;
      recoveryTransactionId: number | null;
    }>('/reconciliation/recovery', { method: 'POST', body: JSON.stringify(data) }),
    reconciliationHistory: (limit = 10) => fetchApi<{
      sessions: Array<{
        id: number;
        asOfDate: number;
        status: 'reconciled' | 'needs_classification' | 'recovered';
        kind: 'control' | 'recovery';
        note: string | null;
        lifecycleStatus: 'active' | 'voided';
        voidedAt: number | null;
        voidReason: string | null;
        items: Array<{
          id: number;
          accountId: number;
          accountName: string;
          ledgerBalance: number;
          actualBalance: number;
          difference: number;
          status: 'matched' | 'needs_classification';
        }>;
      }>;
    }>(`/reconciliation?limit=${limit}`),
  },

  // Transactions
  transactions: {
    list: (params?: {
      startDate?: string;
      endDate?: string;
      accountId?: string;
      txType?: string;
      periodId?: string;
      categoryId?: string;
      tagId?: string;
      search?: string;
      kind?: 'expense' | 'income' | 'transfer' | 'loan';
      minAmount?: string;
      maxAmount?: string;
      sort?: 'newest' | 'oldest' | 'largest';
      /** Include internal inverse journals and superseded originals for audit views. */
      includeReversals?: string;
      limit?: string;
      offset?: string;
    }) => {
      const query = params ? new URLSearchParams(params).toString() : '';
      return fetchApi<{
        data: Array<{
          id: number;
          date: number;
          description: string;
          reference: string | null;
          notes: string | null;
          place: string | null;
          txType: string;
          status: string;
          reversalOfTxId: number | null;
          categoryId: number | null;
          periodId: number | null;
          linkedTxId: number | null;
          debitCents: number;
          creditCents: number;
          expenseCents: number;
          incomeCents: number;
          lines: Array<{
            id: number;
            accountId: number;
            debit: number;
            credit: number;
            cashFlowClass: 'operating' | 'investing' | 'financing' | 'transfer' | 'recovery' | null;
            accountName: string | null;
            accountType: string | null;
            accountSystemKey: string | null;
          }>;
          categoryAllocations: Array<{ categoryId: number; amount: number; categoryName: string | null }>;
          tags: Array<{ tagId: number; name: string; color: string }>;
        }>;
        pagination: {
          total: number;
          limit: number;
          offset: number;
          hasMore: boolean;
        };
        summary: {
          expenseCents: number;
          incomeCents: number;
        };
      }>(`/transactions${query ? `?${query}` : ''}`);
    },
    get: (id: number) => fetchApi<{
      id: number;
      date: number;
      description: string;
      notes: string | null;
      place: string | null;
      categoryId: number | null;
      txType: string;
      lines: Array<{ id: number; accountId: number; debit: number; credit: number; description: string | null; cashFlowClass: 'operating' | 'investing' | 'financing' | 'transfer' | 'recovery' | null }>;
      tags: Array<{ tagId: number; name: string; color: string }>;
      categoryAllocations: Array<{ categoryId: number; amount: number; categoryName: string | null }>;
    }>(`/transactions/${id}`),
    reverse: (id: number) => fetchApi<{ id: number; reversalOfTxId: number }>(`/transactions/${id}/reverse`, { method: 'POST' }),
    create: (
      data:
        | {
            date: string;
            description: string;
            reference?: string | null;
            notes?: string | null;
            place?: string | null;
            txType?: string;
            periodId?: number | null;
            linkedTxId?: number | null;
            tagIds?: number[];
            categoryId?: number | null;
            categoryAllocations?: Array<{ categoryId: number; amount: number }>;
            lines: Array<{
              accountId: number;
              debit: number;
              credit: number;
              description?: string;
              cashFlowClass?: 'operating' | 'investing' | 'financing' | 'transfer' | 'recovery' | null;
            }>;
          }
        | {
            kind: 'expense' | 'income' | 'transfer';
            amountCents: number;
            description: string;
            notes?: string | null;
            place?: string | null;
            date: string;
            periodId?: number | null;
            categoryId?: number | null;
            tagIds?: number[];
            walletAccountId: number;
            toWalletAccountId?: number;
            linkedTxId?: number | null;
            // Transport location fields
            originLat?: number | null;
            originLng?: number | null;
            originName?: string | null;
            destLat?: number | null;
            destLng?: number | null;
            destName?: string | null;
            distanceKm?: number | null;
            // Subscription payment
            subscriptionId?: number;
          },
    ) => fetchApi<{
      id: number;
      date: number;
      description: string;
      reference: string | null;
      notes: string | null;
      place: string | null;
      txType: string;
      categoryId: number | null;
      periodId: number | null;
      lines: Array<{
        id: number;
        accountId: number;
        debit: number;
        credit: number;
        cashFlowClass: 'operating' | 'investing' | 'financing' | 'transfer' | 'recovery' | null;
      }>;
      balancesByAccountId: Record<number, number>;
    }>('/transactions', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<{
      description: string;
      reference: string | null;
      notes: string | null;
      place: string | null;
      date: string;
      tagIds: number[];
      categoryId: number | null;
    }>) => fetchApi(`/transactions/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) => fetchApi(`/transactions/${id}`, { method: 'DELETE' }),
    bulkDelete: (ids: number[]) => fetchApi<{ success: boolean; deletedCount: number; message: string }>('/transactions/bulk-delete', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),
    recommendCategory: (name: string) => fetchApi<{ categoryId: number; categoryName: string }>('/transactions/recommend-category', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
    importPreview: (csvText: string) => fetchApi<{
      rows: Array<{
        rowNumber: number;
        date: string;
        description: string;
        amount: number;
        type: 'expense' | 'income';
        accountName: string;
        categoryName: string | null;
        periodName: string;
        notes: string | null;
        reference: string | null;
        isValid: boolean;
        errors: string[];
        warnings: string[];
        accountMatched: boolean;
        categoryMatched: boolean;
        periodMatched: boolean;
        accountId: number | null;
        categoryId: number | null;
        periodId: number | null;
      }>;
      summary: {
        totalRows: number;
        validRows: number;
        warningRows: number;
        errorRows: number;
        totalIncome: number;
        totalExpense: number;
        uniqueAccounts: string[];
        uniqueCategories: string[];
        uniquePeriods: string[];
        missingAccounts: string[];
        missingCategories: string[];
        missingPeriods: string[];
      };
      existingCategories: Array<{ id: number; name: string }>;
      existingAccounts: Array<{ id: number; name: string }>;
      existingPeriods: Array<{ id: number; name: string }>;
    }>('/transactions/import/preview', {
      method: 'POST',
      body: JSON.stringify({ csvText }),
    }),
    importConfirm: (data: {
      rows: Array<{
        date: string;
        description: string;
        amount: number;
        type: 'expense' | 'income';
        accountId: number;
        periodId?: number | null;
        categoryId?: number | null;
        notes?: string | null;
        reference?: string | null;
      }>;
      categoryMappings?: Record<string, number | null>;
      accountMappings?: Record<string, number | null>;
      periodMappings?: Record<string, number | null>;
    }) => fetchApi<{
      imported: number;
      skipped: number;
      errors: Array<{ row: number; message: string }>;
      transactions: Array<{ id: number; description: string; amount: number }>;
    }>('/transactions/import/confirm', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  },

  // Categories
  categories: {
    list: (params?: { search?: string; includeInactive?: boolean }) => {
      const query = params ? new URLSearchParams(Object.entries(params).reduce<Record<string, string>>((out, [key, value]) => { if (value !== undefined) out[key] = String(value); return out; }, {})).toString() : '';
      return fetchApi<Array<{
        id: number;
        name: string;
        icon: string | null;
        color: string | null;
        reportingAccountId: number | null;
        isActive: boolean;
      }>>(`/categories${query ? `?${query}` : ''}`);
    },
    create: (data: { name: string; icon?: string | null; color?: string | null; reportingAccountId?: number | null }) =>
      fetchApi('/categories', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<{ name: string; icon: string | null; color: string | null; reportingAccountId: number | null }>) =>
      fetchApi(`/categories/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: number) => fetchApi(`/categories/${id}`, { method: 'DELETE' }),
    restore: (id: number) => fetchApi(`/categories/${id}/restore`, { method: 'POST' }),
    dependencyPreview: (id: number) => fetchApi(`/categories/${id}/dependency-preview`),
  },

  // Tags
  tags: {
    list: () => fetchApi<Array<{ id: number; name: string; color: string }>>('/tags'),
    create: (data: { name: string; color: string }) =>
      fetchApi('/tags', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<{ name: string; color: string }>) =>
      fetchApi(`/tags/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: number) => fetchApi(`/tags/${id}`, { method: 'DELETE' }),
  },

  // Periods
  periods: {
    list: (params?: { includeInactive?: boolean }) => fetchApi<Array<{
      id: number;
      name: string;
      startDate: number;
      endDate: number;
      status: 'open' | 'closed';
      closedAt: number | null;
      reopenedAt: number | null;
      isActive: boolean;
      archivedAt: number | null;
      coverageStatus: 'complete' | 'partial' | 'skipped' | 'unknown';
      coverageReason: string | null;
    }>>(`/periods${params?.includeInactive ? '?includeInactive=true' : ''}`),
    get: (id: number) => fetchApi(`/periods/${id}`),
    create: (data: { name: string; startDate: string; endDate: string }) =>
      fetchApi('/periods', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<{ name: string; startDate: string; endDate: string }>) =>
      fetchApi(`/periods/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: number) => fetchApi(`/periods/${id}`, { method: 'DELETE' }),
    close: (id: number) => fetchApi(`/periods/${id}/close`, { method: 'POST' }),
    reopen: (id: number) => fetchApi(`/periods/${id}/reopen`, { method: 'POST' }),
    archive: (id: number) => fetchApi(`/periods/${id}/archive`, { method: 'POST' }),
    restore: (id: number) => fetchApi(`/periods/${id}/restore`, { method: 'POST' }),
    returnPreview: (asOfDate: number) => fetchApi<{
      candidates: Array<{ name: string; startDate: number; endDate: number; isCurrent: boolean }>;
      payrollDay?: number;
      reason?: string;
    }>(`/periods/return-preview?asOfDate=${asOfDate}`),
    createReturnBackfill: (asOfDate: number, currentPeriodCoverage: 'partial' | 'complete' = 'partial') => fetchApi<{
      periods: Array<{ id: number; name: string; startDate: number; endDate: number; coverageStatus: 'complete' | 'partial' | 'skipped' }>;
      message: string;
    }>('/periods/return-backfill', {
      method: 'POST',
      body: JSON.stringify({
        asOfDate,
        confirmed: true,
        currentPeriodCoverage,
        reviewedCurrentPeriod: currentPeriodCoverage === 'complete',
      }),
    }),
    setCoverage: (id: number, data: { coverageStatus: 'partial' | 'complete' | 'skipped'; reason: string; reviewed?: boolean }) =>
      fetchApi(`/periods/${id}/coverage`, { method: 'POST', body: JSON.stringify(data) }),
    suggestNext: () => fetchApi<{
      suggestedName: string;
      suggestedStartDate: string;
      suggestedEndDate: string;
    }>('/periods/suggest-next'),
  },

  // Budget
  budgets: {
    list: (periodId?: string) => {
      const query = periodId ? `?periodId=${periodId}` : '';
      return fetchApi<BudgetSummary | BudgetSummary[]>(`/budgets${query}`);
    },
    create: (data: { periodId: number; categoryId: number; plannedAmount: number }) =>
      fetchApi('/budgets', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<{ plannedAmount: number }>) =>
      fetchApi(`/budgets/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: number) => fetchApi(`/budgets/${id}`, { method: 'DELETE' }),
    // Templates
    templates: {
      list: (params?: { includeInactive?: boolean }) => fetchApi<Array<{
        id: number;
        name: string;
        description: string | null;
        isActive: boolean;
        createdAt: number;
        items: Array<{
          id: number;
          categoryId: number;
          plannedAmount: number;
          categoryName: string;
        }>;
      }>>(`/budgets/templates${params?.includeInactive ? '?includeInactive=true' : ''}`),
      create: (data: { name: string; description?: string; periodId: number }) =>
        fetchApi('/budgets/templates', { method: 'POST', body: JSON.stringify(data) }),
      apply: (templateId: number, data: { periodId: number; replaceExisting?: boolean }) =>
        fetchApi<{ applied: number; skipped: number }>(`/budgets/templates/${templateId}/apply`, { method: 'POST', body: JSON.stringify(data) }),
      delete: (id: number) => fetchApi(`/budgets/templates/${id}`, { method: 'DELETE' }),
      restore: (id: number) => fetchApi(`/budgets/templates/${id}/restore`, { method: 'POST' }),
    },
    // Compare periods
    compare: (currentPeriodId: string, comparePeriodId: string) =>
      fetchApi<Array<{
        categoryId: number;
        categoryName: string;
        currentPlanned: number;
        comparePlanned: number;
        compareActual: number;
        plannedDiff: number;
        actualDiff: number;
      }>>(`/budgets/compare?currentPeriodId=${currentPeriodId}&comparePeriodId=${comparePeriodId}`),
  },

  // Attachments
  attachments: {
    list: (transactionId?: string) => {
      const query = transactionId ? `?transactionId=${transactionId}` : '';
      return fetchApi<Array<{
        id: number;
        transactionId: number;
        filename: string;
        mimetype: string;
        fileSize: number;
      }>>(`/attachments${query}`);
    },
    upload: (data: {
      transactionId: number;
      filename: string;
      contentType: string;
      data: string;
    }) => fetchApi<{
      id: number;
      transactionId: number;
      filename: string;
      mimetype: string;
      fileSize: number;
      downloadUrl: string;
      expiresIn: number;
    }>('/attachments/upload', { method: 'POST', body: JSON.stringify(data) }),
    getUrl: (id: number, expiresIn?: number) =>
      fetchApi<{ url: string; expiresIn: number }>(`/attachments/${id}/url${expiresIn ? `?expiresIn=${expiresIn}` : ''}`),
    delete: (id: number) => fetchApi<void>(`/attachments/${id}`, { method: 'DELETE' }),
  },

  // Analytics
  analytics: {
    dashboard: () => fetchApi<{
      netWorth: {
        totalAssets: number;
        totalLiabilities: number;
        netWorth: number;
        liquidAssets: number;
        illiquidAssets: number;
      };
      burnRate: { grossBurnRate: number; period: string };
      runway: { runwayMonths: number | null; isUnbounded: boolean; liquidAssets: number; grossBurnRate: number };
      trialBalance: { totalDebits: number; totalCredits: number; isBalanced: boolean };
    }>('/analytics/dashboard'),
    netWorth: () => fetchApi('/analytics/net-worth'),
    netWorthTrend: (params?: { range?: '7d' | '30d' | '3m' | '6m' | '1y' }) => {
      const q = new URLSearchParams();
      if (params?.range) q.set('range', params.range);
      const qs = q.toString();
      return fetchApi<{
        range: '7d' | '30d' | '3m' | '6m' | '1y';
        bucketCount: number;
        series: Array<{
          label: string;
          asOfMs: number;
          netWorth: number;
          totalAssets: number;
          totalLiabilities: number;
        }>;
      }>(`/analytics/net-worth-trend${qs ? `?${qs}` : ''}`);
    },
    spendingTrend: (params: { periodId?: number } = {}) => fetchApi<{
      range: '30d' | 'period';
      periodId: number | null;
      periodName: string | null;
      startMs: number;
      endMs: number;
      bucketCount: number;
      totalSpent: number;
      averageDailySpend: number;
      hasIncompleteCoverage: boolean;
      series: Array<{
        label: string;
        startMs: number;
        endMs: number;
        spent: number;
        transactionCount: number;
        coverageStatus: 'complete' | 'partial' | 'skipped' | 'unknown';
      }>;
    }>(`/analytics/spending-trend${params.periodId ? `?periodId=${params.periodId}` : ''}`),
    burnRate: () => fetchApi('/analytics/burn-rate'),
    runway: () => fetchApi<{ runwayMonths: number | null; isUnbounded: boolean; liquidAssets: number }>('/analytics/runway'),
    accountBalance: (accountId: number) => fetchApi<{ accountId: number; balance: number }>(`/analytics/account-balance/${accountId}`),
    periodSummaries: () => fetchApi<Array<{
      periodId: number;
      periodName: string;
      startDate: number;
      endDate: number;
      income: number;
      expenses: number;
      net: number;
    }>>('/analytics/period-summaries'),
  },

  // Audit Log
  anomalies: {
    money: (status?: 'open' | 'resolved' | 'dismissed') => fetchApi<{
      reviews: Array<{
        id: number;
        kind: 'possible_100x_pair' | 'legacy_reconciliation_plug';
        transactionId: number;
        relatedTransactionId: number | null;
        detectedAmount: number;
        reason: string;
        status: 'open' | 'resolved' | 'dismissed';
        reviewNote: string | null;
        transaction: { id: number; date: number; description: string; txType: string; status: string } | null;
        relatedTransaction: { id: number; date: number; description: string; txType: string; status: string } | null;
      }>;
    }>(`/anomalies/money${status ? `?status=${status}` : ''}`),
    scanMoney: () => fetchApi<{ created: number; candidates: number }>('/anomalies/money/scan', { method: 'POST' }),
    reviewMoney: (id: number, status: 'resolved' | 'dismissed', reviewNote: string) => fetchApi(`/anomalies/money/${id}/review`, { method: 'POST', body: JSON.stringify({ status, reviewNote }) }),
  },

  // Audit Log
  auditLog: {
    list: (params?: {
      entityType?: string;
      entityId?: number;
      action?: string;
      search?: string;
      page?: number;
      pageSize?: number;
    }) => {
      const queryParams = new URLSearchParams();
      if (params) {
        if (params.entityType) queryParams.append('entityType', params.entityType);
        if (params.entityId) queryParams.append('entityId', params.entityId.toString());
        if (params.action) queryParams.append('action', params.action);
        if (params.search?.trim()) queryParams.append('search', params.search.trim());
        if (params.page) queryParams.append('page', params.page.toString());
        if (params.pageSize) queryParams.append('pageSize', params.pageSize.toString());
      }
      const query = queryParams.toString();
      return fetchApi<{
        entries: Array<{
          id: number;
          entityType: string;
          entityId: number;
          action: string;
          beforeSnapshot: Record<string, unknown> | null;
          afterSnapshot: Record<string, unknown> | null;
          createdAt: number;
        }>;
        total: number;
        page: number;
        pageSize: number;
      }>(`/audit-log${query ? `?${query}` : ''}`);
    },
    getEntityHistory: (entityType: string, entityId: number) =>
      fetchApi<{
        entityType: string;
        entityId: number;
        history: Array<{
          id: number;
          action: string;
          beforeSnapshot: Record<string, unknown> | null;
          afterSnapshot: Record<string, unknown> | null;
          createdAt: number;
        }>;
      }>(`/audit-log/${entityType}/${entityId}`),
  },

  /** Payroll profile (gross, PTKP) + Indonesia PPh21 / BPJS estimates with PMK 168/2023 TER */
  salarySettings: {
    get: () =>
      fetchApi<{
        settings: {
          grossMonthly: number;
          payrollDay: number;
          ptkpCode: string;
          depositAccountId: number | null;
          depositAccountName: string | null;
          terCategory: string;
          jkkRiskGrade: number;
          jkmRate: number;
          bpjsKesehatanActive: boolean;
          jpWageCap: number;
          bpjsKesWageCap: number;
          jhtWageCap: number;
        };
        ptkpOptions: Array<{ code: string; label: string; annualPtkp: number; terCategory: string }>;
        computed: {
          grossMonthly: number;
          ptkpCode: string;
          ptkpAnnual: number;
          terCategory: string;
          taxBasisBruto: number;
          employerJkk: number;
          employerJkm: number;
          employerBpjsKes: number;
          jhtMonthly: number;
          jpMonthly: number;
          bpjsKesehatanMonthly: number;
          pph21Monthly: number;
          totalMandatoryDeductionsMonthly: number;
          estimatedNetMonthly: number;
          calculationMethod: string;
          notes: string[];
        };
      }>('/salary-settings'),
    preview: (params: {
      grossMonthly: number;
      ptkpCode: string;
      month?: number;
      jkkRiskGrade?: number;
      jkmRate?: number;
      bpjsKesehatanActive?: boolean;
      jpWageCap?: number;
      bpjsKesWageCap?: number;
      jhtWageCap?: number;
    }) => {
      const q = new URLSearchParams();
      q.set('grossMonthly', String(params.grossMonthly));
      q.set('ptkpCode', params.ptkpCode);
      if (params.month) q.set('month', String(params.month));
      if (params.jkkRiskGrade !== undefined) q.set('jkkRiskGrade', String(params.jkkRiskGrade));
      if (params.jkmRate !== undefined) q.set('jkmRate', String(params.jkmRate));
      if (params.bpjsKesehatanActive !== undefined) q.set('bpjsKesehatanActive', String(params.bpjsKesehatanActive));
      if (params.jpWageCap !== undefined) q.set('jpWageCap', String(params.jpWageCap));
      if (params.bpjsKesWageCap !== undefined) q.set('bpjsKesWageCap', String(params.bpjsKesWageCap));
      if (params.jhtWageCap !== undefined) q.set('jhtWageCap', String(params.jhtWageCap));
      return fetchApi<{
        computed: {
          grossMonthly: number;
          ptkpCode: string;
          ptkpAnnual: number;
          terCategory: string;
          taxBasisBruto: number;
          employerJkk: number;
          employerJkm: number;
          employerBpjsKes: number;
          jhtMonthly: number;
          jpMonthly: number;
          bpjsKesehatanMonthly: number;
          pph21Monthly: number;
          totalMandatoryDeductionsMonthly: number;
          estimatedNetMonthly: number;
          calculationMethod: string;
          notes: string[];
        };
        month: number;
      }>(`/salary-settings/preview?${q.toString()}`);
    },
    postingPreview: () =>
      fetchApi<{
        wouldPost: boolean;
        isPayrollDay: boolean;
        todayDay: number;
        payrollDay: number;
        grossMonthly: number;
        netMonthly: number;
        depositAccountId: number | null;
        depositAccountName: string | null;
        message: string;
      }>('/salary-settings/posting-preview'),
    catchUpPreview: () => fetchApi<{
      occurrences: Array<{ occurrenceDate: number; netAmount: number; status: 'due' | 'posted' | 'skipped' | 'legacy'; transactionId?: number }>;
      truncated: boolean;
      message?: string;
    }>('/salary-settings/catch-up-preview'),
    catchUp: (data: { mode: 'post' | 'skip'; occurrenceDates: number[] }) => fetchApi<{
      mode: 'post' | 'skip';
      results: Array<{ occurrenceDate: number; posted?: boolean; skipped?: boolean; transactionId?: number; message?: string }>;
    }>('/salary-settings/catch-up', { method: 'POST', body: JSON.stringify(data) }),
    postSalary: (occurrenceDate?: number) =>
      fetchApi<{
        posted: boolean;
        transactionId?: number;
        netAmount?: number;
        message?: string;
      }>('/salary-settings/post-salary', { method: 'POST', body: JSON.stringify(occurrenceDate == null ? {} : { occurrenceDate }) }),
    attachOccurrencePeriod: (occurrenceDate: number) => fetchApi<{ transactionId: number; periodId: number; changed: boolean }>(
      `/salary-settings/occurrences/${occurrenceDate}/attach-period`, { method: 'POST' },
    ),
    update: (data: Partial<{
      grossMonthly: number;
      payrollDay: number;
      ptkpCode: string;
      depositAccountId: number | null;
      terCategory?: string;
      jkkRiskGrade?: number;
      jkmRate?: number;
      bpjsKesehatanActive?: boolean;
      jpWageCap?: number;
      bpjsKesWageCap?: number;
      jhtWageCap?: number;
    }>) =>
      fetchApi<{
        settings: {
          grossMonthly: number;
          payrollDay: number;
          ptkpCode: string;
          depositAccountId: number | null;
          depositAccountName: string | null;
          terCategory: string;
          jkkRiskGrade: number;
          jkmRate: number;
          bpjsKesehatanActive: boolean;
          jpWageCap: number;
          bpjsKesWageCap: number;
          jhtWageCap: number;
        };
        ptkpOptions: Array<{ code: string; label: string; annualPtkp: number; terCategory: string }>;
        computed: {
          grossMonthly: number;
          ptkpCode: string;
          ptkpAnnual: number;
          terCategory: string;
          taxBasisBruto: number;
          employerJkk: number;
          employerJkm: number;
          employerBpjsKes: number;
          jhtMonthly: number;
          jpMonthly: number;
          bpjsKesehatanMonthly: number;
          pph21Monthly: number;
          totalMandatoryDeductionsMonthly: number;
          estimatedNetMonthly: number;
          calculationMethod: string;
          notes: string[];
        };
      }>('/salary-settings', { method: 'PUT', body: JSON.stringify(data) }),
  },

  subscriptions: {
    list: () =>
      fetchApi<{
        subscriptions: Array<{
          id: number;
          name: string;
          linkedAccountId: number;
          linkedAccountName: string;
          categoryId: number | null;
          amount: number;
          billingCycle: string;
          nextRenewalAt: number;
          status: string;
          iconKey: string;
          sortOrder: number;
          createdAt: number;
          updatedAt: number;
        }>;
        renewalPreview: {
          occurrences: Array<{
            subscriptionId: number;
            subscriptionName: string;
            dueAt: number;
            amount: number;
            linkedAccountId: number;
            billingCycle: string;
          }>;
          truncated: boolean;
        };
      }>('/subscriptions'),
    get: (id: number) =>
      fetchApi<{
        id: number;
        name: string;
        linkedAccountId: number;
        linkedAccountName: string;
        categoryId: number | null;
        amount: number;
        billingCycle: string;
        nextRenewalAt: number;
        status: string;
        iconKey: string;
        sortOrder: number;
        createdAt: number;
        updatedAt: number;
      }>(`/subscriptions/${id}`),
    create: (data: {
      name: string;
      linkedAccountId: number;
      categoryId?: number | null;
      amount: number;
      billingCycle?: string;
      nextRenewalAt: number;
      status?: string;
      iconKey?: string;
      sortOrder?: number;
    }) =>
      fetchApi<{
        id: number;
        name: string;
        linkedAccountId: number;
        linkedAccountName: string;
        categoryId: number | null;
        amount: number;
        billingCycle: string;
        nextRenewalAt: number;
        status: string;
        iconKey: string;
        sortOrder: number;
        createdAt: number;
        updatedAt: number;
      }>('/subscriptions', { method: 'POST', body: JSON.stringify(data) }),
    update: (
      id: number,
      data: Partial<{
        name: string;
        linkedAccountId: number;
        categoryId: number | null;
        amount: number;
        billingCycle: string;
        nextRenewalAt: number;
        status: string;
        iconKey: string;
        sortOrder: number;
      }>,
    ) =>
      fetchApi<{
        id: number;
        name: string;
        linkedAccountId: number;
        linkedAccountName: string;
        categoryId: number | null;
        amount: number;
        billingCycle: string;
        nextRenewalAt: number;
        status: string;
        iconKey: string;
        sortOrder: number;
        createdAt: number;
        updatedAt: number;
      }>(`/subscriptions/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: number) => fetchApi<void>(`/subscriptions/${id}`, { method: 'DELETE' }),
    runRenewals: (
      mode: 'post' | 'skip',
      occurrences: Array<{ subscriptionId: number; dueAt: number }>,
    ) =>
      fetchApi<{ posted: number; skipped: number; transactionIds: number[] }>(
        '/subscriptions/run-renewals',
        { method: 'POST', body: JSON.stringify({ mode, occurrences }) },
      ),
  },

  paylater: {
    recognize: (data: {
      date: number;
      description: string;
      principalAmount: number;
      paylaterLiabilityAccountId: number;
      categoryId?: number;
      installmentMonths: 1 | 3 | 6 | 12;
      interestRatePercent?: number;
      adminFeeCents?: number;
      firstDueDate: number;
      reference?: string;
      notes?: string;
    }) => fetchApi<{ transactionId: number; installments: Array<{
      installmentNumber: number;
      totalInstallments: number;
      dueDate: number;
      principalCents: number;
      interestCents: number;
      feeCents: number;
      totalCents: number;
    }> }>('/paylater/recognize', { method: 'POST', body: JSON.stringify(data) }),
    calculateSchedule: (data: {
      principalAmount: number;
      installmentMonths: 1 | 3 | 6 | 12;
      interestRatePercent?: number;
      adminFeeCents?: number;
      firstDueDate: number;
    }) => fetchApi<{ installments: Array<{
      installmentNumber: number;
      totalInstallments: number;
      dueDate: number;
      principalCents: number;
      interestCents: number;
      feeCents: number;
      totalCents: number;
    }> }>('/paylater/calculate-schedule', { method: 'POST', body: JSON.stringify(data) }),
    interest: (data: {
      date: number;
      description: string;
      interestAmount: number;
      interestExpenseAccountId: number;
      paylaterLiabilityAccountId: number;
      originalTxId?: number;
      reference?: string;
      notes?: string;
      dueDate?: number | null;
    }) => fetchApi<{ transactionId: number }>('/paylater/interest', { method: 'POST', body: JSON.stringify(data) }),
    settle: (data: {
      date: number;
      description: string;
      paymentAmount: number;
      paylaterLiabilityAccountId: number;
      bankAccountId: number;
      originalTxId?: number;
      reference?: string;
      notes?: string;
    }) => fetchApi<{ transactionId: number }>('/paylater/settle', { method: 'POST', body: JSON.stringify(data) }),
    summary: () => fetchApi<{
      totalOutstanding: number;
      paylaterAccounts: Array<{ accountId: number; accountName: string; balance: number }>;
    }>('/paylater/summary'),
    obligations: () =>
      fetchApi<{
        obligations: Array<{
          recognitionTxId: number;
          description: string;
          dateRecognizedMs: number;
          liabilityAccountId: number;
          liabilityAccountName: string;
          principalCents: number;
          interestPostedCents: number;
          paymentsPostedCents: number;
          outstandingCents: number;
          dueDateMs: number | null;
          status: 'paid' | 'overdue' | 'due_soon' | 'current';
          daysUntilDue: number | null;
        }>;
        scheduleItems: Array<{
          dateMs: number;
          kind: 'recognition' | 'interest';
          recognitionTxId: number;
          transactionId: number;
          description: string;
          amountCents: number;
          liabilityAccountId: number;
          liabilityAccountName: string;
        }>;
        providerExposure: Array<{
          liabilityAccountId: number;
          liabilityAccountName: string;
          totalOutstandingCents: number;
          nextDueDateMs: number | null;
          daysUntilNextDue: number | null;
        }>;
        totalOutstandingCents: number;
      }>('/paylater/obligations'),
  },

  // Reports
  reports: {
    incomeStatement: (periodId?: number, startDate?: number, endDate?: number) => {
      const params = new URLSearchParams();
      if (periodId) params.append('periodId', periodId.toString());
      if (startDate) params.append('startDate', startDate.toString());
      if (endDate) params.append('endDate', endDate.toString());
      return fetchApi<{
        revenue: Array<{ name: string; code?: string; amount: number; isTotal?: boolean; level: number }>;
        expenses: Array<{ name: string; code?: string; amount: number; isTotal?: boolean; level: number }>;
        totalRevenue: number;
        totalExpenses: number;
        netIncome: number;
        periodName?: string;
        startDate?: number;
        endDate?: number;
      }>(`/reports/income-statement?${params.toString()}`);
    },
    balanceSheet: (asOfDate?: number) => {
      const params = asOfDate ? `?asOfDate=${asOfDate}` : '';
      return fetchApi<{
        assets: Array<{ name: string; code: string; balance: number; level: number; isTotal?: boolean }>;
        liabilities: Array<{ name: string; code: string; balance: number; level: number; isTotal?: boolean }>;
        equity: Array<{ name: string; code: string; balance: number; level: number; isTotal?: boolean }>;
        totalAssets: number;
        totalLiabilities: number;
        totalEquity: number;
        asOfDate: string;
      }>(`/reports/balance-sheet${params}`);
    },
    cashFlow: (periodId?: number, startDate?: number, endDate?: number) => {
      const params = new URLSearchParams();
      if (periodId) params.append('periodId', periodId.toString());
      if (startDate) params.append('startDate', startDate.toString());
      if (endDate) params.append('endDate', endDate.toString());
      return fetchApi<{
        operating: Array<{ category: string; description: string; amount: number; type: string; classificationSource: 'explicit' | 'legacy_inference' }>;
        investing: Array<{ category: string; description: string; amount: number; type: string; classificationSource: 'explicit' | 'legacy_inference' }>;
        financing: Array<{ category: string; description: string; amount: number; type: string; classificationSource: 'explicit' | 'legacy_inference' }>;
        netOperating: number;
        netInvesting: number;
        netFinancing: number;
        netChange: number;
        historicalRecoveryBridge?: number;
        beginningCash: number;
        endingCash: number;
        periodName?: string;
        coverage?: { isComparable: boolean; warnings: string[] };
      }>(`/reports/cash-flow?${params.toString()}`);
    },
    spending: (periodId?: number, startDate?: number, endDate?: number) => {
      const params = new URLSearchParams();
      if (periodId) params.append('periodId', periodId.toString());
      if (startDate) params.append('startDate', startDate.toString());
      if (endDate) params.append('endDate', endDate.toString());
      return fetchApi<{
        breakdown: Array<{ category: string; accountId: number; amount: number; percentage: number }>;
        total: number;
        coverage: { complete: number[]; partial: number[]; skipped: number[]; unknown: number[]; isComparable: boolean; warnings: string[] };
      }>(`/reports/spending?${params.toString()}`);
    },
    monthly: (periodId: number) => fetchApi<{
      revision: number;
      period: { id: number; name: string; startDate: number; endDate: number };
      incomeStatement: { totalRevenue: number; totalExpenses: number; netIncome: number };
      balanceSheet: { totalAssets: number; totalLiabilities: number; totalEquity: number; asOfDate: string };
      incomeBySource: Array<{ name: string; amount: number }>;
      expensesByCategory: Array<{ name: string; amount: number }>;
      budgetComparison: Array<{ category: string; budget: number; actual: number; variance: number }>;
      transactions: Array<{ id: number; date: number; description: string; category: string; amountCents: number; type: string }>;
      coverage: { complete: number[]; partial: number[]; skipped: number[]; unknown: number[]; isComparable: boolean; warnings: string[] };
      provenance: { source: string; asOfMs: number; includesDrafts: boolean };
    }>(`/reports/monthly?periodId=${periodId}`),
    trends: (periodCount?: number) => {
      const params = periodCount ? `?periodCount=${periodCount}` : '';
      return fetchApi<Array<{
        periodId: number;
        periodName: string;
        startDate: number;
        endDate: number;
        revenue: number;
        expenses: number;
        netIncome: number;
        coverage: { complete: number[]; partial: number[]; skipped: number[]; unknown: number[]; isComparable: boolean; warnings: string[] };
      }>>(`/reports/trends${params}`);
    },
    export: (reportType: 'income-statement' | 'balance-sheet' | 'cash-flow', periodId?: number, startDate?: number, endDate?: number, asOfDate?: number) => {
      const params = new URLSearchParams();
      if (periodId) params.append('periodId', periodId.toString());
      if (startDate) params.append('startDate', startDate.toString());
      if (endDate) params.append('endDate', endDate.toString());
      if (asOfDate) params.append('asOfDate', asOfDate.toString());

      const url = `/reports/export/${reportType}?${params.toString()}`;
      return fetch(url, {
        credentials: 'include',
      }).then((res) => {
        if (!res.ok) throw new Error('Export failed');
        return res.text();
      });
    },
  },

  // Wishlist - planned purchases and goals
  wishlist: {
    list: (filters?: { status?: string; categoryId?: number; periodId?: number }) => {
      const params = new URLSearchParams();
      if (filters?.status) params.append('status', filters.status);
      if (filters?.categoryId) params.append('categoryId', filters.categoryId.toString());
      if (filters?.periodId) params.append('periodId', filters.periodId.toString());
      const query = params.toString() ? `?${params.toString()}` : '';
      return fetchApi<Array<{
        id: number;
        name: string;
        description: string | null;
        amount: number;
        status: 'active' | 'fulfilled' | 'cancelled';
        createdAt: number;
        updatedAt: number;
        fulfilledAt: number | null;
        fulfilledTransactionId: number | null;
        categoryId: number | null;
        periodId: number | null;
        imageUrl: string | null;
        category: {
          id: number;
          name: string;
          icon: string | null;
          color: string | null;
        } | null;
        period: {
          id: number;
          name: string;
          startDate: number;
          endDate: number;
        } | null;
      }>>(`/wishlist${query}`);
    },
    get: (id: number) => fetchApi<{
      id: number;
      name: string;
      description: string | null;
      amount: number;
      status: 'active' | 'fulfilled' | 'cancelled';
      createdAt: number;
      updatedAt: number;
      fulfilledAt: number | null;
      fulfilledTransactionId: number | null;
      categoryId: number | null;
      periodId: number | null;
      category: {
        id: number;
        name: string;
        icon: string | null;
        color: string | null;
      } | null;
      period: {
        id: number;
        name: string;
        startDate: number;
        endDate: number;
      } | null;
    }>(`/wishlist/${id}`),
    create: (data: {
      name: string;
      description?: string | null;
      amount: number;
      categoryId?: number | null;
      periodId?: number | null;
      imageUrl?: string | null;
    }) => fetchApi<{
      id: number;
      name: string;
      description: string | null;
      amount: number;
      status: string;
      createdAt: number;
      updatedAt: number;
      imageUrl: string | null;
    }>('/wishlist', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    update: (id: number, data: Partial<{
      name: string;
      description: string | null;
      amount: number;
      categoryId: number | null;
      periodId: number | null;
      status: string;
    }>) => fetchApi<{
      id: number;
      name: string;
      description: string | null;
      amount: number;
      status: string;
      createdAt: number;
      updatedAt: number;
    }>(`/wishlist/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
    delete: (id: number) => fetchApi<void>(`/wishlist/${id}`, { method: 'DELETE' }),
    fulfill: (id: number, data: {
      date: string;
      accountId: number;
      description?: string;
      notes?: string;
    }) => fetchApi<{
      wishlist: {
        id: number;
        status: string;
        fulfilledAt: number;
        fulfilledTransactionId: number;
      };
      transaction: {
        id: number;
        description: string;
        amount: number;
      };
    }>(`/wishlist/${id}/fulfill`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    link: (id: number, transactionId: number) => fetchApi<{
      wishlist: {
        id: number;
        status: string;
        fulfilledAt: number;
        fulfilledTransactionId: number;
      };
      transaction: {
        id: number;
        description: string;
        amount: number;
      };
    }>(`/wishlist/${id}/link`, {
      method: 'POST',
      body: JSON.stringify({ transactionId }),
    }),
    scrape: async (url: string) => {
      const response = await fetch(`${API_BASE}/wishlist/scrape`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
        credentials: 'include',
      });
      
      const data = await response.json();
      return data as {
        success: boolean;
        data?: {
          name: string;
          description: string;
          price: number;
          originalPrice?: number;
          discountPercentage?: number;
          currency: string;
          imageUrl: string;
          galleryImages?: string[];
          rating?: number;
          reviewCount?: number;
          sellerName?: string;
          brand?: string;
          source: string;
          url: string;
        };
        attempts: Array<{
          method: string;
          success: boolean;
          timestamp: number;
          duration: number;
          error?: string;
          dataFound?: any;
        }>;
        requiresAdvancedScraping: boolean;
        error?: {
          code: string;
          message: string;
          suggestions: string[];
        };
      };
    },
    scrapeAdvanced: async (url: string) => {
      const response = await fetch(`${API_BASE}/wishlist/scrape-advanced`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
        credentials: 'include',
      });
      
      const data = await response.json();
      return data as {
        success: boolean;
        data?: {
          name: string;
          description: string;
          price: number;
          originalPrice?: number;
          discountPercentage?: number;
          currency: string;
          imageUrl: string;
          galleryImages?: string[];
          rating?: number;
          reviewCount?: number;
          sellerName?: string;
          brand?: string;
          source: string;
          url: string;
        };
        attempts: Array<{
          method: string;
          success: boolean;
          timestamp: number;
          duration: number;
          error?: string;
          dataFound?: any;
        }>;
        requiresAdvancedScraping: boolean;
        error?: {
          code: string;
          message: string;
          suggestions: string[];
        };
      };
    },
  },

  // Contacts
  contacts: {
    list: (params?: { search?: string; includeInactive?: boolean }) => {
      const queryParams = new URLSearchParams();
      if (params?.search) queryParams.append('search', params.search);
      if (params?.includeInactive) queryParams.append('includeInactive', 'true');
      const query = queryParams.toString();
      return fetchApi<Array<{
        id: number;
        name: string;
        fullName: string | null;
        nickname: string | null;
        email: string | null;
        phone: string | null;
        relationshipType: string | null;
        notes: string | null;
        isActive: boolean;
        createdAt: number;
        updatedAt: number;
        totalLent: number;
        totalBorrowed: number;
        netBalance: number;
        activeLoansCount: number;
      }>>(`/contacts${query ? `?${query}` : ''}`);
    },
    get: (id: number) => fetchApi<{
      id: number;
      name: string;
      fullName: string | null;
      nickname: string | null;
      email: string | null;
      phone: string | null;
      relationshipType: string | null;
      notes: string | null;
      isActive: boolean;
      createdAt: number;
      updatedAt: number;
      loans: Array<{
        id: number;
        contactId: number;
        direction: 'lent' | 'borrowed';
        amountCents: number;
        remainingCents: number;
        startDate: number;
        dueDate: number | null;
        status: 'active' | 'repaid' | 'defaulted' | 'written_off';
        description: string | null;
        createdAt: number;
      }>;
      summary: {
        totalLent: number;
        totalBorrowed: number;
        netBalance: number;
        activeLoansCount: number;
        repaidLoansCount: number;
        totalLentAllTime: number;
        totalBorrowedAllTime: number;
      };
    }>(`/contacts/${id}`),
    create: (data: {
      name: string;
      fullName?: string | null;
      nickname?: string | null;
      email?: string | null;
      phone?: string | null;
      relationshipType?: string | null;
      notes?: string | null;
    }) => fetchApi<{
      id: number;
      name: string;
      fullName: string | null;
      nickname: string | null;
      email: string | null;
      phone: string | null;
      relationshipType: string | null;
      notes: string | null;
      isActive: boolean;
      createdAt: number;
      updatedAt: number;
    }>('/contacts', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<{
      name: string;
      fullName: string | null;
      nickname: string | null;
      email: string | null;
      phone: string | null;
      relationshipType: string | null;
      notes: string | null;
    }>) => fetchApi<{
      id: number;
      name: string;
      fullName: string | null;
      nickname: string | null;
      email: string | null;
      phone: string | null;
      relationshipType: string | null;
      notes: string | null;
      isActive: boolean;
      createdAt: number;
      updatedAt: number;
    }>(`/contacts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: number) => fetchApi<void>(`/contacts/${id}`, { method: 'DELETE' }),
    restore: (id: number) => fetchApi(`/contacts/${id}/restore`, { method: 'POST' }),
  },

  // Loans
  loans: {
    list: (params?: {
      direction?: 'lent' | 'borrowed';
      status?: 'active' | 'repaid' | 'defaulted' | 'written_off';
      contactId?: number;
      includeHistory?: boolean;
    }) => {
      const queryParams = new URLSearchParams();
      if (params?.direction) queryParams.append('direction', params.direction);
      if (params?.status) queryParams.append('status', params.status);
      if (params?.contactId) queryParams.append('contactId', params.contactId.toString());
      if (params?.includeHistory) queryParams.append('includeHistory', 'true');
      const query = queryParams.toString();
      return fetchApi<Array<{
        id: number;
        contactId: number;
        direction: 'lent' | 'borrowed';
        amountCents: number;
        remainingCents: number;
        startDate: number;
        dueDate: number | null;
        status: string;
        description: string | null;
        contact: { id: number; name: string };
        isOverdue: boolean;
        daysOverdue: number;
      }>>(`/loans${query ? `?${query}` : ''}`);
    },
    summary: () => fetchApi<{
      totalLent: number;
      totalBorrowed: number;
      netPosition: number;
      totalRepaid: number;
      activeLoansCount: number;
      repaidLoansCount: number;
      defaultedLoansCount: number;
    }>('/loans/summary'),
    get: (id: number) => fetchApi<{
      id: number;
      contactId: number;
      direction: 'lent' | 'borrowed';
      amountCents: number;
      remainingCents: number;
      startDate: number;
      dueDate: number | null;
      status: string;
      description: string | null;
      sourceType: string;
      contact: { id: number; name: string };
      payments: Array<{
        id: number;
        loanId: number;
        amountCents: number;
        principalCents: number;
        paymentDate: number;
        notes: string | null;
        createdAt: number;
      }>;
      isOverdue: boolean;
      daysOverdue: number;
    }>(`/loans/${id}`),
    create: (data: {
      contactId: number;
      direction: 'lent' | 'borrowed';
      amountCents: number;
      description?: string;
      dueDate?: number | null;
      walletAccountId: number;
    }) => fetchApi<{
      id: number;
      contactId: number;
      direction: 'lent' | 'borrowed';
      amountCents: number;
      remainingCents: number;
      startDate: number;
      dueDate: number | null;
      status: string;
      description: string | null;
    }>('/loans', { method: 'POST', body: JSON.stringify(data) }),
    recordPayment: (id: number, data: {
      amountCents: number;
      paymentDate?: number;
      notes?: string;
      walletAccountId: number;
    }) => fetchApi<{
      payment: {
        id: number;
        loanId: number;
        amountCents: number;
        principalCents: number;
        paymentDate: number;
        notes: string | null;
        createdAt: number;
      };
      loan: {
        id: number;
        remainingCents: number;
        status: string;
      };
    }>(`/loans/${id}/payments`, { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: {
      status?: 'active' | 'repaid' | 'defaulted' | 'written_off';
      description?: string;
    }) => fetchApi<{
      id: number;
      contactId: number;
      direction: 'lent' | 'borrowed';
      amountCents: number;
      remainingCents: number;
      startDate: number;
      dueDate: number | null;
      status: string;
      description: string | null;
    }>(`/loans/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: number) => fetchApi<void>(`/loans/${id}`, { method: 'DELETE' }),
  },

  insights: {
    generateDashboard: (periodId?: number) => fetchApi<{ insight: string; generatedAt: string; sourceRevision: number; stale: false }>(`/insights/dashboard${periodId ? `?periodId=${periodId}` : ''}`, { method: 'POST' }),
    generateBudget: (periodId?: number) => fetchApi<{ insight: string; generatedAt: string; sourceRevision: number; stale: false }>(`/insights/budget`, {
      method: 'POST', 
      body: JSON.stringify({ periodId }) 
    }),
    getDashboardLatest: (periodId?: number) => fetchApi<{ insight: string | null; generatedAt: string | null; sourceRevision: number | null; stale: boolean }>(`/insights/dashboard/latest${periodId ? `?periodId=${periodId}` : ''}`),
    getBudgetLatest: (periodId?: number) => fetchApi<{ insight: string | null; generatedAt: string | null; sourceRevision: number | null; stale: boolean }>(`/insights/budget/latest${periodId ? `?periodId=${periodId}` : ''}`),
  },

  agent: {
    memories: {
      list: () => fetchApi<{ memories: AgentMemory[]; limits: { maxItems: number; maxLabelLength: number; maxContentLength: number } }>('/agent/memories'),
      create: (data: { label: string; content: string }) => fetchApi<{ memory: AgentMemory }>('/agent/memories', {
        method: 'POST', body: JSON.stringify(data),
      }),
      update: (id: number, data: { label?: string; content?: string }) => fetchApi<{ memory: AgentMemory }>(`/agent/memories/${id}`, {
        method: 'PATCH', body: JSON.stringify(data),
      }),
      delete: (id: number) => fetchApi<void>(`/agent/memories/${id}`, { method: 'DELETE' }),
    },
    conversations: {
      list: (options: { includeArchived?: boolean } = {}) => fetchApi<{ conversations: Array<{ id: number; title: string; createdAt: number; updatedAt: number; isPinned: boolean; archivedAt: number | null }>; includeArchived: boolean }>(`/agent/conversations${options.includeArchived ? '?includeArchived=true' : ''}`),
      create: (data: { title?: string } = {}) => fetchApi<{ conversation: { id: number; title: string; createdAt: number; updatedAt: number; isPinned: boolean; archivedAt: number | null } }>('/agent/conversations', {
        method: 'POST', body: JSON.stringify(data),
      }),
      get: (id: number) => fetchApi<{
        conversation: { id: number; title: string; createdAt: number; updatedAt: number; isPinned: boolean; archivedAt: number | null };
        messages: Array<{ id: number; role: 'user' | 'assistant'; content: string; response?: unknown; createdAt: number }>;
      }>(`/agent/conversations/${id}`),
      update: (id: number, data: { title?: string; isPinned?: boolean; archived?: boolean }) => fetchApi<{ conversation: { id: number; title: string; createdAt: number; updatedAt: number; isPinned: boolean; archivedAt: number | null } }>(`/agent/conversations/${id}`, {
        method: 'PATCH', body: JSON.stringify(data),
      }),
      delete: (id: number) => fetchApi<void>(`/agent/conversations/${id}`, { method: 'DELETE' }),
    },
    tools: () => fetchApi<{
      schemaVersion: number;
      revision: number;
      tools: Array<{
        name: string;
        description: string;
        inputSchema: Record<string, unknown>;
      }>;
      policy: { readOnly: boolean; writesRequireExplicitConfirmation: boolean };
    }>('/agent/tools'),
    toolCall: (data: { name: string; input?: Record<string, unknown> }) =>
      fetchApi<{ tool: string; revision: number; readOnly: true; data: unknown }>('/agent/tool-call', {
        method: 'POST', body: JSON.stringify(data),
      }),
    financialFacts: (input: { periodId?: number; startDate?: number; endDate?: number } = {}) =>
      fetchApi<AgentFinancialFacts>('/agent/tool-call', {
        method: 'POST', body: JSON.stringify({ name: 'get_financial_facts', input }),
      }),
    searchTransactions: (input: { periodId?: number; startDate?: number; endDate?: number; text?: string; limit?: number } = {}) =>
      fetchApi<AgentTransactionSearch>('/agent/tool-call', {
        method: 'POST', body: JSON.stringify({ name: 'search_transactions', input }),
      }),
    context: (params?: { periodId?: number; startDate?: number; endDate?: number }) => {
      const query = new URLSearchParams();
      if (params?.periodId) query.set('periodId', String(params.periodId));
      if (params?.startDate) query.set('startDate', String(params.startDate));
      if (params?.endDate) query.set('endDate', String(params.endDate));
      return fetchApi(`/agent/context${query.toString() ? `?${query.toString()}` : ''}`);
    },
    query: (data: { question: string; periodId?: number; startDate?: number; endDate?: number; conversationId?: number; replaceMessageId?: number; images?: Array<{ filename: string; mimeType: string; data: string }> }) =>
      fetchApi<AgentQueryResponse>('/agent/query', {
        method: 'POST', body: JSON.stringify(data),
      }),
    streamQuery: streamAgentQuery,
    planBudget: (data: { periodId?: number; targetSavingsRate?: number }) =>
      fetchApi<{ revision: number; targetSavingsRate: number; incomeCents: number; targetSpendCents: number; recommendations: Array<{ categoryId: number | null; category: string; suggestedAmountCents: number; basis: string }>; requiresConfirmation: boolean; writesPerformed: boolean }>('/agent/plan-budget', {
        method: 'POST', body: JSON.stringify(data),
      }),
    actions: {
      list: (conversationId?: number) => fetchApi<{ actions: Array<{
        pendingActionId: number;
        conversationId: number | null;
        kind: string;
        status: string;
        input: unknown;
        assumptions: string[];
        missingFields: string[];
        baseFinancialRevision: number;
        createdAt: number;
        expiresAt: number;
      }> }>(`/agent/actions${conversationId ? `?conversationId=${conversationId}` : ''}`),
      prepare: (data: {
        conversationId?: number | null;
        kind: 'budget_plan_upsert' | 'transaction_journal_create';
        input: unknown;
        assumptions?: string[];
        missingFields?: string[];
        idempotencyKey?: string;
      }) => fetchApi<AgentActionProposal>('/agent/actions/prepare', { method: 'POST', body: JSON.stringify(data) }),
      prepareBudget: (data: {
        conversationId?: number | null;
        input: { periodId: number; plans: Array<{ categoryId: number; plannedAmountCents: number }> };
        assumptions?: string[];
        missingFields?: string[];
        idempotencyKey?: string;
      }) => fetchApi<AgentBudgetActionProposal>('/agent/actions/prepare', { method: 'POST', body: JSON.stringify({ ...data, kind: 'budget_plan_upsert' }) }),
      prepareTransaction: (data: {
        conversationId?: number | null;
        input: {
          dateMs: number;
          description: string;
          reference?: string | null;
          notes?: string | null;
          place?: string | null;
          periodId?: number | null;
          categoryId?: number | null;
          categoryAllocations?: Array<{ categoryId: number; amount: number }>;
          lines: Array<{ accountId: number; debit: number; credit: number; description?: string; cashFlowClass?: 'operating' | 'investing' | 'financing' | 'transfer' | 'recovery' | null }>;
          tagIds?: number[];
        };
        assumptions?: string[];
        missingFields?: string[];
        idempotencyKey?: string;
      }) => fetchApi<AgentTransactionActionProposal>('/agent/actions/prepare', { method: 'POST', body: JSON.stringify({ ...data, kind: 'transaction_journal_create' }) }),
      execute: (approvalId: number, token: string) => fetchApi<{ receipt: {
        actionId: number;
        approvalId: number;
        kind: 'budget_plan_upsert' | 'transaction_journal_create';
        periodId?: number | null;
        transactionId?: number;
        changed?: Array<{ planId: number; categoryId: number; plannedAmountCents: number; operation: 'created' | 'updated' }>;
        changedCount?: number;
        auditLogIds: number[];
        financialRevision: number;
        executedAt: number;
      }; replay: boolean }>(`/agent/approvals/${approvalId}/execute`, { method: 'POST', body: JSON.stringify({ token }) }),
      reissue: (approvalId: number) => fetchApi<AgentActionProposal>(`/agent/approvals/${approvalId}/reissue`, { method: 'POST', body: JSON.stringify({}) }),
      reject: (approvalId: number, token: string) => fetchApi<{ status: 'rejected'; approvalId: number }>(`/agent/approvals/${approvalId}/reject`, { method: 'POST', body: JSON.stringify({ token }) }),
    },
  },

  pendingTransactions: {
    list: () =>
      fetchApi<Array<{
        id: number;
        rawMessage: string;
        parsedData: {
          type: string;
          amount: number;
          description: string;
          category: string;
          date?: string;
          place?: string;
          notes?: string;
          confidence: number;
        };
        status: string;
        parseAttempts: number;
        lastError: string | null;
        createdAt: number;
      }>>('/pending-transactions'),
    get: (id: number) =>
      fetchApi<{
        id: number;
        rawMessage: string;
        parsedData: {
          type: string;
          amount: number;
          description: string;
          category: string;
          date?: string;
          place?: string;
          notes?: string;
          confidence: number;
        };
        status: string;
        parseAttempts: number;
        lastError: string | null;
        source: string;
        createdAt: number;
      }>(`/pending-transactions/${id}`),
    approve: (id: number) =>
      fetchApi<{ success: boolean; transactionId?: number; message?: string }>(`/pending-transactions/${id}/approve`, { method: 'POST' }),
    reject: (id: number) =>
      fetchApi<{ success: boolean }>(`/pending-transactions/${id}/reject`, { method: 'POST' }),
    retry: (id: number) =>
      fetchApi<{ success: boolean; parsed?: unknown }>(`/pending-transactions/${id}/retry`, { method: 'POST' }),
    preview: (message: string) =>
      fetchApi<{
        parsed: {
          type: string;
          amount: number;
          description: string;
          category: string;
          date?: string;
          place?: string;
          memo?: string;
          fromAccount?: string;
          toAccount?: string;
          confidence: number;
        };
      }>('/pending-transactions/preview', {
        method: 'POST',
        body: JSON.stringify({ message }),
      }),
    create: (message: string, parsed: {
      type: string;
      amount: number;
      description: string;
      category: string;
      date?: string;
      place?: string;
      memo?: string;
      fromAccount?: string;
      toAccount?: string;
      confidence: number;
    }) =>
      fetchApi<{ pendingId: number }>('/pending-transactions', {
        method: 'POST',
        body: JSON.stringify({ message, parsed, source: 'web' }),
      }),
    update: (id: number, parsed: {
      type: string;
      amount: number;
      description: string;
      category: string;
      date?: string;
      place?: string;
      memo?: string;
      fromAccount?: string;
      toAccount?: string;
      confidence: number;
    }) =>
      fetchApi<{ success: boolean }>(`/pending-transactions/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ parsed }),
      }),
  },

  // Splitbill
  splitbill: {
    scan: (imageData: string, filename: string) =>
      fetchApi<{
        parsed: {
          merchantName: string;
          receiptDate: string;
          expenseCategory: string;
          items: Array<{
            name: string;
            quantity: number;
            unitPrice: number;
            totalPrice: number;
            notes: string | null;
          }>;
          subtotal: number;
          tax: number;
          taxPercent: number;
          serviceFee: number;
          servicePercent: number;
          discount: number;
          discountPercent: number;
          total: number;
          paymentMethod: string | null;
          currency: string;
        };
        r2Key: string;
      }>('/splitbill/scan', {
        method: 'POST',
        body: JSON.stringify({ imageData, filename }),
      }),
    calculate: (data: {
      items: Array<{
        name: string;
        quantity: number;
        unitPrice: number;
        totalPrice: number;
        notes: string | null;
      }>;
      people: Array<{ id?: number; name: string; isNew?: boolean }>;
      assignments: Array<{ itemIndex: number; personIds: number[] }>;
      tax: number;
      serviceFee: number;
      discount: number;
    }) =>
      fetchApi<Array<{
        personId: number;
        personName: string;
        assignedItems: Array<{
          name: string;
          quantity: number;
          unitPrice: number;
          totalPrice: number;
          notes: string | null;
        }>;
        subtotal: number;
        taxShare: number;
        serviceShare: number;
        discountShare: number;
        total: number;
      }>>('/splitbill/calculate', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    createLoans: (data: {
      splitResults: Array<{
        personId: number;
        personName: string;
        total: number;
      }>;
      isBorrower: boolean;
      walletAccountId?: number;
      expenseCategory?: string;
      receiptTotal?: number;
      merchantName?: string;
      payerContactId?: number;
    }) =>
      fetchApi<Array<{
        id: number;
        contactId: number;
        direction: string;
        amountCents: number;
        remainingCents: number;
        status: string;
      }>>('/splitbill/create-loans', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    history: () =>
      fetchApi<Array<{
        id: number;
        merchantName: string | null;
        receiptDate: number | null;
        total: number;
        status: string;
        createdAt: number;
      }>>('/splitbill/history'),
    get: (id: number) =>
      fetchApi<{
        id: number;
        merchantName: string | null;
        receiptDate: number | null;
        receiptImageR2Key: string | null;
        parsedItemsJson: string | null;
        subtotal: number | null;
        tax: number | null;
        serviceFee: number | null;
        discount: number | null;
        total: number;
        peopleJson: string | null;
        assignmentsJson: string | null;
        splitResultJson: string | null;
        loanIds: string | null;
        status: string;
        createdAt: number;
      }>(`/splitbill/${id}`),
  },
};
