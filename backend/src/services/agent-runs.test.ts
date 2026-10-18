import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activeRun,
  AgentRunConflictError,
  cancelRun,
  FINISHED_RUN_TTL_MS,
  latestRun,
  resetAgentRuns,
  startRun,
  subscribe,
  type AgentRunEvent,
} from "./agent-runs";

/** A run whose body the test drives by hand. */
function controllableRun(conversationId: number) {
  let emit!: (event: AgentRunEvent) => void;
  let signal!: AbortSignal;
  let resolve!: (value: unknown) => void;
  let reject!: (error: unknown) => void;
  startRun(conversationId, (emitEvent, abortSignal) => {
    emit = emitEvent;
    signal = abortSignal;
    return new Promise((res, rej) => { resolve = res; reject = rej; });
  });
  return { emit: (event: AgentRunEvent) => emit(event), signal: () => signal, resolve: (v: unknown) => resolve(v), reject: (e: unknown) => reject(e) };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("agent runs", () => {
  beforeEach(() => resetAgentRuns());
  afterEach(() => { vi.useRealTimers(); resetAgentRuns(); });

  it("keeps running with no listeners and saves the result for a late subscriber", async () => {
    const run = controllableRun(1);
    const early: AgentRunEvent[] = [];
    const unsubscribe = subscribe(1, (event) => early.push(event));
    run.emit({ type: "delta", text: "Hel" });
    unsubscribe?.();
    run.emit({ type: "delta", text: "lo" });
    run.emit({ type: "heartbeat" });
    run.resolve({ answer: "Hello" });
    await flush();

    expect(early).toEqual([{ type: "delta", text: "Hel" }]);
    expect(run.signal().aborted).toBe(false);
    expect(activeRun(1)).toBeNull();
    expect(latestRun(1)?.status).toBe("done");

    const late: AgentRunEvent[] = [];
    subscribe(1, (event) => late.push(event));
    expect(late).toEqual([{ type: "delta", text: "Hello" }, { type: "complete", response: { answer: "Hello" } }]);
  });

  it("replays merged deltas and then streams live events to a reattaching listener", async () => {
    const run = controllableRun(2);
    run.emit({ type: "progress", label: "Reading" });
    run.emit({ type: "delta", text: "A" });
    run.emit({ type: "delta", text: "B" });
    const seen: AgentRunEvent[] = [];
    subscribe(2, (event) => seen.push(event));
    run.emit({ type: "delta", text: "C" });
    run.resolve({ ok: true });
    await flush();
    expect(seen).toEqual([
      { type: "progress", label: "Reading" },
      { type: "delta", text: "AB" },
      { type: "delta", text: "C" },
      { type: "complete", response: { ok: true } },
    ]);
  });

  it("refuses a second run while one is active, and allows one after it ends", async () => {
    const run = controllableRun(3);
    expect(() => startRun(3, async () => null)).toThrow(AgentRunConflictError);
    run.resolve(null);
    await flush();
    expect(() => startRun(3, async () => null)).not.toThrow();
  });

  it("cancels only on an explicit stop and reports it to listeners", async () => {
    const run = controllableRun(4);
    const seen: AgentRunEvent[] = [];
    subscribe(4, (event) => seen.push(event));
    expect(cancelRun(4)).toBe(true);
    expect(run.signal().aborted).toBe(true);
    run.reject(new Error("aborted"));
    await flush();
    expect(seen).toEqual([{ type: "cancelled" }]);
    expect(latestRun(4)?.status).toBe("cancelled");
    expect(cancelRun(4)).toBe(false);
    expect(cancelRun(999)).toBe(false);
  });

  it("reports a failure as an error event", async () => {
    const run = controllableRun(5);
    const seen: AgentRunEvent[] = [];
    subscribe(5, (event) => seen.push(event));
    run.reject(new Error("provider down"));
    await flush();
    expect(seen).toEqual([{ type: "error", error: "provider down" }]);
    expect(latestRun(5)?.status).toBe("failed");
  });

  it("forgets a finished run after the replay window", async () => {
    vi.useFakeTimers();
    let resolve!: (value: unknown) => void;
    startRun(6, () => new Promise((res) => { resolve = res; }));
    resolve("done");
    await vi.advanceTimersByTimeAsync(0);
    expect(latestRun(6)?.status).toBe("done");
    await vi.advanceTimersByTimeAsync(FINISHED_RUN_TTL_MS + 1);
    expect(latestRun(6)).toBeNull();
    expect(subscribe(6, () => undefined)).toBeNull();
  });

  it("drops a listener that throws without stopping the run", async () => {
    const run = controllableRun(7);
    subscribe(7, () => { throw new Error("socket gone"); });
    const seen: AgentRunEvent[] = [];
    subscribe(7, (event) => seen.push(event));
    run.emit({ type: "delta", text: "x" });
    run.emit({ type: "delta", text: "y" });
    run.resolve(1);
    await flush();
    expect(seen.map((event) => event.type)).toEqual(["delta", "delta", "complete"]);
  });
});
