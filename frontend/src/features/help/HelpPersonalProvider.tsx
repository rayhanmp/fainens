import { useMemo, type ReactNode } from 'react';
import { useAccountsLedgerQuery } from '../accounts/queries';
import { useAgentMemoriesQuery, useAgentProfileQuery } from '../agent/queries';
import { useBudgetPeriodsQuery } from '../budgets/queries';
import { findCurrentPeriod } from '../../lib/utils';
import { HelpPersonalContext, type HelpPersonal } from './personal';

function storedSalaryDay(): number {
  try {
    const day = (JSON.parse(localStorage.getItem('fainens-settings') ?? '{}') as { salaryDay?: unknown }).salaryDay;
    return typeof day === 'number' && day >= 1 && day <= 31 ? day : 25;
  } catch {
    return 25;
  }
}

/** Reads the same queries the app uses and hands the docs a small, name-only picture of the user. */
export function HelpPersonalProvider({ children }: { children: ReactNode }) {
  const accountsQuery = useAccountsLedgerQuery();
  const periodsQuery = useBudgetPeriodsQuery();
  const memoriesQuery = useAgentMemoriesQuery();
  const profileQuery = useAgentProfileQuery();

  const value = useMemo<HelpPersonal>(() => {
    const accounts = (accountsQuery.data ?? []).filter((account) => account.isActive && !account.systemKey);
    // Most-used first is approximated by largest balance: the accounts people hold money in.
    const cashAccounts = accounts
      .filter((account) => account.type === 'asset' && account.liquidityClass === 'cash_equivalent')
      .sort((a, b) => b.balance - a.balance)
      .map((account) => account.name);
    const payLaterAccounts = accounts
      .filter((account) => account.type === 'liability' && typeof (account as Record<string, unknown>).provider === 'string')
      .map((account) => account.name);
    const periods = (periodsQuery.data ?? []).filter((period) => period.isActive);
    const current = findCurrentPeriod(periods);
    return {
      ready: Boolean(accountsQuery.data && periodsQuery.data),
      name: profileQuery.data?.nickname ?? null,
      cashAccounts,
      payLaterAccounts,
      accountCount: accounts.length,
      salaryDay: current ? new Date(current.startDate).getDate() : storedSalaryDay(),
      currentPeriod: current ? { name: current.name, startDate: current.startDate, endDate: current.endDate } : null,
      periodCount: periods.length,
      memoryCount: memoriesQuery.data?.memories.length ?? 0,
    };
  }, [accountsQuery.data, periodsQuery.data, memoriesQuery.data, profileQuery.data]);

  return <HelpPersonalContext.Provider value={value}>{children}</HelpPersonalContext.Provider>;
}
