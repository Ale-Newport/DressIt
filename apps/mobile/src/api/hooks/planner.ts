import type {
  CalendarEventDto,
  CalendarEventWrite,
  DeviceCalendarSyncRequest,
  PlanDto,
  PlannerDayDto,
  PlanWrite,
  SuggestWeekRequest,
  TripDto,
  TripRequest,
} from '@dressit/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../client';
import { qk } from '../keys';

// --- Events ------------------------------------------------------------------

export function useEvents(from?: string, to?: string) {
  return useQuery({ queryKey: qk.events(from, to), queryFn: () => api.get<CalendarEventDto[]>('/v1/events', { from, to }) });
}

function invalidateCalendar(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['events'] });
  qc.invalidateQueries({ queryKey: ['planner'] });
  qc.invalidateQueries({ queryKey: qk.home });
}

export function useCreateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CalendarEventWrite) => api.post<CalendarEventDto>('/v1/events', body),
    onSuccess: () => invalidateCalendar(qc),
  });
}

export function useUpdateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: CalendarEventWrite & { id: string }) => api.patch<CalendarEventDto>(`/v1/events/${id}`, body),
    onSuccess: () => invalidateCalendar(qc),
  });
}

export function useDeleteEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<void>(`/v1/events/${id}`),
    onSuccess: () => invalidateCalendar(qc),
  });
}

export function useSyncDeviceCalendar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: DeviceCalendarSyncRequest) => api.post<{ upserted: number; removed: number }>('/v1/events/sync-device', body),
    onSuccess: () => invalidateCalendar(qc),
  });
}

// --- Planner -----------------------------------------------------------------

export function usePlanner(from: string, to: string) {
  return useQuery({ queryKey: qk.planner(from, to), queryFn: () => api.get<PlannerDayDto[]>('/v1/planner', { from, to }) });
}

export function useCreatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PlanWrite) => api.post<PlanDto>('/v1/planner', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['planner'] });
      qc.invalidateQueries({ queryKey: qk.home });
    },
  });
}

/** Move / edit a plan. Optimistically moves the card between days in every cached planner range. */
export function useUpdatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<PlanWrite> & { id: string }) => api.patch<PlanDto>(`/v1/planner/${id}`, body),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ['planner'] });
      const snapshots = qc.getQueriesData<PlannerDayDto[]>({ queryKey: ['planner'] });
      if (vars.date) {
        qc.setQueriesData<PlannerDayDto[]>({ queryKey: ['planner'] }, (days) => {
          if (!days) return days;
          const plan = days.flatMap((d) => d.plans).find((p) => p.id === vars.id);
          if (!plan) return days;
          const moved: PlanDto = { ...plan, date: vars.date!, position: vars.position ?? plan.position };
          return days.map((d) => {
            const without = d.plans.filter((p) => p.id !== vars.id);
            return d.date === vars.date ? { ...d, plans: [...without, moved] } : { ...d, plans: without };
          });
        });
      }
      return { snapshots };
    },
    onError: (_e, _v, ctx) => {
      ctx?.snapshots.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['planner'] });
      qc.invalidateQueries({ queryKey: qk.home });
    },
  });
}

export function useDeletePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<void>(`/v1/planner/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['planner'] });
      qc.invalidateQueries({ queryKey: qk.home });
    },
  });
}

export function useSuggestWeek() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SuggestWeekRequest) => api.post<PlannerDayDto[]>('/v1/planner/suggest-week', body, { timeoutMs: 60_000 }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['planner'] });
      qc.invalidateQueries({ queryKey: qk.home });
    },
  });
}

// --- Trips -------------------------------------------------------------------

export function useTrips() {
  return useQuery({ queryKey: qk.trips.all, queryFn: () => api.get<TripDto[]>('/v1/trips') });
}

export function useTrip(id: string | undefined) {
  return useQuery({
    queryKey: qk.trips.detail(id ?? ''),
    queryFn: () => api.get<TripDto>(`/v1/trips/${id}`),
    enabled: !!id,
  });
}

export function useCreateTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TripRequest) => api.post<TripDto>('/v1/trips', body, { timeoutMs: 60_000 }),
    onSuccess: (trip) => {
      qc.setQueryData(qk.trips.detail(trip.id), trip);
      qc.invalidateQueries({ queryKey: qk.trips.all });
    },
  });
}

export function useDeleteTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<void>(`/v1/trips/${id}`),
    onSuccess: (_v, id) => {
      qc.removeQueries({ queryKey: qk.trips.detail(id) });
      qc.invalidateQueries({ queryKey: qk.trips.all });
    },
  });
}

export function useTogglePacked(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ garmentId, packed }: { garmentId: string; packed: boolean }) =>
      api.patch<TripDto>(`/v1/trips/${tripId}/packing/${garmentId}`, { packed }),
    onMutate: async ({ garmentId, packed }) => {
      const key = qk.trips.detail(tripId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<TripDto>(key);
      if (prev) {
        qc.setQueryData<TripDto>(key, {
          ...prev,
          packingList: prev.packingList.map((p) => (p.garment.id === garmentId ? { ...p, packed } : p)),
        });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.trips.detail(tripId), ctx.prev);
    },
    onSuccess: (trip) => qc.setQueryData(qk.trips.detail(tripId), trip),
  });
}
