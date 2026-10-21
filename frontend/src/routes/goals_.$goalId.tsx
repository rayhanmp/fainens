import { Link, createFileRoute } from '@tanstack/react-router';
import { AlertCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useConfirm } from '../components/ui/ConfirmDialog';
import { PageContainer } from '../components/ui/PageContainer';
import { toast } from '../components/ui/useToast';
import { useBalanceVisibility } from '../hooks/useBalanceVisibility';
import { coloredGoals, GOAL_COLORS } from '../features/goals/colors';
import { Celebration } from '../features/goals/detail/Celebration';
import { DetailsPanel } from '../features/goals/detail/DetailsPanel';
import { FilesSection } from '../features/goals/detail/FilesSection';
import { GoalPageHero } from '../features/goals/detail/GoalPageHero';
import { GrowthChart } from '../features/goals/detail/GrowthChart';
import { PartsSection } from '../features/goals/detail/PartsSection';
import { CompleteGoalDialog, GoalDialog, MoveMoneyDialog, PayFromGoalDialog, type GoalDraft } from '../features/goals/dialogs';
import { GoalNotes } from '../features/goals/GoalNotes';
import {
  useAllocateMutation,
  useCompleteGoalMutation,
  useDeleteGoalMutation,
  useGoalQuery,
  useGoalsQuery,
  useSpendFromGoalMutation,
  useUpdateGoalMutation,
} from '../features/goals/queries';
import { RequireAuth } from '../lib/auth';

export const Route = createFileRoute('/goals_/$goalId')({
  component: GoalPage,
});

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);
const QUARTERS = [25, 50, 75, 100] as const;
const quarterOf = (held: number, target: number) => (target > 0 ? QUARTERS.filter((share) => held >= (target * share) / 100).at(-1) ?? 0 : 0);

function GoalPage() {
  const { goalId } = Route.useParams();
  const id = Number(goalId);
  const navigate = Route.useNavigate();
  const { confirm } = useConfirm();
  const { formatAmount } = useBalanceVisibility();
  const query = useGoalQuery(id);
  const overviewQuery = useGoalsQuery();
  const allocate = useAllocateMutation();
  const spend = useSpendFromGoalMutation();
  const complete = useCompleteGoalMutation();
  const update = useUpdateGoalMutation();
  const saveNotes = useUpdateGoalMutation();
  const remove = useDeleteGoalMutation();
  const [moving, setMoving] = useState<'in' | 'out' | null>(null);
  const [paying, setPaying] = useState<{ partId: number | null } | null>(null);
  const [completing, setCompleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [celebrate, setCelebrate] = useState<{ share: 25 | 50 | 75 | 100; seed: number } | null>(null);

  const detail = query.data;
  const overview = overviewQuery.data;
  const goal = detail?.goal;
  const color = coloredGoals(overview?.goals ?? []).find((item) => item.goal.id === id)?.color ?? GOAL_COLORS[0];

  // Putting money in that reaches a new quarter of the target is celebrated.
  const celebrateIfReached = (before: number, after: { setAside: number; targetAmount: number }) => {
    const quarter = quarterOf(after.setAside, after.targetAmount);
    if (quarter > quarterOf(before, after.targetAmount)) setCelebrate({ share: quarter as 25 | 50 | 75 | 100, seed: Date.now() % 997 });
  };
  useEffect(() => {
    if (!celebrate) return;
    const timer = window.setTimeout(() => setCelebrate(null), 2800);
    return () => window.clearTimeout(timer);
  }, [celebrate]);

  useEffect(() => {
    if (goal) document.title = `${goal.name} · Goals · Fainens`;
  }, [goal]);

  if (query.error && !detail) {
    return (
      <RequireAuth>
        <PageContainer className="px-4 pt-6 sm:px-6 lg:px-8">
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/5 px-4 py-3 text-sm text-[var(--color-danger)]">
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
            <span className="flex-1">{errorText(query.error, 'We couldn’t load this goal.')}</span>
            <Link to="/goals" className="font-semibold underline">Back to Goals</Link>
          </div>
        </PageContainer>
      </RequireAuth>
    );
  }

  return (
    <RequireAuth>
      <PageContainer className="px-4 pt-6 sm:px-6 lg:px-8">
        {!detail || !goal || !overview ? (
          <div className="h-[360px] animate-pulse rounded-3xl bg-[var(--color-accent)]/25" aria-label="Loading the goal" />
        ) : (
          <>
            <div className="relative">
              <GoalPageHero
                detail={detail}
                color={color}
                pausing={update.isPending}
                onPutIn={() => setMoving('in')}
                onTakeOut={() => setMoving('out')}
                onPay={() => setPaying({ partId: null })}
                onBought={() => setCompleting(true)}
                onEdit={() => setEditing(true)}
                onPause={() => update.mutate({ id, paused: !goal.paused }, {
                  onSuccess: () => toast.success(goal.paused ? `${goal.name} gets its monthly amount again.` : `${goal.name} is paused: its money stays, nothing goes in each month.`),
                  onError: (error) => toast.error(errorText(error, 'Could not save')),
                })}
              />
              {celebrate && <Celebration share={celebrate.share} name={goal.name} seed={celebrate.seed} />}
            </div>

            <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
              <div className="min-w-0 space-y-6">
                <GrowthChart detail={detail} color={color} />
                {/* Its own save, so typing never holds up the buttons above; the notes say when they're saved. */}
                <GoalNotes key={id} value={goal.description} onSave={async (next) => { await saveNotes.mutateAsync({ id, description: next }); }} />
                <PartsSection detail={detail} onPay={(part) => setPaying({ partId: part.id })} />
                <FilesSection detail={detail} />
              </div>
              <DetailsPanel detail={detail} overview={overview} />
            </div>

            {moving && (
              <MoveMoneyDialog
                goal={goal}
                unassigned={overview.unassigned}
                initialDirection={moving}
                busy={allocate.isPending}
                onClose={() => setMoving(null)}
                onSave={async (amount, note) => {
                  try {
                    const updated = await allocate.mutateAsync({ id, amount, note });
                    setMoving(null);
                    celebrateIfReached(goal.setAside, updated);
                  } catch (error) {
                    toast.error(errorText(error, 'Could not move the money'));
                  }
                }}
              />
            )}
            {paying && (
              <PayFromGoalDialog
                goal={goal}
                parts={detail.parts}
                initialPartId={paying.partId}
                busy={spend.isPending}
                onClose={() => setPaying(null)}
                onSave={async (input) => {
                  try {
                    await spend.mutateAsync({ id, ...input });
                    toast.success(`Paid ${formatAmount(input.amount)} from ${goal.name}.`);
                    setPaying(null);
                  } catch (error) {
                    toast.error(errorText(error, 'Could not pay from the goal'));
                  }
                }}
              />
            )}
            {completing && (
              <CompleteGoalDialog
                goal={goal}
                busy={complete.isPending}
                onClose={() => setCompleting(false)}
                onSave={async (transactionId) => {
                  try {
                    await complete.mutateAsync({ id, transactionId });
                    toast.success(goal.recurrence === 'yearly' ? `${goal.name} is paid for this year; it starts again for next year.` : `${goal.name} is done.`);
                    setCompleting(false);
                  } catch (error) {
                    toast.error(errorText(error, 'Could not finish the goal'));
                  }
                }}
              />
            )}
            {editing && (
              <GoalDialog
                goal={goal}
                unassigned={overview.unassigned}
                salary={overview.salary}
                busy={update.isPending}
                onClose={() => setEditing(false)}
                onSave={async (draft: GoalDraft) => {
                  // Money moves through Put money in, not the edit form.
                  const rest = Object.fromEntries(Object.entries(draft).filter(([key]) => key !== 'setAside')) as Omit<GoalDraft, 'setAside'>;
                  try {
                    await update.mutateAsync({ id, ...rest });
                    setEditing(false);
                  } catch (error) {
                    toast.error(errorText(error, 'Could not save the goal'));
                  }
                }}
                onArchive={async () => {
                  const ok = await confirm({ title: `Archive ${goal.name}?`, message: goal.setAside ? `Its ${formatAmount(goal.setAside)} goes back to your free money. You can reopen it later.` : 'You can reopen it later.', confirmLabel: 'Archive' });
                  if (!ok) return;
                  await update.mutateAsync({ id, status: 'archived' }).catch((error) => toast.error(errorText(error, 'Could not archive')));
                  setEditing(false);
                }}
                onDelete={async () => {
                  const ok = await confirm({ title: `Delete ${goal.name}?`, message: 'The goal, its notes, files and history are removed; its money goes back to your free money.', confirmLabel: 'Delete', variant: 'danger' });
                  if (!ok) return;
                  try {
                    await remove.mutateAsync(id);
                    void navigate({ to: '/goals' });
                  } catch (error) {
                    toast.error(errorText(error, 'Could not delete'));
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
