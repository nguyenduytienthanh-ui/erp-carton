import { useCallback } from 'react';
import { useDebouncedValue } from './useDebouncedValue';

/**
 * Input → Intent → Query separation.
 *
 * - Input: raw values (search text, filters) — controlled, never debounced, never overwritten by API.
 * - Intent: debounced "user intent" — only updates after user stops typing (search 650ms, filters 300ms).
 * - Query: use only intent for API/URL — API must never write back to input.
 *
 * Flow: User types → input updates immediately → after debounce → intent updates → intent drives API/URL.
 */
export interface UseSearchFilterIntentConfig<TFilters> {
  /** Input layer: search text (never debounced). */
  searchInput: string;
  /** Input layer: filter values (never debounced). */
  filterValues: TFilters;
  /** Debounce ms for search intent (e.g. 650). */
  searchDebounceMs: number;
  /** Debounce ms for filter intent (e.g. 300 for snappier filter). */
  filterDebounceMs: number;
  /** Serialize filters to stable string for debounce. */
  serializeFilters: (f: TFilters) => string;
  /** Parse stable string back to filters. */
  parseFilters: (s: string) => TFilters;
}

export interface UseSearchFilterIntentResult<TFilters> {
  /** Intent layer: debounced search — use for API & URL only. */
  intentSearch: string;
  /** Intent layer: debounced filters — use for API & URL only. */
  intentFilters: TFilters;
  /** Stable string of intent filters (for dependency arrays / queryKey). */
  intentFilterStableString: string;
  /** Sync intent immediately (e.g. when applying URL or saved preferences). Does not change input. */
  setIntentImmediate: (search: string, filters: TFilters) => void;
}

export function useSearchFilterIntent<TFilters>(
  config: UseSearchFilterIntentConfig<TFilters>
): UseSearchFilterIntentResult<TFilters> {
  const {
    searchInput,
    filterValues,
    searchDebounceMs,
    filterDebounceMs,
    serializeFilters,
    parseFilters,
  } = config;

  const [intentSearch, setIntentSearchImmediate] = useDebouncedValue(
    searchInput ?? '',
    searchDebounceMs
  );

  const filterStableString = serializeFilters(filterValues);
  const [debouncedFilterString, setDebouncedFilterImmediate] = useDebouncedValue(
    filterStableString,
    filterDebounceMs
  );

  const intentFilters = parseFilters(debouncedFilterString);

  const setIntentImmediate = useCallback(
    (search: string, filters: TFilters) => {
      setIntentSearchImmediate(search);
      setDebouncedFilterImmediate(serializeFilters(filters));
    },
    [setIntentSearchImmediate, setDebouncedFilterImmediate, serializeFilters]
  );

  return {
    intentSearch: intentSearch ?? '',
    intentFilters,
    intentFilterStableString: debouncedFilterString ?? '',
    setIntentImmediate,
  };
}
