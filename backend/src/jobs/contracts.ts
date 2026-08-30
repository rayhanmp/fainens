import { z } from "zod";

export const taskJobDataSchema = z.object({ taskId: z.string().uuid() }).strict();
export const emptyJobDataSchema = z.undefined();

export const maintenanceJobNames = z.enum(["dispatch-background-tasks", "cache-invalidation-outbox", "storage-deletion-outbox", "precompute-warmup"]);
export const recurringJobNames = z.enum(["subscription-renewals", "salary-posting"]);
export const agentJobNames = z.enum(["conversation-title", "budget-outlier-review"]);

export type TaskJobData = z.infer<typeof taskJobDataSchema>;

export function parseTaskJobData(value: unknown): TaskJobData {
  return taskJobDataSchema.parse(value);
}
