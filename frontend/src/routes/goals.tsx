import { createFileRoute } from '@tanstack/react-router';
import { AlertCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '../components/ui/Button';
import { useConfirm } from '../components/ui/ConfirmDialog';
import { PageContainer } from '../components/ui/PageContainer';
import { PageHeader } from '../components/ui/PageHeader';
import { toast } from '../components/ui/useToast';
import { useBalanceVisibility } from '../hooks/useBalanceVisibility';
import { CompleteGoalDialog, GoalDialog, MoveMoneyDialog, type GoalDraft } from '../features/goals/dialogs';
import { GoalList } from '../features/goals/GoalList';
import { GoalsHero, type GoalStarter } from '../features/goals/GoalsHero';
import { ReachPanel, ThisMonthPanel } from '../features/goals/GoalsSidePanels';
import { AccountsDialog } from '../features/goals/AccountsDialog';
import { usePeriodSummariesQuery } from '../features/analytics/queries';
import { compactRupiah, recentSaving } from '../features/savings/plan';
import { useWishlistQuery } from '../features/wishlist/queries';
import {
  useAllocateMutation,
  useCompleteGoalMutation,
  useCreateGoalMutation,
  useDeleteGoalMutation,
  useFundMonthlyMutation,
  useReorderGoalsMutation,
  useGoalSettingsMutation,
  useGoalsQuery,
  useReopenGoalMutation,
  useUpdateGoalMutation,
  type Goal,
} from '../features/goals/queries';
import { RequireAuth } from '../lib/auth';

type GoalsSearch = { wishlistId?: number; name?: string; amount?: number; byDate?: number };

export const Route = createFileRoute('/goals')({
  component: GoalsPage,
  // The wishlist opens this page with an item to save for.
  validateSearch: (search: Record<string, unknown>): GoalsSearch => ({
    wishlistId: Number(search.wishlistId) || undefined,
    name: typeof search.name === 'string' ? search.name.slice(0, 120) : undefined,
    amount: Number(search.amount) || undefined,
    byDate: Number(search.byDate) || undefined,
  }),
});

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

function GoalsPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { confirm } = useConfirm();
  const { formatAmount } = useBalanceVisibility();
  const query = useGoalsQuery();
  const createGoal = useCreateGoalMutation();
  const updateGoal = useUpdateGoalMutation();
  const deleteGoal = useDeleteGoalMutation();
  const allocate = useAllocateMutation();
  const completeGoal = useCompleteGoalMutation();
  const reopenGoal = useReopenGoalMutation();
  const fundMonthly = useFundMonthlyMutation();
  const settings = useGoalSettingsMutation();
  const reorder = useReorderGoalsMutation();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editing, setEditing] = useState<Goal | 'new' | null>(search.wishlistId ? 'new' : null);
  const [moving, setMoving] = useState<Goal | null>(null);
  const [completing, setCompleting] = useState<Goal | null>(null);
  const [choosingAccounts, setChoosingAccounts] = useState(false);
  // A new goal's starting values: from the wishlist link, or a starter in the hero.
  const [initial, setInitial] = useState<Partial<GoalDraft> | undefined>(
    search.wishlistId ? { name: search.name, targetAmount: search.amount, byDate: search.byDate ?? null, kind: 'spend', wishlistId: search.wishlistId } : undefined,
  );
  const [now] = useState(() => Date.now());
  const summaries = usePeriodSummariesQuery();
  const wishlist = useWishlistQuery();

  const overview = query.data;
  // Six months of what you spend, to the nearest Rp1 juta: the emergency fund's suggested size.
  const emergency = useMemo(() => Math.round(((recentSaving(summaries.data ?? [], now)?.averageSpending ?? 0) * 6) / 1_000_000) * 1_000_000, [summaries.data, now]);
  const starters = useMemo<GoalStarter[]>(() => {
    const list: GoalStarter[] = [];
    if (!overview?.goals.some((goal) => goal.name.trim().toLowerCase() === 'emergency fund')) {
      list.push({ key: 'emergency', label: 'Emergency fund', detail: emergency > 0 ? `6× spending, ${compactRupiah(emergency)}` : undefined, draft: { name: 'Emergency fund', icon: '🛟', kind: 'keep', targetAmount: emergency || undefined } });
    }
    const linked = new Set(overview?.goals.map((goal) => goal.wishlistId) ?? []);
    for (const item of wishlist.data?.items ?? []) {
      if (list.length >= 3) break;
      if (item.status !== 'active' || item.amount <= 0 || linked.has(item.id)) continue;
      list.push({ key: `wishlist-${item.id}`, label: item.name, detail: compactRupiah(item.amount), draft: { name: item.name.slice(0, 80), icon: '🛍️', targetAmount: item.amount, kind: 'spend', wishlistId: item.id, byDate: item.period ? Number(item.period.endDate) : null } });
    }
    return list;
  }, [emergency, wishlist.data, overview?.goals]);
  const addGoal = (draft?: Partial<GoalDraft>) => {
    setInitial(draft);
    setEditing('new');
  };
  const closeEditor = () => {
    setEditing(null);
    setInitial(undefined);
    if (search.wishlistId) void navigate({ search: {} });
  };

  const saveGoal = async (draft: GoalDraft) => {
    try {
      if (editing && editing !== 'new') {
        // Money moves through Put money in, not the edit form.
        const rest = Object.fromEntries(Object.entries(draft).filter(([key]) => key !== 'setAside')) as Omit<GoalDraft, 'setAside'>;
        await updateGoal.mutateAsync({ id: editing.id, ...rest });
        toast.success(`Saved ${draft.name}.`);
      } else {
        const created = await createGoal.mutateAsync({ ...draft, setAside: draft.setAside || undefined });
        setSelectedId(created.id);
        toast.success(`Added ${draft.name}.`);
      }
      closeEditor();
    } catch (error) {
      toast.error(errorText(error, 'Could not save the goal'));
    }
  };

  const select = (id: number | null) => {
    setSelectedId(id);
    if (id !== null) requestAnimationFrame(() => document.getElementById(`goal-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  };

  return (
    <RequireAuth>
      <PageContainer className="px-4 pt-6 sm:px-6 lg:px-8">
        <PageHeader subtext="Planning" title="Goals" description="Split the money you have into goals. Each goal is its own pot; what’s left is free." />

        {query.error && (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/5 px-4 py-3 text-sm text-[var(--color-danger)]">
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
            <span className="flex-1">{errorText(query.error, 'We couldn’t load your goals.')}</span>
            <Button type="button" size="sm" variant="secondary" onClick={() => void query.refetch()}>Retry</Button>
          </div>
        )}

        {!overview ? (
          <div className="h-[340px] animate-pulse rounded-3xl bg-[var(--color-accent)]/25" aria-label="Loading goals" />
        ) : (
          <>
            <GoalsHero
              overview={overview}
              selectedId={selectedId}
              onSelect={select}
              onAdd={addGoal}
              onAccounts={() => setChoosingAccounts(true)}
              starters={starters}
            />

            {/* The goals, once there are any, with this month's plan and when each gets there beside them. */}
            {overview.goals.length > 0 && (
              <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
                <GoalList
                  overview={overview}
                  selectedId={selectedId}
                  onReorder={(ids) => reorder.mutate(ids, { onError: (error) => toast.error(errorText(error, "Could not change the order")) })}
                  onMove={setMoving}
                  onComplete={setCompleting}
                  onEdit={setEditing}
                  onReopen={async (goal) => {
                    try {
                      await (goal.status === 'archived' ? updateGoal.mutateAsync({ id: goal.id, status: 'active' }) : reopenGoal.mutateAsync(goal.id));
                    } catch (error) {
                      toast.error(errorText(error, 'Could not reopen the goal'));
                    }
                  }}
                />
                {overview.goals.some((goal) => goal.status === 'active') && (
                  <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2 xl:grid-cols-1">
                    <ThisMonthPanel
                      overview={overview}
                      funding={fundMonthly.isPending}
                      savingAuto={settings.isPending}
                      onAutoFund={(on) => settings.mutate({ autoFundOnPayday: on }, {
                        onSuccess: () => toast.success(on ? 'Goals get their monthly amounts when your salary posts.' : 'Payday no longer puts money into goals.'),
                        onError: (error) => toast.error(errorText(error, 'Could not save')),
                      })}
                      onFund={async () => {
                        try {
                          const result = await fundMonthly.mutateAsync(null);
                          toast.success(result.total > 0 ? `Put ${formatAmount(result.total)} into ${result.assigned.length} goal${result.assigned.length === 1 ? '' : 's'}.` : 'Nothing to put in: goals are full or nothing is free.');
                        } catch (error) {
                          toast.error(errorText(error, 'Could not put the money in'));
                        }
                      }}
                    />
                    <ReachPanel overview={overview} />
                  </div>
                )}
              </div>
            )}
            {choosingAccounts && (
              <AccountsDialog
                overview={overview}
                busy={settings.isPending}
                onClose={() => setChoosingAccounts(false)}
                onToggle={async (accountId, included) => {
                  const excluded = overview.accounts.filter((account) => !account.included).map((account) => account.id);
                  try {
                    await settings.mutateAsync({ excludedAccountIds: included ? excluded.filter((id) => id !== accountId) : [...excluded, accountId] });
                  } catch (error) {
                    toast.error(errorText(error, 'Could not save'));
                  }
                }}
              />
            )}

            {editing && (
              <GoalDialog
                goal={editing === 'new' ? null : editing}
                initial={editing === 'new' ? initial : undefined}
                unassigned={overview.unassigned}
                salary={overview.salary}
                emergencyAmount={emergency}
                busy={createGoal.isPending || updateGoal.isPending}
                onClose={closeEditor}
                onSave={(draft) => void saveGoal(draft)}
                onArchive={editing !== 'new' ? async () => {
                  const ok = await confirm({ title: `Archive ${editing.name}?`, message: editing.setAside ? `Its ${formatAmount(editing.setAside)} goes back to your free money. You can reopen it later.` : 'You can reopen it later.', confirmLabel: 'Archive' });
                  if (!ok) return;
                  await updateGoal.mutateAsync({ id: editing.id, status: 'archived' }).catch((error) => toast.error(errorText(error, 'Could not archive')));
                  closeEditor();
                } : undefined}
                onDelete={editing !== 'new' ? async () => {
                  const ok = await confirm({ title: `Delete ${editing.name}?`, message: 'The goal and its history are removed; its money goes back to your free money.', confirmLabel: 'Delete', variant: 'danger' });
                  if (!ok) return;
                  await deleteGoal.mutateAsync(editing.id).catch((error) => toast.error(errorText(error, 'Could not delete')));
                  closeEditor();
                } : undefined}
              />
            )}
            {moving && (
              <MoveMoneyDialog
                goal={moving}
                unassigned={overview.unassigned}
                busy={allocate.isPending}
                onClose={() => setMoving(null)}
                onSave={async (amount, note) => {
                  try {
                    await allocate.mutateAsync({ id: moving.id, amount, note });
                    setMoving(null);
                  } catch (error) {
                    toast.error(errorText(error, 'Could not move the money'));
                  }
                }}
              />
            )}
            {completing && (
              <CompleteGoalDialog
                goal={completing}
                busy={completeGoal.isPending}
                onClose={() => setCompleting(null)}
                onSave={async (transactionId) => {
                  try {
                    await completeGoal.mutateAsync({ id: completing.id, transactionId });
                    toast.success(`${completing.name} is done.`);
                    setCompleting(null);
                  } catch (error) {
                    toast.error(errorText(error, 'Could not finish the goal'));
                  }
                }}
              />
            )}
          </>
        )}
      </PageContainer>
    </RequireAuth>
  );
}
