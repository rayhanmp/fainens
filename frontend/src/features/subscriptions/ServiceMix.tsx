import { useMemo } from 'react';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { cn } from '../../lib/utils';
import { squarify } from '../categories/treemap';
import { serviceTypeLabel, serviceTypeOf, type ServiceType } from './service-types';
import type { Subscription } from './queries';

/** The layout box the treemap is computed in; the tiles are placed as percentages of it. */
const BOX = { w: 100, h: 32 };

/**
 * Cost per month by kind of service as a treemap: each tile's area is its share, the darkest is
 * the biggest. Choosing a tile filters the list to that kind; choosing it again clears it.
 */
export function ServiceMix({ renewing, selected, onSelect }: {
  renewing: Subscription[];
  selected: ServiceType | null;
  onSelect: (type: ServiceType | null) => void;
}) {
  const { formatAmount } = useBalanceVisibility();
  const groups = useMemo(() => {
    const byType = new Map<ServiceType, { type: ServiceType; monthly: number; names: string[] }>();
    for (const subscription of renewing) {
      const type = serviceTypeOf(subscription);
      const group = byType.get(type) ?? { type, monthly: 0, names: [] };
      group.monthly += subscription.monthlyEquivalent;
      group.names.push(subscription.name);
      byType.set(type, group);
    }
    return [...byType.values()].filter((group) => group.monthly > 0).sort((a, b) => b.monthly - a.monthly);
  }, [renewing]);

  if (groups.length === 0) return <p className="px-4 py-8 text-center text-sm text-[var(--ref-on-surface-variant)] sm:px-5">Types show here once subscriptions renew.</p>;

  const total = groups.reduce((sum, group) => sum + group.monthly, 0);
  const rects = squarify(groups.map((group) => group.monthly), BOX.w, BOX.h);

  return (
    <div className="px-4 pb-4 pt-3 sm:px-5">
      <div className="relative w-full" style={{ aspectRatio: `${BOX.w} / ${BOX.h}` }} role="list" aria-label="Cost per month by type of service">
        {groups.map((group, index) => {
          const rect = rects[index];
          const share = group.monthly / total;
          // Bigger shares are darker steps of the accent; the text keeps contrast on each.
          const strength = Math.round(30 + (group.monthly / groups[0].monthly) * 70);
          const dark = strength >= 60;
          const roomy = rect.w >= 26 && rect.h >= 13;
          const isSelected = selected === group.type;
          return (
            <button
              key={group.type}
              type="button"
              role="listitem"
              aria-pressed={isSelected}
              aria-label={`${serviceTypeLabel(group.type)}: ${formatAmount(Math.round(group.monthly))} a month, ${Math.round(share * 100)}%, ${group.names.join(', ')}`}
              onClick={() => onSelect(isSelected ? null : group.type)}
              className={cn(
                'group absolute overflow-visible p-[2px] text-left transition-opacity',
                selected && !isSelected && 'opacity-40 hover:opacity-80',
              )}
              style={{ left: `${(rect.x / BOX.w) * 100}%`, top: `${(rect.y / BOX.h) * 100}%`, width: `${(rect.w / BOX.w) * 100}%`, height: `${(rect.h / BOX.h) * 100}%` }}
            >
              <span
                className={cn('flex h-full w-full flex-col justify-between overflow-hidden rounded-lg p-2', isSelected && 'ring-2 ring-[var(--ref-on-surface)] ring-offset-1 ring-offset-[var(--color-surface)]')}
                style={{ background: `color-mix(in srgb, var(--ref-primary) ${strength}%, var(--color-surface))` }}
              >
                {roomy ? (
                  <>
                    <span className={cn('block truncate text-xs font-semibold', dark ? 'text-white' : 'text-[var(--ref-on-surface)]')}>{serviceTypeLabel(group.type)}</span>
                    <span className={cn('block truncate text-[11px] tabular-nums', dark ? 'text-white/85' : 'text-[var(--ref-on-surface-variant)]')}>
                      <span className="text-base font-bold">{Math.round(share * 100)}%</span> · {formatAmount(Math.round(group.monthly))}/mo
                    </span>
                  </>
                ) : (
                  <span className={cn('block truncate text-[11px] font-semibold', dark ? 'text-white' : 'text-[var(--ref-on-surface)]')}>{Math.round(share * 100)}%</span>
                )}
              </span>
              <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1 hidden w-max max-w-56 -translate-x-1/2 rounded-lg border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] px-2.5 py-1.5 text-xs shadow-lg group-hover:block">
                <span className="block font-semibold text-[var(--ref-on-surface)]">{serviceTypeLabel(group.type)} · {Math.round(share * 100)}%</span>
                <span className="block text-[var(--ref-on-surface-variant)]">{formatAmount(Math.round(group.monthly))} a month</span>
                <span className="block text-[var(--ref-on-surface-variant)]">{group.names.join(', ')}</span>
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-[var(--ref-on-surface-variant)]">{selected ? 'Choose it again to show every type.' : 'Choose a type to filter your list.'}</p>
    </div>
  );
}
