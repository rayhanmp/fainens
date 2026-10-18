/**
 * In-memory registry of agent answers being generated, keyed by conversation.
 *
 * A run is decoupled from the HTTP connection that started it: closing the tab only detaches that listener, the
 * model keeps writing and the answer is saved when it finishes. Events are buffered (consecutive text deltas merged)
 * so a client that comes back can replay what it missed and then follow the rest live. Runs live in this process, so
 * a server restart still loses an in-flight answer; the client shows those turns as interrupted with a Retry.
 */

export type AgentRunStatus = "running" | "done" | "failed" | "cancelled";

export type AgentRunEvent =
  | { type: "delta"; text: string }
  | { type: "complete"; response: unknown }
  | { type: "error"; error: string }
  | { type: "cancelled" }
  | ({ type: string } & Record<string, unknown>);

export type AgentRunListener = (event: AgentRunEvent) => void;

export type AgentRunInfo = { conversationId: number; status: AgentRunStatus; startedAt: number; finishedAt: number | null };

type AgentRun = AgentRunInfo & {
  controller: AbortController;
  events: AgentRunEvent[];
  listeners: Set<AgentRunListener>;
  cleanup: ReturnType<typeof setTimeout> | null;
};

/** How long a finished run stays replayable for a client that returns just after it ended. */
export const FINISHED_RUN_TTL_MS = 60_000;

const runs = new Map<number, AgentRun>();

const isTerminal = (event: AgentRunEvent) => event.type === "complete" || event.type === "error" || event.type === "cancelled";

function info(run: AgentRun): AgentRunInfo {
  return { conversationId: run.conversationId, status: run.status, startedAt: run.startedAt, finishedAt: run.finishedAt };
}

function record(run: AgentRun, event: AgentRunEvent) {
  if (event.type === "heartbeat") return;
  const last = run.events[run.events.length - 1];
  if (event.type === "delta" && last?.type === "delta") {
    run.events[run.events.length - 1] = { type: "delta", text: String(last.text) + String(event.text) };
  } else {
    run.events.push(event);
  }
}

function emit(run: AgentRun, event: AgentRunEvent) {
  if (run.status !== "running") return;
  record(run, event);
  for (const listener of [...run.listeners]) {
    try {
      listener(event);
    } catch {
      // A broken listener (a dead socket) must not stop the run or the other listeners.
      run.listeners.delete(listener);
    }
  }
}

function finish(run: AgentRun, status: Exclude<AgentRunStatus, "running">, event: AgentRunEvent) {
  if (run.status !== "running") return;
  emit(run, event);
  run.status = status;
  run.finishedAt = Date.now();
  run.listeners.clear();
  run.cleanup = setTimeout(() => {
    if (runs.get(run.conversationId) === run) runs.delete(run.conversationId);
  }, FINISHED_RUN_TTL_MS);
  run.cleanup.unref?.();
}

/** The run for a conversation that is still generating, if any. */
export function activeRun(conversationId: number): AgentRunInfo | null {
  const run = runs.get(conversationId);
  return run?.status === "running" ? info(run) : null;
}

/** The latest run for a conversation, running or recently finished. */
export function latestRun(conversationId: number): AgentRunInfo | null {
  const run = runs.get(conversationId);
  return run ? info(run) : null;
}

/**
 * Start generating an answer for a conversation. `execute` receives an emitter for progress and text events and an
 * abort signal that only an explicit cancel fires. Throws when the conversation already has a running answer.
 */
export function startRun(
  conversationId: number,
  execute: (emit: (event: AgentRunEvent) => void, signal: AbortSignal) => Promise<unknown>,
): AgentRunInfo {
  const existing = runs.get(conversationId);
  if (existing?.status === "running") throw new AgentRunConflictError();
  if (existing?.cleanup) clearTimeout(existing.cleanup);
  const run: AgentRun = {
    conversationId,
    status: "running",
    startedAt: Date.now(),
    finishedAt: null,
    controller: new AbortController(),
    events: [],
    listeners: new Set(),
    cleanup: null,
  };
  runs.set(conversationId, run);
  void (async () => {
    try {
      const response = await execute((event) => emit(run, event), run.controller.signal);
      finish(run, "done", { type: "complete", response });
    } catch (error) {
      if (run.controller.signal.aborted) finish(run, "cancelled", { type: "cancelled" });
      else finish(run, "failed", { type: "error", error: error instanceof Error ? error.message : "Failed to answer agent query" });
    }
  })();
  return info(run);
}

/**
 * Follow a run: replays every buffered event, then streams new ones until the run ends. Returns null when there is no
 * run to follow, otherwise an unsubscribe function. A finished run replays fully, ending with its terminal event.
 */
export function subscribe(conversationId: number, listener: AgentRunListener): (() => void) | null {
  const run = runs.get(conversationId);
  if (!run) return null;
  for (const event of run.events) listener(event);
  if (run.status !== "running" || run.events.some(isTerminal)) return () => undefined;
  run.listeners.add(listener);
  return () => { run.listeners.delete(listener); };
}

/** Stop a running answer. Returns false when nothing was running. */
export function cancelRun(conversationId: number): boolean {
  const run = runs.get(conversationId);
  if (!run || run.status !== "running") return false;
  run.controller.abort();
  finish(run, "cancelled", { type: "cancelled" });
  return true;
}

export class AgentRunConflictError extends Error {
  constructor() {
    super("This conversation is already answering. Wait for it to finish or stop it first.");
    this.name = "AgentRunConflictError";
  }
}

/** Test hook: forget every run and its timers. */
export function resetAgentRuns() {
  for (const run of runs.values()) if (run.cleanup) clearTimeout(run.cleanup);
  runs.clear();
}
