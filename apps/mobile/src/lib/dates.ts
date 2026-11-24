/** Local-calendar date helpers. API `date` fields are local `YYYY-MM-DD`. */

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parses `YYYY-MM-DD` as a local date (not UTC). */
export function parseISODate(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export function today(): string {
  return toISODate(new Date());
}

export function addDays(date: string, days: number): string {
  const d = parseISODate(date);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

export function diffDays(a: string, b: string): number {
  return Math.round((parseISODate(b).getTime() - parseISODate(a).getTime()) / 86_400_000);
}

/** Monday-based week start. */
export function startOfWeek(date: string): string {
  const d = parseISODate(date);
  const dow = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - dow);
  return toISODate(d);
}

export function startOfMonth(date: string): string {
  const d = parseISODate(date);
  return toISODate(new Date(d.getFullYear(), d.getMonth(), 1));
}

export function endOfMonth(date: string): string {
  const d = parseISODate(date);
  return toISODate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

export function addMonths(date: string, months: number): string {
  const d = parseISODate(date);
  return toISODate(new Date(d.getFullYear(), d.getMonth() + months, 1));
}

export function rangeDays(from: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addDays(from, i));
}

/** 6×7 grid for a month view (Monday first), padded with adjacent days. */
export function monthGrid(date: string): string[] {
  const first = startOfMonth(date);
  const start = startOfWeek(first);
  return rangeDays(start, 42);
}

export function isSameMonth(a: string, b: string): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

/** Minutes → `HH:MM`. */
export function minutesToHHMM(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function hhmmToMinutes(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Hour of the day (0–23) in the local timezone for an ISO timestamp. */
export function localHour(iso: string): number {
  return new Date(iso).getHours();
}
