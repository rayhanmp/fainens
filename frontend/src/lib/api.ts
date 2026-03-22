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
      return fetchApi<Array<{
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
      }>>(`/transactions${query ? `?${query}` : ''}`);
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
};
