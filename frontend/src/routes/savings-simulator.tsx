import { createFileRoute } from '@tanstack/react-router';
import { useState, useMemo } from 'react';
import { PageHeader } from '../components/ui/PageHeader';
import { PageContainer } from '../components/ui/PageContainer';
import { RequireAuth } from '../lib/auth';
import { CurrencyInput } from '../components/ui/CurrencyInput';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Modal } from '../components/ui/Modal';
import { formatCurrency, cn } from '../lib/utils';
import {
  TrendingUp,
  Target,
  GitCompare,
  Plus,
  Trash2,
  Edit2,
  Calculator,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

export const Route = createFileRoute('/savings-simulator')({
  component: SavingsSimulatorPage,
} as any);

type Tab = 'projection' | 'scenarios' | 'goals';

interface Scenario {
  id: string;
  name: string;
  monthlyIncome: number;
  monthlySavings: number;
  currentBalance: number;
  months: number;
  returnRate: number;
}

interface ProjectionDataPoint {
  month: number;
  balance: number;
  contributions: number;
  interest: number;
}

function calculateProjection(
  startingBalance: number,
  monthlyContribution: number,
  annualReturnRate: number,
  months: number
): ProjectionDataPoint[] {
  const data: ProjectionDataPoint[] = [];
  let balance = startingBalance;
  let totalContributions = startingBalance;
  const monthlyRate = annualReturnRate / 100 / 12;

  for (let month = 1; month <= months; month++) {
    const interest = balance * monthlyRate;
    balance = balance + monthlyContribution + interest;
    totalContributions += monthlyContribution;
    data.push({
      month,
      balance: Math.round(balance),
      contributions: Math.round(totalContributions),
      interest: Math.round(balance - totalContributions),
    });
  }

  return data;
}

function calculateMonthsToGoal(
  goalAmount: number,
  startingBalance: number,
  monthlyContribution: number,
  annualReturnRate: number
): number {
  if (startingBalance >= goalAmount) return 0;
  if (monthlyContribution <= 0 && annualReturnRate <= 0) return Infinity;

  const monthlyRate = annualReturnRate / 100 / 12;
  let balance = startingBalance;
  let months = 0;

  while (balance < goalAmount && months < 1200) {
    balance = balance + monthlyContribution + balance * monthlyRate;
    months++;
  }

  return months;
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium transition-all',
        active
          ? 'bg-[var(--color-accent)] text-white shadow-lg shadow-[var(--color-accent)]/20'
          : 'bg-[var(--ref-surface-container-high)] text-[var(--color-text-secondary)] hover:bg-[var(--ref-surface-container-low)] hover:text-[var(--color-text-primary)]'
      )}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );
}

function SavingsSimulatorPage() {
  const [activeTab, setActiveTab] = useState<Tab>('projection');

  return (
    <RequireAuth>
      <PageContainer>
        <PageHeader
          subtext="Calculator"
          title="Savings Simulator"
          description="Project your savings growth, compare scenarios, and plan your financial goals."
        />

        <div className="flex gap-2 mb-8 overflow-x-auto pb-2">
          <TabButton
            active={activeTab === 'projection'}
            onClick={() => setActiveTab('projection')}
            icon={TrendingUp}
            label="Projection"
          />
          <TabButton
            active={activeTab === 'scenarios'}
            onClick={() => setActiveTab('scenarios')}
            icon={GitCompare}
            label="Scenarios"
          />
          <TabButton
            active={activeTab === 'goals'}
            onClick={() => setActiveTab('goals')}
            icon={Target}
            label="Goals"
          />
        </div>

        {activeTab === 'projection' && <ProjectionTab />}
        {activeTab === 'scenarios' && <ScenariosTab />}
        {activeTab === 'goals' && <GoalsTab />}
      </PageContainer>
    </RequireAuth>
  );
}

function ProjectionTab() {
  const [currentSavings, setCurrentSavings] = useState('');
  const [monthlySavings, setMonthlySavings] = useState('');
  const [months, setMonths] = useState('');
  const [returnRate, setReturnRate] = useState('');

  const projectionData = useMemo(() => {
    const savings = parseInt(currentSavings.replace(/\D/g, '') || '0');
    const contribution = parseInt(monthlySavings.replace(/\D/g, '') || '0');
    const m = parseInt(months) || 12;
    const rate = parseFloat(returnRate) || 0;

    return calculateProjection(savings, contribution, rate, m);
  }, [currentSavings, monthlySavings, months, returnRate]);

  const summary = useMemo(() => {
    if (projectionData.length === 0) return null;
    const last = projectionData[projectionData.length - 1];
    const first = projectionData[0];
    return {
      finalBalance: last.balance,
      totalContributions: last.contributions,
      totalInterest: last.interest,
      growthPercent: ((last.balance - first.contributions) / first.contributions) * 100,
    };
  }, [projectionData]);

  const chartData = projectionData.map((d) => ({
    month: `M${d.month}`,
    Balance: d.balance,
    Contributions: d.contributions,
    Interest: d.interest,
  }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-4">
          <Card className="p-6">
            <h3 className="font-headline text-lg font-bold mb-4 flex items-center gap-2">
              <Calculator className="w-5 h-5 text-[var(--color-accent)]" />
              Input Parameters
            </h3>
            <div className="space-y-4">
              <CurrencyInput
                label="Current Savings"
                value={currentSavings}
                onChange={setCurrentSavings}
                size="sm"
              />
              <CurrencyInput
                label="Monthly Savings Contribution"
                value={monthlySavings}
                onChange={setMonthlySavings}
                size="sm"
              />
              <div>
                <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5">
                  Months to Simulate
                </label>
                <Input
                  type="number"
                  min="1"
                  max="120"
                  value={months}
                  onChange={(e) => setMonths(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5">
                  Expected Annual Return (%)
                </label>
                <Input
                  type="number"
                  min="0"
                  max="50"
                  step="0.1"
                  value={returnRate}
                  onChange={(e) => setReturnRate(e.target.value)}
                />
              </div>
            </div>
          </Card>

          {summary && (
            <Card className="p-6 border-2 border-[var(--color-accent)] bg-[var(--ref-surface-container-lowest)]">
              <h3 className="font-headline text-lg font-bold mb-4 text-[var(--color-accent)]">Summary</h3>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm text-[var(--color-text-secondary)]">Final Balance</span>
                  <span className="font-bold text-[var(--color-text-primary)]">{formatCurrency(summary.finalBalance)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-[var(--color-text-secondary)]">Total Contributions</span>
                  <span className="font-medium text-[var(--color-text-primary)]">{formatCurrency(summary.totalContributions)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-[var(--color-text-secondary)]">Interest Earned</span>
                  <span className="font-medium text-[var(--color-success)]">+{formatCurrency(summary.totalInterest)}</span>
                </div>
                <div className="pt-3 border-t border-[var(--color-border)]">
                  <div className="flex justify-between">
                    <span className="text-sm text-[var(--color-text-secondary)]">Growth</span>
                    <span className="font-bold text-[var(--color-accent)]">+{summary.growthPercent.toFixed(1)}%</span>
                  </div>
                </div>
              </div>
            </Card>
          )}
        </div>

        <div className="lg:col-span-2">
          <Card className="p-6">
            <h3 className="font-headline text-lg font-bold mb-4">Savings Projection</h3>
            <div className="h-[400px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 12, fill: 'var(--color-text-secondary)' }}
                  />
                  <YAxis
                    tickFormatter={(value) => `${(value / 1000000).toFixed(1)}M`}
                    tick={{ fontSize: 12, fill: 'var(--color-text-secondary)' }}
                  />
                  <Tooltip
                    formatter={(value) => formatCurrency(Number(value) || 0)}
                    contentStyle={{
                      backgroundColor: 'var(--color-surface)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 8,
                    }}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="Balance"
                    stroke="var(--color-accent)"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="Contributions"
                    stroke="#94a3b8"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="Interest"
                    stroke="#22c55e"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="p-6 mt-6">
            <h3 className="font-headline text-lg font-bold mb-4">Month-by-Month Breakdown</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)]">
                    <th className="text-left py-2 px-3 font-medium text-[var(--color-text-secondary)]">Month</th>
                    <th className="text-right py-2 px-3 font-medium text-[var(--color-text-secondary)]">Balance</th>
                    <th className="text-right py-2 px-3 font-medium text-[var(--color-text-secondary)]">Contributions</th>
                    <th className="text-right py-2 px-3 font-medium text-[var(--color-text-secondary)]">Interest</th>
                  </tr>
                </thead>
                <tbody>
                  {projectionData.filter((_, i) => i % Math.max(1, Math.floor(projectionData.length / 12)) === 0 || i === projectionData.length - 1).map((row) => (
                    <tr key={row.month} className="border-b border-[var(--color-border)]/50">
                      <td className="py-2 px-3">Month {row.month}</td>
                      <td className="text-right py-2 px-3 font-medium">{formatCurrency(row.balance)}</td>
                      <td className="text-right py-2 px-3 text-[var(--color-text-secondary)]">{formatCurrency(row.contributions)}</td>
                      <td className="text-right py-2 px-3 text-green-600">+{formatCurrency(row.interest)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function ScenariosTab() {
  const [scenarios, setScenarios] = useState<Scenario[]>(() => {
    const saved = localStorage.getItem('savings-scenarios');
    return saved ? JSON.parse(saved) : [];
  });
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingScenario, setEditingScenario] = useState<Scenario | null>(null);
  const [form, setForm] = useState({
    name: '',
    monthlyIncome: '',
    monthlySavings: '',
    currentBalance: '',
    months: '',
    returnRate: '',
  });

  const saveToStorage = (data: Scenario[]) => {
    localStorage.setItem('savings-scenarios', JSON.stringify(data));
    setScenarios(data);
  };

  const openModal = (scenario?: Scenario) => {
    if (scenario) {
      setEditingScenario(scenario);
      setForm({
        name: scenario.name,
        monthlyIncome: String(scenario.monthlyIncome),
        monthlySavings: String(scenario.monthlySavings),
        currentBalance: String(scenario.currentBalance),
        months: String(scenario.months),
        returnRate: String(scenario.returnRate),
      });
    } else {
      setEditingScenario(null);
      setForm({
        name: '',
        monthlyIncome: '',
        monthlySavings: '',
        currentBalance: '',
        months: '',
        returnRate: '',
      });
    }
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingScenario(null);
  };

  const handleSave = () => {
    const scenario: Scenario = {
      id: editingScenario?.id || Date.now().toString(),
      name: form.name || 'Untitled Scenario',
      monthlyIncome: parseInt(form.monthlyIncome.replace(/\D/g, '') || '0'),
      monthlySavings: parseInt(form.monthlySavings.replace(/\D/g, '') || '0'),
      currentBalance: parseInt(form.currentBalance.replace(/\D/g, '') || '0'),
      months: parseInt(form.months) || 12,
      returnRate: parseFloat(form.returnRate) || 0,
    };

    if (editingScenario) {
      saveToStorage(scenarios.map((s) => (s.id === editingScenario.id ? scenario : s)));
    } else {
      saveToStorage([...scenarios, scenario]);
    }
    closeModal();
  };

  const deleteScenario = (id: string) => {
    if (confirm('Delete this scenario?')) {
      saveToStorage(scenarios.filter((s) => s.id !== id));
    }
  };

  const scenarioResults = scenarios.map((scenario) => {
    const projection = calculateProjection(
      scenario.currentBalance,
      scenario.monthlySavings,
      scenario.returnRate,
      scenario.months
    );
    const final = projection[projection.length - 1];
    return {
      ...scenario,
      finalBalance: final.balance,
      totalInterest: final.interest,
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button onClick={() => openModal()}>
          <Plus className="w-4 h-4" />
          Add Scenario
        </Button>
      </div>

      {scenarioResults.length === 0 ? (
        <Card className="p-12 text-center">
          <GitCompare className="w-12 h-12 mx-auto mb-4 text-[var(--color-muted)]" />
          <p className="font-headline text-lg font-bold mb-2">No scenarios yet</p>
          <p className="text-sm text-[var(--color-text-secondary)] mb-4">
            Create different savings scenarios to compare side-by-side.
          </p>
          <Button onClick={() => openModal()}>
            <Plus className="w-4 h-4" />
            Create First Scenario
          </Button>
        </Card>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th className="text-left py-3 px-4 font-medium text-[var(--color-text-secondary)]">Scenario</th>
                <th className="text-right py-3 px-4 font-medium text-[var(--color-text-secondary)]">Monthly Income</th>
                <th className="text-right py-3 px-4 font-medium text-[var(--color-text-secondary)]">Monthly Savings</th>
                <th className="text-right py-3 px-4 font-medium text-[var(--color-text-secondary)]">Current Balance</th>
                <th className="text-right py-3 px-4 font-medium text-[var(--color-text-secondary)]">Months</th>
                <th className="text-right py-3 px-4 font-medium text-[var(--color-text-secondary)]">Return Rate</th>
                <th className="text-right py-3 px-4 font-medium text-[var(--color-text-secondary)]">Final Balance</th>
                <th className="text-right py-3 px-4 font-medium text-[var(--color-text-secondary)]">Interest Earned</th>
                <th className="text-center py-3 px-4 font-medium text-[var(--color-text-secondary)]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {scenarioResults.map((scenario) => (
                <tr key={scenario.id} className="border-b border-[var(--color-border)]/50 hover:bg-[var(--ref-surface-container-low)]">
                  <td className="py-3 px-4 font-medium">{scenario.name}</td>
                  <td className="text-right py-3 px-4">{formatCurrency(scenario.monthlyIncome)}</td>
                  <td className="text-right py-3 px-4">{formatCurrency(scenario.monthlySavings)}</td>
                  <td className="text-right py-3 px-4">{formatCurrency(scenario.currentBalance)}</td>
                  <td className="text-right py-3 px-4">{scenario.months}</td>
                  <td className="text-right py-3 px-4">{scenario.returnRate}%</td>
                  <td className="text-right py-3 px-4 font-bold text-[var(--color-accent)]">{formatCurrency(scenario.finalBalance)}</td>
                  <td className="text-right py-3 px-4 text-green-600">+{formatCurrency(scenario.totalInterest)}</td>
                  <td className="py-3 px-4">
                    <div className="flex justify-center gap-1">
                      <button
                        onClick={() => openModal(scenario)}
                        className="p-1.5 rounded hover:bg-[var(--ref-surface-container-high)] text-[var(--color-text-secondary)]"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => deleteScenario(scenario.id)}
                        className="p-1.5 rounded hover:bg-[var(--color-danger)]/10 text-[var(--color-danger)]"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={editingScenario ? 'Edit Scenario' : 'Add Scenario'}
        subtitle="Create a savings scenario to compare different strategies."
        size="xl"
      >
        <div className="space-y-4">
          <Input
            label="Scenario Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g., Aggressive Savings"
          />
          <div className="grid grid-cols-2 gap-4">
            <CurrencyInput
              label="Monthly Income"
              value={form.monthlyIncome}
              onChange={(v) => setForm({ ...form, monthlyIncome: v })}
            />
            <CurrencyInput
              label="Current Savings Balance"
              value={form.currentBalance}
              onChange={(v) => setForm({ ...form, currentBalance: v })}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <CurrencyInput
              label="Monthly Savings Contribution"
              value={form.monthlySavings}
              onChange={(v) => setForm({ ...form, monthlySavings: v })}
            />
            <Input
              label="Months to Simulate"
              type="number"
              min="1"
              max="120"
              value={form.months}
              onChange={(e) => setForm({ ...form, months: e.target.value })}
            />
          </div>
          <Input
            label="Expected Annual Return (%)"
            type="number"
            min="0"
            max="50"
            step="0.1"
            value={form.returnRate}
            onChange={(e) => setForm({ ...form, returnRate: e.target.value })}
          />
          <div className="flex gap-3 pt-4">
            <Button onClick={handleSave}>
              {editingScenario ? 'Update Scenario' : 'Add Scenario'}
            </Button>
            <Button variant="secondary" onClick={closeModal}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function GoalsTab() {
  const [goalAmount, setGoalAmount] = useState('');
  const [startingBalance, setStartingBalance] = useState('');
  const [monthlyContribution, setMonthlyContribution] = useState('');
  const [returnRate, setReturnRate] = useState('');

  const result = useMemo(() => {
    const goal = parseInt(goalAmount.replace(/\D/g, '') || '0');
    const start = parseInt(startingBalance.replace(/\D/g, '') || '0');
    const contribution = parseInt(monthlyContribution.replace(/\D/g, '') || '0');
    const rate = parseFloat(returnRate) || 0;

    const months = calculateMonthsToGoal(goal, start, contribution, rate);

    if (months === Infinity || months >= 1200) {
      return { months: null, milestones: [] };
    }

    const milestones = [0.25, 0.5, 0.75, 1].map((pct) => {
      const target = goal * pct;
      const milestoneMonths = calculateMonthsToGoal(target, start, contribution, rate);
      const projection = calculateProjection(start, contribution, rate, milestoneMonths);
      return {
        percent: pct * 100,
        target,
        months: milestoneMonths,
        projectedBalance: projection[projection.length - 1]?.balance || start,
      };
    });

    return { months, milestones };
  }, [goalAmount, startingBalance, monthlyContribution, returnRate]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-4">
          <Card className="p-6">
            <h3 className="font-headline text-lg font-bold mb-4 flex items-center gap-2">
              <Target className="w-5 h-5 text-[var(--color-accent)]" />
              Goal Settings
            </h3>
            <div className="space-y-4">
              <CurrencyInput
                label="Target Savings Goal"
                value={goalAmount}
                onChange={setGoalAmount}
                size="sm"
              />
              <CurrencyInput
                label="Starting Balance"
                value={startingBalance}
                onChange={setStartingBalance}
                size="sm"
              />
              <CurrencyInput
                label="Monthly Contribution"
                value={monthlyContribution}
                onChange={setMonthlyContribution}
                size="sm"
              />
              <Input
                label="Expected Annual Return (%)"
                type="number"
                min="0"
                max="50"
                step="0.1"
                value={returnRate}
                onChange={(e) => setReturnRate(e.target.value)}
              />
            </div>
          </Card>

          {result.months !== null && (
            <Card className="p-6 border-2 border-[var(--color-accent)] bg-[var(--ref-surface-container-lowest)]">
              <h3 className="font-headline text-lg font-bold mb-2 text-[var(--color-accent)]">Time to Goal</h3>
              <p className="text-4xl font-extrabold mb-2 text-[var(--color-text-primary)]">
                {result.months} months
              </p>
              <p className="text-sm text-[var(--color-text-secondary)]">
                ≈ {(result.months / 12).toFixed(1)} years
              </p>
              <div className="mt-4 pt-4 border-t border-[var(--color-border)]">
                {(() => {
                  const goal = parseInt(goalAmount.replace(/\D/g, '') || '0');
                  const contribution = parseInt(monthlyContribution.replace(/\D/g, '') || '0');
                  return (
                    <p className="text-sm text-[var(--color-text-secondary)]">
                      Reach your goal of {formatCurrency(goal)} by saving {formatCurrency(contribution)} per month.
                    </p>
                  );
                })()}
              </div>
            </Card>
          )}

          {result.months === null && (
            <Card className="p-6 bg-[var(--color-warning)]/10 border border-[var(--color-warning)]">
              <p className="font-medium text-[var(--color-warning)]">
                Unable to reach goal with current contribution. Try increasing your monthly savings or expected return rate.
              </p>
            </Card>
          )}
        </div>

        <div className="lg:col-span-2">
          <Card className="p-6">
            <h3 className="font-headline text-lg font-bold mb-4">Milestone Timeline</h3>
            {result.milestones.length > 0 ? (
              <div className="space-y-4">
                {result.milestones.map((milestone) => (
                  <div
                    key={milestone.percent}
                    className="flex items-center gap-4 p-4 rounded-lg bg-[var(--ref-surface-container-low)]"
                  >
                    <div className={cn(
                      'w-16 h-16 rounded-full flex items-center justify-center text-lg font-bold',
                      milestone.percent === 100
                        ? 'bg-[var(--color-success)] text-white'
                        : 'bg-[var(--color-accent)] text-white'
                    )}>
                      {milestone.percent}%
                    </div>
                    <div className="flex-1">
                      <p className="font-medium">Target: {formatCurrency(milestone.target)}</p>
                      <p className="text-sm text-[var(--color-text-secondary)]">
                        Projected balance: {formatCurrency(milestone.projectedBalance)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-lg">{milestone.months} months</p>
                      <p className="text-xs text-[var(--color-text-secondary)]">
                        ≈ {(milestone.months / 12).toFixed(1)} years
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center text-[var(--color-text-secondary)] py-8">
                Adjust your goal settings to see milestone timeline.
              </p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
