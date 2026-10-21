import { useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { toast } from '../../../components/ui/useToast';
import { useBalanceVisibility } from '../../../hooks/useBalanceVisibility';
import { useAddPartMutation, usePreviewLinkMutation, useUpdateGoalMutation, useUpdatePartMutation, type GoalDetail, type GoalsOverview } from '../queries';
import { EducationPanel } from './EducationPanel';
import { EmergencyPanel } from './EmergencyPanel';
import { GadgetPanel } from './GadgetPanel';
import { HousePanel } from './HousePanel';
import { UmrahPanel } from './UmrahPanel';
import { useTypeDataSaver } from './useTypeData';
import { WeddingPanel } from './WeddingPanel';
import { YearlyPanel } from './YearlyPanel';
import {
  emergencyData,
  gadgetData,
  gadgetTarget,
  houseCosts,
  houseData,
  umrahData,
  umrahTotal,
  weddingData,
  weddingTotal,
  type GadgetData,
  type GadgetOption,
  type HouseData,
  type UmrahData,
  type WeddingData,
} from './type-math';

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);
type Props = { detail: GoalDetail; overview: GoalsOverview; spending: number | null; now: number; color: string; onPutIn: (note: string) => void };

/** Adds the parts missing from the breakdown and re-prices the unpaid ones of the same name. */
function useFillParts(detail: GoalDetail) {
  const add = useAddPartMutation();
  const update = useUpdatePartMutation();
  const [busy, setBusy] = useState(false);
  const fill = async (wanted: Array<{ name: string; amount: number }>) => {
    setBusy(true);
    try {
      for (const item of wanted.filter((entry) => entry.amount > 0)) {
        const existing = detail.parts.find((part) => part.name.trim().toLowerCase() === item.name.toLowerCase());
        if (!existing) await add.mutateAsync({ id: detail.goal.id, name: item.name, amount: item.amount });
        else if (existing.paidAt === null && existing.amount !== item.amount) await update.mutateAsync({ id: existing.id, amount: item.amount });
      }
      toast.success('The breakdown is up to date.');
    } catch (error) {
      toast.error(errorText(error, 'Could not update the breakdown'));
    } finally {
      setBusy(false);
    }
  };
  return { fill, busy };
}

/** A button that makes an amount the goal's target, when it isn't already. */
function TargetButton({ detail, amount, label }: { detail: GoalDetail; amount: number; label?: string }) {
  const { formatAmount } = useBalanceVisibility();
  const update = useUpdateGoalMutation();
  if (amount <= 0 || amount === detail.goal.targetAmount) return null;
  return (
    <Button type="button" size="sm" variant="secondary" isLoading={update.isPending} onClick={() => update.mutate({ id: detail.goal.id, targetAmount: amount }, { onError: (error) => toast.error(errorText(error, 'Could not save')) })}>
      {label ?? `Make ${formatAmount(amount)} the target`}
    </Button>
  );
}

function House({ detail, overview }: Props) {
  const save = useTypeDataSaver(detail.goal.id, detail.goal.typeData);
  const { fill, busy } = useFillParts(detail);
  const [value, setValue] = useState<HouseData>(() => houseData(detail.goal.typeData));
  const costs = houseCosts(value);
  return (
    <HousePanel
      value={value}
      onChange={(patch) => { setValue((current) => ({ ...current, ...patch })); save(patch); }}
      salary={overview.salary}
      actions={(
        <>
          <TargetButton detail={detail} amount={costs.upfront} />
          <Button type="button" size="sm" variant="secondary" isLoading={busy} onClick={() => void fill([
            { name: 'Down payment', amount: costs.downPayment },
            { name: 'BPHTB', amount: costs.bphtb },
            { name: 'Notary and AJB', amount: costs.notary },
            { name: 'Bank fees and provisi', amount: costs.provisi },
            { name: 'Appraisal', amount: costs.appraisal },
          ])}>Put these in the breakdown</Button>
        </>
      )}
    />
  );
}

function Wedding({ detail }: Props) {
  const save = useTypeDataSaver(detail.goal.id, detail.goal.typeData);
  const { fill, busy } = useFillParts(detail);
  const [value, setValue] = useState<WeddingData>(() => weddingData(detail.goal.typeData));
  const totals = weddingTotal(value, detail.parts);
  return (
    <WeddingPanel
      value={value}
      onChange={(patch) => { setValue((current) => ({ ...current, ...patch })); save(patch); }}
      parts={detail.parts}
      target={detail.goal.targetAmount}
      actions={(
        <>
          {totals.catering > 0 && <Button type="button" size="sm" variant="secondary" isLoading={busy} onClick={() => void fill([{ name: 'Catering', amount: totals.catering }])}>Put catering in the breakdown</Button>}
          <TargetButton detail={detail} amount={totals.total} />
        </>
      )}
    />
  );
}

function Umrah({ detail, now }: Props) {
  const save = useTypeDataSaver(detail.goal.id, detail.goal.typeData);
  const { fill, busy } = useFillParts(detail);
  const [value, setValue] = useState<UmrahData>(() => umrahData(detail.goal.typeData));
  return (
    <UmrahPanel
      value={value}
      onChange={(patch) => { setValue((current) => ({ ...current, ...patch })); save(patch); }}
      target={detail.goal.targetAmount}
      leaves={detail.goal.byDate}
      now={now}
      actions={(
        <>
          <Button type="button" size="sm" variant="secondary" isLoading={busy} onClick={() => void fill([{ name: 'Package', amount: value.travellers * value.packagePrice }, { name: 'Spending money', amount: value.travellers * value.spending }])}>Put these in the breakdown</Button>
          <TargetButton detail={detail} amount={umrahTotal(value)} />
        </>
      )}
    />
  );
}

function Education({ detail, now }: Props) {
  const add = useAddPartMutation();
  return (
    <EducationPanel
      fees={detail.parts}
      held={detail.goal.setAside}
      now={now}
      onAddFees={async (fees) => {
        try {
          for (const fee of fees) await add.mutateAsync({ id: detail.goal.id, ...fee });
        } catch (error) {
          toast.error(errorText(error, 'Could not add the fee'));
        }
      }}
    />
  );
}

/** The picked option's first and latest price, which the goal's headline reads. */
const headlinePrices = (gadget: GadgetData) => ({ firstPrice: gadget.options[gadget.pick]?.firstPrice ?? null, linkPrice: gadget.options[gadget.pick]?.price ?? null });

function Gadget({ detail }: Props) {
  const save = useTypeDataSaver(detail.goal.id, detail.goal.typeData);
  const preview = usePreviewLinkMutation();
  const [value, setValue] = useState<GadgetData>(() => gadgetData(detail.goal.typeData));
  const [checking, setChecking] = useState(false);
  const change = (patch: Partial<GadgetData>) => setValue((current) => {
    const next = { ...current, ...patch };
    save({ ...patch, ...headlinePrices(next) });
    return next;
  });
  const read = async (url: string): Promise<Partial<GadgetOption>> => {
    const page = await preview.mutateAsync(url);
    return { title: page.title ?? null, image: page.image ?? null, ...(page.price ? { price: page.price } : {}), checkedAt: Date.now() };
  };
  const net = gadgetTarget(value);
  return (
    <GadgetPanel
      value={value}
      onChange={change}
      target={detail.goal.targetAmount}
      checking={checking}
      onAddLink={async (url) => {
        if (value.options.some((option) => option.url === url)) return;
        let found: Partial<GadgetOption> = {};
        try {
          found = await read(url);
        } catch {
          toast.error('Couldn’t read that shop’s page; type its price in.');
        }
        const option: GadgetOption = { url, title: found.title ?? null, image: found.image ?? null, price: found.price ?? null, firstPrice: found.price ?? null, checkedAt: found.checkedAt ?? null };
        change({ options: [...value.options, option] });
      }}
      onCheck={async () => {
        setChecking(true);
        const options = await Promise.all(value.options.map(async (option) => {
          try {
            return { ...option, ...(await read(option.url)), firstPrice: option.firstPrice };
          } catch {
            return option;
          }
        }));
        setChecking(false);
        change({ options });
      }}
      actions={net !== null ? <TargetButton detail={detail} amount={net} /> : undefined}
    />
  );
}

function Yearly({ detail, now, onPutIn }: Props) {
  const save = useTypeDataSaver(detail.goal.id, detail.goal.typeData);
  const update = useUpdateGoalMutation();
  const { goal } = detail;
  const data = goal.typeData;
  const [lastYear, setLastYear] = useState(typeof data.lastYear === 'number' ? data.lastYear : 0);
  const kind = goal.goalType as 'vehicle-tax' | 'insurance' | 'lebaran';
  return (
    <YearlyPanel
      kind={kind}
      lastYear={lastYear}
      lastPaidAt={typeof data.lastPaidAt === 'number' ? data.lastPaidAt : null}
      onLastYear={(value) => { setLastYear(value); save({ lastYear: value }); }}
      held={goal.setAside}
      dueAt={goal.byDate}
      now={now}
      plateUntil={typeof data.plateUntil === 'number' ? data.plateUntil : null}
      monthly={goal.monthlyAmount}
      onUseMonthly={(monthlyAmount) => update.mutate({ id: goal.id, monthlyAmount }, { onSuccess: () => toast.success('Its monthly amount is set.'), onError: (error) => toast.error(errorText(error, 'Could not save')) })}
      onPutInThr={kind === 'lebaran' ? () => onPutIn('THR') : undefined}
      actions={lastYear > 0 ? <TargetButton detail={detail} amount={lastYear} label="Make last year’s the target" /> : undefined}
    />
  );
}

/**
 * The tool for a goal's kind on its page: months covered for an emergency fund, the KPR for a house,
 * guests for a wedding, the package for an umrah, fees for school, shops for a gadget, and last
 * year's bill for a yearly one. A holiday has its own trip sections instead.
 */
export function TypePanel(props: Props) {
  const { goal } = props.detail;
  const { formatAmount } = useBalanceVisibility();
  const update = useUpdateGoalMutation();
  switch (goal.goalType) {
    case 'emergency':
      return (
        <EmergencyPanel
          color={props.color}
          held={goal.setAside}
          target={goal.targetAmount}
          average={props.spending}
          data={emergencyData(goal.typeData, goal.targetAmount, props.spending)}
          onUseTarget={(targetAmount) => update.mutate({ id: goal.id, targetAmount }, { onSuccess: () => toast.success(`${goal.name} now aims for ${formatAmount(targetAmount)}.`), onError: (error) => toast.error(errorText(error, 'Could not save')) })}
          onBurn={(burn) => update.mutate({ id: goal.id, typeData: { ...goal.typeData, burn } }, { onError: (error) => toast.error(errorText(error, 'Could not save')) })}
        />
      );
    case 'house': return <House key={goal.id} {...props} />;
    case 'wedding': return <Wedding key={goal.id} {...props} />;
    case 'umrah': return <Umrah key={goal.id} {...props} />;
    case 'education': return <Education {...props} />;
    case 'gadget': return <Gadget key={goal.id} {...props} />;
    case 'vehicle-tax':
    case 'insurance':
    case 'lebaran': return <Yearly key={goal.id} {...props} />;
    default: return null;
  }
}
