export type AccountView = 'list' | 'grid';

export type AccountViewPreferences = {
  view: AccountView;
  showPinned: boolean;
  pinnedAccountIds: number[];
};

export function accountViewStorageKey(email: string) {
  return `fainens.accounts.view:${encodeURIComponent(email)}`;
}

export function parseAccountViewPreferences(raw: string | null): AccountViewPreferences {
  const defaults: AccountViewPreferences = { view: 'list', showPinned: true, pinnedAccountIds: [] };
  if (!raw) return defaults;
  try {
    const saved: unknown = JSON.parse(raw);
    if (!saved || typeof saved !== 'object') return defaults;
    const { view, showPinned, pinnedAccountIds } = saved as Record<string, unknown>;
    return {
      view: view === 'grid' ? view : 'list',
      showPinned: typeof showPinned === 'boolean' ? showPinned : true,
      pinnedAccountIds: Array.isArray(pinnedAccountIds)
        ? [...new Set(pinnedAccountIds.filter((id): id is number => Number.isSafeInteger(id) && id > 0))]
        : [],
    };
  } catch {
    return defaults;
  }
}
