import { Link, useLocation } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import {
  Banknote,
  BarChart3,
  CircleHelp,
  CreditCard,
  HandCoins,
  Images,
  Landmark,
  PiggyBank,
  Settings,
  ShieldAlert,
  Target,
  Users,
  X,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { ProfileMenu } from './Sidebar';
import { navigationActive } from './navigation';
import { useUiStore } from '../../stores/ui-store';

const groups = [
  {
    label: 'Your money',
    items: [
      { to: '/accounts', label: 'Accounts', description: 'Balances and net worth', icon: Landmark },
      { to: '/budget', label: 'Budget', description: 'Plan this period', icon: PiggyBank },
      { to: '/salary-income', label: 'Income', description: 'Salary and pay periods', icon: Banknote },
      { to: '/reports', label: 'Reports', description: 'Trends and exports', icon: BarChart3 },
    ],
  },
  {
    label: 'Plan ahead',
    items: [
      { to: '/savings-simulator', label: 'Savings', description: 'Test a savings plan', icon: Target },
      { to: '/loans', label: 'Loans', description: 'Track money owed', icon: Users },
      { to: '/paylater', label: 'Pay later', description: 'Upcoming settlements', icon: CreditCard },
      { to: '/reimbursements', label: 'Reimbursements', description: 'Recover shared costs', icon: HandCoins },
    ],
  },
] as const;

const supportItems = [
  { to: '/gallery', label: 'Image storage', icon: Images },
  { to: '/anomalies', label: 'Data quality', icon: ShieldAlert },
  { to: '/settings', label: 'Settings', icon: Settings },
  { to: '/help', label: 'Help', icon: CircleHelp },
] as const;

export function MobileMenu({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const { pathname } = useLocation();
  const openSettings = useUiStore((state) => state.openSettings);

  useEffect(() => {
    if (!isOpen) {
      dialog.current?.close();
      return;
    }
    dialog.current?.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [isOpen]);

  return (
    <dialog ref={dialog} className="finance-mobile-menu" aria-label="More navigation" onCancel={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div
        className="finance-mobile-inner"
        onPointerDown={(event) => { if (event.pointerType !== 'mouse') swipeStart.current = { x: event.clientX, y: event.clientY }; }}
        onPointerUp={(event) => {
          const start = swipeStart.current;
          swipeStart.current = null;
          if (start && event.clientY - start.y > 72 && Math.abs(event.clientX - start.x) < 56) onClose();
        }}
        onPointerCancel={() => { swipeStart.current = null; }}
      >
        <div className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-[var(--ref-outline-variant)]" aria-hidden="true" />
        <header className="flex items-start justify-between gap-4 px-5 pb-4 pt-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--ref-primary)]">Explore Fainens</p>
            <h2 className="mt-1 font-headline text-2xl font-extrabold text-[var(--ref-on-surface)]">More</h2>
          </div>
          <button type="button" className="grid h-11 w-11 place-items-center rounded-full bg-[var(--ref-surface-container-low)] text-[var(--ref-on-surface-variant)]" aria-label="Close menu" onClick={onClose}><X className="h-5 w-5" /></button>
        </header>

        <nav aria-label="More destinations" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-5">
          {groups.map((group) => (
            <section key={group.label} className="mb-6">
              <h3 className="mb-2 px-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--ref-outline)]">{group.label}</h3>
              <div className="grid grid-cols-2 gap-2">
                {group.items.map(({ to, label, description, icon: Icon }) => {
                  const active = navigationActive(pathname, to);
                  return <Link key={to} to={to} onClick={onClose} aria-current={active ? 'page' : undefined} className={cn('min-h-24 rounded-2xl border p-3 transition-transform active:scale-[0.98]', active ? 'border-[var(--ref-primary)] bg-[var(--ref-primary)]/10 text-[var(--ref-primary)]' : 'border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] text-[var(--ref-on-surface)]')}><Icon className="h-5 w-5" /><strong className="mt-2 block text-sm">{label}</strong><span className="mt-0.5 block text-[11px] leading-4 text-[var(--ref-on-surface-variant)]">{description}</span></Link>;
                })}
              </div>
            </section>
          ))}
          <section>
            <h3 className="mb-2 px-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--ref-outline)]">App & support</h3>
            <div className="grid grid-cols-2 gap-2">
              {supportItems.map(({ to, label, icon: Icon }) => {
                const active = navigationActive(pathname, to);
                return <Link key={to} to={to} onClick={(event) => { if (to === '/settings') { event.preventDefault(); openSettings(); } onClose(); }} aria-current={active ? 'page' : undefined} className={cn('flex min-h-12 items-center gap-2 rounded-xl px-3 text-sm font-semibold', active ? 'bg-[var(--ref-primary)]/10 text-[var(--ref-primary)]' : 'bg-[var(--ref-surface-container-low)] text-[var(--ref-on-surface-variant)]')}><Icon className="h-4 w-4 shrink-0" />{label}</Link>;
              })}
            </div>
          </section>
        </nav>
        <div className="finance-footer shrink-0"><ProfileMenu onNavigate={onClose} /></div>
      </div>
    </dialog>
  );
}
