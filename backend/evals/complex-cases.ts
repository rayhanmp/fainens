import { answer, calls, load, read } from "./provider";
import { PERIOD, journal, sqlRun } from "./fixture";
import { aggregateEquals, amountChecks, check, exactIds, hasAmount, successful, used, visible, type Result, type Workflow } from "./contracts";

const ms = (date: string) => Date.parse(date);
const day = { startDate: ms("2026-08-30T00:00:00+07:00"), endDate: ms("2026-08-30T23:59:59.999+07:00") };
const searchRows = (r: Result) => successful(r, "find_transactions").flatMap((x: any) => x.result.data.transactions ?? []);
const expenseFilter = { transactionType: "expense" };
const hasCategory = (i: any, id: number, name: string) => i.categoryId === id || i.categoryName?.toLowerCase() === name.toLowerCase();
const categoryTotal = (r: Result, id: number, amount: number) => successful(r, "get_category_spending")
  .some((x: any) => x.result.data.categories?.length === 1 && x.result.data.categories[0].categoryId === id && x.result.data.totalSpentCents === amount);

// Each workflow gets its own reset fixture. Decoys deliberately distinguish
// plausible-but-wrong filters; expected amounts are independently hand-derived.
export const complexWorkflows: Workflow[] = [
  { id: "jakarta-day-boundaries", tags: ["complex", "intent", "dates", "filters"], setup: () => {
    journal(300, "Start of Jakarta day", 10_000, 10, 1, 1, PERIOD, "expense", "2026-08-30T00:00:00+07:00");
    journal(301, "End of Jakarta day", 20_000, 10, 1, 1, PERIOD, "expense", "2026-08-30T23:59:59.999+07:00");
    journal(302, "Just before day", 30_000, 10, 1, 1, PERIOD, "expense", "2026-08-29T23:59:59.999+07:00");
    journal(303, "Just after day", 40_000, 10, 1, 1, PERIOD, "expense", "2026-08-31T00:00:00+07:00");
  }, turns: [{
    question: "Total pengeluaran kemarin, 30 Agustus 2026, satu hari kalender WIB ya, bukan seluruh periode gajian. Cukup totalnya.",
    truth: "Jakarta Aug 30 includes both midnight and 23:59:59.999: 1040000 + 10000 + 20000 = 1070000 IDR, 10 expenses. Excludes the adjacent-day 30000 and 40000.",
    script: [read("summarize_transactions", { ...day, groupBy: "category", filters: expenseFilter }), answer("Total pengeluaran 30 Agustus (WIB) Rp1.070.000.")],
    checks: (r) => [...amountChecks(r, 1_070_000), check("calendar range, not inherited salary-period range", ["summarize_transactions", "get_period_summary"].some((name) => used(r, name, (i) => i.startDate === day.startDate && i.endDate >= day.endDate - 999 && i.endDate <= day.endDate && i.periodId == null))),
      check("aggregate includes only the requested local day", aggregateEquals(r, 1_070_000, 10) || successful(r, "get_period_summary").some((x: any) => x.result.data.facts?.totalSpentCents === 1_070_000)), check("no raw-row retrieval for total", !used(r, "find_transactions"))],
  }] },
  { id: "inclusive-amount-boundaries", tags: ["complex", "intent", "filters", "transactions"], setup: () => {
    journal(300, "Exactly lower limit", 150_000, 10, 1, 1, PERIOD);
    journal(301, "One rupiah below", 149_999, 10, 1, 1, PERIOD);
    journal(302, "One rupiah above", 200_001, 10, 1, 1, PERIOD);
    journal(303, "Wallet move, not spending", 175_000, 2, 1, null, PERIOD, "transfer");
  }, turns: [{
    question: "Cari pengeluaran September 2026 dari 150rb sampai 200rb, dua batasnya ikut. Maksimal 10 transaksi, bukan transfer antar rekening.",
    truth: "Exactly IDs 100/101/102/300: 200000,180000,160000,150000. Exclude 149999,200001 and the 175000 transfer.",
    script: [read("find_transactions", { periodId: PERIOD, pageSize: 10, filters: { ...expenseFilter, minAmount: 150_000, maxAmount: 200_000 } }), answer("Ada 4: Food Rp200.000, Travel Rp180.000, Shopping Rp160.000, dan Exactly lower limit Rp150.000.")],
    checks: (r) => [check("both inclusive boundaries in backend filter", used(r, "find_transactions", (i) => i.filters?.minAmount === 150_000 && i.filters?.maxAmount === 200_000 && i.pageSize === 10)),
      check("exact qualifying rows, including the boundary", exactIds(searchRows(r), [100, 101, 102, 300])), ...[200_000, 180_000, 160_000, 150_000].flatMap((n) => amountChecks(r, n))],
  }] },
  { id: "category-not-merchant", tags: ["complex", "intent", "targeting", "spending"], setup: () => {
    sqlRun('UPDATE "transaction" SET description=? WHERE id=101', "Rail ticket");
    journal(300, "Travel bookstore", 90_000, 10, 1, 3, PERIOD);
  }, turns: [{
    question: "How much did I spend in the Travel category in September 2026? I mean the category, not merchants with travel in their name. Just that category's total.",
    truth: "Travel category is the 180000 rail ticket; the 90000 Travel bookstore is Shopping and must not be included.",
    script: [read("get_category_spending", { periodId: PERIOD, categoryName: "Travel", selection: { mode: "all" } }), answer("Travel-category spending is Rp180.000.")],
    checks: (r) => [...amountChecks(r, 180_000), check("category-filtered evidence is correct", categoryTotal(r, 2, 180_000) || aggregateEquals(r, 180_000, 1)),
      check("uses category semantics, not text search", used(r, "get_category_spending", (i) => hasCategory(i, 2, "Travel")) || used(r, "summarize_transactions", (i) => i.filters?.categoryId === 2 && !i.filters?.text)),
      check("does not retrieve every category", !used(r, "get_spending_breakdown"))],
  }] },
  { id: "merchant-and-account-scope", tags: ["complex", "intent", "targeting", "transactions"], setup: () => {
    journal(300, "Shayi dinner", 45_000, 10, 1, 1, PERIOD);
    journal(301, "Shayi snack", 55_000, 10, 1, 1, PERIOD);
    journal(302, "Shayi coffee", 70_000, 10, 2, 1, PERIOD);
    journal(303, "Shopee order", 90_000, 10, 1, 3, PERIOD);
  }, turns: [{
    question: "Total belanja Shayi dari BNI di September berapa? GoPay jangan ikut. Shayi itu teks di deskripsi transaksi, bukan tag. Nggak perlu rincian satu-satu.",
    truth: "Only Shayi dinner 45000 and Shayi snack 55000 from BNI: 100000 total, 2 transactions. Exclude Shayi GoPay and Shopee BNI.",
    script: [read("find_transactions", { periodId: PERIOD, pageSize: 20, filters: { ...expenseFilter, text: "Shayi", accountId: 1 } }), answer("Total Shayi dari BNI Rp100.000, dari 2 transaksi.")],
    checks: (r) => [...amountChecks(r, 100_000), check("both merchant text and account filtered in backend", ["find_transactions", "summarize_transactions"].some((name) => used(r, name, (i) => i.filters?.accountId === 1 && i.filters?.text?.toLowerCase() === "shayi"))),
      check("complete scoped evidence, not a partial page sum", aggregateEquals(r, 100_000, 2) || successful(r, "find_transactions").some((x: any) => x.result.data.complete === true && exactIds(x.result.data.transactions ?? [], [300, 301]))), check("no tag-name detour", !used(r, "get_tags"))],
  }] },
  { id: "aggregation-beyond-page-limit", tags: ["complex", "aggregate", "scale", "efficiency"], setup: () => {
    for (let i = 0; i < 120; i++) journal(300 + i, `Small food purchase ${i + 1}`, 1000, 10, 1, 1, PERIOD);
  }, turns: [{
    question: "For September 2026, give me total expenses and their count across ALL recorded activity. Don't list transactions or total just the first page.",
    truth: "128 expenses: original 8 total 1040000 plus 120 x 1000 = 1160000 IDR. More than the maximum 100-row search page.",
    script: [read("summarize_transactions", { periodId: PERIOD, groupBy: "category", filters: expenseFilter }), answer("All 128 expenses total Rp1.160.000.")],
    checks: (r) => [...amountChecks(r, 1_160_000), check("visible count includes all 128", hasAmount(r, 128)), check("SQL aggregation covers all 128 expenses", aggregateEquals(r, 1_160_000, 128)), check("no raw-page scan for aggregate question", !used(r, "find_transactions"))],
  }] },
  { id: "corrected-account-followup", tags: ["complex", "intent", "multiturn", "context", "targeting"], setup: () => {
    journal(300, "Food from GoPay", 25_000, 10, 2, 1, PERIOD);
    journal(301, "Travel from GoPay", 70_000, 10, 2, 2, PERIOD);
  }, turns: [
    { question: "Food spending from GoPay for September 2026? Just the total.", truth: "Food+GoPay=25000; not GoPay Travel 70000 or BNI Food 200000.",
      script: [read("summarize_transactions", { periodId: PERIOD, groupBy: "category", filters: { ...expenseFilter, accountId: 2, categoryId: 1 } }), answer("Food paid from GoPay totals Rp25.000.")],
      checks: (r) => [...amountChecks(r, 25_000), check("GoPay Food evidence", aggregateEquals(r, 25_000, 1))] },
    { question: "Eh salah, maksudku BNI. Kategori dan periodenya tetep.", truth: "Replace account with BNI, retain Food and September: 200000 IDR.",
      script: [read("summarize_transactions", { periodId: PERIOD, groupBy: "category", filters: { ...expenseFilter, accountId: 1, categoryId: 1 } }), answer("Oke, Food dari BNI di September Rp200.000.")],
      checks: (r) => [...amountChecks(r, 200_000), check("corrected account retains prior category and period", used(r, "summarize_transactions", (i) => i.periodId === PERIOD && i.filters?.accountId === 1 && i.filters?.categoryId === 1)), check("BNI Food evidence", aggregateEquals(r, 200_000, 1)), check("no unnecessary re-clarification", !r.clarifications?.length)] },
    { question: "Now combine both accounts, still Food only. Total aja.", truth: "Food BNI 200000 + GoPay 25000 =225000. Do not include 70000 GoPay Travel. Reuse valid evidence or targeted aggregation.",
      script: [read("calculate", { expression: "200000 + 25000" }), answer("Total Food dari BNI dan GoPay Rp225.000.")],
      checks: (r) => [...amountChecks(r, 225_000), check("does not replace spending with wallet balances", !used(r, "get_account_balances") && !used(r, "get_account_balance"))] },
  ] },
  { id: "clarify-account-before-expense", tags: ["complex", "intent", "clarification", "multiturn", "actions", "approval"],
    approval: { debitAccount: 10, creditAccount: 2, amount: 42_000, categoryId: 1 }, turns: [
      { question: "Prepare lunch 42rb, Food, 30 August 2026 noon WIB. I paid from one of my accounts but haven't told you which. Ask before choosing; I'll approve later.",
        truth: "Payment account is materially missing. Ask one focused question; no expense proposal yet and do not assume BNI.",
        script: [calls(["ask_clarification", { question: "Which account paid for lunch?", choices: [{ id: "bni", label: "BNI" }, { id: "gopay", label: "GoPay" }] }])],
        checks: (r) => [check("asks for payment account", !!r.clarifications?.some((c: any) => /account|rekening|bayar/i.test(c.question)) || /which account|rekening mana|akun mana/i.test(r.answer ?? "")), check("no proposal before account is supplied", !r.pendingActions?.length && !used(r, "prepare_expense"))] },
      { question: "GoPay. Keep everything else the same and prepare the approval card.", truth: "Exactly one Lunch Food expense 42000 from GoPay, Aug30 noon WIB; only post after approval.",
        script: [load("prepare_expense"), calls(["prepare_expense", { amountCents: 42_000, accountId: 2, categoryId: 1, periodId: PERIOD, date: "2026-08-30T12:00:00+07:00", description: "Lunch" }]), answer("Lunch Rp42.000 dari GoPay, Food, siap kamu approve.")],
        checks: (r) => [check("one proposal uses the clarified account and retained details", r.pendingActions?.length === 1 && used(r, "prepare_expense", (i) => i.accountId === 2 && i.amountCents === 42_000 && i.categoryId === 1 && ms(i.date) === ms("2026-08-30T12:00:00+07:00")))] },
    ] },
  { id: "shared-items-friend-payer", tags: ["complex", "intent", "split-bill", "visuals", "safety"], turns: [{
    question: "Inas paid dinner, not me. My noodle 32k, her rice 48k, and 2 teas at 10k each shared equally. Discount 10k proportional, tax 9k proportional, service 5k equal. Make a split card and note how much I owe her. Calculation only, no debt or transaction.",
    truth: "Ray items42000, Inas58000 (tea LINE total20000, qty2). Discount4200/5800; tax3780/5220; service2500each. Ray owes Inas44080; Inas59920; bill104000. Inas payer, not Ray. No financial writes.",
    script: [load("show_split_bill"), calls(["show_split_bill", { type: "split_bill", title: "Dinner", payerId: "inas",
      participants: [{ id: "ray", name: "Ray" }, { id: "inas", name: "Inas" }],
      items: [{ id: "noodle", name: "Noodle", quantity: 1, amount: 32_000, participantIds: ["ray"] }, { id: "rice", name: "Rice", quantity: 1, amount: 48_000, participantIds: ["inas"] }, { id: "tea", name: "Tea", quantity: 2, amount: 20_000, participantIds: ["ray", "inas"] }],
      charges: { tax: 9000, service: 5000, discount: 10000, tip: 0, taxRule: "proportional", serviceRule: "equal", discountRule: "proportional" }, note: "Ray owes Inas Rp44.080. Inas share Rp59.920; bill Rp104.000. Calculation only." }]), answer("Ray owes Inas Rp44.080. Total Rp104.000; no debt recorded.")],
    checks: (r) => {
      const card = r.presentations?.find((p: any) => p.type === "split_bill");
      const participant = (name: string) => card?.participants?.find((p: any) => p.name.toLowerCase() === name)?.id;
      return [check("friend is payer, user resolved to Ray", !!participant("ray") && !!participant("inas") && card?.payerId === participant("inas")),
        check("line totals, quantities and item ownership preserved", card?.items?.length === 3 && card.items.some((i: any) => /tea/i.test(i.name) && i.quantity === 2 && i.amount === 20_000 && i.participantIds.length === 2 && i.participantIds.includes(participant("ray")) && i.participantIds.includes(participant("inas"))) && card.items.some((i: any) => /noodle/i.test(i.name) && i.amount === 32_000 && i.participantIds.length === 1 && i.participantIds[0] === participant("ray")) && card.items.some((i: any) => /rice/i.test(i.name) && i.amount === 48_000 && i.participantIds.length === 1 && i.participantIds[0] === participant("inas"))),
        check("discount, tax and service allocation rules preserved", card?.charges?.discount === 10_000 && card.charges.discountRule === "proportional" && card.charges.tax === 9000 && card.charges.taxRule === "proportional" && card.charges.service === 5000 && card.charges.serviceRule === "equal"),
        ...amountChecks(r, 44_080), check("note states user owes friend", /(?:Ray|you|kamu|aku).*(?:owe|utang|hutang|bayar).*Inas/i.test(card?.note ?? ""))];
    },
  }] },
  { id: "similar-is-not-duplicate", tags: ["complex", "intent", "audit", "safety", "targeting"], setup: () => {
    for (const [id, date, reference] of [[310, "2026-08-30T12:00:00+07:00", "CAFE-A"], [311, "2026-08-29T12:00:00+07:00", "CAFE-B"], [312, "2026-08-30T12:01:00+07:00", "CAFE-A"]] as const) {
      journal(id, "Cafe latte", 35_000, 10, 1, 1, PERIOD, "expense", date);
      sqlRun('UPDATE "transaction" SET reference=? WHERE id=?', reference, id);
    }
  }, turns: [{
    question: "Does transaction 310 look duplicated? Compare its two closest matches, including references and dates. Don't delete or change anything; a similar amount alone isn't proof.",
    truth: "310 and312 share CAFE-A, amount35000, same day one minute apart: possible duplicate, not confirmed. 311 has CAFE-B on prior day and may be a separate purchase. Inspect exact details; read-only.",
    script: [read("find_similar_transactions", { transactionId: 310, selection: { mode: "top", count: 2 } }), calls(...[310, 311, 312].map((transactionId): [string, Record<string, unknown>] => ["invoke_read_tool", { name: "get_transaction", arguments: { transactionId } }])), answer("310 and 312 both have reference CAFE-A and Rp35.000 one minute apart: a possible duplicate, not confirmed. 311 has CAFE-B the previous day, so it may be a separate purchase. Nothing changed.")],
    checks: (r) => [check("exactly two similarity candidates requested", used(r, "find_similar_transactions", (i) => i.transactionId === 310 && i.selection?.mode === "top" && i.selection.count === 2)),
      check("both seeded candidates returned", successful(r, "find_similar_transactions").some((x: any) => exactIds(x.result.data.candidates ?? [], [311, 312]))), check("reference-bearing details read for all three", [310, 311, 312].every((id) => used(r, "get_transaction", (i) => i.transactionId === id))),
      check("reports references and uncertainty", /CAFE-A/.test(visible(r)) && /CAFE-B/.test(visible(r)) && /possible|potential|may|might|cannot confirm|suspect|mungkin|dugaan|belum pasti/i.test(visible(r)))],
  }] },
  { id: "partial-period-comparison", tags: ["complex", "coverage", "comparison", "uncertainty"], setup: () => journal(300, "August Food recorded", 40_000, 10, 1, 1, 1, "expense", "2026-08-15T12:00:00+07:00"), turns: [{
    question: "Compare Food spending in August and September 2026. How much did it change, and can I trust that comparison given tracking coverage? Only Food please.",
    truth: "Recorded Food Aug40000 vs Sept200000; recorded increase160000. August partial, September complete. Must not present that as a reliable actual spending increase.",
    script: [read("compare_category_spending", { periodIds: [1, PERIOD], selection: { mode: "ids", ids: [1] } }), answer("Recorded Food went from Rp40.000 to Rp200.000, up Rp160.000. August tracking is partial, so this is not a trustworthy comparison of actual spending.")],
    checks: (r) => [...[40_000, 200_000, 160_000].flatMap((n) => amountChecks(r, n)),
      check("both category scopes grounded", successful(r, "compare_category_spending").some((x: any) => [1, PERIOD].every((id) => x.result.data.periods?.some((p: any) => p.period.id === id && p.byCategory?.length === 1 && p.byCategory[0].categoryId === 1))) || (used(r, "get_category_spending", (i) => i.periodId === 1 && hasCategory(i, 1, "Food")) && used(r, "get_category_spending", (i) => i.periodId === PERIOD && hasCategory(i, 1, "Food")))),
      check("discloses incomplete comparison", /partial|incomplete|missing|belum lengkap|tidak lengkap/i.test(visible(r)) && /recorded|tracking|actual|tercatat|sebenarnya/i.test(visible(r)))],
  }] },
  { id: "hypothetical-budget-reallocation", tags: ["complex", "intent", "budget", "calculator", "safety"], turns: [{
    question: "What if I moved 50k of September's budget from Travel to Food? Tell me each new budget and remaining amount. Just simulate; don't prepare or save a budget change.",
    truth: "Food planned300000-spent200000 => new planned350000 remaining150000. Travel planned300000-spent180000 => new planned250000 remaining70000. Total budget unchanged; zero writes or proposals.",
    script: [calls(["invoke_read_tool", { name: "get_budget_category", arguments: { periodId: PERIOD, categoryId: 1 } }], ["invoke_read_tool", { name: "get_budget_category", arguments: { periodId: PERIOD, categoryId: 2 } }]), read("calculate", { expression: "(300000+50000-200000) + (300000-50000-180000)" }), answer("Hypothetically: Food budget Rp350.000, remaining Rp150.000. Travel budget Rp250.000, remaining Rp70.000. Overall budget unchanged; nothing saved.")],
    checks: (r) => [...[350_000, 150_000, 250_000, 70_000].flatMap((n) => amountChecks(r, n)), check("both current budget categories grounded", [1, 2].every((id) => used(r, "get_budget_category", (i) => i.periodId === PERIOD && i.categoryId === id)) || successful(r, "get_budget_breakdown").some((x: any) => [1, 2].every((id) => x.result.data.budgets?.some((b: any) => b.categoryId === id)))),
      check("does not invoke preparation for a hypothetical", !(r.toolCalls ?? []).some((c: any) => c.name.startsWith("prepare_")))],
  }] },
  { id: "transfer-not-spending", tags: ["complex", "intent", "accounting", "aggregate"], setup: () => {
    journal(300, "Client payment", 1_000_000, 1, 11, null, PERIOD, "income");
    journal(301, "BNI to GoPay", 250_000, 2, 1, null, PERIOD, "transfer");
    sqlRun("UPDATE transaction_line SET cash_flow_class='transfer' WHERE transaction_id=301");
  }, turns: [{
    question: "I moved money from BNI to GoPay and got a client payment this September. What's my actual spending and income, and the net of those two? Don't count my own transfer as either.",
    truth: "Spending1040000, income1000000, net -40000. Internal transfer250000 is neither spending nor income. Opening balances are not income.",
    script: [read("get_period_summary", { periodId: PERIOD }), answer("Spending Rp1.040.000; income Rp1.000.000; net -Rp40.000 (deficit). The Rp250.000 internal transfer is neither income nor expense.")],
    checks: (r) => [...[1_040_000, 1_000_000, 40_000].flatMap((n) => amountChecks(r, n)), check("ledger excludes transfer from both totals", successful(r, "get_period_summary").some((x: any) => x.result.data.facts?.totalSpentCents === 1_040_000 && x.result.data.facts?.totalIncomeCents === 1_000_000) || aggregateEquals(r, 1_040_000, undefined, 1_000_000)),
      check("net direction is negative", /deficit|defisit|negative|negatif|minus|[-−]\s*(?:Rp\s*)?40[.,]?000/i.test(visible(r)))],
  }] },
  { id: "income-not-expense-approval", tags: ["complex", "intent", "actions", "approval", "accounting"],
    setup: () => sqlRun("UPDATE account SET system_key='auto-income' WHERE id=11"), approval: { debitAccount: 1, creditAccount: 11, amount: 1_500_000 }, turns: [{
      question: "Client paid me a freelance fee of 1,5 jt into BNI on 30 August 2026, noon WIB. Prepare it as income for my approval, not an expense or transfer.",
      truth: "1,5 jt means1500000 whole IDR. Income proposal debits BNI and credits revenue, exactly once on approval; no expense category allocation.",
      script: [load("prepare_income"), calls(["prepare_income", { amountCents: 1_500_000, accountId: 1, periodId: PERIOD, date: "2026-08-30T12:00:00+07:00", description: "Freelance fee" }]), answer("Freelance income Rp1.500.000 into BNI is ready for approval; not posted yet.")],
      checks: (r) => [check("one correctly interpreted income proposal", r.pendingActions?.length === 1 && used(r, "prepare_income", (i) => i.amountCents === 1_500_000 && i.accountId === 1)), check("does not prepare expense or transfer", !used(r, "prepare_expense") && !used(r, "prepare_transfer"))],
    }] },
];
