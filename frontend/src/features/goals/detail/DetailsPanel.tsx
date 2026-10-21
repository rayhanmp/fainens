import { useState } from 'react';
import { AlertTriangle, ExternalLink, Link2, X } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { toast } from '../../../components/ui/useToast';
import { useBalanceVisibility } from '../../../hooks/useBalanceVisibility';
import { cn } from '../../../lib/utils';
import { useCategoriesQuery } from '../../categories/queries';
import { PercentField } from '../../savings/fields';
import { InfoHint } from '../../savings/InfoHint';
import { POT_TEMPLATES } from '../../savings/pots';
import { Dropdown } from '../../settings/controls';
import { Section } from '../../subscriptions/PageParts';
import { goalLinkImageUrl, usePreviewLinkMutation, useUpdateGoalMutation, type GoalDetail, type GoalsOverview } from '../queries';

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);
const rowLabel = 'text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--ref-outline)]';
const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

/** A product or booking page: shown as a card once set; reading it fills its title, picture and price. */
function LinkRow({ detail }: { detail: GoalDetail }) {
  const { formatAmount } = useBalanceVisibility();
  const update = useUpdateGoalMutation();
  const preview = usePreviewLinkMutation();
  const { goal } = detail;
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState(goal.linkUrl ?? '');
  const [price, setPrice] = useState<number | null>(null);

  const save = async () => {
    const value = url.trim();
    if (!/^https?:\/\//i.test(value)) return toast.error('Paste a web address starting with https://');
    // Save the link first; the shop is read after, and a page it can't read keeps just the link.
    try {
      await update.mutateAsync({ id: goal.id, linkUrl: value, linkTitle: null, linkImage: null });
      setEditing(false);
    } catch (error) {
      return toast.error(errorText(error, 'Could not save the link'));
    }
    try {
      const read = await preview.mutateAsync(value);
      await update.mutateAsync({ id: goal.id, linkTitle: read.title, linkImage: read.image });
      setPrice(read.price && read.price !== goal.targetAmount ? read.price : null);
    } catch {
      // Not a shop the scraper knows: the link alone is fine.
    }
  };

  if (editing || !goal.linkUrl) {
    return (
      <form onSubmit={(event) => { event.preventDefault(); void save(); }} className="flex gap-2">
        <input aria-label="Link" type="url" inputMode="url" className="brutalist-input h-[34px] min-w-0 flex-1" placeholder="https://… a product, tour or booking page" value={url} onChange={(event) => setUrl(event.target.value)} />
        <Button type="submit" size="sm" variant="secondary" isLoading={update.isPending || preview.isPending} disabled={!url.trim()}>Save</Button>
        {editing && <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>}
      </form>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-3 rounded-xl border border-[var(--color-border)] p-2.5">
        {goal.linkImage
          ? <img src={goalLinkImageUrl(goal.linkImage)} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
          : <span className="grid h-14 w-14 shrink-0 place-items-center rounded-lg bg-[var(--ref-surface-container-low)] text-[var(--ref-on-surface-variant)]"><Link2 className="h-5 w-5" aria-hidden /></span>}
        <div className="min-w-0 flex-1">
          <a href={goal.linkUrl} target="_blank" rel="noreferrer noopener" className="line-clamp-2 text-sm font-semibold text-[var(--ref-on-surface)] hover:underline">{goal.linkTitle ?? host(goal.linkUrl)}<ExternalLink className="ml-1 inline h-3 w-3 align-baseline" aria-hidden /></a>
          <p className="truncate text-xs text-[var(--ref-on-surface-variant)]">{host(goal.linkUrl)}</p>
        </div>
        <div className="flex shrink-0 flex-col gap-1">
          <button type="button" onClick={() => { setUrl(goal.linkUrl ?? ''); setEditing(true); }} className="rounded-md px-2 py-1 text-xs font-semibold text-[var(--ref-primary)] hover:bg-[var(--ref-surface-container-low)]">Change</button>
          <button type="button" aria-label="Remove link" onClick={() => update.mutate({ id: goal.id, linkUrl: null, linkTitle: null, linkImage: null })} className="grid place-items-center rounded-md px-2 py-1 text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-low)]"><X className="h-3.5 w-3.5" aria-hidden /></button>
        </div>
      </div>
      {price !== null && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--ref-surface-container-low)] px-3 py-2 text-xs">
          <span>The page says <span className="font-semibold tabular-nums">{formatAmount(price)}</span>.</span>
          <span className="flex gap-1">
            <Button type="button" size="sm" variant="secondary" className="h-[28px] px-2 text-xs" onClick={() => { update.mutate({ id: goal.id, targetAmount: price }); setPrice(null); }}>Use as target</Button>
            <Button type="button" size="sm" variant="secondary" className="h-[28px] px-2 text-xs" onClick={() => setPrice(null)}>Keep</Button>
          </span>
        </div>
      )}
    </div>
  );
}

/** The yearly return its money earns where it sits, with the usual places as one tap. */
function ReturnRow({ detail }: { detail: GoalDetail }) {
  const update = useUpdateGoalMutation();
  const [value, setValue] = useState(detail.goal.expectedReturn);
  const save = (next: number) => {
    setValue(next);
    update.mutate({ id: detail.goal.id, expectedReturn: next }, { onError: (error) => toast.error(errorText(error, 'Could not save')) });
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="w-[110px]"><PercentField ariaLabel="Yearly return" value={value} min={-20} max={50} onChange={setValue} /></div>
        {value !== detail.goal.expectedReturn && <Button type="button" size="sm" variant="secondary" isLoading={update.isPending} onClick={() => save(value)}>Save</Button>}
      </div>
      <div className="flex flex-wrap gap-1">
        {[{ name: 'Nothing', returnRate: 0, title: 'Cash or a wallet: earns nothing' }, ...POT_TEMPLATES.filter((item) => item.name !== 'Saham')].map((item) => (
          <button key={item.name} type="button" title={item.title} onClick={() => save(item.returnRate)} className={cn('rounded-full border px-2.5 py-1 text-[11px] font-semibold', detail.goal.expectedReturn === item.returnRate ? 'border-[var(--ref-primary)] bg-[var(--ref-primary)]/10 text-[var(--ref-primary)]' : 'border-[var(--color-border)] text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-low)]')}>
            {item.name} {item.returnRate ? `${item.returnRate.toLocaleString('id-ID')}%` : ''}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The goal's settings beside its page: its link, the account its money sits in (warned when that
 * account holds less than its goals), what it earns there, the category whose expenses it pays,
 * and the milestones it has reached.
 */
export function DetailsPanel({ detail, overview }: { detail: GoalDetail; overview: GoalsOverview }) {
  const { formatAmount } = useBalanceVisibility();
  const update = useUpdateGoalMutation();
  const categories = useCategoriesQuery();
  const { goal, account } = detail;
  const short = (share: number) => `${share}%`;
  const save = (body: Parameters<typeof update.mutate>[0]) => update.mutate(body, { onError: (error) => toast.error(errorText(error, 'Could not save')) });
  const categoryOptions = [{ value: 'none', label: 'None' }, ...((categories.data ?? []) as Array<{ id: number; name: string; isActive?: boolean }>).filter((item) => item.isActive !== false).map((item) => ({ value: String(item.id), label: item.name }))];

  return (
    <Section title="Details">
      <div className="divide-y divide-[var(--color-border)]">
        <div className="space-y-2 px-4 py-4 sm:px-5">
          <p className={rowLabel}>Link</p>
          <LinkRow detail={detail} />
        </div>

        <div className="space-y-2 px-4 py-4 sm:px-5">
          <div className="flex items-center gap-1">
            <p className={rowLabel}>Where the money sits</p>
            <InfoHint label="About where the money sits">The account or pocket this goal’s money is really kept in, like a Jago pocket. Nothing moves; it’s a note, and a check that the account holds enough for its goals.</InfoHint>
          </div>
          <Dropdown
            ariaLabel="Account"
            value={goal.accountId ? String(goal.accountId) : 'none'}
            options={[{ value: 'none', label: 'Not said' }, ...overview.accounts.map((item) => ({ value: String(item.id), label: item.name }))]}
            onChange={(value) => save({ id: goal.id, accountId: value === 'none' ? null : Number(value) })}
          />
          {account && (
            account.balance < account.goalsHold ? (
              <p className="flex items-start gap-1.5 text-xs text-[var(--color-warning)]"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{account.name} holds {formatAmount(account.balance)}, less than the {formatAmount(account.goalsHold)} its goals have.</p>
            ) : (
              <p className="text-xs text-[var(--ref-on-surface-variant)]">{account.name} holds {formatAmount(account.balance)}; its goals have {formatAmount(account.goalsHold)}.</p>
            )
          )}
        </div>

        <div className="space-y-2 px-4 py-4 sm:px-5">
          <div className="flex items-center gap-1">
            <p className={rowLabel}>What it earns</p>
            <InfoHint label="About what it earns">The yearly return, after tax, of where its money sits. It’s counted in when the goal gets there, here and in the savings simulator.</InfoHint>
          </div>
          <ReturnRow key={goal.expectedReturn} detail={detail} />
        </div>

        <div className="space-y-2 px-4 py-4 sm:px-5">
          <div className="flex items-center gap-1">
            <p className={rowLabel}>Pays for</p>
            <InfoHint label="About paying for a category">Expenses you record in this category come out of the goal automatically, from the day you choose it, as far as its money goes. Reverse an expense and its money comes back.</InfoHint>
          </div>
          <Dropdown ariaLabel="Category" value={goal.categoryId ? String(goal.categoryId) : 'none'} options={categoryOptions} onChange={(value) => save({ id: goal.id, categoryId: value === 'none' ? null : Number(value) })} />
          {goal.categoryId && goal.categorySince && <p className="text-xs text-[var(--ref-on-surface-variant)]">{detail.categoryName ?? 'Its'} expenses from {new Date(goal.categorySince).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} on come out of it.</p>}
        </div>

        <div className="space-y-2 px-4 py-4 sm:px-5">
          <p className={rowLabel}>Milestones</p>
          <ul className="space-y-1.5 text-sm">
            {([25, 50, 75, 100] as const).map((share) => {
              const at = detail.milestones.find((item) => item.share === share)?.at;
              return (
                <li key={share} className="flex items-center justify-between gap-3">
                  <span className={cn('flex items-center gap-2', at ? 'text-[var(--ref-on-surface)]' : 'text-[var(--ref-on-surface-variant)]')}>
                    <span className={cn('h-2.5 w-2.5 rounded-full', at ? 'bg-[#fbbf24]' : 'border border-[var(--ref-outline)]')} aria-hidden />
                    {share === 100 ? 'All there' : `${short(share)} there`}
                  </span>
                  <span className="text-xs tabular-nums text-[var(--ref-on-surface-variant)]">{at ? new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : formatAmount(Math.round((goal.targetAmount * share) / 100))}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </Section>
  );
}
