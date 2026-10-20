import { QueryClient, type QueryKey } from '@tanstack/react-query';
import { createContext, useContext } from 'react';

/**
 * Practice mode lets the help docs open real app components (the transaction composer) without
 * saving anything. Two layers keep it safe:
 *  - a separate QueryClient whose every mutation is rejected and whose every query is answered from
 *    data the real app already holds (or an empty sample), so nothing reaches the server;
 *  - this context, which components check for the few things React Query can't see, such as the
 *    composer's saved draft.
 */
export const PracticeModeContext = createContext(false);

export function usePracticeMode(): boolean {
  return useContext(PracticeModeContext);
}

export class PracticeError extends Error {
  constructor() {
    super('Practice mode: nothing was saved. Close this and use Add transaction to record it for real.');
    this.name = 'PracticeError';
  }
}

/** Empty answers for queries the real app may not have cached yet. */
const EMPTY_BY_KEY: Record<string, unknown> = {
  'transaction-tag-suggestions': { tags: [] },
};

/** A QueryClient that reads from `source` (the app's own client) and refuses to write. */
export function createPracticeQueryClient(source: QueryClient): QueryClient {
  const client = new QueryClient();
  const baseQueryOptions = client.defaultQueryOptions.bind(client);
  const baseMutationOptions = client.defaultMutationOptions.bind(client);
  const answer = (key: QueryKey) => source.getQueryData(key) ?? EMPTY_BY_KEY[String(key[0])] ?? null;

  client.defaultQueryOptions = ((options) => {
    const resolved = baseQueryOptions(options);
    return { ...resolved, queryFn: () => Promise.resolve(answer(resolved.queryKey)), retry: false, staleTime: Infinity };
  }) as QueryClient['defaultQueryOptions'];

  client.defaultMutationOptions = ((options) => {
    const resolved = baseMutationOptions(options);
    return { ...resolved, mutationFn: () => Promise.reject(new PracticeError()), retry: false, onSuccess: undefined };
  }) as QueryClient['defaultMutationOptions'];

  return client;
}
