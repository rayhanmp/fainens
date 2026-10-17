import { useMemo, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { dashboardViewStorageKey, parseDashboardViewPreferences, type DashboardViewPreferences } from './view-preferences';

export function useDashboardViewPreferences() {
  const { user } = useAuth();
  const storageKey = user?.email ? dashboardViewStorageKey(user.email) : null;
  const initial = useMemo(() => {
    try {
      return parseDashboardViewPreferences(storageKey ? window.localStorage.getItem(storageKey) : null);
    } catch {
      return parseDashboardViewPreferences(null);
    }
  }, [storageKey]);
  const [saved, setSaved] = useState({ storageKey, preferences: initial });
  const preferences = saved.storageKey === storageKey ? saved.preferences : initial;
  const updatePreferences = (next: DashboardViewPreferences) => {
    setSaved({ storageKey, preferences: next });
    try {
      if (storageKey) window.localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // The controls still work when browser storage is unavailable.
    }
  };
  return { preferences, updatePreferences };
}
