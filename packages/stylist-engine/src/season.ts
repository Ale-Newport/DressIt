import type { Season } from '@dressit/shared';

/** Meteorological season for the northern hemisphere (Spain). */
export function seasonOf(date: string, southernHemisphere = false): Season {
  const month = Number(date.slice(5, 7));
  const north: Season = month <= 2 || month === 12 ? 'invierno' : month <= 5 ? 'primavera' : month <= 8 ? 'verano' : 'otono';
  if (!southernHemisphere) return north;
  return ({ invierno: 'verano', verano: 'invierno', primavera: 'otono', otono: 'primavera' } as const)[north];
}
