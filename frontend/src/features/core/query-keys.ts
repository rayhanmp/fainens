/** One canonical query-key vocabulary. Server facts belong in React Query, never Zustand. */
export const queryKeys = {
  accounts: { all: ["accounts"] as const, list: (filters: object = {}) => ["accounts", "list", filters] as const, detail: (id: number) => ["accounts", id] as const, reconciliation: (limit: number) => ["accounts", "reconciliation", limit] as const },
  categories: { all: ["categories"] as const, list: (includeInactive = false) => ["categories", "list", { includeInactive }] as const },
  tags: { all: ["tags"] as const },
  periods: { all: ["periods"] as const, detail: (id: number) => ["periods", id] as const },
  transactions: {
    all: ["transactions"] as const,
    list: (filters: object = {}) => ["transactions", "list", filters] as const,
    detail: (id: number) => ["transactions", "detail", id] as const,
  },
  budgets: { all: ["budgets"] as const, period: (periodId: number) => ["budgets", periodId] as const, outlook: (periodId: number) => ["budgets", periodId, "outlook"] as const, comparison: (periodId: number, comparePeriodId: number) => ["budgets", "comparison", periodId, comparePeriodId] as const, templates: ["budgets", "templates"] as const },
  loans: { all: ["loans"] as const, list: (filters: object = {}) => ["loans", "list", filters] as const, summary: ["loans", "summary"] as const },
  subscriptions: { all: ["subscriptions"] as const, list: ["subscriptions", "list"] as const },
  paylater: { all: ["paylater"] as const },
  dashboard: {
    all: ["dashboard"] as const,
    analytics: ["dashboard", "analytics"] as const,
    reconciliation: ["dashboard", "reconciliation"] as const,
    loans: ["dashboard", "loans"] as const,
    paylater: ["dashboard", "paylater"] as const,
    subscriptions: ["dashboard", "subscriptions"] as const,
    period: (periodId: number) => ["dashboard", "period", periodId] as const,
  },
  agent: { all: ["agent"] as const, conversations: (archived = false) => ["agent", "conversations", { archived }] as const, conversation: (id: number) => ["agent", "conversation", id] as const, memories: ["agent", "memories"] as const },
} as const;

/** Financial mutations can change every summarized view, even when their local entity key is precise. */
export async function invalidateFinancialSummaries(queryClient: { invalidateQueries: (options: { queryKey: readonly unknown[] }) => Promise<unknown> }) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.accounts.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.categories.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.tags.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.periods.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.budgets.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.loans.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.subscriptions.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.paylater.all }),
  ]);
}
