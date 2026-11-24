import type { DayWeatherDto, HomeResponse } from '@dressit/shared';
import { useQuery } from '@tanstack/react-query';

import { api } from '../client';
import { qk } from '../keys';

export function useHome() {
  return useQuery({ queryKey: qk.home, queryFn: () => api.get<HomeResponse>('/v1/home'), staleTime: 2 * 60_000 });
}

export function useDayWeather(date: string, enabled = true) {
  return useQuery({
    queryKey: qk.weather(date),
    queryFn: () => api.get<DayWeatherDto>('/v1/weather/day', { date }),
    enabled,
    staleTime: 30 * 60_000,
  });
}
