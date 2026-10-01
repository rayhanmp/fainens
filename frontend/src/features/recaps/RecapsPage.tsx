import { getRouteApi } from '@tanstack/react-router';
import { RequireAuth } from '../../lib/auth';
import { RecapExperience } from './RecapExperience';
import './recaps.css';

const recapRoute = getRouteApi('/recaps');

export function RecapsPage() {
  const { periodId } = recapRoute.useSearch();
  const navigate = recapRoute.useNavigate();
  return <RequireAuth><div className="recaps-page">
    <RecapExperience key={periodId ?? 'latest'} initialPeriodId={periodId} onPeriodChange={selected => { void navigate({ search: { periodId: selected }, replace: true }); }} />
  </div></RequireAuth>;
}
