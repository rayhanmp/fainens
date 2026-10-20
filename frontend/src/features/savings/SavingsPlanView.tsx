import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { toast } from '../../components/ui/useToast';
import { Section } from '../subscriptions/PageParts';
import { EventDialog, GoalDialog, NameDialog } from './dialogs';
import { GoalsPanel, type GoalSuggestion } from './GoalsPanel';
import { DEFAULT_PLAN, DEFAULT_POT, goalOutlooks, MAX_POTS, newId, normalizePlan, planRange, runPlan, samePlan, type PlanEvent, type PlanGoal, type PlanInputs, type PlanPot } from './plan';
import type { PotTemplate } from './pots';
import { PlanPanel } from './PlanPanel';
import { ProjectionChart, type ValueMode } from './ProjectionChart';
import { SavedPlansPanel, MAX_COMPARED } from './SavedPlansPanel';
import { SavingsHero } from './SavingsHero';
import {
  useCreateSavingsPlanMutation,
  useDeleteSavingsPlanMutation,
  useLedgerFacts,
  useSavingsPlansQuery,
  useUpdateSavingsPlanMutation,
  type LedgerFacts,
  type SavedPlan,
} from './queries';

const DRAFT_KEY = 'savings-simulator:draft';

type Stored = { inputs: PlanInputs | null; openId: number | null; mode: ValueMode; compared: number[] };

/** The plan on screen survives a reload in this browser; saved plans live in the database. */
function readStored(): Stored {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    const value = raw ? JSON.parse(raw) : null;
    if (!value || typeof value !== 'object') return { inputs: null, openId: null, mode: 'nominal', compared: [] };
    return {
      inputs: value.inputs ? normalizePlan(value.inputs) : null,
      openId: Number.isInteger(value.openId) ? value.openId : null,
      mode: value.mode === 'real' ? 'real' : 'nominal',
      compared: Array.isArray(value.compared) ? value.compared.filter(Number.isInteger).slice(0, MAX_COMPARED) : [],
    };
  } catch {
    return { inputs: null, openId: null, mode: 'nominal', compared: [] };
  }
}

/** A first plan from the ledger: one pot holding what you have now, fed by what you've been saving. */
function planFromLedger(ledger: LedgerFacts): PlanInputs {
  return {
    ...DEFAULT_PLAN,
    pots: [{
      ...DEFAULT_POT,
      start: Math.max(0, Math.round(ledger.liquid ?? 0)),
      monthly: ledger.saving && ledger.saving.average > 0 ? Math.round(ledger.saving.average / 10_000) * 10_000 : 0,
    }],
  };
}

export function SavingsPlanView() {
  const { confirm } = useConfirm();
  const [now] = useState(() => Date.now());
  const ledger = useLedgerFacts(now);
  const plansQuery = useSavingsPlansQuery();
  const createPlan = useCreateSavingsPlanMutation();
  const updatePlan = useUpdateSavingsPlanMutation();
  const deletePlan = useDeleteSavingsPlanMutation();
  const [stored] = useState(readStored);
  // Until the first edit the plan follows the ledger, so a first visit starts from real figures.
  const [draft, setDraft] = useState<PlanInputs | null>(stored.inputs);
  const [openId, setOpenId] = useState<number | null>(stored.openId);
  const [mode, setMode] = useState<ValueMode>(stored.mode);
  const [comparedIds, setComparedIds] = useState<number[]>(stored.compared);
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const [editingEvent, setEditingEvent] = useState<PlanEvent | 'new' | null>(null);
  const [editingGoal, setEditingGoal] = useState<PlanGoal | 'new' | null>(null);
  const [naming, setNaming] = useState<{ kind: 'save' | 'rename'; plan?: SavedPlan } | null>(null);

  const [selectedPotInput, setSelectedPotId] = useState<string | null>(null);

  const inputs = draft ?? planFromLedger(ledger);
  // The pot open in the panel; falls back to the first when the chosen one is gone.
  const selectedPot = inputs.pots.find((pot) => pot.id === selectedPotInput) ?? inputs.pots[0]!;
  const plans = useMemo(() => plansQuery.data ?? [], [plansQuery.data]);
  const openPlan = plans.find((plan) => plan.id === openId) ?? null;
  const dirty = openPlan !== null && !samePlan(openPlan.inputs, inputs);

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ inputs: draft, openId, mode, compared: comparedIds }));
    } catch { /* storage unavailable: the plan just won't survive a reload */ }
  }, [draft, openId, mode, comparedIds]);

  // Escape lets go of the goal marked on the chart (dialogs handle their own Escape).
  const dialogOpen = editingEvent !== null || editingGoal !== null || naming !== null;
  useEffect(() => {
    if (selectedGoalId === null || dialogOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setSelectedGoalId(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedGoalId, dialogOpen]);

  const run = useMemo(() => runPlan(inputs), [inputs]);
  const range = useMemo(() => planRange(inputs), [inputs]);
  const outlooks = useMemo(() => goalOutlooks(inputs, range), [inputs, range]);
  const compared = useMemo(
    () => plans.filter((plan) => comparedIds.includes(plan.id) && plan.id !== openId).map((plan) => ({ id: plan.id, name: plan.name, run: runPlan(plan.inputs, inputs.years * 12) })),
    [plans, comparedIds, openId, inputs.years],
  );

  const change = (patch: Partial<PlanInputs>) => setDraft({ ...inputs, ...patch });
  const changePot = (id: string, patch: Partial<PlanPot>) => change({ pots: inputs.pots.map((pot) => (pot.id === id ? { ...pot, ...patch } : pot)) });

  const addPot = (template: PotTemplate | null) => {
    if (inputs.pots.length >= MAX_POTS) return;
    const pot: PlanPot = { ...DEFAULT_POT, id: newId(), name: template?.name ?? `Pot ${inputs.pots.length + 1}`, returnRate: template?.returnRate ?? DEFAULT_POT.returnRate, uncertainty: template?.uncertainty ?? 'off' };
    change({ pots: [...inputs.pots, pot] });
    setSelectedPotId(pot.id);
  };

  // A removed pot's goals and money in and out move to the first remaining pot rather than vanish.
  const removePot = async (pot: PlanPot) => {
    const into = inputs.pots.find((item) => item.id !== pot.id)!;
    const moved = inputs.goals.filter((goal) => goal.potId === pot.id).length + inputs.events.filter((event) => event.potId === pot.id).length;
    const ok = await confirm({
      title: `Remove “${pot.name}”?`,
      message: `Its amounts are dropped from the plan.${moved ? ` Its ${moved} goal${moved === 1 ? '' : 's'} and money in or out move to “${into.name}”.` : ''}`,
      confirmLabel: 'Remove',
      variant: 'danger',
    });
    if (!ok) return;
    change({
      pots: inputs.pots.filter((item) => item.id !== pot.id),
      goals: inputs.goals.map((goal) => (goal.potId === pot.id ? { ...goal, potId: into.id } : goal)),
      events: inputs.events.map((event) => (event.potId === pot.id ? { ...event, potId: into.id } : event)),
    });
    setSelectedPotId(into.id);
  };

  const suggestions = useMemo<GoalSuggestion[]>(() => {
    const taken = new Set(inputs.goals.map((goal) => goal.id));
    const list: GoalSuggestion[] = [];
    if (ledger.saving && ledger.saving.averageSpending > 0 && !taken.has('emergency-fund')) {
      list.push({ key: 'emergency-fund', name: 'Emergency fund', amount: Math.round((ledger.saving.averageSpending * 6) / 100_000) * 100_000, byMonth: 12, spend: false, source: 'Six months of your spending, kept saved' });
    }
    for (const item of ledger.wishlist) {
      if (list.length >= 4) break;
      if (!taken.has(`wishlist-${item.id}`)) list.push({ key: `wishlist-${item.id}`, name: item.name, amount: item.amount, byMonth: item.byMonth, spend: true, source: 'From your wishlist' });
    }
    return inputs.goals.length >= 20 ? [] : list;
  }, [inputs.goals, ledger.saving, ledger.wishlist]);

  const saveAs = async (name: string) => {
    try {
      const created = await createPlan.mutateAsync({ name, inputs });
      setDraft(inputs);
      setOpenId(created.id);
      setNaming(null);
      toast.success(`Saved “${created.name}”.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save the plan');
    }
  };

  const saveChanges = async () => {
    if (!openPlan) return;
    try {
      await updatePlan.mutateAsync({ id: openPlan.id, inputs });
      toast.success(`Saved changes to “${openPlan.name}”.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save the plan');
    }
  };

  const rename = async (plan: SavedPlan, name: string) => {
    try {
      await updatePlan.mutateAsync({ id: plan.id, name });
      setNaming(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not rename the plan');
    }
  };

  const remove = async (plan: SavedPlan) => {
    const ok = await confirm({ title: `Delete “${plan.name}”?`, message: 'The saved plan is removed. The plan on screen stays as it is.', confirmLabel: 'Delete', variant: 'danger' });
    if (!ok) return;
    try {
      await deletePlan.mutateAsync(plan.id);
      if (plan.id === openId) setOpenId(null);
      setComparedIds((ids) => ids.filter((id) => id !== plan.id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete the plan');
    }
  };

  const open = async (plan: SavedPlan) => {
    if (dirty || (openPlan === null && draft !== null && !plans.some((saved) => samePlan(saved.inputs, inputs)))) {
      const ok = await confirm({ title: `Open “${plan.name}”?`, message: 'The plan on screen has changes that aren’t saved. Opening another plan replaces them.', confirmLabel: 'Open' });
      if (!ok) return;
    }
    setDraft(plan.inputs);
    setSelectedPotId(null);
    setOpenId(plan.id);
    setComparedIds((ids) => ids.filter((id) => id !== plan.id));
    setSelectedGoalId(null);
  };

  const startNew = () => {
    setDraft(null);
    setOpenId(null);
    setSelectedGoalId(null);
  };

  const saveGoal = (goal: PlanGoal) => {
    const exists = inputs.goals.some((item) => item.id === goal.id);
    change({ goals: exists ? inputs.goals.map((item) => (item.id === goal.id ? goal : item)) : [...inputs.goals, goal] });
    setEditingGoal(null);
    setSelectedGoalId(goal.id);
  };

  const saveEvent = (event: PlanEvent) => {
    const exists = inputs.events.some((item) => item.id === event.id);
    change({ events: (exists ? inputs.events.map((item) => (item.id === event.id ? event : item)) : [...inputs.events, event]).sort((a, b) => a.month - b.month) });
    setEditingEvent(null);
  };

  const planAside = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {openPlan && <span className="max-w-[10rem] truncate text-xs text-[var(--ref-on-surface-variant)]" title={openPlan.name}>{openPlan.name}{dirty ? ' · edited' : ''}</span>}
      {openPlan && dirty && <Button type="button" size="sm" className="h-[34px]" isLoading={updatePlan.isPending} onClick={() => void saveChanges()}>Save changes</Button>}
      <Button type="button" size="sm" variant={openPlan && dirty ? 'secondary' : openPlan ? 'secondary' : 'primary'} className="h-[34px]" onClick={() => setNaming({ kind: 'save' })}>
        {openPlan ? 'Save as new' : 'Save plan'}
      </Button>
    </div>
  );

  const editingGoalValue = editingGoal === 'new' ? null : editingGoal;
  const editingEventValue = editingEvent === 'new' ? null : editingEvent;

  return (
    <>
      <SavingsHero inputs={inputs} run={run} range={range} outlooks={outlooks} mode={mode} onMode={setMode} ledger={ledger} pot={selectedPot} onUse={(field, value) => changePot(selectedPot.id, { [field]: value })} />

      {/* Side by side only when the chart keeps a useful width; below that the plan's fields go two-up. */}
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(320px,380px)_minmax(0,1fr)]">
        <PlanPanel
          inputs={inputs}
          selectedPotId={selectedPot.id}
          onSelectPot={setSelectedPotId}
          onChange={change}
          onChangePot={changePot}
          onAddPot={addPot}
          onRemovePot={(pot) => void removePot(pot)}
          aside={planAside}
          onAddEvent={() => setEditingEvent('new')}
          onEditEvent={setEditingEvent}
          onRemoveEvent={(event) => change({ events: inputs.events.filter((item) => item.id !== event.id) })}
        />

        <div className="min-w-0 space-y-6">
          <Section title="How it grows">
            <div className="px-3 pb-3 pt-3 sm:px-5 sm:pb-4">
              <ProjectionChart run={run} range={range} mode={mode} years={inputs.years} compared={compared} outlooks={outlooks} selectedGoalId={selectedGoalId} events={inputs.events} />
            </div>
          </Section>

          <GoalsPanel
            outlooks={outlooks}
            pots={inputs.pots}
            selectedId={selectedGoalId}
            onSelect={setSelectedGoalId}
            onAdd={() => setEditingGoal('new')}
            onEdit={setEditingGoal}
            onRemove={(goal) => {
              change({ goals: inputs.goals.filter((item) => item.id !== goal.id) });
              if (selectedGoalId === goal.id) setSelectedGoalId(null);
            }}
            onUseMonthly={(goal, monthly) => changePot(goal.potId, { monthly })}
            suggestions={suggestions}
            onAddSuggestion={(suggestion) => saveGoal({ id: suggestion.key, name: suggestion.name.slice(0, 80), amount: suggestion.amount, byMonth: suggestion.byMonth, potId: selectedPot.id, spend: suggestion.spend })}
          />

          <SavedPlansPanel
            plans={plans}
            loading={plansQuery.isPending && !plansQuery.data}
            error={plansQuery.error ? (plansQuery.error instanceof Error ? plansQuery.error.message : 'Could not load saved plans') : null}
            onRetry={() => void plansQuery.refetch()}
            current={run}
            mode={mode}
            openId={openId}
            comparedIds={comparedIds}
            onToggleCompare={(id) => setComparedIds((ids) => (ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id].slice(-MAX_COMPARED)))}
            onOpen={(plan) => void open(plan)}
            onRename={(plan) => setNaming({ kind: 'rename', plan })}
            onDelete={(plan) => void remove(plan)}
            onNew={startNew}
          />
        </div>
      </div>

      {editingEvent && <EventDialog event={editingEventValue} pots={inputs.pots} defaultPotId={selectedPot.id} onClose={() => setEditingEvent(null)} onSave={saveEvent} />}
      {editingGoal && <GoalDialog goal={editingGoalValue} pots={inputs.pots} defaultPotId={selectedPot.id} onClose={() => setEditingGoal(null)} onSave={saveGoal} />}
      {naming?.kind === 'save' && <NameDialog title="Save plan" initial="" submitLabel="Save" busy={createPlan.isPending} onClose={() => setNaming(null)} onSave={(name) => void saveAs(name)} />}
      {naming?.kind === 'rename' && naming.plan && <NameDialog title="Rename plan" initial={naming.plan.name} submitLabel="Rename" busy={updatePlan.isPending} onClose={() => setNaming(null)} onSave={(name) => void rename(naming.plan!, name)} />}
    </>
  );
}
