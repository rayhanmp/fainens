import type { AgentChatTool } from "./agent-llm";

export const agentToolGroupNames = ["records", "transactions", "planning", "metadata", "obligations", "audit", "currency", "charts", "scenarios", "split_bill"] as const;
export type AgentToolGroup = typeof agentToolGroupNames[number];

export const agentToolGroups: Record<AgentToolGroup, readonly string[]> = {
  records: ["get_financial_facts", "search_transactions", "get_transaction_details", "get_account_balances", "get_category_spending", "list_periods"],
  transactions: ["get_account_balances", "get_categories", "get_transport_route_templates", "get_tags", "prepare_transaction", "prepare_transactions"],
  planning: ["get_budget_facts", "get_category_variance", "compare_periods", "forecast_cash_position", "preview_budget_plan", "review_budget_patterns", "list_periods", "get_categories", "prepare_budget"],
  metadata: ["search_transactions", "get_transaction_details", "get_tags", "create_tag", "update_transaction_tags", "update_transaction_metadata"],
  obligations: ["get_loan_balances", "get_paylater_obligations", "get_due_recurring", "get_salary_catch_up", "list_periods"],
  audit: ["get_account_balances", "get_account_health", "get_money_anomalies", "get_reconciliation_status", "find_similar_transactions", "get_transaction_details"],
  currency: ["get_currency_exchange_rate", "calculate", "get_current_datetime", "calculate_date_difference"],
  charts: ["show_chart"],
  scenarios: ["show_scenario", "show_worksheet", "calculate"],
  split_bill: ["show_split_bill"],
};

export const loadToolGroupTool: AgentChatTool = {
  type: "function",
  function: {
    name: "load_tool_group",
    description: "Load one additional capability group when the currently available tools cannot complete the request. Do not call this when an available tool or plain answer is sufficient.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["group"],
      properties: {
        group: {
          type: "string",
          enum: agentToolGroupNames,
          description: "records=ledger facts; transactions=prepare entries; planning=budgets/forecast; metadata=notes/tags; obligations=loans/pay-later/recurring; audit=reconciliation/anomalies; currency=rates/date math; charts=static charts; scenarios=editable what-ifs; split_bill=editable receipt split.",
        },
      },
    },
  },
};

function matches(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
}

/** Cheap deterministic routing avoids spending another model call merely to
 * decide which schemas to send. load_tool_group remains as an escape hatch. */
export function selectInitialToolGroups(question: string, historyText = "", hasImages = false): Set<AgentToolGroup> {
  const text = `${question}\n${historyText.slice(-4_000)}`.toLowerCase();
  const groups = new Set<AgentToolGroup>();
  const splitRequested = matches(text, /\b(split\s*bill|split the bill|bill split|split receipt|receipt split|patungan|bagi (?:bill|tagihan)|service charge)\b/);

  if (splitRequested) {
    groups.add("split_bill");
  }
  if ((hasImages && !splitRequested) || matches(text, /\b(record|log|add|create|spent|spend|bought|purchase|paid|received|income|salary|expense|transaction|transfer|top[ -]?up|wallet|account)\b/)) {
    groups.add("transactions");
    groups.add("records");
  }
  if (matches(text, /\b(tag|tags|note|notes|annotate|annotation|label|metadata)\b/)) groups.add("metadata");
  if (matches(text, /\b(budget|plan|planning|saving|savings|forecast|project|projection|goal|runway|variance|compare|comparison|versus|trend|scenario|allocation|what if)\b/)) {
    groups.add("planning");
    groups.add("scenarios");
    groups.add("records");
  }
  if (matches(text, /\b(chart|graph|visuali[sz]|donut|composition|breakdown|heatmap|sparkline)\b/)) {
    groups.add("charts");
    groups.add("records");
  }
  if (matches(text, /\b(loan|borrow|borrowed|debt|lent|lending|pay\s*later|paylater|installment|subscription|recurring|renewal|obligation|due)\b/)) groups.add("obligations");
  if (matches(text, /\b(reconcile|reconciliation|anomal|duplicate|audit|trace|provenance|account health|wrong transaction|incorrect transaction)\b/)) groups.add("audit");
  if (matches(text, /\b(currency|exchange|convert|conversion|exchange rate|usd|idr|jpy|eur|sgd|aud|gbp)\b/)) groups.add("currency");
  if (matches(text, /\b(balance|financial|finance|money|cash|spending|category|period|how am i doing|how much|transaction)\b/)) groups.add("records");

  return groups;
}

export function parseAgentToolGroup(value: unknown): AgentToolGroup {
  if (typeof value !== "string" || !agentToolGroupNames.includes(value as AgentToolGroup)) {
    throw new Error("Unknown tool group");
  }
  return value as AgentToolGroup;
}

export function toolNamesForGroups(groups: Iterable<AgentToolGroup>): Set<string> {
  const names = new Set<string>();
  for (const group of groups) for (const name of agentToolGroups[group]) names.add(name);
  return names;
}
