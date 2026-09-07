import { describe, expect, it } from "vitest";
import { casualWorkflows } from "./casual-cases";
import { efficiencyBudgets } from "./efficiency";
import type { Result } from "./contracts";

const checks = (id: string, r: Result, turn = 0) => casualWorkflows.find((w) => w.id === id)!.turns[turn].checks(r, []);
const fails = (id: string, name: string, r: Result, turn = 0) => expect(checks(id, r, turn).find((c) => c.name === name)?.passed).toBe(false);
const question = (text: string) => ({ answer: "One detail first.", clarifications: [{ question: text, choices: [{ label: "A" }, { label: "B" }] }] });
const toolResult = (name: string, input: any, data: any, answer = ""): Result => ({ answer,
  toolCalls: [{ id: "call", name, input }], toolResults: [{ id: "call", name, result: { status: "ok", data } }],
});

describe("casual language interpretation controls", () => {
  it("adds ten distinct conversations with evaluator-only intent and per-turn budgets", () => {
    expect(casualWorkflows).toHaveLength(10);
    expect(casualWorkflows.filter((w) => w.turns.length > 1)).toHaveLength(5);
    for (const w of casualWorkflows) {
      expect(w.offlineOnly).not.toBe(true);
      expect(w.tags).toContain("casual");
      expect(efficiencyBudgets[w.id]).toHaveLength(w.turns.length);
      for (const t of w.turns) {
        expect(t.intent?.reason).toMatch(/\S/);
        expect(["infer", "clarify", "conditional"]).toContain(t.intent?.decision);
      }
    }
  });

  it("penalizes unnecessary clarification for an obvious bank typo", () => {
    const r = toolResult("get_account_balance", { accountId: 1 }, { accounts: [{ id: 1, balanceCents: 3960000 }] }, "BNI Rp3.960.000.");
    expect(checks("casual-bank-typo", r).every((c) => c.passed)).toBe(true);
    expect(checks("casual-bank-typo", { ...r, answer: `${r.answer} Mau lihat transaksi juga?` }).every((c) => c.passed)).toBe(true);
    fails("casual-bank-typo", "no clarification for obvious bank typo", { ...r, clarifications: [{ question: "Did you mean BNI?" }] });
  });

  it("requires a focused scope question instead of assuming calendar or salary month", () => {
    expect(checks("casual-month-confusion", question("Bulan kalender atau periode gajian?" )).every((c) => c.passed)).toBe(true);
    fails("casual-month-confusion", "clarifies calendar versus salary period", { answer: "September Rp1.040.000." });
    fails("casual-month-confusion", "elliptical date selects the salary period", toolResult("get_period_summary", { periodId: 1 }, { facts: { totalSpentCents: 1040000 } }, "Rp1.040.000"), 1);
  });

  it("does not guess a price when the user explicitly gives two competing amounts", () => {
    expect(checks("casual-uncertain-amount", question("Rp35.000 atau Rp350.000?" )).every((c) => c.passed)).toBe(true);
    fails("casual-uncertain-amount", "no guessed proposal", { ...question("35000?"), pendingActions: [{}] });
  });

  it("rejects stale amount/account after an in-message correction and preserves evening", () => {
    const wrong = { ...toolResult("prepare_expense", { amountCents: 28000, accountId: 1, categoryId: 2, date: "2026-08-30T20:00:00+07:00" }, {}), pendingActions: [{}] };
    fails("casual-in-message-correction", "latest amount and account override earlier words", wrong);
    const morning = { ...toolResult("prepare_expense", { amountCents: 82000, accountId: 2, categoryId: 2, date: "2026-08-30T08:00:00+07:00" }, {}), pendingActions: [{}] };
    fails("casual-in-message-correction", "evening is not silently changed to morning", morning);
  });

  it("rejects using the intervening wallet balance as the earlier meal reference", () => {
    const r = toolResult("get_account_balance", { accountId: 1 }, { accounts: [{ id: 1, balanceCents: 3920000 }] }, "BNI would be Rp4.190.000.");
    fails("casual-reference-after-detour", "answer contains IDR 4120000", r, 2);
    fails("casual-reference-after-detour", "no reversal or proposal for hypothetical", { answer: "Rp4.120.000", pendingActions: [{}] }, 2);
  });

  it("requires direction for an ambiguous transfer pronoun, then retains its amount", () => {
    const balances = toolResult("get_account_balances", { selection: { mode: "filter", liquidityClass: "cash_equivalent" } }, { accounts: [{ id: 1, balanceCents: 3960000 }, { id: 2, balanceCents: 300000 }] }, "BNI Rp3.960.000; GoPay Rp300.000.");
    expect(checks("casual-ambiguous-transfer-direction", balances).every((c) => c.passed)).toBe(true);
    expect(checks("casual-ambiguous-transfer-direction", question("BNI ke GoPay atau GoPay ke BNI?"), 1).every((c) => c.passed)).toBe(true);
    fails("casual-ambiguous-transfer-direction", "no guessed transfer direction", { pendingActions: [{}] }, 1);
    const reverse = { ...toolResult("prepare_transfer", { accountId: 2, toAccountId: 1, amountCents: 100000 }, {}), pendingActions: [{}] };
    fails("casual-ambiguous-transfer-direction", "direction and retained amount match clarification", reverse, 2);
  });

  it("distinguishes how much to transfer from an instruction to transfer", () => {
    const r = { answer: "Ray perlu transfer Rp67.540 ke Inas." };
    expect(checks("casual-payer-correction", r).every((c) => c.passed)).toBe(true);
    fails("casual-payer-correction", "how much to transfer does not authorize transfer", { ...r, pendingActions: [{}] });
    fails("casual-payer-correction", "repayment direction follows the corrected payer", { answer: "Inas perlu transfer Rp67.540 ke Ray." });
  });

  it("accepts explaining both service alternatives, but not silently defaulting one", () => {
    const alternatives = { answer: "Kalau rata: Ray Rp67.500, Inas Rp97.500. Kalau sesuai porsi: Ray Rp66.000, Inas Rp99.000." };
    expect(checks("casual-service-choice", alternatives).every((c) => c.passed)).toBe(true);
    expect(checks("casual-service-choice", question("Service mau rata atau sesuai porsi?" )).every((c) => c.passed)).toBe(true);
    fails("casual-service-choice", "service ambiguity is surfaced, not silently defaulted", { answer: "Service saya bagi rata. Inas Rp97.500." });
    fails("casual-service-choice", "no finalized split before service choice", { ...alternatives, presentations: [{ type: "split_bill" }] });
  });

  it("rejects a draft expense even if a hypothetical answer is numerically correct", () => {
    fails("casual-hypothetical-purchase", "negation prevents even a prepared expense", { answer: "Rp3.510.000", toolCalls: [{ name: "prepare_expense" }] });
    fails("casual-hypothetical-purchase", "situ does not become all cash", toolResult("get_account_balances", { selection: { mode: "total" } }, {}, "Rp3.510.000"));
  });

  it("requires both fuzzy candidates and excludes cross-account/day decoys", () => {
    fails("casual-fuzzy-transaction-reference", "both candidates exposed instead of arbitrary choice", { answer: "It was Cafe Rp58.000." });
    fails("casual-fuzzy-transaction-reference", "both plausible matches retrieved completely", toolResult("find_transactions", {}, { complete: true, transactions: [{ id: 300 }, { id: 302 }] }, "52000 58000"));
    const r = toolResult("find_transactions", { startDate: Date.parse("2026-08-30T00:00:00+07:00"), endDate: Date.parse("2026-08-30T23:59:59.999+07:00"), filters: { accountId: 1 } }, { complete: true, transactions: [{ id: 300 }, { id: 301 }] });
    r.clarifications = [{ question: "Which one?", choices: [{ label: "Warung Rp52.000" }, { label: "Cafe Rp58.000" }] }];
    expect(checks("casual-fuzzy-transaction-reference", r).every((c) => c.passed)).toBe(true);
  });
});
