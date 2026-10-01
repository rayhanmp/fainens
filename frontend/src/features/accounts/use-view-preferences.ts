import { useMemo, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { accountViewStorageKey, parseAccountViewPreferences, type AccountViewPreferences } from './view-preferences';

export function useAccountViewPreferences() {
  const { user } = useAuth();
  const storageKey = user?.email ? accountViewStorageKey(user.email) : null;
  const initial = useMemo(() => {
    try {
      return parseAccountViewPreferences(storageKey ? window.localStorage.getItem(storageKey) : null);
    } catch {
      return parseAccountViewPreferences(null);
    }
  }, [storageKey]);
  const [saved, setSaved] = useState({ storageKey, preferences: initial });
  const preferences = saved.storageKey === storageKey ? saved.preferences : initial;

  const updatePreferences = (next: AccountViewPreferences) => {
    setSaved({ storageKey, preferences: next });
    try {
      if (storageKey) window.localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // View controls remain usable when browser storage is unavailable.
    }
  };

  return { preferences, updatePreferences };
}
