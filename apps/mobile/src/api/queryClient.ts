import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { focusManager, onlineManager, QueryClient } from '@tanstack/react-query';
import { AppState, type AppStateStatus, Platform } from 'react-native';

import { ApiError } from './client';

/** Signed image URLs live ≤ 12 h, so the persisted cache must not outlive them. */
export const PERSIST_MAX_AGE = 12 * 60 * 60 * 1000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: PERSIST_MAX_AGE,
      // Serve cached data offline instead of failing; refetch when back online.
      networkMode: 'offlineFirst',
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
        return failureCount < 2;
      },
    },
    mutations: {
      networkMode: 'online',
      retry: false,
    },
  },
});

export const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'dressit.query-cache.v1',
  throttleTime: 1500,
});

/** Queries that must never be written to disk. */
const NON_PERSISTED_ROOTS = new Set(['export', 'geo', 'assistant', 'clipboard']);

export function shouldPersistQuery(queryKey: readonly unknown[]): boolean {
  const root = queryKey[0];
  return typeof root === 'string' && !NON_PERSISTED_ROOTS.has(root);
}

let wired = false;
/** Connect react-query to NetInfo (online state) and AppState (refetch on focus). */
export function wireReactQueryToNative() {
  if (wired) return;
  wired = true;
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => {
      setOnline(state.isConnected !== false);
    }),
  );
  const onChange = (status: AppStateStatus) => {
    if (Platform.OS !== 'web') focusManager.setFocused(status === 'active');
  };
  AppState.addEventListener('change', onChange);
}
