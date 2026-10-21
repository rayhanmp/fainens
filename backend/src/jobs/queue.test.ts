import { describe, expect, it, vi } from "vitest";

// The real queues would connect to Redis as the module loads; these tests only need the helper.
vi.mock("bullmq", () => ({ Queue: class { name = "stub"; } }));

import { addFresh } from "./queue";

/** A stand-in queue holding one job under an id, in a given state. */
function queueWith(state: string | null) {
  const job = state ? { getState: vi.fn(async () => state), remove: vi.fn(async () => undefined) } : null;
  const queue = {
    getJob: vi.fn(async () => job),
    add: vi.fn(async () => ({ id: "new" })),
  };
  return { queue, job };
}

describe("adding a job under a fixed id", () => {
  it("clears a finished job first, so a retry or a later boot actually runs", async () => {
    for (const state of ["completed", "failed"]) {
      const { queue, job } = queueWith(state);
      await addFresh(queue as never, "conversation-title", { taskId: "t1" }, { jobId: "task-t1" });
      expect(job!.remove).toHaveBeenCalledOnce();
      expect(queue.add).toHaveBeenCalledWith("conversation-title", { taskId: "t1" }, { jobId: "task-t1" });
    }
  });

  it("leaves a job that's waiting or running, so the work isn't done twice", async () => {
    for (const state of ["waiting", "active", "delayed"]) {
      const { queue, job } = queueWith(state);
      const result = await addFresh(queue as never, "gmail-sync", undefined, { jobId: "recurring-gmail-sync" });
      expect(result).toBe(job);
      expect(job!.remove).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    }
  });

  it("adds a job when none has that id", async () => {
    const { queue } = queueWith(null);
    await addFresh(queue as never, "gmail-sync", undefined, { jobId: "recurring-gmail-sync" });
    expect(queue.add).toHaveBeenCalledOnce();
  });
});
