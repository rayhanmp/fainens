import { useCallback, useEffect, useRef } from 'react';
import { toast } from '../../../components/ui/useToast';
import { useUpdateGoalMutation } from '../queries';

const SAVE_AFTER_MS = 600;

/**
 * Saves a goal's type figures as they're typed: changes gather for a moment and go as one save,
 * merged into what the goal already has. Whatever is still waiting is saved when the page closes.
 */
export function useTypeDataSaver(goalId: number, typeData: Record<string, unknown>) {
  const update = useUpdateGoalMutation();
  const mutate = useRef(update.mutate);
  const latest = useRef(typeData);
  const pending = useRef<Record<string, unknown>>({});
  const timer = useRef<number | null>(null);
  useEffect(() => { mutate.current = update.mutate; }, [update.mutate]);
  useEffect(() => { latest.current = typeData; }, [typeData]);

  const flush = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    const patch = pending.current;
    pending.current = {};
    if (!Object.keys(patch).length) return;
    const next = { ...latest.current, ...patch };
    latest.current = next;
    mutate.current({ id: goalId, typeData: next }, { onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not save') });
  }, [goalId]);

  useEffect(() => () => flush(), [flush]);

  return useCallback((patch: Record<string, unknown>) => {
    pending.current = { ...pending.current, ...patch };
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, SAVE_AFTER_MS);
  }, [flush]);
}
