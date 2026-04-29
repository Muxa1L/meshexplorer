import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';
import { buildApiUrl } from '@/lib/api';
import type { MeshcoreSearchResult } from './useMeshcoreSearch';

interface ObserverSearchQuery {
  query: string;
  region?: string;
  lastSeen?: number | null;
  limit?: number;
  exact?: boolean;
  enabled?: boolean;
}

export function useMeshcoreObserverSearches({ searches }: { searches: ObserverSearchQuery[] }) {
  const queryConfigs = useMemo(() =>
    searches.map((searchParams, index) => {
      const {
        query,
        region,
        lastSeen,
        limit = 50,
        exact = false,
        enabled = true
      } = searchParams;
      const trimmedQuery = typeof query === 'string' ? query.trim() : String(query || '').trim();
      return {
        queryKey: ['meshcore-observer-search-batch', trimmedQuery, region, lastSeen, limit, exact],
        queryFn: async ({ signal }: { signal?: AbortSignal }): Promise<{ results: MeshcoreSearchResult[]; total: number }> => {
          const response = await fetch(buildApiUrl('/api/meshcore/search/observers'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ queries: [{ query: trimmedQuery, region, lastSeen, limit, exact }] }),
            signal,
          });
          if (!response.ok) {
            throw new Error(`Failed to execute observer search: ${response.statusText}`);
          }
          const batchResponse = await response.json();
          const results = Array.isArray(batchResponse.results) && batchResponse.results[0] ? batchResponse.results[0] : [];
          return {
            results,
            total: results.length
          };
        },
        enabled: enabled && trimmedQuery.length > 0,
        staleTime: 1000,
        gcTime: 30 * 1000,
        retry: 1,
        refetchOnWindowFocus: false,
      };
    })
  , [searches]);

  return useQueries({
    queries: queryConfigs
  });
}
