import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { PageContainer } from '../components/ui/PageContainer';
import { PageHeader } from '../components/ui/PageHeader';
import { RetirementPlanner } from '../components/savings/RetirementPlanner';
import { Segmented } from '../features/savings/fields';
import { SavingsPlanView } from '../features/savings/SavingsPlanView';
import { RequireAuth } from '../lib/auth';

export const Route = createFileRoute('/savings-simulator')({
  component: SavingsSimulatorPage,
});

type View = 'plan' | 'retirement';
const VIEW_KEY = 'savings-simulator:view';

function readView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'retirement' ? 'retirement' : 'plan';
  } catch {
    return 'plan';
  }
}

function SavingsSimulatorPage() {
  const [view, setView] = useState<View>(readView);
  const choose = (next: View) => {
    setView(next);
    try { localStorage.setItem(VIEW_KEY, next); } catch { /* the choice just won't be remembered */ }
  };

  return (
    <RequireAuth>
      <PageContainer className="px-4 pt-6 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <PageHeader
            subtext="Planning"
            title="Savings simulator"
            description={view === 'plan' ? 'Where your savings could go, what it takes to reach your goals, and how plans compare.' : 'BPJS JHT and JP with your own savings, against the life you want after work.'}
          />
          <Segmented
            ariaLabel="Simulator"
            className="w-full sm:w-[260px]"
            value={view}
            onChange={choose}
            options={[{ value: 'plan', label: 'Savings plan' }, { value: 'retirement', label: 'Retirement' }]}
          />
        </div>
        {view === 'plan' ? <SavingsPlanView /> : <RetirementPlanner />}
      </PageContainer>
    </RequireAuth>
  );
}
