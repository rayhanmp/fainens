/** Undated loans are never overdue; API flags must always be booleans. */
export function getLoanOverdueStatus(status: string, dueDate: Date | null, now = Date.now()): { isOverdue: boolean; daysOverdue: number } {
  const dueDateMs = dueDate?.getTime() ?? null;
  const isOverdue = status === "active" && dueDateMs !== null && dueDateMs < now;
  return {
    isOverdue,
    daysOverdue: isOverdue && dueDateMs !== null ? Math.floor((now - dueDateMs) / 86_400_000) : 0,
  };
}
