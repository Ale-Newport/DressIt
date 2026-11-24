/**
 * Weather from Open-Meteo (https://open-meteo.com, data CC BY 4.0).
 * Free endpoint = non-commercial use only; set OPEN_METEO_API_KEY for the commercial
 * customer endpoint. Forecasts are cached per ~11 km grid cell and day (no personal data).
 */
import type { DayWeatherDto, GeoSearchResult, HourlyWeatherDto } from '@dressit/shared';
import type { DayConditions } from '@dressit/stylist-engine';
import type { Database } from '../../db/index.ts';
import { timed } from '../../lib/metrics.ts';
import { unavailable } from '../../lib/errors.ts';

interface OpenMeteoForecast {
  timezone: string;
  hourly: {
    time: string[];
    temperature_2m: number[];
    apparent_temperature: number[];
    precipitation_probability: Array<number | null>;
    precipitation: number[];
    wind_speed_10m: number[];
    relative_humidity_2m: number[];
    uv_index: Array<number | null>;
    weather_code: number[];
  };
}

const HOURLY = 'temperature_2m,apparent_temperature,precipitation_probability,precipitation,wind_speed_10m,relative_humidity_2m,uv_index,weather_code';
const CACHE_TTL_MS = 60 * 60 * 1000;

export interface Fetcher {
  (url: string, init?: RequestInit): Promise<Response>;
}

export class WeatherService {
  private readonly db: Database;
  private readonly apiKey: string | undefined;
  private readonly fetcher: Fetcher;
  constructor(db: Database, apiKey: string | undefined, fetcher: Fetcher = fetch) {
    this.db = db;
    this.apiKey = apiKey;
    this.fetcher = fetcher;
  }

  get provider(): string {
    return this.apiKey ? 'open-meteo (comercial)' : 'open-meteo (gratuito, no comercial)';
  }

  private forecastUrl(lat: number, lon: number): string {
    const base = this.apiKey ? 'https://customer-api.open-meteo.com/v1/forecast' : 'https://api.open-meteo.com/v1/forecast';
    const p = new URLSearchParams({ latitude: lat.toFixed(2), longitude: lon.toFixed(2), hourly: HOURLY, timezone: 'auto', forecast_days: '16', wind_speed_unit: 'kmh' });
    if (this.apiKey) p.set('apikey', this.apiKey);
    return `${base}?${p}`;
  }

  /** Fetch (or read cached) hourly forecast for the grid cell containing lat/lon. */
  async forecast(lat: number, lon: number, date: string): Promise<{ data: OpenMeteoForecast; fetchedAt: Date; stale: boolean }> {
    const gridLat = Math.round(lat * 10) / 10;
    const gridLon = Math.round(lon * 10) / 10;
    const cached = await this.db
      .selectFrom('weather_snapshots')
      .select(['payload', 'fetched_at'])
      .where('provider', '=', 'open-meteo')
      .where('grid_lat', '=', gridLat)
      .where('grid_lon', '=', gridLon)
      .where('valid_date', '=', date)
      .executeTakeFirst();
    if (cached && Date.now() - cached.fetched_at.getTime() < CACHE_TTL_MS) {
      return { data: cached.payload as unknown as OpenMeteoForecast, fetchedAt: cached.fetched_at, stale: false };
    }
    try {
      const data = await timed('open-meteo', async () => {
        const res = await this.fetcher(this.forecastUrl(gridLat, gridLon), { signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
        return (await res.json()) as OpenMeteoForecast;
      });
      // One row per day, each holding only that day's hours.
      const days = [...new Set(data.hourly.time.map((t) => t.slice(0, 10)))];
      const now = new Date();
      const rows = days.map((d) => {
        const idx = data.hourly.time.flatMap((t, i) => (t.startsWith(d) ? [i] : []));
        const hourly = Object.fromEntries(
          Object.entries(data.hourly).map(([k, arr]) => [k, idx.map((i) => (arr as unknown[])[i])]),
        ) as OpenMeteoForecast['hourly'];
        const payload = JSON.stringify({ timezone: data.timezone, hourly });
        return { provider: 'open-meteo', grid_lat: gridLat, grid_lon: gridLon, valid_date: d, timezone: data.timezone, payload, fetched_at: now };
      });
      if (rows.length) {
        await this.db
          .insertInto('weather_snapshots')
          .values(rows)
          .onConflict((oc) =>
            oc.columns(['provider', 'grid_lat', 'grid_lon', 'valid_date']).doUpdateSet((eb) => ({
              payload: eb.ref('excluded.payload'),
              fetched_at: eb.ref('excluded.fetched_at'),
              timezone: eb.ref('excluded.timezone'),
            })),
          )
          .execute();
      }
      return { data, fetchedAt: now, stale: false };
    } catch (e) {
      if (cached) return { data: cached.payload as unknown as OpenMeteoForecast, fetchedAt: cached.fetched_at, stale: true };
      throw unavailable('No se pudo obtener la previsión meteorológica en este momento.', { cause: (e as Error).message });
    }
  }

  async day(params: { lat: number; lon: number; locationName: string; date: string; window: { start: string; end: string } }): Promise<DayWeatherDto> {
    const { data, fetchedAt, stale } = await this.forecast(params.lat, params.lon, params.date);
    return summarizeDay(data, { ...params, provider: this.provider, fetchedAt, stale });
  }

  async geocode(q: string): Promise<GeoSearchResult[]> {
    const p = new URLSearchParams({ name: q, count: '10', language: 'es', format: 'json' });
    const res = await timed('open-meteo-geocoding', () => this.fetcher(`https://geocoding-api.open-meteo.com/v1/search?${p}`, { signal: AbortSignal.timeout(6000) })).catch(() => null);
    if (!res || !res.ok) throw unavailable('El buscador de ciudades no está disponible ahora mismo.');
    const json = (await res.json()) as { results?: Array<{ name: string; admin1?: string; country?: string; country_code?: string; latitude: number; longitude: number }> };
    return (json.results ?? []).map((r) => ({
      name: r.name,
      admin1: r.admin1 ?? null,
      country: r.country ?? null,
      countryCode: r.country_code ?? null,
      lat: Math.round(r.latitude * 100) / 100,
      lon: Math.round(r.longitude * 100) / 100,
    }));
  }
}

const WMO_RAIN = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]);

function partOfDay(hour: number): string {
  if (hour < 12) return 'por la mañana';
  if (hour < 15) return 'a mediodía';
  if (hour < 21) return 'por la tarde';
  return 'por la noche';
}

/** Turn the hourly forecast into the user's day window profile + a Spanish summary. */
export function summarizeDay(
  data: OpenMeteoForecast,
  p: { date: string; window: { start: string; end: string }; locationName: string; provider: string; fetchedAt: Date; stale: boolean },
): DayWeatherDto {
  const h = data.hourly;
  const hourly: HourlyWeatherDto[] = [];
  for (let i = 0; i < h.time.length; i++) {
    const t = h.time[i]!;
    if (!t.startsWith(p.date)) continue;
    hourly.push({
      time: t,
      temperature: h.temperature_2m[i]!,
      apparentTemperature: h.apparent_temperature[i]!,
      precipitationProbability: h.precipitation_probability[i] ?? 0,
      precipitation: h.precipitation[i] ?? 0,
      windSpeed: h.wind_speed_10m[i]!,
      humidity: h.relative_humidity_2m[i]!,
      uvIndex: h.uv_index[i] ?? 0,
      weatherCode: h.weather_code[i] ?? 0,
    });
  }
  if (hourly.length === 0) throw unavailable('No hay previsión para esa fecha (máximo 16 días).');
  const startH = Number(p.window.start.slice(0, 2));
  const endH = Number(p.window.end.slice(0, 2));
  const inWindow = hourly.filter((x) => {
    const hr = Number(x.time.slice(11, 13));
    return hr >= startH && hr <= endH;
  });
  const w = inWindow.length ? inWindow : hourly;
  const min = (f: (x: HourlyWeatherDto) => number) => Math.min(...w.map(f));
  const max = (f: (x: HourlyWeatherDto) => number) => Math.max(...w.map(f));
  const rainy = w.filter((x) => x.precipitationProbability >= 40 || x.precipitation >= 0.3 || WMO_RAIN.has(x.weatherCode));
  const rainPeriods: DayWeatherDto['rainPeriods'] = [];
  for (const x of rainy) {
    const last = rainPeriods.at(-1);
    const hr = Number(x.time.slice(11, 13));
    if (last && Number(last.to.slice(11, 13)) === hr - 1) {
      last.to = x.time;
      last.maxProbability = Math.max(last.maxProbability, x.precipitationProbability);
    } else rainPeriods.push({ from: x.time, to: x.time, maxProbability: x.precipitationProbability });
  }
  const tempMin = min((x) => x.temperature);
  const tempMax = max((x) => x.temperature);
  const probMax = max((x) => x.precipitationProbability);
  let summary = `Hoy hará entre ${Math.round(tempMin)} y ${Math.round(tempMax)} °C`;
  if (rainPeriods.length && probMax >= 40) {
    const firstHour = Number(rainPeriods[0]!.from.slice(11, 13));
    summary += `, con lluvia ${partOfDay(firstHour)}`;
  } else if (probMax >= 20) summary += ', con alguna posibilidad de lluvia';
  const windMax = max((x) => x.windSpeed);
  if (windMax >= 35) summary += ' y viento fuerte';
  const uvMax = max((x) => x.uvIndex);
  if (uvMax >= 7 && !(probMax >= 40)) summary += ' y sol intenso';
  summary += '.';
  return {
    date: p.date,
    locationName: p.locationName,
    timezone: data.timezone,
    provider: p.provider,
    fetchedAt: p.fetchedAt.toISOString(),
    window: p.window,
    tempMin,
    tempMax,
    apparentMin: min((x) => x.apparentTemperature),
    apparentMax: max((x) => x.apparentTemperature),
    tempAtStart: w[0]!.temperature,
    tempAtEnd: w.at(-1)!.temperature,
    precipitationProbabilityMax: probMax,
    precipitationSum: w.reduce((a, x) => a + x.precipitation, 0),
    rainPeriods,
    windMax,
    humidityAvg: w.reduce((a, x) => a + x.humidity, 0) / w.length,
    uvMax,
    summary,
    hourly,
    stale: p.stale,
  };
}

export function toConditions(d: DayWeatherDto): DayConditions {
  const firstRain = d.rainPeriods.find((r) => r.maxProbability >= 40);
  return {
    apparentMin: d.apparentMin,
    apparentMax: d.apparentMax,
    tempAtStart: d.tempAtStart,
    tempAtEnd: d.tempAtEnd,
    precipProbMax: d.precipitationProbabilityMax,
    precipSum: d.precipitationSum,
    windMax: d.windMax,
    humidityAvg: d.humidityAvg,
    uvMax: d.uvMax,
    rainFromHour: firstRain ? Number(firstRain.from.slice(11, 13)) : null,
  };
}
