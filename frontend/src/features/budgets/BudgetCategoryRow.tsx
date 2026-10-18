import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { FolderInput, Pencil, StickyNote, Trash2, TrendingDown, TrendingUp } from 'lucide-react';
import { cn, formatIdNominalInput, parseIdNominalToInt } from '../../lib/utils';
import { categoryIcon } from '../categories/category-icon';
import { budgetLineCopy, type BudgetLineStatus, type BudgetLineTone } from './budget-line';

export type BudgetCategoryRowData = {
  id: number;
  categoryId: number;
  categoryName: string;
  plannedAmount: number;
  actualAmount: number;
  note: string | null;
};

type BudgetCategoryRowProps = {
  row: BudgetCategoryRowData;
  categoryColor: string | null;
  status: BudgetLineStatus;
  /** False when the period has no actuals, so the row only shows the plan. */
  tracked: boolean;
  /** Spend difference against a compared period, when one is chosen. */
  comparison?: { actualDiff: number; label: string };
  /** Show the status chip; off when the list is already grouped by status. */
  showLabel?: boolean;
  periodId: string;
  formatAmount: (amount: number) => string;
  /** Null once the period is closed: the row is then read-only. */
  actions: {
    savePlanned: (row: BudgetCategoryRowData, plannedAmount: number) => Promise<void>;
    edit: (row: BudgetCategoryRowData) => void;
    move: (row: BudgetCategoryRowData) => void;
    remove: (row: BudgetCategoryRowData) => void;
  } | null;
};

const toneText: Record<BudgetLineTone, string> = {
  danger: 'text-[var(--ref-error)]',
  warning: 'text-[var(--color-warning)]',
  ok: 'text-[var(--ref-on-surface)]',
  neutral: 'text-[var(--ref-on-surface-variant)]',
};

const toneFill: Record<BudgetLineTone, string> = {
  danger: 'var(--ref-error)',
  warning: 'var(--color-warning)',
  ok: 'color-mix(in srgb, var(--ref-on-surface) 60%, transparent)',
  neutral: 'color-mix(in srgb, var(--ref-on-surface) 30%, transparent)',
};

const chipTone: Record<BudgetLineTone, string> = {
  danger: 'bg-[var(--ref-error)]/10 text-[var(--ref-error)]',
  warning: 'bg-[var(--color-warning)]/12 text-[var(--color-warning)]',
  ok: '',
  neutral: '',
};

const tipSurface = 'pointer-events-none absolute z-40 hidden w-max max-w-72 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-left text-xs font-medium leading-relaxed text-[var(--ref-on-surface)] shadow-xl ring-1 ring-black/5 group-hover/hint:block group-focus-within/hint:block';

/** Hover or focus the child to read `text`; keeps the row free of secondary copy. */
function Hint({ text, align = 'left', className, style, children }: { text: string; align?: 'left' | 'right' | 'center'; className?: string; style?: React.CSSProperties; children: React.ReactNode }) {
  const placement = align === 'right' ? 'right-0' : align === 'center' ? 'left-1/2 -translate-x-1/2 whitespace-nowrap' : 'left-0';
  return (
    <span className={cn('group/hint relative hover:z-30 focus-within:z-30', className)} style={style}>
      {children}
      <span role="tooltip" className={cn(tipSurface, 'top-[calc(100%+0.375rem)]', placement)}>{text}</span>
    </span>
  );
}

const menuItem ='flex min-h-9 w-full cursor-pointer items-center gap-2.5 whitespace-nowrap rounded-lg px-2.5 text-left text-sm font-medium text-[var(--ref-on-surface)] outline-none hover:bg-[var(--ref-surface-container-low)] focus-visible:bg-[var(--ref-surface-container-low)]';

/**
 * One category in the budget list: name and plan on the left, what is left and the share used on
 * the right, and a bar underneath that marks where today's spend should be. The whole row opens
 * the category's transactions; the plan amount edits in place.
 */
export function BudgetCategoryRow({ row, categoryColor, status, tracked, comparison, showLabel = true, periodId, formatAmount, actions }: BudgetCategoryRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const committingRef = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const Icon = categoryIcon(row.categoryName);
  const color = categoryColor || 'var(--ref-primary)';
  const copy = budgetLineCopy(status, formatAmount);
  const percent = tracked ? `${Math.round(Math.min(status.usedRatio, 9.99) * 100)}%` : '—';
  const fillWidth = Math.min(status.usedRatio, 1) * status.planMark * 100;
  const spilled = tracked && status.usedRatio > 1;

  useEffect(() => {
    if (draft != null) inputRef.current?.select();
  }, [draft]);

  // Opening moves focus into the menu; closing with Escape hands it back to the icon.
  useEffect(() => {
    if (!menuOpen) return;
    menuRef.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [menuOpen]);

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])];
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? items.length - 1
        : event.key === 'ArrowDown' ? (current + 1) % items.length
          : (current - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  // Enter and blur can both fire for one edit; the ref makes sure the plan is saved once.
  const commitDraft = async () => {
    if (draft == null || !actions || committingRef.current) return;
    const amount = parseIdNominalToInt(draft);
    if (!Number.isFinite(amount) || amount <= 0 || amount === row.plannedAmount) {
      setDraft(null);
      return;
    }
    committingRef.current = true;
    setSaving(true);
    try {
      await actions.savePlanned(row, amount);
      setDraft(null);
    } catch {
      // The caller has already reported the failure; the amount stays open for another try.
    } finally {
      committingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <li>
      <div className={cn(
        'group/row relative rounded-2xl px-2 py-2.5 transition-colors hover:bg-[var(--ref-surface-container-low)] sm:px-3',
        'has-[a:focus-visible]:outline has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-[var(--ref-primary)]',
      )}>
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3">
          {actions ? (
            <div className={cn('relative', menuOpen ? 'z-30' : 'z-[1]')}>
              <button
                ref={triggerRef}
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                className={cn(
                  'grid h-8 w-8 -m-1 place-items-center rounded-lg transition-colors hover:bg-[var(--ref-surface-container-highest)] focus-visible:bg-[var(--ref-surface-container-highest)]',
                  menuOpen && 'bg-[var(--ref-surface-container-highest)]',
                )}
                style={{ color }}
                aria-label={`Actions for ${row.categoryName}`}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                title="Edit, move or delete"
              >
                <Icon className="h-4 w-4" aria-hidden />
              </button>
              {menuOpen && (
                <>
                  <button type="button" className="fixed inset-0 z-10 cursor-default" aria-label="Close menu" onClick={() => setMenuOpen(false)} />
                  <div
                    ref={menuRef}
                    role="menu"
                    aria-label={`${row.categoryName} budget`}
                    onKeyDown={onMenuKeyDown}
                    className="absolute left-0 top-full z-20 mt-1.5 min-w-52 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-xl ring-1 ring-black/5"
                  >
                    <div className="px-2.5 pb-1.5 pt-1.5">
                      <p className="truncate text-xs font-bold text-[var(--ref-on-surface)]">{row.categoryName}</p>
                      <p className="text-[11px] tabular-nums text-[var(--ref-on-surface-variant)]">Planned {formatAmount(row.plannedAmount)}</p>
                    </div>
                    <button type="button" role="menuitem" className={menuItem} onClick={() => { setMenuOpen(false); actions.edit(row); }}>
                      <Pencil className="h-3.5 w-3.5 text-[var(--ref-on-surface-variant)]" aria-hidden />Edit amount &amp; note
                    </button>
                    <button type="button" role="menuitem" className={menuItem} onClick={() => { setMenuOpen(false); actions.move(row); }}>
                      <FolderInput className="h-3.5 w-3.5 text-[var(--ref-on-surface-variant)]" aria-hidden />Move to another period
                    </button>
                    <div className="my-1 h-px bg-[var(--color-border)]" role="separator" />
                    <button type="button" role="menuitem" className={cn(menuItem, 'text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10 focus-visible:bg-[var(--color-danger)]/10')} onClick={() => { setMenuOpen(false); actions.remove(row); }}>
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />Delete budget line
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <span className="grid h-6 w-6 place-items-center" style={{ color }} aria-hidden>
              <Icon className="h-4 w-4" />
            </span>
          )}

          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <Link
                to="/transactions"
                search={{ periodId, categoryId: String(row.categoryId) }}
                className="truncate text-sm font-bold text-[var(--ref-on-surface)] outline-none after:absolute after:inset-0 after:rounded-2xl after:content-[''] group-hover/row:text-[var(--color-accent)]"
              >
                {row.categoryName}
              </Link>
              {tracked && showLabel && status.label && (
                <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold', chipTone[status.tone])}>{status.label}</span>
              )}
              {row.note && (
                <Hint text={row.note} className="relative z-[1] shrink-0">
                  <span tabIndex={0} aria-label={`Note: ${row.note}`} className="grid h-5 w-5 place-items-center rounded text-[var(--ref-outline)] outline-none hover:text-[var(--ref-on-surface-variant)] focus-visible:ring-2 focus-visible:ring-[var(--ref-primary)]">
                    <StickyNote className="h-3.5 w-3.5" aria-hidden />
                  </span>
                </Hint>
              )}
            </div>
            <div className="mt-0.5 flex min-w-0 items-center gap-x-1.5 text-xs text-[var(--ref-on-surface-variant)]">
              {tracked ? <span className="shrink-0 tabular-nums">{formatAmount(row.actualAmount)} of</span> : <span className="shrink-0">Plan</span>}
              {draft != null ? (
                <input
                  ref={inputRef}
                  value={draft}
                  disabled={saving}
                  inputMode="numeric"
                  aria-label={`Planned amount for ${row.categoryName}`}
                  onChange={(event) => setDraft(formatIdNominalInput(event.target.value))}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') { event.preventDefault(); void commitDraft(); }
                    if (event.key === 'Escape') { event.preventDefault(); setDraft(null); }
                  }}
                  onBlur={() => void commitDraft()}
                  size={Math.max(6, draft.length + 1)}
                  className="relative z-[1] -my-px border-b border-[var(--ref-primary)] bg-transparent p-0 text-xs font-semibold tabular-nums text-[var(--ref-on-surface)] outline-none disabled:opacity-60"
                />
              ) : actions ? (
                <button
                  type="button"
                  onClick={() => setDraft(formatIdNominalInput(String(row.plannedAmount)))}
                  title="Change the planned amount"
                  className="relative z-[1] mr-4 shrink-0 border-b border-transparent font-semibold tabular-nums text-[var(--ref-on-surface)] transition-colors hover:border-[var(--ref-outline)] focus-visible:border-[var(--ref-primary)]"
                >
                  {formatAmount(row.plannedAmount)}
                  <Pencil className="absolute left-full top-1/2 ml-1 h-3 w-3 -translate-y-1/2 text-[var(--ref-outline)] opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100" aria-hidden />
                </button>
              ) : (
                <span className="shrink-0 font-semibold tabular-nums text-[var(--ref-on-surface)]">{formatAmount(row.plannedAmount)}</span>
              )}
              {!tracked && <span className="shrink-0">· Actuals not tracked</span>}
              {tracked && comparison && comparison.actualDiff !== 0 && (
                <span
                  title={`${comparison.actualDiff > 0 ? 'More' : 'Less'} than ${comparison.label}`}
                  className={cn(
                    'inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-px text-[10px] font-bold tabular-nums',
                    comparison.actualDiff > 0 ? 'bg-[var(--ref-error)]/10 text-[var(--ref-error)]' : 'bg-[var(--color-success)]/10 text-[var(--color-success)]',
                  )}
                >
                  {comparison.actualDiff > 0 ? <TrendingUp className="h-3 w-3" aria-hidden /> : <TrendingDown className="h-3 w-3" aria-hidden />}
                  {formatAmount(Math.abs(comparison.actualDiff))}
                </span>
              )}
            </div>
          </div>

          <div className="text-right">
            <p className={cn('text-sm font-bold tabular-nums', tracked ? toneText[status.tone] : 'text-[var(--ref-on-surface-variant)]')}>{percent}</p>
            {tracked && (
              <Hint text={copy.detail} align="right" className="relative z-[1] mt-0.5 block">
                <p tabIndex={0} className={cn('text-xs tabular-nums outline-none focus-visible:underline', status.tone === 'danger' ? 'text-[var(--ref-error)]' : 'text-[var(--ref-on-surface-variant)]')}>
                  {copy.value}
                </p>
              </Hint>
            )}
          </div>
        </div>

        <div className="relative mt-2 ml-9 h-1.5 rounded-full bg-[var(--ref-surface-container-highest)]">
          {tracked && (
            <div
              className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-300"
              style={{ width: `${fillWidth}%`, background: toneFill[status.tone] }}
            />
          )}
          {spilled && (
            <Hint
              text={`Spent ${formatAmount(row.actualAmount - row.plannedAmount)} past the ${formatAmount(row.plannedAmount)} plan`}
              align="right"
              className="absolute inset-y-0 right-0 z-[1]"
              style={{ left: `${status.planMark * 100}%` }}
            >
              <span className="absolute -inset-y-1 inset-x-0" aria-hidden />
              <span
                className="absolute inset-0 block rounded-r-full"
                style={{ background: 'repeating-linear-gradient(135deg, var(--ref-error) 0 3px, transparent 3px 6px)', opacity: 0.5 }}
                aria-hidden
              />
            </Hint>
          )}
        </div>

      </div>
    </li>
  );
}
