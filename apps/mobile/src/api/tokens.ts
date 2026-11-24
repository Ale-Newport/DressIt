import type { AuthTokens } from '@dressit/shared';
import * as SecureStore from 'expo-secure-store';

/** Persisted session tokens with an absolute expiry for proactive refresh. */
export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms when the access token expires. */
  expiresAt: number;
}

export interface TokenStore {
  get(): Promise<StoredTokens | null>;
  set(tokens: StoredTokens | null): Promise<void>;
}

export function toStoredTokens(tokens: AuthTokens, now = Date.now()): StoredTokens {
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: now + Math.max(0, tokens.expiresIn) * 1000,
  };
}

/** In-memory store (tests, or as a cache in front of SecureStore). */
export function createMemoryTokenStore(initial: StoredTokens | null = null): TokenStore {
  let value = initial;
  return {
    async get() {
      return value;
    },
    async set(t) {
      value = t;
    },
  };
}

const KEY = 'dressit.session.v1';

/**
 * Keychain / Keystore backed store with an in-memory cache. Tokens never touch
 * AsyncStorage.
 */
export function createSecureTokenStore(): TokenStore {
  let cache: StoredTokens | null | undefined;
  return {
    async get() {
      if (cache !== undefined) return cache;
      try {
        const raw = await SecureStore.getItemAsync(KEY);
        cache = raw ? (JSON.parse(raw) as StoredTokens) : null;
      } catch {
        cache = null;
      }
      return cache;
    },
    async set(t) {
      cache = t;
      if (t) {
        await SecureStore.setItemAsync(KEY, JSON.stringify(t), {
          keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
        });
      } else {
        await SecureStore.deleteItemAsync(KEY);
      }
    },
  };
}
