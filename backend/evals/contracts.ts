import type { ScriptStep } from "./provider";

export type Dimension = "correctness" | "reliability" | "efficiency";
export type Check = { name: string; passed: boolean; detail?: string; dimension?: Dimension };
export type Result = Record<string, any>;
export type Turn = {
  question: string; script: ScriptStep[]; truth: string;
  intent?: { decision: "infer" | "clarify" | "conditional"; reason: string };
  before?: () => void; checks: (result: Result, previous: Result[]) => Check[];
};
export type Workflow = {
  id: string; tags: string[]; turns: Turn[]; setup?: () => void;
  offlineOnly?: boolean; allowedErrors?: number;
  approval?: { debitAccount: number; creditAccount: number; amount: number; categoryId?: number; transfer?: boolean };
};
export const check = (name: string, passed: boolean, detail?: string): Check => ({ name, passed, ...(detail ? { detail } : {}) });
export const visible = (result: Result) => `${result.answer ?? ""}\n${JSON.stringify(result.presentations ?? [])}`;
export function hasAmount(result: Result, amount: number) {
  if ([String(amount), amount.toLocaleString("id-ID"), amount.toLocaleString("en-US")]
    .some((formatted) => new RegExp(`(^|[^0-9.,])${formatted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![0-9]|[.,][0-9]|\\s*(?:million|ribu|juta|rb|jt|k|m)\\b)`, "i").test(visible(result)))
  ) return true;
  const units: Record<string, number> = { k: 1000, rb: 1000, ribu: 1000, jt: 1_000_000, juta: 1_000_000, million: 1_000_000, m: 1_000_000 };
  return [...visible(result).matchAll(/(?:^|[^\d.,])(?:Rp\s*)?(\d+(?:[.,]\d+)?)\s*(million|ribu|juta|rb|jt|k|m)\b/gi)]
    .some((m) => Math.abs(Number(m[1].replace(",", ".")) * units[m[2].toLowerCase()] - amount) < 0.001);
}
export function successful(result: Result, name: string) {
  return (result.toolResults ?? []).filter((row: any) => row.name === name && row.result != null && row.result?.status !== "error" && row.result?.data?.status !== "error");
}
export const inputOf = (result: Result, id: string) => result.toolCalls?.find((row: any) => row.id === id)?.input;
export function used(result: Result, name: string, predicate: (input: any) => boolean = () => true) {
  return successful(result, name).some((row: any) => predicate(inputOf(result, row.id) ?? {}));
}
export function amountChecks(result: Result, amount: number) { return [check(`answer contains IDR ${amount}`, hasAmount(result, amount))]; }
export function exactIds(rows: any[], ids: number[]) {
  return JSON.stringify(rows.map((row) => row.id).sort((a, b) => a - b)) === JSON.stringify([...ids].sort((a, b) => a - b));
}
export function aggregateEquals(result: Result, expense: number, count?: number, income?: number) {
  return successful(result, "summarize_transactions").some((row: any) => {
    const data = row.result.data ?? row.result;
    return data.groups?.reduce((sum: number, g: any) => sum + g.expenseCents, 0) === expense
      && (count == null || data.transactionCount === count)
      && (income == null || data.groups?.reduce((sum: number, g: any) => sum + g.incomeCents, 0) === income);
  });
}
