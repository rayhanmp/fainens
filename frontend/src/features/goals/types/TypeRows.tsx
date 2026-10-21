import { useState } from 'react';
import { PercentField } from '../../savings/fields';
import { Dropdown } from '../../settings/controls';
import { DetailRow } from '../detail/DetailRow';
import type { Goal } from '../queries';
import { EMERGENCY_ADVICE, KPR_LIMIT, STNK_YEARS } from './type-math';
import { useTypeDataSaver } from './useTypeData';

const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

function EmergencyRows({ goal }: { goal: Goal }) {
  const save = useTypeDataSaver(goal.id, goal.typeData);
  const household = goal.typeData.household === 'family' ? 'family' : 'single';
  const advice = EMERGENCY_ADVICE[household];
  const months = num(goal.typeData.months);
  return (
    <>
      <DetailRow
        label="Who relies on it"
        info="With a family relying on your income, an emergency fund usually covers more months."
        control={<Dropdown ariaLabel="Who relies on it" value={household} options={[{ value: 'single', label: 'Just me' }, { value: 'family', label: 'A family' }]} onChange={(value) => save({ household: value })} />}
      />
      <DetailRow
        label="Months to cover"
        info="How many months of your spending the fund should hold. Its target can follow from it on the page."
        control={(
          <Dropdown
            ariaLabel="Months to cover"
            value={String(months ?? 'auto')}
            options={[...(months === null ? [{ value: 'auto', label: 'From the target' }] : []), ...MONTHS.map((count) => ({ value: String(count), label: `${count} month${count === 1 ? '' : 's'}${count >= advice.min && count <= advice.max ? ' · usual' : ''}` }))]}
            onChange={(value) => { if (value !== 'auto') save({ months: Number(value) }); }}
          />
        )}
      />
    </>
  );
}

function HouseRows({ goal }: { goal: Goal }) {
  const save = useTypeDataSaver(goal.id, goal.typeData);
  const [limit, setLimit] = useState(num(goal.typeData.limit) ?? KPR_LIMIT);
  return (
    <DetailRow
      label="Bank’s limit"
      info="The share of your take-home pay a bank lets a KPR payment take. About 30% is usual; some banks allow up to 40%."
      control={<PercentField ariaLabel="Bank’s limit" value={limit} min={10} max={60} onChange={(value) => { setLimit(value); save({ limit: value }); }} />}
    />
  );
}

function EducationRows({ goal }: { goal: Goal }) {
  const save = useTypeDataSaver(goal.id, goal.typeData);
  const [school, setSchool] = useState(typeof goal.typeData.school === 'string' ? goal.typeData.school : '');
  return (
    <DetailRow
      label="School"
      control={<input aria-label="School" className="brutalist-input h-[34px] w-full" placeholder="Its name" value={school} maxLength={120} onChange={(event) => setSchool(event.target.value)} onBlur={() => { if (school !== (goal.typeData.school ?? '')) save({ school: school.trim() || null }); }} />}
    />
  );
}

function VehicleRows({ goal }: { goal: Goal }) {
  const save = useTypeDataSaver(goal.id, goal.typeData);
  const [year, setYear] = useState(num(goal.typeData.plateUntil)?.toString() ?? '');
  return (
    <DetailRow
      label="Plate and STNK until"
      info={`The year on the plate. They renew every ${STNK_YEARS} years, which costs more than the yearly tax; that year's bill says so.`}
      control={(
        <input
          aria-label="Plate and STNK until"
          inputMode="numeric"
          className="brutalist-input h-[34px] w-full"
          placeholder="2028"
          value={year}
          maxLength={4}
          onChange={(event) => {
            const value = event.target.value.replace(/\D/g, '');
            setYear(value);
            if (/^20\d\d$/.test(value)) save({ plateUntil: Number(value) });
          }}
        />
      )}
    />
  );
}

/**
 * The settings of a goal's kind, at the top of its Details: who an emergency fund is for and how many
 * months it covers, a bank's limit for a house's KPR, a school's name, a vehicle's plate year.
 */
export function TypeRows({ goal }: { goal: Goal }) {
  switch (goal.goalType) {
    case 'emergency': return <EmergencyRows key={goal.id} goal={goal} />;
    case 'house': return <HouseRows key={goal.id} goal={goal} />;
    case 'education': return <EducationRows key={goal.id} goal={goal} />;
    case 'vehicle-tax': return <VehicleRows key={goal.id} goal={goal} />;
    default: return null;
  }
}
