import { useNavigate } from '@tanstack/react-router';
import { BedDouble, RotateCcw } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { toast } from '../../../components/ui/useToast';
import { useBalanceVisibility } from '../../../hooks/useBalanceVisibility';
import { cn } from '../../../lib/utils';
import { Section } from '../../subscriptions/PageParts';
import { goalFileUrl, type GoalFile } from '../queries';
import { BOOKING_ICONS } from './booking-icons';
import { usePlanAgainMutation, type Trip } from './queries';
import { dayKey, dayLabel, itinerary, tripBudget } from './trip-utils';

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);
const ROLE: Record<string, string> = { leave: 'Leaves', arrive: 'Lands', 'check-in': 'Check in', 'check-out': 'Check out' };
const NUMBER = 'whitespace-nowrap pl-3 text-right tabular-nums';

/** A figure with what it's measured against, and a bar that turns amber past it. */
function Meter({ label, value, of, amount }: { label: string; value: number; of: number; amount: (value: number) => string }) {
  const over = of > 0 && value > of;
  return (
    <div>
      <p className="flex flex-wrap items-baseline justify-between gap-x-2 text-sm">
        <span className="text-[var(--ref-on-surface-variant)]">{label}</span>
        <span className="tabular-nums"><span className={cn('font-semibold', over ? 'text-[var(--color-warning)]' : 'text-[var(--ref-on-surface)]')}>{amount(value)}</span>{of > 0 && <span className="text-[var(--ref-on-surface-variant)]"> of {amount(of)}</span>}</span>
      </p>
      {of > 0 && (
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--ref-surface-container-high)]" aria-hidden>
          <div className={cn('h-full rounded-full', over ? 'bg-[var(--color-warning)]' : 'bg-[var(--ref-primary)]')} style={{ width: `${Math.min(100, (value / of) * 100)}%` }} />
        </div>
      )}
    </div>
  );
}

/**
 * During the trip: today's bookings and plans in order, what's been spent today against the
 * day's spending money and plans, and the trip so far against what was planned for those days.
 * Spending is every expense you record dated on the trip's days.
 */
export function TodayPanel({ trip, now }: { trip: Trip; now: number }) {
  const { formatAmount } = useBalanceVisibility();
  const { days } = itinerary(trip.basics, trip.bookings, trip.plans);
  const key = dayKey(now);
  const today = days.find((day) => day.key === key);
  if (!today) return null;
  const allowance = trip.basics.dailyBudget * Math.max(1, trip.travellers.length);
  const spentOn = new Map((trip.spending?.byDay ?? []).map((row) => [row.day, row.total]));
  const soFar = days.filter((day) => day.key <= key);
  const plannedSoFar = soFar.reduce((sum, day) => sum + day.planned + allowance, 0);
  const spentSoFar = soFar.reduce((sum, day) => sum + (spentOn.get(day.key) ?? 0), 0);

  return (
    <Section title={`Today · day ${today.index} of ${days.length}`} aside={<span className="text-xs text-[var(--ref-on-surface-variant)]">{dayLabel(key)}</span>}>
      <div className="grid grid-cols-1 gap-5 px-4 py-4 sm:px-5 md:grid-cols-2">
        <div>
          {today.items.length === 0 ? <p className="text-sm text-[var(--ref-on-surface-variant)]">Nothing planned today.</p> : (
            <ul className="space-y-2">
              {today.items.map((item) => {
                if (item.type === 'plan') return <li key={`p${item.plan.id}`} className="flex gap-3 text-sm"><span className="w-11 shrink-0 font-semibold tabular-nums text-[var(--ref-on-surface-variant)]">{item.time ?? ''}</span><span className="text-[var(--ref-on-surface)]">{item.plan.title}{item.plan.place && <span className="text-[var(--ref-on-surface-variant)]"> · {item.plan.place}</span>}</span></li>;
                const Icon = BOOKING_ICONS[item.booking.kind];
                return (
                  <li key={`${item.role}${item.booking.id}`} className="flex gap-3 text-sm">
                    <span className="w-11 shrink-0 font-semibold tabular-nums text-[var(--ref-on-surface-variant)]">{item.time ?? ''}</span>
                    <span className="flex min-w-0 items-start gap-1.5 text-[var(--ref-on-surface)]"><Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ref-on-surface-variant)]" aria-hidden />{ROLE[item.role] ? `${ROLE[item.role]}: ` : ''}{item.booking.title}{item.booking.code && <span className="font-mono text-xs text-[var(--ref-on-surface-variant)]"> {item.booking.code}</span>}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {today.sleep && <p className="mt-3 flex items-center gap-1.5 text-xs text-[var(--ref-on-surface-variant)]"><BedDouble className="h-3.5 w-3.5" aria-hidden />Tonight at {today.sleep.title}</p>}
        </div>
        <div className="space-y-4">
          <Meter label="Spent today" value={spentOn.get(key) ?? 0} of={allowance + today.planned} amount={formatAmount} />
          <Meter label={`The trip so far, ${soFar.length} day${soFar.length === 1 ? '' : 's'}`} value={spentSoFar} of={plannedSoFar} amount={formatAmount} />
          {(trip.spending?.byCategory.length ?? 0) > 0 && (
            <ul className="space-y-1 text-xs">
              {trip.spending!.byCategory.slice(0, 4).map((row) => <li key={row.categoryId} className="flex justify-between gap-2"><span className="text-[var(--ref-on-surface-variant)]">{row.name}</span><span className="tabular-nums font-semibold text-[var(--ref-on-surface)]">{formatAmount(row.total)}</span></li>)}
            </ul>
          )}
          <p className="text-xs text-[var(--ref-on-surface-variant)]">Counts every expense you record dated on the trip’s days.</p>
        </div>
      </div>
    </Section>
  );
}

/**
 * After the trip: what was planned against what it took, for bookings and for the days there,
 * each paying person's share, where the money went, its photos, and a way to plan it again.
 */
export function TripRecap({ goalId, trip, target, files }: { goalId: number; trip: Trip; target: number; files: GoalFile[] }) {
  const { formatAmount } = useBalanceVisibility();
  const navigate = useNavigate();
  const again = usePlanAgainMutation();
  const budget = tripBudget(trip.basics, trip.bookings, trip.plans, trip.travellers, target);
  const spent = trip.spending?.total ?? 0;
  const photos = files.filter((file) => file.mimetype.startsWith('image/')).slice(0, 8);
  const rows = [
    { label: 'Bookings', planned: budget.booked, actual: budget.paid },
    { label: 'On the trip', planned: budget.plans + budget.spendingMoney, actual: spent },
  ];
  const plannedTotal = rows.reduce((sum, row) => sum + row.planned, 0);
  const actualTotal = rows.reduce((sum, row) => sum + row.actual, 0);

  return (
    <Section
      title="How the trip went"
      aside={(
        <Button type="button" size="sm" variant="secondary" isLoading={again.isPending} onClick={async () => {
          try {
            const { id } = await again.mutateAsync(goalId);
            toast.success('A new holiday goal, with the same places, people and packing list.');
            void navigate({ to: '/goals/$goalId', params: { goalId: String(id) } });
          } catch (error) {
            toast.error(errorText(error, 'Could not plan it again'));
          }
        }}><RotateCcw className="mr-1.5 inline h-3.5 w-3.5" aria-hidden />Plan it again</Button>
      )}
    >
      <div className="px-4 py-4 sm:px-5">
        <table className="w-full text-[13px] sm:text-sm">
          <thead>
            <tr className="text-left text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--ref-on-surface-variant)]">
              <th className="pb-2 font-bold" />
              <th className={cn(NUMBER, 'pb-2 font-bold')}>Planned</th>
              <th className={cn(NUMBER, 'pb-2 font-bold')}>Spent</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {rows.map((row) => (
              <tr key={row.label}>
                <td className="py-2 text-[var(--ref-on-surface-variant)]">{row.label}</td>
                <td className={cn(NUMBER, 'py-2 text-[var(--ref-on-surface)]')}>{formatAmount(row.planned)}</td>
                <td className={cn(NUMBER, 'py-2 font-semibold', row.actual > row.planned ? 'text-[var(--color-warning)]' : 'text-[var(--ref-on-surface)]')}>{formatAmount(row.actual)}</td>
              </tr>
            ))}
            <tr>
              <td className="py-2 font-semibold text-[var(--ref-on-surface)]">Altogether</td>
              <td className={cn(NUMBER, 'py-2 text-[var(--ref-on-surface)]')}>{formatAmount(plannedTotal)}</td>
              <td className={cn(NUMBER, 'py-2 font-semibold text-[var(--ref-on-surface)]')}>{formatAmount(actualTotal)}</td>
            </tr>
            {budget.payers > 1 && (
              <tr>
                <td className="py-2 text-[var(--ref-on-surface-variant)]">Each paying person</td>
                <td className={cn(NUMBER, 'py-2 text-[var(--ref-on-surface)]')}>{formatAmount(Math.round(plannedTotal / budget.payers))}</td>
                <td className={cn(NUMBER, 'py-2 font-semibold text-[var(--ref-on-surface)]')}>{formatAmount(Math.round(actualTotal / budget.payers))}</td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-[var(--ref-on-surface-variant)]">Bookings count what was paid from the goal; the trip counts every expense dated on its days.</p>

        {(trip.spending?.byCategory.length ?? 0) > 0 && (
          <div className="mt-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--ref-on-surface-variant)]">Where it went there</p>
            <ul className="mt-2 space-y-1.5">
              {trip.spending!.byCategory.slice(0, 6).map((row) => (
                <li key={row.categoryId} className="text-sm">
                  <div className="flex justify-between gap-2"><span className="text-[var(--ref-on-surface)]">{row.name}</span><span className="tabular-nums font-semibold text-[var(--ref-on-surface)]">{formatAmount(row.total)}</span></div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--ref-surface-container-high)]" aria-hidden><div className="h-full rounded-full bg-[var(--ref-primary)]" style={{ width: `${(row.total / Math.max(1, spent)) * 100}%` }} /></div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {photos.length > 0 && (
          <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-8">
            {photos.map((photo) => <a key={photo.id} href={goalFileUrl(photo.id)} target="_blank" rel="noreferrer noopener"><img src={goalFileUrl(photo.id)} alt={photo.filename} className="aspect-square w-full rounded-lg object-cover" loading="lazy" /></a>)}
          </div>
        )}
      </div>
    </Section>
  );
}
