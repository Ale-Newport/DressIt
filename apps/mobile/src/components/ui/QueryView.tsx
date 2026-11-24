import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { ErrorState } from './States';

export interface QueryViewProps<T> {
  query: Pick<UseQueryResult<T>, 'data' | 'isPending' | 'isError' | 'error' | 'refetch'>;
  loading: ReactNode;
  /** Rendered when `isEmpty(data)` is true. */
  empty?: ReactNode;
  isEmpty?: (data: T) => boolean;
  children: (data: T) => ReactNode;
  errorTitle?: string;
  compactError?: boolean;
}

/**
 * Uniform loading / error / empty / data rendering for a react-query result.
 * When cached data exists (offline), it is shown even if the refetch failed.
 */
export function QueryView<T>({ query, loading, empty, isEmpty, children, errorTitle, compactError }: QueryViewProps<T>) {
  if (query.data !== undefined) {
    if (empty && isEmpty?.(query.data)) return <>{empty}</>;
    return <>{children(query.data)}</>;
  }
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} title={errorTitle} compact={compactError} />;
  return <>{loading}</>;
}
