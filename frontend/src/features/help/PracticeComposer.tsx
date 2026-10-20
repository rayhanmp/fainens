import { QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { MousePointerClick, ShieldCheck } from 'lucide-react';
import { TransactionModal, type WalletAccount } from '../../components/transactions/TransactionModal';
import { SplitBillCard, type SplitBillVisualization } from '../../components/agent/SplitBillCard';
import { useAccountsQuery } from '../accounts/queries';
import { useCategoriesQuery, useTagsQuery } from '../categories/queries';
import { usePaylaterQuery } from '../paylater/queries';
import { useTransportRouteTemplatesQuery } from '../transactions/queries';
import { createPracticeQueryClient, PracticeModeContext } from './practice';

/**
 * The real transaction composer, opened from the docs in practice mode: the user's own accounts,
 * categories and tags, the exact same form, and nothing saved. Reads happen here on the app's own
 * client (as the real composer would); the composer itself runs on a client that refuses to write.
 */
export function PracticeComposer({ label = 'Try the real composer' }: { label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="not-prose my-6 flex flex-col gap-3 rounded-2xl border border-dashed border-[var(--color-accent)]/40 bg-[color-mix(in_srgb,var(--color-accent)_5%,transparent)] p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[color-mix(in_srgb,var(--color-accent)_14%,transparent)] text-[var(--color-accent)]"><MousePointerClick className="h-4 w-4" aria-hidden /></span>
        <div>
          <p className="text-sm font-semibold text-[var(--ref-on-surface)]">Practise with the real thing</p>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-[var(--ref-on-surface-variant)]"><ShieldCheck className="h-3.5 w-3.5 text-[var(--color-success)]" aria-hidden />Your own accounts and categories; nothing is saved.</p>
        </div>
      </div>
      <button type="button" onClick={() => setOpen(true)} className="brutalist-button inline-flex shrink-0 items-center px-4 py-2 text-sm text-white">{label}</button>
      {open && <OpenPractice onClose={() => setOpen(false)} />}
    </div>
  );
}

const SAMPLE_SPLIT: SplitBillVisualization = {
  type: 'split_bill',
  title: 'Sushi dinner',
  merchant: 'Sushi Tei',
  date: new Date().toISOString().slice(0, 10),
  participants: [{ id: 'me', name: 'You' }, { id: 'ani', name: 'Ani' }, { id: 'budi', name: 'Budi' }],
  items: [
    { id: 'salmon', name: 'Salmon set', quantity: 1, amount: 95_000, participantIds: ['me'] },
    { id: 'ramen', name: 'Spicy ramen', quantity: 1, amount: 78_000, participantIds: ['ani'] },
    { id: 'bento', name: 'Chicken bento', quantity: 1, amount: 72_000, participantIds: ['budi'] },
    { id: 'gyoza', name: 'Gyoza to share', quantity: 2, amount: 50_000, participantIds: ['me', 'ani', 'budi'] },
  ],
  charges: { tax: 29_500, service: 14_750, discount: 0, tip: 0, taxRule: 'proportional', serviceRule: 'proportional', discountRule: 'proportional', tipRule: 'proportional' },
  payerId: 'me',
};

/** The real split-bill card Agent shows, with a sample receipt to play with: reassign items, change the split, add a guest. */
export function PracticeSplitBill() {
  return (
    <figure className="not-prose my-6">
      <div className="rounded-2xl border border-dashed border-[var(--color-accent)]/40 bg-[color-mix(in_srgb,var(--color-accent)_5%,transparent)] p-3 sm:p-5">
        <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-[var(--ref-on-surface-variant)]"><MousePointerClick className="h-3.5 w-3.5 text-[var(--color-accent)]" aria-hidden />The real card from Agent, with a sample receipt. Try changing who had what, or the split mode.</p>
        {/* .agent-viz-card sets its own margin outside the utility layer, so centring happens here. */}
        <div className="mx-auto w-full max-w-xl"><SplitBillCard visualization={SAMPLE_SPLIT} currentUserName="You" /></div>
      </div>
      <figcaption className="mt-2 text-center text-xs text-[var(--ref-on-surface-variant)]">Nothing here is saved. Amounts follow your hide-balances setting.</figcaption>
    </figure>
  );
}

function OpenPractice({ onClose }: { onClose: () => void }) {
  const appClient = useQueryClient();
  const accountsQuery = useAccountsQuery();
  const categoriesQuery = useCategoriesQuery();
  const tagsQuery = useTagsQuery();
  // Loaded on the app's client so the practice composer can answer these from cache, never the network.
  usePaylaterQuery();
  useTransportRouteTemplatesQuery();
  const [practiceClient] = useState(() => createPracticeQueryClient(appClient));

  return (
    <QueryClientProvider client={practiceClient}>
      <PracticeModeContext.Provider value>
        <TransactionModal
          isOpen
          onClose={onClose}
          onSaved={onClose}
          accounts={(accountsQuery.data ?? []) as WalletAccount[]}
          categories={categoriesQuery.data ?? []}
          tags={tagsQuery.data ?? []}
          editingTransaction={null}
          periodId={null}
        />
      </PracticeModeContext.Provider>
    </QueryClientProvider>
  );
}
