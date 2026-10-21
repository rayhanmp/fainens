import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, Flame, Pause, Pencil, Play, Plus, Receipt, ShoppingBag } from 'lucide-react';
import { BalanceVisibilityToggle } from '../../../components/ui/BalanceVisibilityToggle';
import { useBalanceVisibility } from '../../../hooks/useBalanceVisibility';
import { cn } from '../../../lib/utils';
import { GOAL_TYPES, isGoalTypeKey } from '../goal-types';
import { goalFileUrl, type GoalDetail } from '../queries';
import { monthsUntil } from '../pace';
import { GoalEnvelope } from './GoalEnvelope';

const microLabel = 'text-[10px] font-bold uppercase tracking-[0.18em]';
const monthYear = (date: Date) => date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
const addMonths = (months: number, now = new Date()) => new Date(now.getFullYear(), now.getMonth() + months, 1);
const whiteButton = 'inline-flex h-[34px] items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors disabled:opacity-50';

/**
 * A goal's own top card: what it holds against its target with a tick at each quarter (filled once
 * reached), when it gets there at its monthly amount, its streak, and what you can do with it. Its
 * cover picture, when it has one, fills the right side; otherwise its envelope does.
 */
export function GoalPageHero({ detail, color, headline, art, onPutIn, onTakeOut, onPay, onBought, onPause, onEdit, pausing }: {
  detail: GoalDetail;
  color: string;
  /** Its type's headline, like "143 days to go". */
  headline: string | null;
  /** Its type's own illustration, in place of the envelope. */
  art?: ReactNode;
  onPutIn: () => void;
  onTakeOut: () => void;
  onPay: () => void;
  onBought: () => void;
  onPause: () => void;
  onEdit: () => void;
  pausing: boolean;
}) {
  const { formatAmount } = useBalanceVisibility();
  const { goal } = detail;
  const progress = goal.targetAmount > 0 ? Math.min(1, goal.setAside / goal.targetAmount) : 0;
  const reached = new Map(detail.milestones.map((item) => [item.share, item.at]));
  const by = goal.byDate ? monthsUntil(goal.byDate) : null;
  const late = goal.reachMonths !== null && by !== null && goal.reachMonths > by ? goal.reachMonths - by : 0;
  const active = goal.status === 'active';
  const formatted = formatAmount(goal.setAside);
  const [prefix, digits] = formatted.startsWith('Rp') ? ['Rp', formatted.slice(2)] : ['', formatted];

  const reach = goal.reachMonths === 0
    ? { text: goal.kind === 'spend' ? 'Ready to buy' : 'All there', tone: 'good' as const }
    : goal.paused
      ? { text: 'Paused: nothing goes in each month', tone: 'plain' as const }
      : goal.reachMonths === null
        ? { text: goal.monthlyAmount > 0 ? 'Not within 50 years at this pace' : 'Add a monthly amount to see when', tone: 'plain' as const }
        : { text: `${monthYear(addMonths(goal.reachMonths))}${by !== null ? (late ? ` · ${late} month${late === 1 ? '' : 's'} late` : ' · on time') : ''}`, tone: late ? 'warn' as const : 'plain' as const };

  return (
    <section className="plan-sky relative overflow-clip rounded-3xl text-white" aria-label={goal.name}>
      {/* The cover picture, fading into the sky toward the text. */}
      {goal.coverAttachmentId && (
        <div className="absolute inset-y-0 right-0 hidden w-[46%] md:block" aria-hidden>
          <img src={goalFileUrl(goal.coverAttachmentId)} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-[var(--color-accent)] via-[var(--color-accent)]/60 to-transparent" />
        </div>
      )}
      <div className="relative flex items-start justify-between gap-6 px-5 pb-5 pt-5 sm:px-7 sm:pb-7 sm:pt-6">
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <Link to="/goals" className="inline-flex items-center gap-1.5 text-xs font-semibold text-white/80 hover:text-white"><ArrowLeft className="h-3.5 w-3.5" aria-hidden />Goals</Link>
            <BalanceVisibilityToggle inverted className="h-7 w-7" />
          </div>
          <div className="mt-4 flex items-center gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#fff]/15 text-2xl" aria-hidden>{goal.icon ?? '🎯'}</span>
            <div className="min-w-0">
              <h1 className="truncate font-headline text-2xl font-extrabold sm:text-3xl">{goal.name}</h1>
              <p className="mt-1 flex flex-wrap gap-1.5">
                {[isGoalTypeKey(goal.goalType) ? GOAL_TYPES[goal.goalType].label : null, goal.kind === 'spend' ? 'To buy' : 'To keep', goal.recurrence === 'yearly' ? 'Every year' : null, goal.paused ? 'Paused' : null, goal.status === 'done' ? 'Finished' : null, goal.status === 'archived' ? 'Archived' : null]
                  .filter(Boolean)
                  .map((chip) => <span key={chip} className="rounded-full bg-[#fff]/15 px-2 py-0.5 text-[11px] font-semibold">{chip}</span>)}
              </p>
            </div>
          </div>

          {/* The figure that matters most for this kind of goal, like days to go or months covered. */}
          {headline && <p className="mt-5 font-headline text-lg font-bold text-amber-100 sm:text-xl">{headline}</p>}

          <p className="mt-6 flex flex-wrap items-baseline gap-x-2">
            <span className="flex items-baseline gap-x-1.5 whitespace-nowrap">
              {prefix && <span className="font-headline text-lg font-bold text-white/70">{prefix}</span>}
              <span className="font-headline text-[clamp(2rem,8vw,3rem)] font-black leading-none tracking-tighter tabular-nums">{digits}</span>
            </span>
            <span className="text-sm font-semibold text-white/80">of {formatAmount(goal.targetAmount)} · {Math.round(progress * 100)}%</span>
          </p>

          {/* The track, with a tick at each quarter; a reached one is filled and says when. */}
          <div className="relative mt-4 h-3 max-w-xl rounded-full bg-[#fff]/20">
            <div className="h-full rounded-full bg-[#fff] transition-[width] duration-700 motion-reduce:transition-none" style={{ width: `${progress * 100}%` }} />
            {([25, 50, 75, 100] as const).map((share) => {
              const at = reached.get(share);
              return (
                <span
                  key={share}
                  title={at ? `${share}% reached ${new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : `${share}%`}
                  className={cn('absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2', at ? 'border-[#fff] bg-[#fbbf24]' : 'border-[#fff]/60 bg-[var(--color-accent)]')}
                  style={{ left: `${share === 100 ? 99 : share}%` }}
                />
              );
            })}
          </div>

          <dl className="mt-5 grid max-w-xl grid-cols-1 gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className={cn(microLabel, 'text-white/65')}>Each month</dt>
              <dd className="mt-1 font-semibold tabular-nums">{goal.monthlyAmount > 0 ? formatAmount(goal.monthlyAmount) : '—'}{goal.monthlyPercent ? <span className="font-normal text-white/75"> · {goal.monthlyPercent}% of salary</span> : null}</dd>
            </div>
            <div>
              <dt className={cn(microLabel, 'text-white/65')}>Gets there</dt>
              <dd className={cn('mt-1 font-semibold', reach.tone === 'warn' && 'text-amber-200', reach.tone === 'good' && 'text-emerald-200')}>{reach.text}</dd>
            </div>
            <div>
              <dt className={cn(microLabel, 'text-white/65')}>Streak</dt>
              <dd className="mt-1 flex items-center gap-1 font-semibold">{detail.streak > 0 ? <><Flame className="h-4 w-4 text-amber-300" aria-hidden />{detail.streak} month{detail.streak === 1 ? '' : 's'} in a row</> : <span className="font-normal text-white/75">{goal.monthlyAmount > 0 ? 'Starts with this month’s amount' : '—'}</span>}</dd>
            </div>
          </dl>

          {active && (
            <div className="mt-6 flex flex-wrap gap-2">
              <button type="button" onClick={onPutIn} className={cn(whiteButton, 'bg-[#fff] text-[#0b2a5c] hover:bg-[#fff]/90')}><Plus className="h-3.5 w-3.5" aria-hidden />Put money in</button>
              <button type="button" onClick={onTakeOut} disabled={goal.setAside <= 0} className={cn(whiteButton, 'bg-[#fff]/15 text-white hover:bg-[#fff]/25')}>Take out</button>
              {goal.kind === 'spend' && (
                <>
                  <button type="button" onClick={onPay} disabled={goal.setAside <= 0} className={cn(whiteButton, 'bg-[#fff]/15 text-white hover:bg-[#fff]/25')}><Receipt className="h-3.5 w-3.5" aria-hidden />Pay part</button>
                  <button type="button" onClick={onBought} className={cn(whiteButton, 'bg-[#fff]/15 text-white hover:bg-[#fff]/25')}><ShoppingBag className="h-3.5 w-3.5" aria-hidden />{goal.recurrence === 'yearly' ? 'Paid this year' : 'Bought it'}</button>
                </>
              )}
              <button type="button" onClick={onPause} disabled={pausing} className={cn(whiteButton, 'bg-[#fff]/15 text-white hover:bg-[#fff]/25')}>{goal.paused ? <><Play className="h-3.5 w-3.5" aria-hidden />Resume</> : <><Pause className="h-3.5 w-3.5" aria-hidden />Pause</>}</button>
              <button type="button" onClick={onEdit} aria-label="Edit goal" className={cn(whiteButton, 'bg-[#fff]/15 px-2.5 text-white hover:bg-[#fff]/25')}><Pencil className="h-3.5 w-3.5" aria-hidden /></button>
            </div>
          )}
        </div>
        {!goal.coverAttachmentId && <div className="-mb-4 hidden shrink-0 self-end md:block">{art ?? <GoalEnvelope color={color} fill={progress} icon={goal.icon} />}</div>}
      </div>
    </section>
  );
}
