import { useMemo, useState, type ReactNode } from 'react';
import { Radio } from 'lucide-react';
import { NetWorthChart } from '../../components/analytics/NetWorthChart';
import { SpendingTrendChart } from '../../components/analytics/SpendingTrendChart';
import { CategoryBreakdown } from '../categories/CategoryBreakdown';
import { PeriodSpendChart } from '../categories/CategoryTrends';
import { useCategoriesPageQuery } from '../categories/page-queries';
import '../dashboard/dashboard.css';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';

/**
 * Not pictures of the app but the app: the same charts as the Dashboard and Categories pages,
 * reading your own data. They only read; nothing on them can change your records, and amounts
 * follow your hide-balances setting.
 */

function LiveFrame({ caption, children }: { caption: string; children: ReactNode }) {
  const { balancesHidden } = useBalanceVisibility();
  return (
    <figure className="not-prose my-6">
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-background)] p-3 sm:p-4">
        <p className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-accent)]"><Radio className="h-3.5 w-3.5" aria-hidden />Live · your own data{balancesHidden ? ' · amounts hidden' : ''}</p>
        {children}
      </div>
      <figcaption className="mt-2 text-center text-xs text-[var(--ref-on-surface-variant)]">{caption}</figcaption>
    </figure>
  );
}

/** The Dashboard’s net worth and spending charts, for your current period. */
export function LiveDashboardCharts() {
  return (
    <LiveFrame caption="The same charts as on your Dashboard. Try the range buttons and the spending chart’s gear menu.">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <NetWorthChart />
        <SpendingTrendChart />
      </div>
    </LiveFrame>
  );
}

/** The Categories page’s period chart and spending map, with your categories. */
export function LiveCategoryViews() {
  const query = useCategoriesPageQuery(true);
  const categories = useMemo(() => (query.data?.categories ?? []) as Array<{ id: number; name: string; color: string | null }>, [query.data?.categories]);
  const [focus, setFocus] = useState<number | null>(null);
  return (
    <LiveFrame caption="The same views as on your Categories page. Hover anything for its numbers; on the page itself, clicking opens the entries.">
      <div className="space-y-4">
        <PeriodSpendChart categories={categories} focus={focus} onFocusChange={setFocus} />
        <CategoryBreakdown categories={categories} />
      </div>
    </LiveFrame>
  );
}
