import { answer, calls, load, read } from "./provider";
import { BNI_BALANCE, PERIOD, journal } from "./fixture";
import { aggregateEquals, amountChecks, check, exactIds, hasAmount, successful, used, visible, type Result, type Workflow } from "./contracts";

const yesterday = { startDate: Date.parse("2026-08-30T00:00:00+07:00"), endDate: Date.parse("2026-08-30T23:59:59.999+07:00") };
const dayMatches = (i: any) => i.startDate === yesterday.startDate && i.endDate >= yesterday.endDate - 999 && i.endDate <= yesterday.endDate;
const datedYesterday = (i: any) => Date.parse(i.date) >= yesterday.startDate && Date.parse(i.date) <= yesterday.endDate;
const proposed = (r: Result) => (r.pendingActions?.length ?? 0) > 0 || (r.toolCalls ?? []).some((c: any) => c.name.startsWith("prepare_"));
export const choiceText = (r: Result) => `${visible(r)}\n${JSON.stringify(r.clarifications ?? [])}`;
export function asksAbout(r: Result, subject: RegExp) {
  return (r.clarifications ?? []).some((c: any) => subject.test(`${c.question} ${JSON.stringify(c.choices)}`))
    || String(r.answer ?? "").split(/(?<=[.!?])\s+|\n/).some((sentence) => /\?/.test(sentence) && subject.test(sentence));
}
const readBalance = (r: Result, id: number, amount: number) => successful(r, "get_account_balance")
  .some((x: any) => (x.result.data ?? x.result).accounts?.some((a: any) => a.id === id && a.balanceCents === amount));
const oneClarification = (question: string, labels: string[]) => calls(["ask_clarification", {
  question, choices: labels.map((label, i) => ({ id: `option-${i + 1}`, label })),
}]);
const intent = (decision: "infer" | "clarify" | "conditional", reason: string) => ({ decision, reason });

// Natural user wording is deliberately NOT repaired before the candidate sees
// it. Oracle notes explain which uncertainty matters and stay evaluator-only.
export const casualWorkflows: Workflow[] = [
  { id: "casual-bank-typo", tags: ["casual", "typos", "intent", "targeting"], turns: [{
    question: "bnni sisa brp sih skrg? yg bank ya bkn gopay wkwk",
    intent: intent("infer", "BNI is the only matching bank in the account context; repeated n is harmless, not financial ambiguity."),
    truth: "Resolve bnni to BNI, ID1, current balance3960000. Do not ask which bank or retrieve all balances.",
    script: [read("get_account_balance", { accountId: 1 }), answer("BNI sekarang Rp3.960.000.")],
    checks: (r) => [...amountChecks(r, BNI_BALANCE), check("typo resolved to the exact bank", used(r, "get_account_balance", (i) => i.accountId === 1 || i.accountName?.toLowerCase() === "bni") && readBalance(r, 1, BNI_BALANCE)),
      check("no clarification for obvious bank typo", !r.clarifications?.length && !asksAbout(r, /maksud|mean|which|bank mana|rekening mana|bni.*(?:betul|benar|ya)/i)), check("no all-account detour", !used(r, "get_account_balances"))],
  }] },
  { id: "casual-month-confusion", tags: ["casual", "ambiguity", "intent", "dates", "multiturn"],
    setup: () => journal(300, "Earlier calendar-month lunch", 75_000, 10, 1, 1, 1, "expense", "2026-08-10T12:00:00+07:00"), turns: [
      { question: "total bulan ini dong... eh yg kalender apa gajian ya, gw lupa",
        intent: intent("clarify", "User explicitly expresses unresolved scope choice. Current calendar month and active salary period have different totals."),
        truth: "Frozen clock Aug31; calendar August differs from active September salary period. Ask which basis the user wants, not assume either or report an unlabeled total.",
        script: [oneClarification("Mau hitung bulan kalender Agustus atau periode gajian September?", ["Kalender Agustus", "Periode gajian September"])],
        checks: (r) => [check("clarifies calendar versus salary period", asksAbout(r, /kalender|calendar/i) && asksAbout(r, /gaji|salary|pay period/i)), check("no unsupported spending answer before scope is resolved", !hasAmount(r, 1_040_000) && !hasAmount(r, 1_115_000))] },
      { question: "yg dr tgl 25 itu loh",
        intent: intent("infer", "Follow-up identifies the active salary period starting Aug25; it is not a new custom date range."),
        truth: "September salary period2 starts Aug25. Its spending1040000 excludes the earlier calendar-month75000 expense. Retain context and do not re-ask.",
        script: [read("get_period_summary", { periodId: PERIOD }), answer("Oke, periode gajian dari 25 Agustus: total Rp1.040.000.")],
        checks: (r) => [...amountChecks(r, 1_040_000), check("elliptical date selects the salary period", used(r, "get_period_summary", (i) => i.periodId === PERIOD) || used(r, "summarize_transactions", (i) => i.periodId === PERIOD)),
          check("scope total grounded", successful(r, "get_period_summary").some((x: any) => x.result.data?.facts?.totalSpentCents === 1_040_000) || aggregateEquals(r, 1_040_000)), check("does not re-ask the resolved period", !r.clarifications?.length)] },
    ] },
  { id: "casual-uncertain-amount", tags: ["casual", "typos", "ambiguity", "multiturn", "approval"],
    approval: { debitAccount: 10, creditAccount: 1, amount: 35_000, categoryId: 1 }, turns: [
      { question: "catetin kopi 35/350rb dr bni kmrn, typo gw keknya",
        intent: intent("clarify", "Two explicitly competing amounts affect a proposed ledger entry; do not silently pick the plausible coffee price."),
        truth: "Amount could be35000 or350000. Ask which amount; BNI and yesterday are already supplied. No proposal until amount is resolved.",
        script: [oneClarification("Kopinya Rp35.000 atau Rp350.000?", ["Rp35.000", "Rp350.000"])],
        checks: (r) => [check("asks about the uncertain amount", asksAbout(r, /35|350|amount|nominal|jumlah|harga/i)), check("no guessed proposal", !proposed(r))] },
      { question: "35rb lah wkwk. food ya",
        intent: intent("infer", "Use the corrected35k and added category, retaining BNI and yesterday from the previous turn."),
        truth: "One Food coffee expense35000 BNI, Aug30 Jakarta. Pending until approval; amount is not35 or350000.",
        script: [load("prepare_expense"), calls(["prepare_expense", { amountCents: 35_000, accountId: 1, categoryId: 1, periodId: PERIOD, date: "2026-08-30T12:00:00+07:00", description: "Kopi" }]), answer("Kopi Rp35.000 dari BNI, Food, untuk kemarin. Siap di-approve.")],
        checks: (r) => [check("resolved amount retains payment and date", r.pendingActions?.length === 1 && used(r, "prepare_expense", (i) => i.amountCents === 35_000 && i.accountId === 1 && i.categoryId === 1 && datedYesterday(i))), check("no repeated clarification", !r.clarifications?.length)] },
    ] },
  { id: "casual-in-message-correction", tags: ["casual", "typos", "intent", "negation", "approval"],
    approval: { debitAccount: 10, creditAccount: 2, amount: 82_000, categoryId: 2 }, turns: [{
      question: "catet grab 28rb eh 82rb deng, gopey bkn bni. kmrn malem. travel ya",
      intent: intent("infer", "Last correction wins:82k and GoPay. gopey is a spelling error, not a new account. Yesterday evening is approximate but sufficient."),
      truth: "Prepare one Travel expense82000 from GoPay, Aug30 evening Jakarta. Not28000, notBNI. Do not ask to reconfirm a clear self-correction.",
      script: [load("prepare_expense"), calls(["prepare_expense", { amountCents: 82_000, accountId: 2, categoryId: 2, periodId: PERIOD, date: "2026-08-30T20:00:00+07:00", description: "Grab" }]), answer("Grab Rp82.000 dari GoPay, Travel, kemarin malam. Siap di-approve.")],
      checks: (r) => [check("latest amount and account override earlier words", r.pendingActions?.length === 1 && used(r, "prepare_expense", (i) => i.amountCents === 82_000 && i.accountId === 2 && i.categoryId === 2 && datedYesterday(i))),
        check("evening is not silently changed to morning", used(r, "prepare_expense", (i) => datedYesterday(i) && Date.parse(i.date) >= yesterday.startDate + 18 * 3600_000)), check("no unnecessary reconfirmation", !r.clarifications?.length)],
    }] },
  { id: "casual-reference-after-detour", tags: ["casual", "intent", "multiturn", "context", "calculator"], setup: () => {
    journal(300, "Food GoPay yesterday", 30_000, 10, 2, 1, PERIOD);
    journal(301, "Food BNI earlier", 40_000, 10, 1, 1, PERIOD, "expense", "2026-08-29T12:00:00+07:00");
  }, turns: [
    { question: "yg makan2 kmrn dr bni total brp?",
      intent: intent("infer", "makan2 means Food spending, kmrn means Aug30; both account and day constrain the query."),
      truth: "Food fromBNI yesterday200000. Exclude GoPay30000 and earlierBNI40000.",
      script: [read("summarize_transactions", { ...yesterday, groupBy: "category", filters: { accountId: 1, categoryId: 1, transactionType: "expense" } }), answer("Makan dari BNI kemarin total Rp200.000.")],
      checks: (r) => [...amountChecks(r, 200_000), check("all three casual constraints reach backend", ["summarize_transactions", "find_transactions"].some((name) => used(r, name, (i) => dayMatches(i) && i.filters?.accountId === 1 && i.filters?.categoryId === 1))),
        check("Food evidence excludes account and date decoys", aggregateEquals(r, 200_000, 1) || successful(r, "find_transactions").some((x: any) => x.result.data?.complete === true && exactIds(x.result.data.transactions, [100])))] },
    { question: "btw saldo gopey brp?",
      intent: intent("infer", "Brief topic switch to GoPay balance; do not overwrite the earlier meal reference."),
      truth: "GoPay balance270000 after its30000 expense. This is not the meal amount from the previous turn.",
      script: [read("get_account_balance", { accountId: 2 }), answer("GoPay Rp270.000.")],
      checks: (r) => [...amountChecks(r, 270_000), check("detour is grounded in GoPay", readBalance(r, 2, 270_000))] },
    { question: "nah yg makan tadi kalo gak jadi, bni gue skrg jd brp? simulasi aja",
      intent: intent("infer", "Return to the earlier200k Food topic, not the intervening270k GoPay balance. It is hypothetical, not a reversal request."),
      truth: "CurrentBNI3920000 + earlier meal200000 =4120000. Do not add GoPay270000. Read freshBNI; do not reverse or prepare anything.",
      script: [read("get_account_balance", { accountId: 1 }), read("calculate", { expression: "3920000 + 200000" }), answer("Kalau makan tadi nggak jadi, BNI jadi Rp4.120.000. Ini simulasi aja, transaksi tetap.")],
      checks: (r) => [...amountChecks(r, 4_120_000), check("fresh BNI used after topic switch", readBalance(r, 1, 3_920_000)), check("no reversal or proposal for hypothetical", !proposed(r)), check("reference resolved without re-asking", !r.clarifications?.length)] },
  ] },
  { id: "casual-ambiguous-transfer-direction", tags: ["casual", "ambiguity", "intent", "multiturn", "approval"],
    approval: { debitAccount: 2, creditAccount: 1, amount: 100_000, transfer: true }, turns: [
      { question: "bni sm gopay sisa brp masing2?",
        intent: intent("infer", "Two named account balances, no investment overview."),
        truth: "BNI3960000 andGoPay300000. No action requested yet.",
        script: [calls(["invoke_read_tool", { name: "get_account_balance", arguments: { accountId: 1 } }], ["invoke_read_tool", { name: "get_account_balance", arguments: { accountId: 2 } }]), answer("BNI Rp3.960.000; GoPay Rp300.000.")],
        checks: (r) => [...amountChecks(r, BNI_BALANCE), ...amountChecks(r, 300_000), check("both named balances grounded", (readBalance(r, 1, BNI_BALANCE) && readBalance(r, 2, 300_000)) || successful(r, "get_account_balances").some((x: any) => {
          const accounts = (x.result.data ?? x.result).accounts ?? [];
          return exactIds(accounts, [1, 2]) && accounts.some((a: any) => a.id === 1 && a.balanceCents === BNI_BALANCE) && accounts.some((a: any) => a.id === 2 && a.balanceCents === 300_000);
        })), check("no action during balance question", !proposed(r))] },
      { question: "pindahin 100rb dr situ ke yg satunya dong",
        intent: intent("clarify", "Both accounts were mentioned; situ does not uniquely identify source. Wrong direction changes ledger meaning."),
        truth: "Ask BNI→GoPay orGoPay→BNI. No transfer proposal before direction is known; do not infer source from balance size.",
        script: [oneClarification("Dari BNI ke GoPay, atau sebaliknya?", ["BNI → GoPay", "GoPay → BNI"])],
        checks: (r) => [check("asks for transfer direction", asksAbout(r, /BNI/i) && asksAbout(r, /GoPay/i)), check("no guessed transfer direction", !proposed(r))] },
      { question: "dr bni ke gopay ya, skrg",
        intent: intent("infer", "Resolve direction and retain100k from the preceding turn, use current frozen date."),
        truth: "One100000 transfer fromBNI toGoPay datedAug31 Jakarta. Only post through approval.",
        script: [load("prepare_transfer"), calls(["prepare_transfer", { amountCents: 100_000, accountId: 1, toAccountId: 2, periodId: PERIOD, date: "2026-08-31T12:00:00+07:00", description: "BNI to GoPay" }]), answer("Transfer Rp100.000 BNI ke GoPay siap di-approve.")],
        checks: (r) => [check("direction and retained amount match clarification", r.pendingActions?.length === 1 && used(r, "prepare_transfer", (i) => i.accountId === 1 && i.toAccountId === 2 && i.amountCents === 100_000)), check("no repeated direction question", !r.clarifications?.length)] },
    ] },
  { id: "casual-payer-correction", tags: ["casual", "typos", "intent", "negation", "split-bill"], turns: [{
    question: "split sm inas ya, aku yg original 58rb dia truffle80. tadinya gw mo bayarin tp akhirnya inas yg bayar semua. servis6900 bagi2, tax14490 ikut porsi. gue hrs trf brp? itung aja jgn jd utang",
    intent: intent("infer", "Final payer is Inas despite earlier plan for Ray to pay. bagi2 means equal service, ikut porsi means proportional tax. Asking amount to transfer is not asking to execute a transfer."),
    truth: "Ray owesInas67540 (58000+6090+3450). Inas91850. No loan or transfer proposal. If card exists, Inas payer and correct charge rules.",
    script: [read("calculate", { expression: "58000 + 14490*58000/138000 + 6900/2" }), answer("Kamu (Ray) perlu transfer Rp67.540 ke Inas. Hitungan aja, nggak dicatat sebagai utang.")],
    checks: (r) => [...amountChecks(r, 67_540), check("repayment direction follows the corrected payer", /(?:Ray|kamu|you|lu).*(?:transfer|trf|bayar|owe|pay).*Inas/i.test(visible(r))),
      check("how much to transfer does not authorize transfer", !proposed(r)), check("optional card cannot contradict corrected payer", !(r.presentations ?? []).some((p: any) => p.type === "split_bill" && (!p.participants?.some((person: any) => person.id === p.payerId && /inas/i.test(person.name)) || p.charges?.serviceRule !== "equal" || p.charges?.taxRule !== "proportional")))],
  }] },
  { id: "casual-service-choice", tags: ["casual", "ambiguity", "intent", "multiturn", "split-bill"], turns: [
    { question: "split bill aku60rb inas90rb, gue bayarin. no tax. servis15rb rata apa sesuai makan ya hmm",
      intent: intent("conditional", "User has not chosen equal or proportional service. Ask or explain both alternatives; do not silently settle on one."),
      truth: "Equal service7500each ->Ray67500/Inas97500. Proportional service6000/9000 ->Ray66000/Inas99000. Ask or present both conditional outcomes, no single settled card.",
      script: [oneClarification("Service Rp15.000 mau dibagi rata atau sesuai porsi makan?", ["Rata: Rp7.500 per orang", "Sesuai porsi: Ray Rp6.000, Inas Rp9.000"])],
      checks: (r) => [check("service ambiguity is surfaced, not silently defaulted", asksAbout(r, /service|servis|rata|porsi|equal|proportional/i) || ([67_500, 97_500, 66_000, 99_000].every((n) => hasAmount(r, n)) && /rata|equal/i.test(visible(r)) && /porsi|proportional/i.test(visible(r)))),
        check("no finalized split before service choice", !(r.presentations ?? []).some((p: any) => p.type === "split_bill"))] },
    { question: "rata aja deh, bikin kartunya",
      intent: intent("infer", "Resolve equal service while retaining items, payer and no tax from the prior turn."),
      truth: "Ray payer; items60000/90000, service15000 equal, tax0. Total165000; Inas owesRay97500. No financial writes.",
      script: [load("show_split_bill"), calls(["show_split_bill", { type: "split_bill", title: "Dinner", payerId: "ray", participants: [{ id: "ray", name: "Ray" }, { id: "inas", name: "Inas" }],
        items: [{ id: "ray-food", name: "Ray food", quantity: 1, amount: 60_000, participantIds: ["ray"] }, { id: "inas-food", name: "Inas food", quantity: 1, amount: 90_000, participantIds: ["inas"] }],
        charges: { tax: 0, service: 15_000, discount: 0, tip: 0, taxRule: "proportional", serviceRule: "equal" }, note: "Inas owes Ray Rp97.500." }]), answer("Inas bayar kamu Rp97.500, service sudah dibagi rata.")],
      checks: (r) => {
        const c = r.presentations?.find((p: any) => p.type === "split_bill");
        const person = (name: string) => c?.participants?.find((p: any) => p.name.toLowerCase() === name)?.id;
        return [...amountChecks(r, 97_500), check("resolved service and prior bill details retained", c?.charges?.serviceRule === "equal" && c.charges.service === 15_000 && c.charges.tax === 0 && !!person("ray") && c.payerId === person("ray") && c.items?.length === 2 && [60_000, 90_000].every((amount, i) => c.items.some((item: any) => item.amount === amount && item.quantity === 1 && item.participantIds.length === 1 && item.participantIds[0] === person(i === 0 ? "ray" : "inas")))), check("no repeated service question", !r.clarifications?.length)];
      } },
  ] },
  { id: "casual-hypothetical-purchase", tags: ["casual", "typos", "intent", "negation", "calculator"], turns: [{
    question: "jgn dicatet dulu, kira2 kalo beli sepatu 450 rebu dr bnni sisa duit situ brp ya?",
    intent: intent("infer", "Hypothetical450k purchase fromBNI, not authorization to prepare an expense. situ refers to the named bank, not all cash."),
    truth: "CurrentBNI3960000 minus450000 =>3510000. No expense proposal, balance mutation, or all-account overview.",
    script: [read("get_account_balance", { accountId: 1 }), read("calculate", { expression: "3960000 - 450000" }), answer("Kalau beli sepatu Rp450.000, BNI sisa Rp3.510.000. Belum dicatat apa-apa.")],
    checks: (r) => [...amountChecks(r, 3_510_000), check("hypothetical uses named bank evidence", readBalance(r, 1, BNI_BALANCE)), check("negation prevents even a prepared expense", !proposed(r)), check("situ does not become all cash", !used(r, "get_account_balances"))],
  }] },
  { id: "casual-fuzzy-transaction-reference", tags: ["casual", "typos", "ambiguity", "intent", "transactions"], setup: () => {
    journal(300, "Warung lunch", 52_000, 10, 1, 1, PERIOD);
    journal(301, "Cafe dinner", 58_000, 10, 1, 1, PERIOD);
    journal(302, "GoPay snack", 55_000, 10, 2, 1, PERIOD);
    journal(303, "BNI previous day", 55_000, 10, 1, 1, PERIOD, "expense", "2026-08-29T12:00:00+07:00");
  }, turns: [{
    question: "trrx bni kmrn yg 50an itu apa ya? lupa gw",
    intent: intent("conditional", "50an is approximate50-thousand range, not exactly50 IDR or50000. Two plausible matches exist; show both or ask which one using grounded candidates."),
    truth: "YesterdayBNI has two plausible matches: Warung52000 andCafe58000. Exclude GoPay55000 and prior-dayBNI55000. Do not pretend there is a unique match or act on it.",
    script: [read("find_transactions", { ...yesterday, pageSize: 20, filters: { accountId: 1, minAmount: 50_000, maxAmount: 59_999, transactionType: "expense" } }), answer("Ada dua yang cocok: Warung lunch Rp52.000 dan Cafe dinner Rp58.000, keduanya BNI kemarin. Yang mana maksudmu?")],
    checks: (r) => [check("date and account constrain fuzzy retrieval", used(r, "find_transactions", (i) => dayMatches(i) && i.filters?.accountId === 1)),
      check("both plausible matches retrieved completely", successful(r, "find_transactions").some((x: any) => x.result.data?.complete === true && exactIds(x.result.data.transactions ?? [], [300, 301]))),
      check("both candidates exposed instead of arbitrary choice", [52_000, 58_000].every((n) => hasAmount({ answer: choiceText(r) }, n))), check("vague reference does not authorize action", !proposed(r))],
  }] },
];
