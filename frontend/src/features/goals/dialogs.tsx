import { useMemo, useState } from 'react';
import { Search, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { cn, formatDate } from '../../lib/utils';
import { Dropdown, Toggle } from '../settings/controls';
import { Field, MoneyField, PercentField, Segmented } from '../savings/fields';
import { monthInputValue, parseMonthInput } from '../savings/input-format';
import { useTransactionList } from '../transactions/queries';
import type { Goal } from './queries';
import { GOAL_TYPE_KEYS, GOAL_TYPES, isGoalTypeKey, type GoalTypeKey } from './goal-types';
import { GOAL_ICONS, GOAL_TEMPLATES, type GoalTemplate } from './templates';

export function Footer({ formId, submitLabel, onClose, busy, extra }: { formId: string; submitLabel: string; onClose: () => void; busy?: boolean; extra?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex gap-2">{extra}</div>
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
        <Button type="submit" form={formId} size="sm" isLoading={busy}>{submitLabel}</Button>
      </div>
    </div>
  );
}

/** One part of an editing dialog, like an event in a calendar app: an icon in the gutter, a small label, then its fields. */
export function IconRow({ icon: Icon, label, children }: { icon: React.ElementType; label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[20px_minmax(0,1fr)] gap-x-3">
      <Icon className="mt-0.5 h-4 w-4 text-[var(--ref-on-surface-variant)]" aria-hidden />
      <div className="min-w-0 space-y-2">
        <p className="text-xs font-semibold text-[var(--ref-on-surface-variant)]">{label}</p>
        {children}
      </div>
    </div>
  );
}

/** A field inside an `IconRow` when it holds more than one, with its own small label. */
export function SubField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0 space-y-1">
      <span className="block text-[11px] font-medium text-[var(--ref-on-surface-variant)]">{label}</span>
      {children}
    </label>
  );
}

/** The big name at the top of an editing dialog, underlined instead of boxed; `mark` sits in the gutter. */
export function TitleInput({ value, onChange, placeholder, ariaLabel, autoFocus, maxLength = 120, mark }: { value: string; onChange: (value: string) => void; placeholder: string; ariaLabel: string; autoFocus?: boolean; maxLength?: number; mark?: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[20px_minmax(0,1fr)] items-center gap-x-3">
      <span className="grid place-items-center">{mark}</span>
      <input
        aria-label={ariaLabel}
        autoFocus={autoFocus}
        className="min-w-0 border-0 border-b-2 border-[var(--color-border)] bg-transparent pb-1.5 font-headline text-xl font-bold text-[var(--ref-on-surface)] outline-none transition-colors placeholder:font-semibold placeholder:text-[var(--ref-outline)] focus:border-[var(--ref-primary)]"
        placeholder={placeholder}
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

/** Removing, kept quiet (red text, no fill) so Save stays the one strong button. */
export function RemoveButton({ onClick, disabled, label = 'Remove' }: { onClick: () => void; disabled?: boolean; label?: string }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="inline-flex h-[34px] items-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold text-[var(--color-danger)] transition-colors hover:bg-[var(--color-danger)]/10 disabled:opacity-50">
      <Trash2 className="h-4 w-4" aria-hidden />{label}
    </button>
  );
}

export function ErrorLine({ error }: { error: string | null }) {
  return error ? <p role="alert" className="rounded-lg bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]">{error}</p> : null;
}

export type GoalDraft = {
  name: string;
  icon: string | null;
  /** What kind of goal it is, which shapes its page; null when started blank. */
  goalType: GoalTypeKey | null;
  /** That type's own figures, when the form sets them (a house's price and down payment share). */
  typeData?: Record<string, unknown>;
  targetAmount: number;
  byDate: number | null;
  kind: 'spend' | 'keep';
  recurrence: 'none' | 'yearly';
  monthlyAmount: number;
  /** When set, the monthly amount is this share (%) of your take-home pay. */
  monthlyPercent: number | null;
  setAside: number;
  wishlistId?: number | null;
};

/** The emoji on a goal: a button showing it, opening a grid to pick another or type one. */
function IconPicker({ value, onChange }: { value: string | null; onChange: (icon: string | null) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative shrink-0">
      <button type="button" aria-label="Choose an icon" aria-expanded={open} onClick={() => setOpen((shown) => !shown)} className="grid h-[34px] w-[34px] place-items-center rounded-lg border border-[var(--color-border)] text-lg hover:bg-[var(--ref-surface-container-low)]">
        {value ?? <span className="text-base opacity-60">🎯</span>}
      </button>
      {open && (
        <div className="ui-popover absolute left-0 top-full z-30 mt-1 w-[248px] rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-2 shadow-lg">
          <div className="grid grid-cols-8 gap-1">
            {GOAL_ICONS.map((icon) => (
              <button key={icon} type="button" aria-label={icon} onClick={() => { onChange(icon); setOpen(false); }} className={cn('grid h-7 w-7 place-items-center rounded-md text-base hover:bg-[var(--ref-surface-container-low)]', value === icon && 'bg-[var(--ref-primary)]/15')}>{icon}</button>
            ))}
          </div>
          <div className="mt-2 flex gap-1">
            <input aria-label="Or type an emoji" placeholder="Or type one" maxLength={8} className="brutalist-input h-[30px] min-w-0 flex-1 text-sm" onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); const typed = event.currentTarget.value.trim(); if (typed) { onChange(typed); setOpen(false); } } }} />
            {value && <button type="button" onClick={() => { onChange(null); setOpen(false); }} className="rounded-md px-2 text-xs text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-low)]">None</button>}
          </div>
        </div>
      )}
    </div>
  );
}

/** A new goal starts from a template, or blank. */
function TemplatePicker({ emergencyAmount, onPick }: { emergencyAmount: number; onPick: (template: GoalTemplate | null) => void }) {
  const { formatAmount } = useBalanceVisibility();
  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--ref-on-surface-variant)]">What are you saving for? Pick one to start from, or start blank.</p>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {GOAL_TEMPLATES.map((template) => (
          <li key={template.key}>
            <button type="button" onClick={() => onPick(template)} className="flex h-full w-full items-start gap-3 rounded-xl border border-[var(--color-border)] px-3 py-2.5 text-left hover:border-[var(--ref-primary)]/50 hover:bg-[var(--ref-surface-container-low)]">
              <span className="text-xl leading-none" aria-hidden>{template.icon}</span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-[var(--ref-on-surface)]">
                  {template.name}
                  {template.draft.recurrence === 'yearly' && <span className="rounded bg-[var(--ref-surface-container-high)] px-1.5 py-px text-[10px] font-semibold text-[var(--ref-on-surface-variant)]">Yearly</span>}
                </span>
                <span className="block text-xs text-[var(--ref-on-surface-variant)]">{template.key === 'emergency' && emergencyAmount > 0 ? `Six months of your spending: ${formatAmount(emergencyAmount)}` : template.hint}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <Button type="button" size="sm" variant="secondary" onClick={() => onPick(null)}>Start blank</Button>
    </div>
  );
}

/**
 * Add or edit a goal. A new one starts from a template (or blank) and can start with money you've
 * already saved for it, from what's free. Its monthly amount is fixed or a share of your take-home.
 */
export function GoalDialog({ goal, initial, unassigned, salary, emergencyAmount = 0, busy, onClose, onSave, onArchive, onDelete }: {
  goal: Goal | null;
  initial?: Partial<GoalDraft>;
  unassigned: number;
  /** Your take-home pay, for a monthly amount that's a share of it; null when salary isn't set up. */
  salary: number | null;
  /** Six months of spending, for the emergency fund template. */
  emergencyAmount?: number;
  busy: boolean;
  onClose: () => void;
  onSave: (draft: GoalDraft) => void;
  onArchive?: () => void;
  onDelete?: () => void;
}) {
  const { formatAmount } = useBalanceVisibility();
  const start: Partial<GoalDraft> = { ...initial, ...(goal ? { ...goal, setAside: 0 } : {}) };
  // A new goal without a starting point picks a template first.
  const [choosing, setChoosing] = useState(!goal && !initial);
  const [name, setName] = useState(start.name ?? '');
  const [icon, setIcon] = useState<string | null>(start.icon ?? null);
  const [targetAmount, setTarget] = useState(start.targetAmount ?? 0);
  const [dated, setDated] = useState(start.byDate != null);
  const [month, setMonth] = useState(monthInputValue(start.byDate ? new Date(start.byDate) : new Date(new Date().getFullYear() + 1, new Date().getMonth(), 1)));
  const [kind, setKind] = useState<'spend' | 'keep'>(start.kind ?? 'spend');
  const [yearly, setYearly] = useState(start.recurrence === 'yearly');
  const [goalType, setGoalType] = useState<GoalTypeKey | null>(isGoalTypeKey(start.goalType) ? start.goalType : null);
  const [monthlyMode, setMonthlyMode] = useState<'amount' | 'percent'>(start.monthlyPercent ? 'percent' : 'amount');
  const [monthlyAmount, setMonthly] = useState(start.monthlyPercent ? 0 : start.monthlyAmount ?? 0);
  const [monthlyPercent, setPercent] = useState(start.monthlyPercent ?? 10);
  const [shareOfPrice, setShareOfPrice] = useState<{ price: number; share: number } | null>(null);
  const [setAside, setSetAside] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const free = Math.max(0, unassigned);
  const fromSalary = salary ? Math.round((salary * monthlyPercent) / 100 / 1000) * 1000 : 0;

  const pick = (template: GoalTemplate | null) => {
    setChoosing(false);
    if (!template) return;
    setName(template.name);
    setIcon(template.icon);
    setKind(template.draft.kind ?? 'spend');
    setYearly(template.draft.recurrence === 'yearly');
    setGoalType(isGoalTypeKey(template.key) ? template.key : null);
    if (template.draft.recurrence === 'yearly') setDated(true);
    if (template.key === 'emergency' && emergencyAmount > 0) setTarget(emergencyAmount);
    if (template.shareOfPrice) setShareOfPrice({ price: 0, share: template.shareOfPrice });
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return setError('Give the goal a name.');
    if (!targetAmount) return setError('Enter what it costs or how much to keep.');
    const date = dated ? parseMonthInput(month) : null;
    if (dated && !date) return setError('Pick a month.');
    if (setAside > free) return setError(`Only ${formatAmount(free)} is free.`);
    if (monthlyMode === 'percent' && !salary) return setError('Set up your salary in Income & salary to use a share of it.');
    // A "by" month means by the end of it.
    const byDate = date ? new Date(date.getFullYear(), date.getMonth() + 1, 0, 12).getTime() : null;
    onSave({
      name: name.trim(),
      icon,
      goalType,
      // A house worked out from its price keeps the price and share, for its page.
      ...(goalType === 'house' && shareOfPrice?.price ? { typeData: { ...(goal?.typeData ?? {}), price: shareOfPrice.price, dpShare: shareOfPrice.share } } : {}),
      targetAmount,
      byDate,
      kind,
      recurrence: yearly && byDate ? 'yearly' : 'none',
      monthlyAmount: monthlyMode === 'amount' ? monthlyAmount : 0,
      monthlyPercent: monthlyMode === 'percent' ? monthlyPercent : null,
      setAside,
      wishlistId: start.wishlistId ?? null,
    });
  };

  if (choosing) {
    return (
      <Modal isOpen onClose={() => { if (!busy) onClose(); }} title="Add a goal" size="xl">
        <TemplatePicker emergencyAmount={emergencyAmount} onPick={pick} />
      </Modal>
    );
  }

  return (
    <Modal
      isOpen
      onClose={() => { if (!busy) onClose(); }}
      title={goal ? `Edit ${goal.name}` : 'Add a goal'}
      footer={<Footer formId="goal-form" submitLabel={goal ? 'Save' : 'Add goal'} onClose={onClose} busy={busy} extra={goal && (
        <>
          {onArchive && <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={onArchive}>Archive</Button>}
          {onDelete && <Button type="button" size="sm" variant="secondary" className="text-[var(--color-danger)]" disabled={busy} onClick={onDelete}>Delete</Button>}
        </>
      )} />}
    >
      <form id="goal-form" onSubmit={submit} className="settings-compact space-y-4">
        <ErrorLine error={error} />
        <Field label="Name" htmlFor="goal-name">
          <div className="flex gap-2">
            <IconPicker value={icon} onChange={setIcon} />
            <input id="goal-name" className="brutalist-input min-w-0 flex-1" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} placeholder="Emergency fund, laptop, trip to Japan…" data-autofocus />
          </div>
        </Field>
        <Segmented
          ariaLabel="What it’s for"
          value={kind}
          onChange={setKind}
          options={[{ value: 'spend', label: 'Something to buy' }, { value: 'keep', label: 'Money to keep' }]}
        />
        {/* A new goal's type comes from its template; here it can be changed later, or set on a blank one. */}
        {goal && (
          <Dropdown
            label="Kind of goal"
            value={goalType ?? 'none'}
            options={[{ value: 'none', label: 'None: a plain goal' }, ...GOAL_TYPE_KEYS.map((key) => ({ value: key, label: `${GOAL_TYPES[key].icon} ${GOAL_TYPES[key].label}` }))]}
            onChange={(value) => setGoalType(isGoalTypeKey(value) ? value : null)}
          />
        )}
        {shareOfPrice && (
          <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3">
            <Field label="Price" htmlFor="goal-price">
              <MoneyField id="goal-price" value={shareOfPrice.price} onChange={(price) => { setShareOfPrice({ ...shareOfPrice, price }); setTarget(Math.round((price * shareOfPrice.share) / 100)); }} />
            </Field>
            <Field label="Share" htmlFor="goal-share">
              <PercentField id="goal-share" value={shareOfPrice.share} min={1} max={100} onChange={(share) => { setShareOfPrice({ ...shareOfPrice, share }); setTarget(Math.round((shareOfPrice.price * share) / 100)); }} />
            </Field>
          </div>
        )}
        <Field label={kind === 'spend' ? 'It costs' : 'Keep this much'} htmlFor="goal-target" hint={shareOfPrice?.price ? `${shareOfPrice.share}% of ${formatAmount(shareOfPrice.price)}` : undefined}>
          <MoneyField id="goal-target" value={targetAmount} onChange={(value) => { setTarget(value); setShareOfPrice(null); }} />
        </Field>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-[var(--color-text-secondary)]">Needed by a date</span>
          <Toggle label="Needed by a date" checked={dated} onChange={(on) => { setDated(on); if (!on) setYearly(false); }} />
        </div>
        {dated && (
          <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2">
            <Field label="By" htmlFor="goal-month">
              <input id="goal-month" type="month" className="brutalist-input" value={month} min={monthInputValue(new Date())} onChange={(event) => setMonth(event.target.value)} />
            </Field>
            <label className="flex h-[34px] items-center justify-between gap-3 text-sm font-medium text-[var(--color-text-secondary)]">
              Every year
              <Toggle label="Every year" checked={yearly} onChange={setYearly} />
            </label>
          </div>
        )}
        {yearly && <p className="-mt-2 text-xs text-[var(--ref-on-surface-variant)]">Once it’s paid, the goal starts again for the same month next year.</p>}
        {!goal && (
          <Field label="Already saved for it" htmlFor="goal-set-aside" hint={`Part of the ${formatAmount(free)} you have free that’s already meant for this. It stays in your accounts.`}>
            <div className="flex gap-2">
              <MoneyField id="goal-set-aside" value={setAside} onChange={setSetAside} />
              {free > 0 && targetAmount > 0 && <Button type="button" size="sm" variant="secondary" className="h-[34px] shrink-0" onClick={() => setSetAside(Math.min(free, targetAmount))}>{targetAmount <= free ? 'All of it' : 'All that’s free'}</Button>}
            </div>
          </Field>
        )}
        <Field
          label="Put in each month"
          htmlFor="goal-monthly"
          info="How much you’ll put into this goal every month: a fixed amount, or a share of your take-home pay that follows your salary. One button, on Goals or in Budget, puts in every goal’s monthly amount at once; it can also happen on payday."
          hint={monthlyMode === 'percent' ? (salary ? `${formatAmount(fromSalary)} of your ${formatAmount(salary)} take-home` : 'Set up your salary in Income & salary to use this.') : undefined}
        >
          <div className="flex gap-2">
            <Segmented ariaLabel="Monthly amount as" className="w-[180px] shrink-0" value={monthlyMode} onChange={setMonthlyMode} options={[{ value: 'amount', label: 'Amount' }, { value: 'percent', label: '% of salary' }]} />
            {monthlyMode === 'amount'
              ? <MoneyField id="goal-monthly" value={monthlyAmount} onChange={setMonthly} />
              : <PercentField id="goal-monthly" value={monthlyPercent} min={0.5} max={100} onChange={setPercent} />}
          </div>
        </Field>
      </form>
    </Modal>
  );
}

/**
 * Put money into a goal from what's free, or take some out again. Taking money out of an emergency
 * fund asks what it was for, which its activity keeps.
 */
export function MoveMoneyDialog({ goal, unassigned, busy, onClose, onSave, initialDirection = 'in', initialNote = '' }: { goal: Goal; unassigned: number; busy: boolean; onClose: () => void; onSave: (amount: number, note: string | null) => void; initialDirection?: 'in' | 'out'; initialNote?: string }) {
  const { formatAmount } = useBalanceVisibility();
  const [direction, setDirection] = useState<'in' | 'out'>(initialDirection);
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState(initialNote);
  const [error, setError] = useState<string | null>(null);
  const free = Math.max(0, unassigned);
  const toGo = Math.max(0, goal.targetAmount - goal.setAside);
  const limit = direction === 'in' ? free : goal.setAside;
  const needsReason = direction === 'out' && goal.goalType === 'emergency';

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!amount) return setError('Enter an amount.');
    if (amount > limit) return setError(direction === 'in' ? `Only ${formatAmount(free)} is free.` : `${goal.name} has ${formatAmount(goal.setAside)}.`);
    if (needsReason && !note.trim()) return setError('Say what it was for; the fund’s activity keeps it, and you’re reminded to fill it back up.');
    onSave(direction === 'in' ? amount : -amount, note.trim() || null);
  };

  return (
    <Modal isOpen onClose={() => { if (!busy) onClose(); }} title={goal.name} footer={<Footer formId="goal-move" submitLabel={direction === 'in' ? 'Put in' : 'Take out'} onClose={onClose} busy={busy} />}>
      <form id="goal-move" onSubmit={submit} className="settings-compact space-y-4">
        <ErrorLine error={error} />
        <p className="text-sm text-[var(--ref-on-surface-variant)]">
          Has <span className="font-semibold tabular-nums text-[var(--ref-on-surface)]">{formatAmount(goal.setAside)}</span> of {formatAmount(goal.targetAmount)}. You have <span className="font-semibold tabular-nums text-[var(--ref-on-surface)]">{formatAmount(free)}</span> free.
        </p>
        <Segmented ariaLabel="Direction" value={direction} onChange={(value) => { setDirection(value); setAmount(0); }} options={[{ value: 'in', label: 'Put money in' }, { value: 'out', label: 'Take out' }]} />
        <Field label="Amount" htmlFor="goal-move-amount" hint={direction === 'out' ? 'It goes back to your free money.' : 'From your free money. Nothing moves between accounts.'}>
          <MoneyField id="goal-move-amount" value={amount} onChange={setAmount} autoFocus />
        </Field>
        <div className="flex flex-wrap gap-2">
          {direction === 'in' && toGo > 0 && free > 0 && <Button type="button" size="sm" variant="secondary" onClick={() => setAmount(Math.min(toGo, free))}>{toGo <= free ? `What it still needs · ${formatAmount(toGo)}` : `All that's free · ${formatAmount(free)}`}</Button>}
          {direction === 'in' && goal.monthlyAmount > 0 && goal.monthlyAmount <= free && <Button type="button" size="sm" variant="secondary" onClick={() => setAmount(Math.min(goal.monthlyAmount, toGo || goal.monthlyAmount))}>This month’s · {formatAmount(goal.monthlyAmount)}</Button>}
          {direction === 'out' && goal.setAside > 0 && <Button type="button" size="sm" variant="secondary" onClick={() => setAmount(goal.setAside)}>All of it · {formatAmount(goal.setAside)}</Button>}
        </div>
        <Field label={needsReason ? 'What was it for?' : 'Note'} htmlFor="goal-move-note">
          <input id="goal-move-note" className="brutalist-input" value={note} maxLength={200} onChange={(event) => setNote(event.target.value)} placeholder={direction === 'in' ? 'THR, bonus, this month…' : needsReason ? 'Car repair, hospital, between jobs…' : 'Needed it for…'} />
        </Field>
      </form>
    </Modal>
  );
}

type ExpenseRow = { id: number; date: number | string; description: string; expenseCents?: number };

/** Search your recorded expenses and pick one, or none. */
function ExpensePicker({ initialSearch, picked, onPick }: { initialSearch: string; picked: number | null; onPick: (row: ExpenseRow | null) => void }) {
  const { formatAmount } = useBalanceVisibility();
  const [search, setSearch] = useState(initialSearch);
  const filters = useMemo(() => ({ kind: 'expense', periodId: 'all', status: 'posted', limit: '25', sort: 'newest', ...(search.trim() ? { search: search.trim() } : {}) }), [search]);
  const transactions = useTransactionList(filters as never);
  const rows = (transactions.data as { data?: ExpenseRow[] } | undefined)?.data ?? [];
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted)]" aria-hidden />
        <input className="brutalist-input !pl-9" value={search} onChange={(event) => { setSearch(event.target.value); onPick(null); }} placeholder="Search your expenses" aria-label="Search your expenses" />
      </div>
      <ul className="max-h-56 divide-y divide-[var(--color-border)] overflow-y-auto rounded-xl border border-[var(--color-border)]" role="listbox" aria-label="Expenses">
        {transactions.isPending && !transactions.data ? <li className="px-3 py-3 text-xs text-[var(--ref-on-surface-variant)]">Loading…</li> : rows.length === 0 ? (
          <li className="px-3 py-3 text-xs text-[var(--ref-on-surface-variant)]">No expenses match.</li>
        ) : rows.map((row) => (
          <li key={row.id}>
            <button type="button" role="option" aria-selected={picked === row.id} onClick={() => onPick(picked === row.id ? null : row)} className={cn('flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors', picked === row.id ? 'bg-[var(--color-accent)]/10' : 'hover:bg-[var(--ref-surface-container-low)]')}>
              <span className="min-w-0">
                <span className="block truncate text-[var(--ref-on-surface)]">{row.description}</span>
                <span className="block text-xs text-[var(--ref-on-surface-variant)]">{formatDate(Number(row.date))}</span>
              </span>
              <span className="shrink-0 tabular-nums text-[var(--ref-on-surface)]">{formatAmount(row.expenseCents ?? 0)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Pay part of a goal from its money, like the flights of a trip: an amount, optionally a part of
 * its breakdown to tick off and the expense you recorded for it. The rest of the goal stays open.
 */
export function PayFromGoalDialog({ goal, parts, initialPartId = null, busy, onClose, onSave }: {
  goal: Goal;
  parts: Array<{ id: number; name: string; amount: number; paidAt: number | null }>;
  initialPartId?: number | null;
  busy: boolean;
  onClose: () => void;
  onSave: (input: { amount: number; partId: number | null; transactionId: number | null }) => void;
}) {
  const { formatAmount } = useBalanceVisibility();
  const unpaid = parts.filter((part) => part.paidAt === null);
  const initialPart = unpaid.find((part) => part.id === initialPartId) ?? null;
  const [partId, setPartId] = useState<string>(initialPart ? String(initialPart.id) : 'none');
  const [amount, setAmount] = useState(initialPart ? Math.min(initialPart.amount, goal.setAside) : 0);
  const [picked, setPicked] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <Modal
      isOpen
      onClose={() => { if (!busy) onClose(); }}
      title={`Pay from ${goal.name}`}
      footer={<Footer formId="goal-pay" submitLabel="Pay from goal" onClose={onClose} busy={busy} />}
    >
      <form
        id="goal-pay"
        onSubmit={(event) => {
          event.preventDefault();
          if (!amount) return setError('Enter an amount.');
          if (amount > goal.setAside) return setError(`${goal.name} has ${formatAmount(goal.setAside)}.`);
          onSave({ amount, partId: partId === 'none' ? null : Number(partId), transactionId: picked });
        }}
        className="settings-compact space-y-4"
      >
        <ErrorLine error={error} />
        <p className="text-sm text-[var(--ref-on-surface-variant)]">
          The amount leaves the goal; it has <span className="font-semibold tabular-nums text-[var(--ref-on-surface)]">{formatAmount(goal.setAside)}</span>. The rest of the goal stays open.
        </p>
        {unpaid.length > 0 && (
          <Dropdown
            label="For"
            value={partId}
            options={[{ value: 'none', label: 'Nothing in particular' }, ...unpaid.map((part) => ({ value: String(part.id), label: `${part.name} · ${formatAmount(part.amount)}` }))]}
            onChange={(value) => {
              setPartId(value);
              const part = unpaid.find((item) => String(item.id) === value);
              if (part) setAmount(Math.min(part.amount, goal.setAside));
            }}
          />
        )}
        <Field label="Amount" htmlFor="goal-pay-amount">
          <MoneyField id="goal-pay-amount" value={amount} onChange={setAmount} autoFocus />
        </Field>
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-[var(--color-text-secondary)]">The expense you recorded <span className="font-normal text-[var(--ref-on-surface-variant)]">(optional)</span></p>
          <ExpensePicker
            initialSearch={unpaid.find((part) => String(part.id) === partId)?.name ?? ''}
            picked={picked}
            onPick={(row) => {
              setPicked(row?.id ?? null);
              if (row?.expenseCents && !amount) setAmount(Math.min(row.expenseCents, goal.setAside));
            }}
          />
        </div>
      </form>
    </Modal>
  );
}

/** Mark something you saved for as bought, optionally with the expense that paid for it. */
export function CompleteGoalDialog({ goal, busy, onClose, onSave }: { goal: Goal; busy: boolean; onClose: () => void; onSave: (transactionId: number | null) => void }) {
  const { formatAmount } = useBalanceVisibility();
  const [picked, setPicked] = useState<number | null>(null);

  return (
    <Modal
      isOpen
      onClose={() => { if (!busy) onClose(); }}
      title={`Bought ${goal.name}?`}
      footer={<Footer formId="goal-complete" submitLabel={picked ? 'Mark bought' : 'Skip and mark bought'} onClose={onClose} busy={busy} />}
    >
      <form id="goal-complete" onSubmit={(event) => { event.preventDefault(); onSave(picked); }} className="settings-compact space-y-3">
        <p className="text-sm text-[var(--ref-on-surface-variant)]">
          Its <span className="font-semibold tabular-nums text-[var(--ref-on-surface)]">{formatAmount(goal.setAside)}</span> was spent on it, so the goal is finished and its money leaves it.
        </p>
        <p className="text-sm text-[var(--ref-on-surface-variant)]">
          Optional: pick the expense you recorded for the purchase, so the goal’s history shows what you bought{goal.wishlistId ? ' and its wishlist item is marked bought too' : ''}.
        </p>
        <ExpensePicker initialSearch={goal.name.split(' ')[0] ?? ''} picked={picked} onPick={(row) => setPicked(row?.id ?? null)} />
      </form>
    </Modal>
  );
}
