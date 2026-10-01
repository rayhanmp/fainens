import { createFileRoute } from '@tanstack/react-router';
import { RecapsPage } from '../features/recaps/RecapsPage';

export const Route = createFileRoute('/recaps')({
  validateSearch: (search: Record<string, unknown>): { periodId?: number } => {
    const id = Number(search.periodId);
    return { periodId: Number.isSafeInteger(id) && id > 0 ? id : undefined };
  },
  component: RecapsPage,
});
