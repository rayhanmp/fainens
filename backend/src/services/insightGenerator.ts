import { callOpenRouter } from './openrouter';
import { env } from '../lib/env';

const DASHBOARD_SYSTEM_PROMPT = `You analyze transaction data and give spending insights.

RULES:
- 2-3 sentences
- Casual, direct, like texting a friend
- No emojis, no em dashes
- Mention specific amounts and category names
- Focus on transaction patterns, not just budgets

READ THE DATA:
- "This week's transactions" = what they bought this week
- "Largest transaction: Rp X for [desc]" = biggest single purchase
- "Top category: X" = where most money went
- "Spending velocity: faster/slower" = trend vs previous weeks
- Budget warnings and positives = budget health

CATEGORY TIPS:
- Transport: Can suggest cheaper alternatives (walk, bike, public transit)
- Food/Groceries: Can suggest batch cooking, cheaper alternatives
- Entertainment: Easy to cut back if over
- Healthcare: Be gentle, medical costs are necessary
- Household: Depends on necessity, be careful
- Others: Use common sense

WHAT TO LOOK FOR:
- Big purchases that stand out
- Categories with too many small purchases
- Unusual spending patterns
- Good discipline areas

EXAMPLES:
"You spent Rp 850k on transport this week. Consider walking or taking the bus for short trips."

"Food had 12 transactions this week. Maybe batch cook to cut down on small purchases."

"That Rp 450k purchase on healthcare is the biggest one. Medical costs happen, no worries."

"You spent faster this week. Food at Rp 300k already stands out."

"Entertainment spending dropped this week. Good discipline there."`;

const BUDGET_SYSTEM_PROMPT = `You analyze budget data and give insights with actionable suggestions.

RULES:
- 2-3 sentences
- Casual, direct, like texting a friend
- No emojis, no em dashes
- Mention specific numbers from the data
- Give actionable insights

CATEGORY TIPS:
- Transport: Can suggest cheaper alternatives
- Food/Groceries: Can suggest batch cooking, cheaper meals
- Entertainment: Easy to cut back
- Healthcare: Be gentle, medical costs are necessary
- Household: Depends on necessity, be careful
- Others: Use common sense

READ THE DATA CAREFULLY:
- "Week X of 4, Y days left this week" = urgency timer
- "Budget status: OVER/ON TRACK/UNDER" = overall health
- "Warning: X exceeded" = problem
- "Doing well: X under control" = keep doing
- "vs Last month: X% less/more" = comparison

EXAMPLES:
"Food exceeded by Rp 80,000 (now at Rp 580k of 500k). You might want to cut back on coffee and snacks."

"Transport will run out in 2 days (Rp 100k left). Consider walking or biking for short distances."

"Healthcare is over budget but that's life. Don't worry about it."

"20% less than last month. Nice. But household category will exceed in 3 days, watch that."

"All budgets on track at Day 7. Nothing urgent to worry about."`;

interface Transaction {
  date: string;
  category: string;
  amount: number;
  description?: string;
}

interface Budget {
  category: string;
  planned: number;
  spent: number;
  spent_this_week?: number;
  transactions?: number;
}

interface DashboardData {
  report_week: string;
  period_name: string;
  salary_period: string;
  today_date: string;
  days_elapsed: number;
  days_total: number;
  days_remaining: number;
  current_week: number;
  days_left_in_week: number;
  week_distribution: number[];
  week_transactions: Transaction[];
  wallet_balance: number;
  monthly_income: number;
  total_spent: number;
  savings_rate: number;
  daily_burn_rate: number;
  expected_total_spend: number;
  budget_status: 'on_track' | 'over_budget' | 'under_budget';
  budgets: Budget[];
  previous_weeks: Array<{ week: number; total: number }>;
  spending_velocity: 'faster' | 'slower' | 'same' | 'unknown';
  top_spending_category: string;
  largest_transaction: { amount: number; description: string; category: string };
  budget_warnings: string[];
  positive_notes: string[];
}

interface BudgetData {
  period: string;
  today_date: string;
  days_elapsed: number;
  days_total: number;
  days_remaining: number;
  current_week: number;
  days_left_in_week: number;
  week_distribution: number[];
  week_number: number;
  all_transactions: Transaction[];
  total_spent: number;
  total_planned: number;
  savings_rate: number;
  daily_burn_rate: number;
  expected_end_spend: number;
  budget_status: 'on_track' | 'over_budget' | 'under_budget';
  budgets: Budget[];
  budget_warnings: string[];
  budget_successes: string[];
  last_month: {
    period: string;
    total_spent: number;
    budget_count: number;
  };
  savings_comparison: number;
}

function formatCurrency(amount: number): string {
  return `Rp ${amount.toLocaleString('id-ID')}`;
}

function formatDashboardPrompt(data: DashboardData): string {
  const budgetSummary = data.budgets.length > 0
    ? data.budgets.map(b => {
        const percent = b.planned > 0 ? ((b.spent / b.planned) * 100).toFixed(0) : '0';
        const remaining = b.planned - b.spent;
        return `- ${b.category}: ${percent}% used, ${remaining >= 0 ? `${formatCurrency(remaining)} left` : `${Math.abs(remaining)} over`}`;
      }).join('\n')
    : 'No budgets set';

  const warnings = data.budget_warnings.length > 0
    ? `\nWARNINGS:\n${data.budget_warnings.map(w => `- ${w}`).join('\n')}`
    : '';

  const positives = data.positive_notes.length > 0
    ? `\nGOOD:\n${data.positive_notes.map(p => `- ${p}`).join('\n')}`
    : '';

  const velocityNote = data.spending_velocity === 'unknown' 
    ? 'N/A'
    : data.spending_velocity;

  return `Week ${data.current_week} of 4, ${data.days_left_in_week} days left this week.

Budget status: ${data.budget_status.toUpperCase()}
Day ${data.days_elapsed} of ${data.days_total} (${data.days_remaining} days left in period)

Spending pace: ${velocityNote} than previous weeks
${data.previous_weeks.length > 0 ? `Previous: ${data.previous_weeks.map(w => `W${w.week}: ${formatCurrency(w.total)}`).join(', ')}` : ''}

${warnings}
${positives}

${budgetSummary}`;
}

function formatBudgetPrompt(data: BudgetData): string {
  const budgetSummary = data.budgets.map(b => {
    const percent = b.planned > 0 ? ((b.spent / b.planned) * 100).toFixed(0) : '0';
    const remaining = b.planned - b.spent;
    return `- ${b.category}: ${percent}%, ${formatCurrency(remaining)} ${remaining >= 0 ? 'left' : 'over'}`;
  }).join('\n');

  const warnings = data.budget_warnings.length > 0
    ? `\nWARNINGS:\n${data.budget_warnings.map(w => `- ${w}`).join('\n')}`
    : '';

  const successes = data.budget_successes.length > 0
    ? `\nGOOD:\n${data.budget_successes.map(s => `- ${s}`).join('\n')}`
    : '';

  const vsLastMonth = data.last_month.total_spent > 0
    ? `\nvs Last month: ${data.savings_comparison > 0 ? `${data.savings_comparison.toFixed(0)}% less` : `${Math.abs(data.savings_comparison).toFixed(0)}% more`}`
    : '';

  return `Week ${data.current_week} of 4, ${data.days_left_in_week} days left this week.

Budget status: ${data.budget_status.toUpperCase()}
Day ${data.days_elapsed} of ${data.days_total} (${data.days_remaining} days left in period)
${vsLastMonth}

${warnings}
${successes}

${budgetSummary}`;
}

export async function generateDashboardInsight(data: DashboardData): Promise<string> {
  const apiKey = env.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OpenRouter API key not configured');
  }

  const userPrompt = formatDashboardPrompt(data);
  return callOpenRouter(DASHBOARD_SYSTEM_PROMPT, userPrompt, apiKey);
}

export async function generateBudgetInsight(data: BudgetData): Promise<string> {
  const apiKey = env.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OpenRouter API key not configured');
  }

  const userPrompt = formatBudgetPrompt(data);
  return callOpenRouter(BUDGET_SYSTEM_PROMPT, userPrompt, apiKey);
}
