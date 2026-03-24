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
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
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
    list: (params?: { type?: string; search?: string }) => {
      const query = params ? new URLSearchParams(params).toString() : '';
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
    }>) => fetchApi(`/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: number) => fetchApi(`/accounts/${id}`, { method: 'DELETE' }),
  },

  // Transactions
  transactions: {
    list: (params?: {
      startDate?: string;
      endDate?: string;
      accountId?: string;
      txType?: string;
      periodId?: string;
      tagId?: string;
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
          categoryId: number | null;
          periodId: number | null;
          linkedTxId: number | null;
          lines: Array<{
            id: number;
            accountId: number;
            debit: number;
            credit: number;
          }>;
          tags: Array<{ tagId: number; name: string; color: string }>;
        }>;
        pagination: {
          total: number;
          limit: number;
          offset: number;
          hasMore: boolean;
        };
      }>(`/transactions${query ? `?${query}` : ''}`);
    },
    get: (id: number) => fetchApi(`/transactions/${id}`),
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
            lines: Array<{
              accountId: number;
              debit: number;
              credit: number;
              description?: string;
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
    }>) => fetchApi(`/transactions/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: number) => fetchApi(`/transactions/${id}`, { method: 'DELETE' }),
    bulkDelete: (ids: number[]) => fetchApi<{ success: boolean; deletedCount: number; message: string }>('/transactions/bulk-delete', {
      method: 'POST',
      body: JSON.stringify({ ids }),
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
    list: (params?: { search?: string }) => {
      const query = params ? new URLSearchParams(params).toString() : '';
      return fetchApi<Array<{
        id: number;
        name: string;
        icon: string | null;
        color: string | null;
      }>>(`/categories${query ? `?${query}` : ''}`);
    },
    create: (data: { name: string; icon?: string | null; color?: string | null }) =>
      fetchApi('/categories', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<{ name: string; icon: string | null; color: string | null }>) =>
      fetchApi(`/categories/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: number) => fetchApi(`/categories/${id}`, { method: 'DELETE' }),
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
    list: () => fetchApi<Array<{ id: number; name: string; startDate: number; endDate: number }>>('/periods'),
    get: (id: number) => fetchApi(`/periods/${id}`),
    create: (data: { name: string; startDate: string; endDate: string }) =>
      fetchApi('/periods', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<{ name: string; startDate: string; endDate: string }>) =>
      fetchApi(`/periods/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: number) => fetchApi(`/periods/${id}`, { method: 'DELETE' }),
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
      return fetchApi<Array<{
        id: number;
        periodId: number;
        categoryId: number;
        plannedAmount: number;
        actualAmount: number;
        variance: number;
        percentUsed: number;
        categoryName: string;
      }>>(`/budgets${query}`);
    },
    create: (data: { periodId: number; categoryId: number; plannedAmount: number }) =>
      fetchApi('/budgets', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<{ plannedAmount: number }>) =>
      fetchApi(`/budgets/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: number) => fetchApi(`/budgets/${id}`, { method: 'DELETE' }),
    // Templates
    templates: {
      list: () => fetchApi<Array<{
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
      }>>('/budgets/templates'),
      create: (data: { name: string; description?: string; periodId: number }) =>
        fetchApi('/budgets/templates', { method: 'POST', body: JSON.stringify(data) }),
      apply: (templateId: number, data: { periodId: number; replaceExisting?: boolean }) =>
        fetchApi<{ applied: number; skipped: number }>(`/budgets/templates/${templateId}/apply`, { method: 'POST', body: JSON.stringify(data) }),
      delete: (id: number) => fetchApi(`/budgets/templates/${id}`, { method: 'DELETE' }),
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
      };
      burnRate: { grossBurnRate: number; period: string };
      runway: { runwayMonths: number; liquidAssets: number };
      trialBalance: { totalDebits: number; totalCredits: number; isBalanced: boolean };
    }>('/analytics/dashboard'),
    netWorth: () => fetchApi('/analytics/net-worth'),
    netWorthTrend: (params?: { range?: '7d' | '30d' | '6m' | '1y' }) => {
      const q = new URLSearchParams();
      if (params?.range) q.set('range', params.range);
      const qs = q.toString();
      return fetchApi<{
        range: '7d' | '30d' | '6m' | '1y';
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
    burnRate: () => fetchApi('/analytics/burn-rate'),
    runway: () => fetchApi('/analytics/runway'),
    accountBalance: (accountId: number) => fetchApi<{ accountId: number; balance: number }>(`/analytics/account-balance/${accountId}`),
    periodSummaries: () => fetchApi<Array<{
      periodId: number;
      periodName: string;
      income: number;
      expenses: number;
      net: number;
    }>>('/analytics/period-summaries'),
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
    postSalary: () =>
      fetchApi<{
        posted: boolean;
        transactionId?: number;
        netAmount?: number;
        message?: string;
      }>('/salary-settings/post-salary', { method: 'POST' }),
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
        renewal: { processed: number; skippedNoAccount: number; errors: string[] };
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
    runRenewals: () =>
      fetchApi<{ processed: number; skippedNoAccount: number; errors: string[] }>(
        '/subscriptions/run-renewals',
        { method: 'POST' },
      ),
  },

  paylater: {
    recognize: (data: {
      date: number;
      description: string;
      principalAmount: number;
      expenseAccountId: number;
      paylaterLiabilityAccountId: number;
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
        operating: Array<{ category: string; description: string; amount: number; type: string }>;
        investing: Array<{ category: string; description: string; amount: number; type: string }>;
        financing: Array<{ category: string; description: string; amount: number; type: string }>;
        netOperating: number;
        netInvesting: number;
        netFinancing: number;
        netChange: number;
        beginningCash: number;
        endingCash: number;
        periodName?: string;
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
      }>(`/reports/spending?${params.toString()}`);
    },
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
    generateDashboard: () => fetchApi<{ insight: string; generatedAt: string }>('/insights/dashboard', { method: 'POST' }),
    generateBudget: (periodId?: number) => fetchApi<{ insight: string; generatedAt: string }>(`/insights/budget`, { 
      method: 'POST', 
      body: JSON.stringify({ periodId }) 
    }),
    getDashboardLatest: () => fetchApi<{ insight: string | null; generatedAt: string | null }>('/insights/dashboard/latest'),
    getBudgetLatest: (periodId?: number) => fetchApi<{ insight: string | null; generatedAt: string | null }>(`/insights/budget/latest${periodId ? `?periodId=${periodId}` : ''}`),
  },
};
