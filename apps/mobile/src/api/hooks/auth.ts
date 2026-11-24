import type { AuthResponse, LoginRequest, RegisterRequest } from '@dressit/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '../client';
import { qk } from '../keys';

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LoginRequest) => api.post<AuthResponse>('/v1/auth/login', body, { auth: false }),
    onSuccess: async (res) => {
      await api.setSession(res.tokens);
      qc.setQueryData(qk.me, res.user);
    },
  });
}

export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RegisterRequest) => api.post<AuthResponse>('/v1/auth/register', body, { auth: false }),
    onSuccess: async (res) => {
      await api.setSession(res.tokens);
      qc.setQueryData(qk.me, res.user);
    },
  });
}

/** Revokes the refresh token server-side (best effort) and wipes local session + cache. */
export async function logout(clear: () => void) {
  const stored = await api.getStoredTokens();
  if (stored?.refreshToken) {
    try {
      await api.post<void>('/v1/auth/logout', { refreshToken: stored.refreshToken }, { auth: false, timeoutMs: 8000 });
    } catch {
      // Offline logout still clears the device session.
    }
  }
  clear();
  await api.clearSession('logout');
}
