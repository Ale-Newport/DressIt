import type {
  ConsentDto,
  ConsentKind,
  GeoSearchResult,
  LocationDto,
  PreferencesDto,
  StyleProfileDto,
  UserDto,
} from '@dressit/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../client';
import { qk } from '../keys';

export function useMe(enabled = true) {
  return useQuery({ queryKey: qk.me, queryFn: () => api.get<UserDto>('/v1/me'), enabled, staleTime: 5 * 60_000 });
}

export function useUpdateMe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { displayName?: string; timezone?: string }) => api.patch<UserDto>('/v1/me', body),
    onSuccess: (user) => qc.setQueryData(qk.me, user),
  });
}

export function useSetLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (loc: LocationDto) =>
      api.put<UserDto>('/v1/me/location', {
        name: loc.name,
        // Privacy: never send more than 2 decimals (~1 km), even if the caller forgot.
        lat: roundCoord(loc.lat),
        lon: roundCoord(loc.lon),
        countryCode: loc.countryCode,
      }),
    onSuccess: (user) => {
      qc.setQueryData(qk.me, user);
      qc.invalidateQueries({ queryKey: qk.home });
      qc.invalidateQueries({ queryKey: ['weather'] });
      qc.invalidateQueries({ queryKey: ['recommendations'] });
    },
  });
}

export function roundCoord(v: number): number {
  return Math.round(v * 100) / 100;
}

export function usePreferences(enabled = true) {
  return useQuery({ queryKey: qk.preferences, queryFn: () => api.get<PreferencesDto>('/v1/me/preferences'), enabled });
}

export function useUpdatePreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<PreferencesDto>) => api.put<PreferencesDto>('/v1/me/preferences', patch),
    onSuccess: (prefs) => {
      qc.setQueryData(qk.preferences, prefs);
      qc.invalidateQueries({ queryKey: ['recommendations'] });
      qc.invalidateQueries({ queryKey: ['shopping'] });
    },
  });
}

export function useCompleteOnboarding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<UserDto>('/v1/me/onboarding/complete'),
    onSuccess: (user) => qc.setQueryData(qk.me, user),
  });
}

export function useConsents(enabled = true) {
  return useQuery({ queryKey: qk.consents, queryFn: () => api.get<ConsentDto[]>('/v1/me/consents'), enabled });
}

export function useSetConsent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ kind, granted }: { kind: ConsentKind; granted: boolean }) =>
      api.put<ConsentDto>(`/v1/me/consents/${kind}`, { granted }),
    onSuccess: (consent) => {
      qc.setQueryData<ConsentDto[]>(qk.consents, (prev) => {
        if (!prev) return [consent];
        const others = prev.filter((c) => c.kind !== consent.kind);
        return [...others, consent];
      });
    },
  });
}

export function isConsentGranted(consents: ConsentDto[] | undefined, kind: ConsentKind): boolean {
  return !!consents?.find((c) => c.kind === kind)?.granted;
}

export function useStyleProfile() {
  return useQuery({ queryKey: qk.styleProfile, queryFn: () => api.get<StyleProfileDto>('/v1/me/style-profile') });
}

/** GDPR art. 20 export: returns the raw JSON payload as a string. */
export function useExportData() {
  return useMutation({
    mutationFn: async () => {
      const data = await api.get<unknown>('/v1/me/export', undefined, { timeoutMs: 60_000 });
      return JSON.stringify(data, null, 2);
    },
  });
}

export function useDeleteAccount() {
  return useMutation({
    mutationFn: (password: string) => api.del<void>('/v1/me', { password }),
  });
}

export function useGeoSearch(q: string) {
  const query = q.trim();
  return useQuery({
    queryKey: qk.geo(query),
    queryFn: ({ signal }) => api.get<GeoSearchResult[]>('/v1/geo/search', { q: query }, { signal }),
    enabled: query.length >= 2,
    staleTime: 24 * 60 * 60_000,
  });
}
