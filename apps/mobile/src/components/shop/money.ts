/** "39,95" / "39.95" / "39 €" → cents. Returns null for empty input and NaN for invalid input. */
export function parseEurosToCents(input: string): number | null {
  const s = input.trim().replace(/\s|€/g, '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return Number.NaN;
  return Math.round(n * 100);
}

/** Euros (number) from a free-text input, for query filters. */
export function parseEuros(input: string): number | undefined {
  const cents = parseEurosToCents(input);
  return cents === null || Number.isNaN(cents) ? undefined : cents / 100;
}
