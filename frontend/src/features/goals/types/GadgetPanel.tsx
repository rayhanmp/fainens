import { useState, type ReactNode } from 'react';
import { ExternalLink, Link2, RefreshCw, TrendingDown, TrendingUp, X } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { useBalanceVisibility } from '../../../hooks/useBalanceVisibility';
import { cn } from '../../../lib/utils';
import { Field, MoneyField } from '../../savings/fields';
import { Section } from '../../subscriptions/PageParts';
import { goalLinkImageUrl } from '../queries';
import { Actions, Figure } from './PanelParts';
import { cheapestOption, GADGET_OPTIONS_MAX, gadgetTarget, type GadgetData, type GadgetOption } from './type-math';

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

/** One shop's offer: its picture, name and price, how the price moved since it was added, and a pick. */
function OptionCard({ option, picked, cheapest, onPick, onRemove, onPrice }: { option: GadgetOption; picked: boolean; cheapest: boolean; onPick: () => void; onRemove?: () => void; onPrice: (price: number) => void }) {
  const { formatAmount } = useBalanceVisibility();
  const moved = option.price !== null && option.firstPrice !== null ? option.price - option.firstPrice : 0;
  return (
    <li className={cn('relative flex flex-col rounded-xl border p-3', picked ? 'border-[var(--ref-primary)] bg-[var(--ref-primary)]/5' : 'border-[var(--color-border)]')}>
      {onRemove && <button type="button" aria-label="Remove this option" onClick={onRemove} className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-md text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-low)]"><X className="h-3.5 w-3.5" aria-hidden /></button>}
      <div className="flex items-start gap-3 pr-6">
        {option.image
          ? <img src={goalLinkImageUrl(option.image)} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
          : <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-[var(--ref-surface-container-low)] text-[var(--ref-on-surface-variant)]"><Link2 className="h-4 w-4" aria-hidden /></span>}
        <a href={option.url} target="_blank" rel="noreferrer noopener" className="min-w-0 hover:underline">
          <span className="line-clamp-2 text-sm font-medium text-[var(--ref-on-surface)]">{option.title ?? host(option.url)}<ExternalLink className="ml-1 inline h-3 w-3 align-baseline text-[var(--ref-on-surface-variant)]" aria-hidden /></span>
          <span className="block truncate text-xs text-[var(--ref-on-surface-variant)]">{host(option.url)}</span>
        </a>
      </div>
      <div className="settings-compact mt-3"><MoneyField ariaLabel="Price" value={option.price ?? 0} onChange={onPrice} /></div>
      <div className="mt-2 flex min-h-[20px] flex-wrap items-center gap-1.5 text-[11px] font-semibold">
        {cheapest && <span className="rounded-full bg-[var(--color-success)]/10 px-2 py-0.5 text-[var(--color-success)]">Cheapest</span>}
        {moved < 0 && <span className="inline-flex items-center gap-0.5 text-[var(--color-success)]"><TrendingDown className="h-3 w-3" aria-hidden />{formatAmount(-moved)} cheaper</span>}
        {moved > 0 && <span className="inline-flex items-center gap-0.5 text-[var(--color-warning)]"><TrendingUp className="h-3 w-3" aria-hidden />{formatAmount(moved)} dearer</span>}
      </div>
      <Button type="button" size="sm" variant={picked ? 'primary' : 'secondary'} className="mt-2 w-full" onClick={onPick} aria-pressed={picked}>{picked ? 'Picked' : 'Pick this'}</Button>
    </li>
  );
}

/**
 * A gadget's shops side by side: up to three links with their prices read from the page (or typed),
 * how each moved since it was added, the cheapest marked, and one picked. What it costs with the
 * old one traded in can become the target; checking again refreshes the prices.
 */
export function GadgetPanel({ value, onChange, target, onAddLink, onCheck, checking = false, actions }: {
  value: GadgetData;
  onChange: (patch: Partial<GadgetData>) => void;
  target: number;
  onAddLink?: (url: string) => Promise<void>;
  onCheck?: () => void;
  checking?: boolean;
  actions?: ReactNode;
}) {
  const { formatAmount } = useBalanceVisibility();
  const [url, setUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const cheapest = cheapestOption(value.options);
  const net = gadgetTarget(value);
  const checked = Math.max(0, ...value.options.map((option) => option.checkedAt ?? 0));
  const setOption = (index: number, patch: Partial<GadgetOption>) => onChange({ options: value.options.map((option, at) => (at === index ? { ...option, ...patch, firstPrice: option.firstPrice ?? patch.price ?? null } : option)) });

  const add = async () => {
    const link = url.trim();
    if (!/^https?:\/\//i.test(link) || !onAddLink) return;
    setAdding(true);
    try {
      await onAddLink(link);
      setUrl('');
    } finally {
      setAdding(false);
    }
  };

  return (
    <Section
      title="Compare"
      aside={onCheck && value.options.length > 0 ? (
        <span className="flex items-center gap-2">
          {checked > 0 && <span className="text-xs text-[var(--ref-on-surface-variant)]">Checked {new Date(checked).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>}
          <Button type="button" size="sm" variant="secondary" isLoading={checking} onClick={onCheck}><RefreshCw className="mr-1 inline h-3.5 w-3.5" aria-hidden />Check prices</Button>
        </span>
      ) : undefined}
    >
      <div className="@container px-4 py-4 sm:px-5">
        {value.options.length > 0 && (
          <ul className="grid grid-cols-1 gap-3 @md:grid-cols-2 @2xl:grid-cols-3">
            {value.options.map((option, index) => (
              <OptionCard
                key={option.url}
                option={option}
                picked={index === value.pick}
                cheapest={value.options.length > 1 && index === cheapest}
                onPick={() => onChange({ pick: index })}
                onRemove={onAddLink ? () => onChange({ options: value.options.filter((_, at) => at !== index), pick: index < value.pick ? value.pick - 1 : index === value.pick ? 0 : value.pick }) : undefined}
                onPrice={(price) => setOption(index, { price })}
              />
            ))}
          </ul>
        )}
        {onAddLink && value.options.length < GADGET_OPTIONS_MAX && (
          <form onSubmit={(event) => { event.preventDefault(); void add(); }} className={cn('flex gap-2', value.options.length > 0 && 'mt-3')}>
            <input aria-label="A shop’s link" type="url" inputMode="url" className="brutalist-input h-[34px] min-w-0 flex-1" placeholder={value.options.length ? 'Another shop’s link, to compare' : 'Paste a link to the gadget in a shop'} value={url} onChange={(event) => setUrl(event.target.value)} />
            <Button type="submit" size="sm" variant="secondary" isLoading={adding} disabled={!/^https?:\/\//i.test(url.trim())}>Add</Button>
          </form>
        )}
        <div className="settings-compact mt-4 grid grid-cols-1 items-end gap-4 @md:grid-cols-2">
          <Field label="Trade-in for the old one" htmlFor="gadget-trade-in" info="What a shop or buyer would give for the device you have now. It comes off the price.">
            <MoneyField id="gadget-trade-in" value={value.tradeIn} onChange={(tradeIn) => onChange({ tradeIn })} />
          </Field>
          <Figure label="It costs you" value={net !== null ? formatAmount(net) : '—'} hint={net !== null ? (net === target ? 'The target' : `The target is ${formatAmount(target)}`) : 'Pick an option with a price'} large />
        </div>
        {actions && <Actions>{actions}</Actions>}
      </div>
    </Section>
  );
}
