import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { parseFilters, toSearchParams, type Filters } from '../lib/filters.ts';

/**
 * The movie page's screening filters, kept in the URL (`cinema`, `format`) so a filtered
 * view can be shared and reloaded. Changes replace the history entry, as date changes do.
 */
export function useFilters(): [Filters, (filters: Filters) => void] {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const filters = useMemo(() => parseFilters(params), [params]);
  const setFilters = (next: Filters) => {
    const search = toSearchParams(next, params).toString();
    void navigate(
      { search: search === '' ? '' : `?${search}` },
      { replace: true, preventScrollReset: true },
    );
  };
  return [filters, setFilters];
}
