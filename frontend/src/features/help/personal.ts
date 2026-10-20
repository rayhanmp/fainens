import { createContext, useContext } from 'react';

/**
 * What the help docs know about the person reading them, so examples use their own accounts and
 * dates instead of made-up ones. Only names and dates: no balances, so nothing private shows even
 * when balances are hidden.
 */
export type HelpPersonal = {
  /** True once the user's data has loaded; examples fall back to sample names until then. */
  ready: boolean;
  name: string | null;
  /** Active cash accounts (bank, e-wallet, cash), most-used first. */
  cashAccounts: string[];
  payLaterAccounts: string[];
  accountCount: number;
  salaryDay: number;
  currentPeriod: { name: string; startDate: number; endDate: number } | null;
  periodCount: number;
  memoryCount: number;
};

export const SAMPLE_PERSONAL: HelpPersonal = {
  ready: false,
  name: null,
  cashAccounts: [],
  payLaterAccounts: [],
  accountCount: 0,
  salaryDay: 25,
  currentPeriod: null,
  periodCount: 0,
  memoryCount: 0,
};

export const HelpPersonalContext = createContext<HelpPersonal>(SAMPLE_PERSONAL);

export function useHelpPersonal(): HelpPersonal {
  return useContext(HelpPersonalContext);
}

/** The user's account names for examples, padded with sample names when they have fewer. */
export function exampleAccounts(personal: HelpPersonal) {
  const [first = 'BNI', second = 'GoPay'] = personal.cashAccounts.length >= 2 ? personal.cashAccounts : [personal.cashAccounts[0] ?? 'BNI', personal.cashAccounts[0] === 'GoPay' ? 'OVO' : 'GoPay'];
  return { first, second, payLater: personal.payLaterAccounts[0] ?? 'Kredivo' };
}
