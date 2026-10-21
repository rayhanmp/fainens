import { useState, type ReactNode } from 'react';
import { AlertTriangle, ExternalLink, Link2, X } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { toast } from '../../../components/ui/useToast';
import { useBalanceVisibility } from '../../../hooks/useBalanceVisibility';
import { useCategoriesQuery } from '../../categories/queries';
import { PercentField } from '../../savings/fields';
import { InfoHint } from '../../savings/InfoHint';
import { POT_TEMPLATES } from '../../savings/pots';
import { Dropdown } from '../../settings/controls';
import { Section } from '../../subscriptions/PageParts';
import { GoalHistory } from '../GoalHistory';
import { goalLinkImageUrl, usePreviewLinkMutation, useUpdateGoalMutation, type GoalDetail, type GoalsOverview } from '../queries';

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);
const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

/** Where a goal's money can earn, as one choice each; anything else is "Another rate". */
const PLACES = [{ name: 'Nowhere', returnRate: 0, title: 'Cash or a wallet: earns nothing' }, ...POT_TEMPLATES];
const placeLabel = (place: (typeof PLACES)[number]) => (place.returnRate ? `${place.name} · ${place.returnRate.toLocaleString('id-ID')}%` : `${place.name} · 0%`);

/** One setting: its name (and a hint) on the left, its control on the right; a note can follow below. */
function Row({ label, info, control, children }: { label: string; info?: ReactNode; control?: ReactNode; children?: ReactNode }) {
  return (
    <div className="px-4 py-3 sm:px-5">
      <div className="flex items-center justify-between gap-3">
        <span className="flex shrink-0 items-center gap-1 text-sm font-medium text-[var(--ref-on-surface)]">
          {label}
          {info && <InfoHint label={`About ${label.toLowerCase()}`}>{info}</InfoHint>}
        </span>
        {control && <div className="min-w-0 max-w-[200px] flex-1">{control}</div>}
      </div>
      {children}
    </div>
  );
}

/** A product or booking page: a button to add one, then a small card; reading it fills its title, picture and price. */
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

  const adding = editing || (!goal.linkUrl && url !== (goal.linkUrl ?? ''));
  return (
    <Row
      label="Link"
      info="A product, tour or booking page. Pages from the shops the wishlist knows show their title and picture, and their price can become the target."
      control={!goal.linkUrl && !adding ? <Button type="button" size="sm" variant="secondary" className="h-[34px] w-full" onClick={() => setEditing(true)}><Link2 className="mr-1.5 inline h-3.5 w-3.5" aria-hidden />Add link</Button> : undefined}
    >
      {adding ? (
        <form onSubmit={(event) => { event.preventDefault(); void save(); }} className="mt-2 flex gap-2">
          <input aria-label="Link" type="url" inputMode="url" autoFocus className="brutalist-input h-[34px] min-w-0 flex-1" placeholder="https://…" value={url} onChange={(event) => setUrl(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { setEditing(false); setUrl(goal.linkUrl ?? ''); } }} />
          <Button type="submit" size="sm" isLoading={update.isPending || preview.isPending} disabled={!url.trim()}>Save</Button>
        </form>
      ) : goal.linkUrl ? (
        <div className="mt-2 flex items-center gap-3">
          {goal.linkImage
            ? <img src={goalLinkImageUrl(goal.linkImage)} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover" />
            : <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-[var(--ref-surface-container-low)] text-[var(--ref-on-surface-variant)]"><Link2 className="h-4 w-4" aria-hidden /></span>}
          <a href={goal.linkUrl} target="_blank" rel="noreferrer noopener" className="min-w-0 flex-1 hover:underline">
            <span className="line-clamp-2 text-sm font-medium text-[var(--ref-on-surface)]">{goal.linkTitle ?? host(goal.linkUrl)}<ExternalLink className="ml-1 inline h-3 w-3 align-baseline text-[var(--ref-on-surface-variant)]" aria-hidden /></span>
            <span className="block truncate text-xs text-[var(--ref-on-surface-variant)]">{host(goal.linkUrl)}</span>
          </a>
          <button type="button" onClick={() => { setUrl(goal.linkUrl ?? ''); setEditing(true); }} className="shrink-0 rounded-md px-1.5 py-1 text-xs font-semibold text-[var(--ref-primary)] hover:bg-[var(--ref-surface-container-low)]">Change</button>
          <button type="button" aria-label="Remove link" onClick={() => { setUrl(''); update.mutate({ id: goal.id, linkUrl: null, linkTitle: null, linkImage: null }); }} className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-low)]"><X className="h-3.5 w-3.5" aria-hidden /></button>
        </div>
      ) : null}
      {price !== null && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--ref-on-surface-variant)]">
          <span>The page says <span className="font-semibold tabular-nums text-[var(--ref-on-surface)]">{formatAmount(price)}</span>.</span>
          <span className="flex gap-1">
            <Button type="button" size="sm" variant="secondary" className="h-[28px] px-2 text-xs" onClick={() => { update.mutate({ id: goal.id, targetAmount: price }); setPrice(null); }}>Use as target</Button>
            <Button type="button" size="sm" variant="secondary" className="h-[28px] px-2 text-xs" onClick={() => setPrice(null)}>Keep</Button>
          </span>
        </div>
      )}
    </Row>
  );
}

/** Where its money earns: one of the usual places, or a rate of your own. */
function EarnsRow({ detail }: { detail: GoalDetail }) {
  const update = useUpdateGoalMutation();
  const rate = detail.goal.expectedReturn;
  const known = PLACES.find((place) => place.returnRate === rate);
  const [custom, setCustom] = useState<number | null>(known ? null : rate);
  const save = (next: number) => update.mutate({ id: detail.goal.id, expectedReturn: next }, { onError: (error) => toast.error(errorText(error, 'Could not save')) });
  const value = custom !== null ? 'custom' : known?.name ?? 'custom';
  return (
    <Row
      label="Earns"
      info="The yearly return, after tax, where its money sits. It’s counted in when the goal is reached, here and in the savings simulator."
      control={(
        <Dropdown
          ariaLabel="Earns"
          value={value}
          options={[...PLACES.map((place) => ({ value: place.name, label: placeLabel(place) })), { value: 'custom', label: custom !== null || !known ? `Another rate · ${rate.toLocaleString('id-ID')}%` : 'Another rate…' }]}
          onChange={(next) => {
            if (next === 'custom') return setCustom(rate);
            setCustom(null);
            save(PLACES.find((place) => place.name === next)?.returnRate ?? 0);
          }}
        />
      )}
    >
      {custom !== null && (
        <div className="mt-2 flex items-center justify-end gap-2">
          <div className="w-[110px]"><PercentField ariaLabel="Yearly return" value={custom} min={-20} max={50} onChange={setCustom} /></div>
          <Button type="button" size="sm" variant="secondary" isLoading={update.isPending} disabled={custom === rate} onClick={() => save(custom)}>Save</Button>
        </div>
      )}
    </Row>
  );
}

/**
 * The goal's settings beside its page, as rows: its link, the account its money sits in (warned
 * when that account holds less than its goals), what it earns there and the category whose
 * expenses it pays. Below, its recent activity.
 */
export function DetailsPanel({ detail, overview }: { detail: GoalDetail; overview: GoalsOverview }) {
  const { formatAmount } = useBalanceVisibility();
  const update = useUpdateGoalMutation();
  const categories = useCategoriesQuery();
  const [allActivity, setAllActivity] = useState(false);
  const { goal, account } = detail;
  const save = (body: Parameters<typeof update.mutate>[0]) => update.mutate(body, { onError: (error) => toast.error(errorText(error, 'Could not save')) });
  const categoryOptions = [{ value: 'none', label: 'Nothing' }, ...((categories.data ?? []) as Array<{ id: number; name: string; isActive?: boolean }>).filter((item) => item.isActive !== false).map((item) => ({ value: String(item.id), label: item.name }))];

  return (
    <div className="space-y-6">
      <Section title="Details">
        <div className="divide-y divide-[var(--color-border)]">
          <LinkRow detail={detail} />
          <Row
            label="Sits in"
            info="The account or pocket this goal’s money is really kept in, like a Jago pocket. Nothing moves; it’s a note, and a check that the account holds enough for its goals."
            control={<Dropdown ariaLabel="Sits in" value={goal.accountId ? String(goal.accountId) : 'none'} options={[{ value: 'none', label: 'Not said' }, ...overview.accounts.map((item) => ({ value: String(item.id), label: item.name }))]} onChange={(value) => save({ id: goal.id, accountId: value === 'none' ? null : Number(value) })} />}
          >
            {account && account.balance < account.goalsHold && (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-[var(--color-warning)]"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{account.name} holds {formatAmount(account.balance)}, less than the {formatAmount(account.goalsHold)} its goals have.</p>
            )}
          </Row>
          <EarnsRow key={goal.expectedReturn} detail={detail} />
          <Row
            label="Pays for"
            info="Expenses you record in this category come out of the goal automatically, from the day you choose it, as far as its money goes. Reverse an expense and its money comes back."
            control={<Dropdown ariaLabel="Pays for" value={goal.categoryId ? String(goal.categoryId) : 'none'} options={categoryOptions} onChange={(value) => save({ id: goal.id, categoryId: value === 'none' ? null : Number(value) })} />}
          >
            {goal.categoryId && goal.categorySince && <p className="mt-2 text-xs text-[var(--ref-on-surface-variant)]">{detail.categoryName ?? 'Its'} expenses from {new Date(goal.categorySince).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} come out of it.</p>}
          </Row>
        </div>
      </Section>

      <Section title="Activity" aside={<button type="button" onClick={() => setAllActivity((shown) => !shown)} className="text-xs font-semibold text-[var(--ref-primary)] hover:underline">{allActivity ? 'Show less' : 'Show all'}</button>}>
        <div className="px-4 py-1 sm:px-5"><GoalHistory goalId={goal.id} limit={allActivity ? undefined : 5} /></div>
      </Section>
    </div>
  );
}
