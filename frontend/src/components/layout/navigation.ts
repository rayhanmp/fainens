import { LayoutDashboard, Receipt, Wallet, Sparkles, PiggyBank, Banknote, Users, CreditCard, BarChart3 } from 'lucide-react';

export const navigationGroups = [
  { label: '', items: [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/transactions', label: 'Transactions', icon: Receipt },
    { to: '/accounts', label: 'Accounts', icon: Wallet },
    { to: '/agent', label: 'Fainens Agent', icon: Sparkles },
  ] },
  { label: 'Planning', items: [
    { to: '/budget', label: 'Budget', icon: PiggyBank },
    { to: '/salary-income', label: 'Income & salary', icon: Banknote },
  ] },
  { label: 'Debt', items: [
    { to: '/loans', label: 'Loans', icon: Users },
    { to: '/paylater', label: 'Pay later', icon: CreditCard },
  ] },
  { label: '', items: [{ to: '/reports', label: 'Reports', icon: BarChart3 }] },
];

export const areaNavigation = [
  { parent: '/transactions', label: 'Transactions', items: [{ to: '/transactions', label: 'All transactions' }, { to: '/reimbursements', label: 'Reimbursements' }] },
  { parent: '/salary-income', label: 'Income & salary', items: [{ to: '/salary-income', label: 'Income & salary' }, { to: '/periods', label: 'Salary periods' }] },
  { parent: '/budget', label: 'Budget', items: [{ to: '/budget', label: 'Budget' }, { to: '/savings-simulator', label: 'Savings simulator' }] },
  { parent: '/settings', label: 'Settings', items: [{ to: '/settings', label: 'Preferences' }, { to: '/help', label: 'Help & glossary' }, { to: '/anomalies', label: 'Data quality' }, { to: '/gallery', label: 'Image storage' }, { to: '/audit-log', label: 'Security audit' }] },
];

export function pathMatches(pathname: string, to: string): boolean {
  return pathname === to || (to !== '/' && pathname.startsWith(`${to}/`));
}

export function navigationActive(pathname: string, to: string): boolean {
  return pathMatches(pathname, to) || Boolean(areaNavigation.find(area => area.parent === to)?.items.some(item => pathMatches(pathname, item.to)));
}
