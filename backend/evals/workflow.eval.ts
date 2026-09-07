import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { performance } from "node:perf_hooks";
import agentRoutes from "../src/routes/agent";
import { NOW, OWNER, PERIOD, closeFixture, ledgerSnapshot, resetFixture, sqlRows } from "./fixture";
import { check, workflows, type Result } from "./cases";
import { beginCase, installNetworkGuard, remainingReplay, restoreNetwork, rounds, setReplay } from "./provider";
import { judgeCase, writeReport, type CaseReport } from "./report";
import { efficiencyChecks } from "./efficiency";

const live = process.env.EVAL_LIVE === "1";
const selected = workflows.filter((w) => (!live || !w.offlineOnly)
  && (!process.env.EVAL_CASE || w.id.includes(process.env.EVAL_CASE))
  && (!process.env.EVAL_TAG || w.tags.includes(process.env.EVAL_TAG)));
const reports: CaseReport[] = [];
const expectedCases = selected.length * Number(process.env.EVAL_REPEATS ?? 1);

beforeAll(() => {
  if (!selected.length) throw new Error("No evaluation cases matched the requested filter");
  if (live && !process.env.EVAL_OPENROUTER_API_KEY) throw new Error("EVAL_OPENROUTER_API_KEY is required for live evaluation");
  installNetworkGuard();
  // Freeze Date without faking timers, sockets or performance.now().
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterAll(() => { writeReport(reports, expectedCases); closeFixture(); restoreNetwork(); vi.useRealTimers(); });

describe("real agent workflow evaluation", () => {
  for (const workflow of selected) {
    for (let repetition = 1; repetition <= Number(process.env.EVAL_REPEATS ?? 1); repetition++) {
      it(`${workflow.id} [${repetition}]`, async () => {
        beginCase();
        const started = performance.now();
        const report: CaseReport = { caseId: workflow.id, repetition, transport: process.env.EVAL_TRANSPORT ?? "query",
          allowedToolFailures: workflow.allowedErrors ?? 0,
          passed: false, checks: [], turns: [], rounds: [], latencyMs: 0, errors: [] };
        const app = Fastify({ logger: false });
        try {
          await resetFixture();
          workflow.setup?.();
          app.setValidatorCompiler(validatorCompiler);
          app.setSerializerCompiler(serializerCompiler);
          app.decorate("authenticate", async (request: any) => { request.user = { email: OWNER }; });
          await app.register(agentRoutes);
          await app.ready();
          const created = await app.inject({ method: "POST", url: "/api/agent/conversations", payload: { title: `Evaluation ${workflow.id}` } });
          if (created.statusCode !== 201) throw new Error(`Conversation creation failed: ${created.body}`);
          const conversationId = created.json().conversation.id;
          const previous: Result[] = [];

          for (const [turnIndex, turn] of workflow.turns.entries()) {
            turn.before?.();
            const before = ledgerSnapshot();
            setReplay(turn.script);
            const roundStart = rounds.length;
            const turnReport: CaseReport["turns"][number] = { question: turn.question, truth: turn.truth, intent: turn.intent, response: {}, completed: false };
            report.turns.push(turnReport); // Preserve the attempted user turn even if the endpoint aborts.
            const response = await app.inject({ method: "POST", url: report.transport === "stream" ? "/api/agent/query/stream" : "/api/agent/query",
              payload: { question: turn.question, conversationId, periodId: PERIOD } });
            if (response.statusCode !== 200) throw new Error(`Query returned ${response.statusCode}: ${response.body}; ${rounds.map((r) => r.error).filter(Boolean).join("; ")}`);
            let result: Result;
            if (report.transport === "stream") {
              const events = response.body.split(/\r?\n/).filter((line) => line.startsWith("data: ")).map((line) => JSON.parse(line.slice(6)));
              const failure = events.find((e) => e.type === "error");
              if (failure) throw new Error(`Streaming query failed: ${failure.error}`);
              result = events.find((e) => e.type === "complete")?.response;
              if (!result) throw new Error("Stream ended without a complete response");
              report.checks.push(check(`turn ${turnIndex + 1}: streamed visible text`, !!result.clarifications?.length || events.some((e) => e.type === "delta" && e.text)));
            } else result = response.json();

            const efficiency = efficiencyChecks(workflow.id, turnIndex, result, rounds.length - roundStart);
            Object.assign(turnReport, { response: result, efficiency, completed: true });
            report.checks.push(...efficiency.checks.map((c) => ({ ...c, name: `turn ${turnIndex + 1}: ${c.name}` })));
            report.checks.push(check(`turn ${turnIndex + 1}: ledger unchanged before approval`, before === ledgerSnapshot()));
            report.checks.push(...turn.checks(result, previous).map((c) => ({ ...c, name: `turn ${turnIndex + 1}: ${c.name}` })));
            report.checks.push(check(`turn ${turnIndex + 1}: nonempty answer or clarification`, !!result.answer?.trim() || !!result.clarifications?.length));
            if (!workflow.approval) report.checks.push(check(`turn ${turnIndex + 1}: no unsolicited proposal`, !result.pendingActions?.length));
            if (!live) report.checks.push(check(`turn ${turnIndex + 1}: replay fully consumed`, remainingReplay() === 0));
            const reload = await app.inject({ method: "GET", url: `/api/agent/conversations/${conversationId}` });
            const messages = reload.json().messages ?? [];
            report.checks.push(check(`turn ${turnIndex + 1}: conversation survives reload`, reload.statusCode === 200 && messages.length === (turnIndex + 1) * 2 && messages.at(-1)?.content === result.answer));
            report.checks.push(check(`turn ${turnIndex + 1}: usage returned and persisted`, result.usage?.calls === rounds.length - roundStart && messages.at(-1)?.usage?.totalTokens === result.usage?.totalTokens));
            const tokens = (result.pendingActions ?? []).map((p: any) => p.approvalToken).filter((t: unknown) => typeof t === "string");
            report.checks.push(check(`turn ${turnIndex + 1}: approval credentials never enter prompt or saved messages`, tokens.every((token: string) => !JSON.stringify(rounds).includes(token) && !reload.body.includes(token))));
            if (turnIndex > 0) report.checks.push(check(`turn ${turnIndex + 1}: prior conversation supplied to model`, rounds[roundStart]?.messages.some((m) => m.role === "assistant" && typeof m.content === "string" && m.content.includes(previous.at(-1)?.answer)) ?? false));
            previous.push(result);
          }

          if (workflow.approval) {
            const action = previous.at(-1)?.pendingActions?.[0];
            if (!action) throw new Error("No approval proposal was returned");
            const countBefore = sqlRows('SELECT count(*) AS n FROM "transaction"')[0].n;
            const beforeInvalidApproval = ledgerSnapshot();
            const invalidApproval = await app.inject({ method: "POST", url: `/api/agent/approvals/${action.approvalId}/execute`, payload: { token: "invalid-evaluation-token-000000" } });
            report.checks.push(check("wrong approval token cannot mutate ledger", [401, 404].includes(invalidApproval.statusCode) && ledgerSnapshot() === beforeInvalidApproval));
            const approved = await app.inject({ method: "POST", url: `/api/agent/approvals/${action.approvalId}/execute`, payload: { token: action.approvalToken } });
            const receipt = approved.json();
            report.checks.push(check("approval returns executed receipt", approved.statusCode === 200 && receipt.status === "executed", approved.statusCode === 200 ? undefined : approved.body));
            if (approved.statusCode === 200) {
              const lines = sqlRows("SELECT account_id,debit,credit,cash_flow_class FROM transaction_line WHERE transaction_id=?", receipt.receipt.transactionId);
              const expected = workflow.approval;
              report.checks.push(check("journal balances on the correct accounts", lines.length === 2
                && lines.some((l) => l.account_id === expected.debitAccount && l.debit === expected.amount && l.credit === 0)
                && lines.some((l) => l.account_id === expected.creditAccount && l.credit === expected.amount && l.debit === 0)));
              if (expected.categoryId != null) {
                const allocations = sqlRows("SELECT category_id,amount FROM transaction_category_allocation WHERE transaction_id=?", receipt.receipt.transactionId);
                report.checks.push(check("expense keeps its reporting category allocation", allocations.length === 1 && allocations[0].category_id === expected.categoryId && allocations[0].amount === expected.amount));
              } else {
                report.checks.push(check("non-expense has no expense allocation", sqlRows("SELECT * FROM transaction_category_allocation WHERE transaction_id=?", receipt.receipt.transactionId).length === 0));
              }
              if (expected.transfer) report.checks.push(check("transfer has transfer cash-flow classification", lines.every((l) => l.cash_flow_class === "transfer")));
              const replayed = await app.inject({ method: "POST", url: `/api/agent/approvals/${action.approvalId}/execute`, payload: { token: action.approvalToken } });
              report.checks.push(check("repeat approval is idempotent", replayed.statusCode === 200 && replayed.json().replay === true
                && sqlRows('SELECT count(*) AS n FROM "transaction"')[0].n === countBefore + 1));
            }
          }
          const errors = previous.flatMap((r) => (r.toolResults ?? []).filter((x: any) => x.result?.status === "error" || x.result?.data?.status === "error"));
          report.checks.push({ ...check("tool failures within case allowance", errors.length <= (workflow.allowedErrors ?? 0), `${errors.length} failure(s): ${errors.map((e: any) => `${e.name}: ${JSON.stringify(e.result.error ?? e.result.data?.error)}`).join("; ")}`), dimension: "reliability" });
          report.checks.push({ ...check("single current evidence block per round", rounds.every((r) => r.evidenceBlocks <= 1)), dimension: "reliability" });
          report.checks.push({ ...check("valid assistant/tool protocol in every round", rounds.every((r) => r.protocolErrors.length === 0), rounds.flatMap((r) => r.protocolErrors).join("; ")), dimension: "reliability" });
          report.checks.push({ ...check("no hidden provider failures", rounds.every((r) => !r.error)), dimension: "reliability" });
          report.rounds = [...rounds];
          report.latencyMs = performance.now() - started;
          if (process.env.EVAL_JUDGE_MODEL) {
            const realProvider = await vi.importActual<typeof import("../src/services/agent-llm")>("../src/services/agent-llm");
            report.judge = await judgeCase(report, realProvider.callOpenRouterAgent);
          }
        } catch (error) {
          report.errors.push(error instanceof Error ? error.message : String(error));
        } finally {
          report.rounds = [...rounds];
          if (report.latencyMs === 0) report.latencyMs = performance.now() - started;
          report.passed = report.errors.length === 0 && report.checks.every((c) => c.passed);
          reports.push(report);
          writeReport(reports, expectedCases); // Incremental artifacts survive a later case failure.
          await app.close();
        }
        expect([...report.errors, ...report.checks.filter((c) => !c.passed).map((c) => `${c.name}${c.detail ? `: ${c.detail}` : ""}`)], workflow.id).toEqual([]);
      });
    }
  }
});
