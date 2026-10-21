import { useState, type ReactNode } from 'react';
import { GOAL_COLORS } from '../goals/colors';
import { EducationPanel } from '../goals/types/EducationPanel';
import { EmergencyPanel } from '../goals/types/EmergencyPanel';
import { GadgetPanel } from '../goals/types/GadgetPanel';
import { HousePanel } from '../goals/types/HousePanel';
import { TypeArt } from '../goals/types/TypeArt';
import { houseData, type GadgetData, type HouseData, type UmrahData, type WeddingData } from '../goals/types/type-math';
import { UmrahPanel } from '../goals/types/UmrahPanel';
import { WeddingPanel } from '../goals/types/WeddingPanel';
import { YearlyPanel } from '../goals/types/YearlyPanel';
import { VisualFrame } from './visuals';

/**
 * Each kind of goal's own tool from its page, the real component with sample figures, beside the
 * picture it shows at the top of the page. The calculators work here too; nothing is saved.
 */

const NOW = new Date(2026, 9, 21, 10).getTime();
const day = (offset: number) => NOW + offset * 86_400_000;

function KindFrame({ goalType, fill, caption, children }: { goalType: string; fill: number; caption: string; children: ReactNode }) {
  return (
    <VisualFrame caption={caption}>
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[210px_minmax(0,1fr)]">
        <div className="plan-sky hidden place-items-center rounded-2xl py-3 lg:grid" aria-hidden>
          <TypeArt goalType={goalType} color={GOAL_COLORS[0]} fill={fill} />
        </div>
        <div className="min-w-0">{children}</div>
      </div>
    </VisualFrame>
  );
}

export function EmergencyDemo() {
  return (
    <KindFrame goalType="emergency" fill={0.7} caption="Sample: Rp21 juta set aside, spending Rp5 juta a month, aiming for six months.">
      <EmergencyPanel color={GOAL_COLORS[0]} held={21_000_000} target={27_000_000} spending={5_000_000} data={{ months: 6, household: 'single' }} />
    </KindFrame>
  );
}

export function HouseDemo() {
  const [value, setValue] = useState<HouseData>(() => houseData({ price: 1_000_000_000 }));
  return (
    <KindFrame goalType="house" fill={0.3} caption="Try it: change the price, down payment, years or rate (sample: Rp20 juta take-home pay).">
      <HousePanel value={value} onChange={(patch) => setValue((current) => ({ ...current, ...patch }))} salary={20_000_000} />
    </KindFrame>
  );
}

export function WeddingDemo() {
  const [value, setValue] = useState<WeddingData>({ guests: 300, perGuest: 150_000 });
  return (
    <KindFrame goalType="wedding" fill={0.5} caption="Try it: change the guests or catering (sample: a Rp40 juta venue, attire and documentation in the breakdown).">
      <WeddingPanel
        value={value}
        onChange={(patch) => setValue((current) => ({ ...current, ...patch }))}
        parts={[{ name: 'Venue', amount: 40_000_000, dueAt: day(30), paidAt: null }, { name: 'Attire', amount: 15_000_000, dueAt: null, paidAt: null }, { name: 'Documentation', amount: 12_000_000, dueAt: null, paidAt: null }]}
        target={130_000_000}
      />
    </KindFrame>
  );
}

export function UmrahDemo() {
  const [value, setValue] = useState<UmrahData>({ travellers: 2, packagePrice: 32_000_000, spending: 5_000_000 });
  return (
    <KindFrame goalType="umrah" fill={0.4} caption="Try it: change who’s going or the package; a package under Kemenag’s reference price is flagged.">
      <UmrahPanel value={value} onChange={(patch) => setValue((current) => ({ ...current, ...patch }))} target={75_000_000} leaves={day(160)} now={NOW} />
    </KindFrame>
  );
}

export function EducationDemo() {
  return (
    <KindFrame goalType="education" fill={0.4} caption="Sample: an entry fee paid, two term fees ahead, Rp6 juta in the goal.">
      <EducationPanel
        held={6_000_000}
        now={NOW}
        fees={[
          { id: 1, name: 'Entry fee', amount: 15_000_000, dueAt: day(-40), paidAt: day(-41) },
          { id: 2, name: 'Term fee, Jan 2027', amount: 9_000_000, dueAt: day(25), paidAt: null },
          { id: 3, name: 'Term fee, Jul 2027', amount: 9_000_000, dueAt: day(206), paidAt: null },
        ]}
      />
    </KindFrame>
  );
}

export function GadgetDemo() {
  const [value, setValue] = useState<GadgetData>({
    options: [
      { url: 'https://www.tokopedia.com/', title: 'Laptop 13", 16 GB, 512 GB', image: null, price: 20_999_000, firstPrice: 22_499_000, checkedAt: day(-1) },
      { url: 'https://shopee.co.id/', title: 'The same laptop, another shop', image: null, price: 21_499_000, firstPrice: 21_499_000, checkedAt: day(-1) },
    ],
    pick: 0,
    tradeIn: 5_000_000,
  });
  return (
    <KindFrame goalType="gadget" fill={0.5} caption="Try it: pick the other shop or change the trade-in (sample prices).">
      <GadgetPanel value={value} onChange={(patch) => setValue((current) => ({ ...current, ...patch }))} target={16_000_000} />
    </KindFrame>
  );
}

export function YearlyDemo() {
  const [lastYear, setLastYear] = useState(3_100_000);
  return (
    <KindFrame goalType="vehicle-tax" fill={0.4} caption="Try it: change last year’s amount (sample: a car whose plate renews in 2027).">
      <YearlyPanel kind="vehicle-tax" lastYear={lastYear} lastPaidAt={new Date(2026, 2, 12).getTime()} onLastYear={setLastYear} held={1_200_000} dueAt={new Date(2027, 2, 15, 12).getTime()} now={NOW} plateUntil={2027} monthly={0} />
    </KindFrame>
  );
}
