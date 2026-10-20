import { useState } from 'react';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { cn, formatDecimal } from '../../lib/utils';
import { Section } from '../subscriptions/PageParts';
import { Field, MoneyField, PercentField, Segmented, Slider } from './fields';
import { InfoHint } from './InfoHint';
import { compactRupiah, MAX_POTS, monthDate, savingInMonth, type PlanEvent, type PlanInputs, type PlanPot, type Uncertainty } from './plan';
import { potColor, POT_TEMPLATES, type PotTemplate } from './pots';

const UNCERTAINTY: Array<{ value: Uncertainty; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

const UNCERTAINTY_HINT: Record<Uncertainty, string> = {
  off: 'One line, as if returns never swing.',
  low: 'Swings like bonds or a deposit mix.',
  medium: 'Swings like a balanced fund.',
  high: 'Swings like shares or crypto.',
};

const groupTitle = 'text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--ref-outline)]';

/**
 * The plan's inputs: the whole plan's length and inflation, then its pots (one open at a time, with
 * its own amounts, return and uncertainty), then money in and out of the pots.
 */
export function PlanPanel({ inputs, selectedPotId, onSelectPot, onChange, onChangePot, onAddPot, onRemovePot, aside, onAddEvent, onEditEvent, onRemoveEvent }: {
  inputs: PlanInputs;
  selectedPotId: string;
  onSelectPot: (id: string) => void;
  onChange: (patch: Partial<Pick<PlanInputs, 'years' | 'inflation'>>) => void;
  onChangePot: (id: string, patch: Partial<PlanPot>) => void;
  onAddPot: (template: PotTemplate | null) => void;
  onRemovePot: (pot: PlanPot) => void;
  aside: React.ReactNode;
  onAddEvent: () => void;
  onEditEvent: (event: PlanEvent) => void;
  onRemoveEvent: (event: PlanEvent) => void;
}) {
  const { formatAmount, balancesHidden } = useBalanceVisibility();
  const [adding, setAdding] = useState(false);
  const potIndex = Math.max(0, inputs.pots.findIndex((pot) => pot.id === selectedPotId));
  const pot = inputs.pots[potIndex]!;
  const set = (patch: Partial<PlanPot>) => onChangePot(pot.id, patch);
  const monthlyMax = Math.max(20_000_000, Math.ceil((pot.monthly * 1.5) / 5_000_000) * 5_000_000);
  const lastSaving = savingInMonth(pot, inputs.years * 12);
  const several = inputs.pots.length > 1;

  return (
    <Section title="Your plan" aside={aside}>
      <div className="settings-compact grid grid-cols-1 items-start gap-5 px-4 py-4 sm:grid-cols-2 sm:gap-x-6 sm:px-5 xl:grid-cols-1">
        <Field label="For how long" htmlFor="plan-years" info="How many years the plan runs. The headline figure is the balance at the end.">
          <div className="grid grid-cols-[minmax(0,1fr)_7.5rem] items-center gap-3">
            <Slider ariaLabel="Years" value={inputs.years} min={1} max={50} step={1} onChange={(years) => onChange({ years })} valueText={`${inputs.years} years`} />
            <PercentField id="plan-years" value={inputs.years} min={1} max={50} suffix={inputs.years === 1 ? 'year' : 'years'} onChange={(years) => onChange({ years: Math.round(years) })} />
          </div>
        </Field>
        <Field label="Yearly inflation" htmlFor="plan-inflation" hint="Indonesia has run near 2–3% lately." info="How fast prices rise. It turns future rupiah into today’s money, and makes your goals cost more over time.">
          <PercentField id="plan-inflation" value={inputs.inflation} min={0} max={30} onChange={(inflation) => onChange({ inflation })} />
        </Field>
      </div>

      <div className="border-t border-[var(--color-border)] px-4 pb-4 pt-3 sm:px-5">
        <div className="flex items-center gap-1">
          <p className={groupTitle}>Pots</p>
          <InfoHint label="About pots">Split your savings by where they’re kept, like a savings account, SBN and an equity fund. Each pot has its own amounts, return and uncertainty, and each goal is paid from one pot, so two goals never count the same money.</InfoHint>
        </div>

        {/* One tab per pot; the open pot's fields are below. */}
        <div className="mt-2 flex flex-wrap gap-1.5" role="tablist" aria-label="Pots">
          {inputs.pots.map((item, index) => {
            const selected = item.id === pot.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => onSelectPot(item.id)}
                className={cn(
                  'flex h-[34px] items-center gap-2 rounded-lg border px-2.5 text-xs transition-colors',
                  selected ? 'border-[var(--ref-on-surface)]/40 bg-[var(--ref-surface-container-low)] text-[var(--ref-on-surface)]' : 'border-[var(--color-border)] text-[var(--ref-on-surface-variant)] hover:text-[var(--ref-on-surface)]',
                )}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: potColor(index) }} aria-hidden />
                <span className="max-w-[8rem] truncate font-semibold">{item.name}</span>
                {several && <span className="tabular-nums opacity-70">{balancesHidden ? '•••' : compactRupiah(item.monthly).replace('Rp', '')}/mo</span>}
              </button>
            );
          })}
          {inputs.pots.length < MAX_POTS && !adding && (
            <button type="button" onClick={() => setAdding(true)} className="flex h-[34px] items-center gap-1 rounded-lg border border-dashed border-[var(--color-border)] px-2.5 text-xs font-semibold text-[var(--ref-on-surface-variant)] hover:text-[var(--ref-on-surface)]">
              <Plus className="h-3.5 w-3.5" aria-hidden />Add pot
            </button>
          )}
        </div>

        {adding && (
          <div className="mt-2 rounded-xl bg-[var(--ref-surface-container-low)] p-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-[var(--ref-on-surface)]">Start the new pot as</p>
              <button type="button" aria-label="Cancel adding a pot" onClick={() => setAdding(false)} className="grid h-7 w-7 place-items-center rounded-md text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-high)]"><X className="h-4 w-4" aria-hidden /></button>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-5 xl:grid-cols-2">
              {[...POT_TEMPLATES, null].map((template) => (
                <button
                  key={template?.name ?? 'blank'}
                  type="button"
                  title={template?.title ?? 'An empty pot you set up yourself'}
                  onClick={() => { onAddPot(template); setAdding(false); }}
                  className="flex h-[34px] items-center justify-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-[11px] text-[var(--ref-on-surface)] hover:border-[var(--color-accent)]"
                >
                  <span className="font-semibold">{template?.name ?? 'Blank'}</span>
                  {template && <span className="tabular-nums text-[var(--ref-on-surface-variant)]">{formatDecimal(template.returnRate, 2)}%</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="settings-compact mt-4 grid grid-cols-1 items-start gap-5 sm:grid-cols-2 sm:gap-x-6 xl:grid-cols-1" role="tabpanel" aria-label={pot.name}>
          <Field label="Pot name" htmlFor="pot-name">
            <div className="flex gap-2">
              <input id="pot-name" className="brutalist-input" value={pot.name} maxLength={80} onChange={(event) => set({ name: event.target.value })} onBlur={() => { if (!pot.name.trim()) set({ name: 'Savings' }); }} />
              {several && (
                <Button type="button" size="sm" variant="secondary" className="h-[34px] shrink-0" aria-label={`Remove ${pot.name}`} title="Remove this pot" onClick={() => onRemovePot(pot)}>
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              )}
            </div>
          </Field>

          <Field label="In it today" htmlFor="pot-start" info="What this pot holds now. Use as start, in the plan’s header, fills it from your cash and investment accounts.">
            <MoneyField id="pot-start" value={pot.start} onChange={(start) => set({ start })} />
          </Field>

          <Field label="Monthly saving" htmlFor="pot-monthly" info="What you put into this pot every month. You can type shortcuts like 5jt or 500rb.">
            <MoneyField id="pot-monthly" value={pot.monthly} onChange={(monthly) => set({ monthly })} />
            <div className="mt-2">
              <Slider ariaLabel="Monthly saving" value={pot.monthly} min={0} max={monthlyMax} step={100_000} onChange={(monthly) => set({ monthly })} valueText={formatAmount(pot.monthly)} />
            </div>
          </Field>

          <Field
            label="Raise it each year by"
            htmlFor="pot-raise"
            info="Grow this pot’s monthly saving once a year, for example by 5% if your salary rises about that much. 0% keeps it the same."
            hint={pot.raise > 0 && pot.monthly > 0 ? `Reaching ${formatAmount(Math.round(lastSaving))} a month in the last year.` : 'Saving more as your income grows.'}
          >
            <PercentField id="pot-raise" value={pot.raise} min={0} max={50} onChange={(raise) => set({ raise })} />
          </Field>

          <Field label="Yearly return" htmlFor="pot-return" info="What this pot earns in a year, after tax and fees. The buttons are rough guides for common places to keep savings. None of them is guaranteed.">
            <div className="grid grid-cols-[minmax(0,1fr)_7.5rem] items-center gap-3">
              <Slider ariaLabel="Yearly return" value={pot.returnRate} min={0} max={15} step={0.25} onChange={(returnRate) => set({ returnRate })} valueText={`${formatDecimal(pot.returnRate, 2)}%`} />
              <PercentField id="pot-return" value={pot.returnRate} min={-20} max={50} onChange={(returnRate) => set({ returnRate })} />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4" role="group" aria-label="Typical returns">
              {POT_TEMPLATES.map((preset) => {
                const active = pot.returnRate === preset.returnRate;
                return (
                  <button
                    key={preset.name}
                    type="button"
                    title={preset.title}
                    aria-pressed={active}
                    onClick={() => set({ returnRate: preset.returnRate, uncertainty: preset.uncertainty })}
                    className={cn(
                      'flex h-[34px] flex-col items-center justify-center rounded-lg border text-[11px] leading-tight transition-colors',
                      active ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--ref-on-surface)]' : 'border-[var(--color-border)] text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-low)]',
                    )}
                  >
                    <span className="font-semibold">{preset.name}</span>
                    <span className="tabular-nums opacity-80">{formatDecimal(preset.returnRate, 2)}%</span>
                  </button>
                );
              })}
            </div>
          </Field>

          <Field label="Uncertainty" hint={UNCERTAINTY_HINT[pot.uncertainty]} info="Real returns go up and down from year to year. With this on, the plan is run 400 times with returns that swing, and the shaded band shows where 8 of 10 outcomes land.">
            <Segmented ariaLabel="Uncertainty" value={pot.uncertainty} options={UNCERTAINTY} onChange={(uncertainty) => set({ uncertainty })} />
          </Field>
        </div>
      </div>

      <div className="border-t border-[var(--color-border)]">
        <div className="flex items-center justify-between gap-3 px-4 pb-1 pt-3 sm:px-5">
          <div>
            <h3 className="flex items-center gap-1 text-sm font-semibold text-[var(--ref-on-surface)]">
              Money in and out
              <InfoHint label="About money in and out">One-off or yearly amounts on top of the monthly saving: money in like THR or a bonus, money out like a wedding or a car. Amounts are in the rupiah of the month they happen. They’re marked on the chart and the landscape.</InfoHint>
            </h3>
            <p className="text-xs text-[var(--ref-on-surface-variant)]">A yearly THR or bonus, a gift, or a big purchase.</p>
          </div>
          <Button type="button" size="sm" variant="secondary" className="h-[34px] shrink-0" onClick={onAddEvent}>
            <Plus className="mr-1 inline h-3.5 w-3.5" aria-hidden />Add
          </Button>
        </div>
        {inputs.events.length === 0 ? (
          <p className="px-4 pb-4 pt-2 text-xs text-[var(--ref-outline)] sm:px-5">Nothing yet.</p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)] pb-1">
            {inputs.events.map((event) => {
              const when = monthDate(event.month).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
              const into = inputs.pots.findIndex((item) => item.id === event.potId);
              return (
                <li key={event.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-[var(--ref-on-surface)]">{event.label || (event.amount > 0 ? 'Money in' : 'Money out')}</p>
                    <p className="flex items-center gap-1.5 truncate text-xs text-[var(--ref-on-surface-variant)]">
                      {several && <><span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: potColor(Math.max(0, into)) }} aria-hidden />{inputs.pots[Math.max(0, into)]!.name} ·{' '}</>}
                      {event.yearly ? `Every year from ${when}` : when}
                    </p>
                  </div>
                  <span className={cn('shrink-0 text-sm font-semibold tabular-nums', event.amount > 0 ? 'text-[var(--color-success)]' : 'text-[var(--ref-on-surface)]')}>
                    {event.amount > 0 ? '+' : '−'}{formatAmount(Math.abs(event.amount))}
                  </span>
                  <div className="flex shrink-0">
                    <button type="button" aria-label={`Edit ${event.label || 'entry'}`} onClick={() => onEditEvent(event)} className="grid h-[34px] w-[34px] place-items-center rounded-lg text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-low)]"><Pencil className="h-4 w-4" aria-hidden /></button>
                    <button type="button" aria-label={`Remove ${event.label || 'entry'}`} onClick={() => onRemoveEvent(event)} className="grid h-[34px] w-[34px] place-items-center rounded-lg text-[var(--ref-on-surface-variant)] hover:bg-[var(--color-danger)]/10 hover:text-[var(--color-danger)]"><Trash2 className="h-4 w-4" aria-hidden /></button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Section>
  );
}
