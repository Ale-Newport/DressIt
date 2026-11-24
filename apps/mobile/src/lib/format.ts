import type { MoneyDto } from '@dressit/shared';

import { parseISODate } from './dates';

const LOCALE = 'es-ES';

export function formatMoney(m: MoneyDto | null | undefined, opts: { compact?: boolean } = {}): string {
  if (!m) return '—';
  return formatCents(m.cents, m.currency, opts);
}

export function formatCents(cents: number, currency = 'EUR', opts: { compact?: boolean } = {}): string {
  const value = cents / 100;
  const whole = Number.isInteger(value);
  try {
    return new Intl.NumberFormat(LOCALE, {
      style: 'currency',
      currency,
      minimumFractionDigits: opts.compact && whole ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2).replace('.', ',')} ${currency === 'EUR' ? '€' : currency}`;
  }
}

export function formatNumber(n: number, digits = 0): string {
  try {
    return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: digits }).format(n);
  } catch {
    return n.toFixed(digits);
  }
}

export function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)} %`;
}

export function formatTemp(c: number): string {
  return `${Math.round(c)} °C`;
}

/**
 * "hace X" in Spanish, used for "verificado hace X". Exported for tests.
 * `now` is injectable for determinism.
 */
export function timeAgo(iso: string | null | undefined, now: number = Date.now()): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const diff = Math.max(0, now - t);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'hace 1 día';
  if (d < 30) return `hace ${d} días`;
  const mo = Math.floor(d / 30);
  if (mo === 1) return 'hace 1 mes';
  if (mo < 12) return `hace ${mo} meses`;
  const y = Math.floor(mo / 12);
  return y === 1 ? 'hace 1 año' : `hace ${y} años`;
}

const dateFmtCache = new Map<string, Intl.DateTimeFormat>();
function dtf(opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(opts);
  let f = dateFmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(LOCALE, opts);
    dateFmtCache.set(key, f);
  }
  return f;
}

/** "lunes, 24 de noviembre" */
export function formatLongDate(date: string): string {
  return dtf({ weekday: 'long', day: 'numeric', month: 'long' }).format(parseISODate(date));
}

/** "24 nov." */
export function formatShortDate(date: string): string {
  return dtf({ day: 'numeric', month: 'short' }).format(parseISODate(date));
}

/** "lun" */
export function formatWeekdayShort(date: string): string {
  return dtf({ weekday: 'short' }).format(parseISODate(date));
}

/** "noviembre de 2026" */
export function formatMonthYear(date: string): string {
  return dtf({ month: 'long', year: 'numeric' }).format(parseISODate(date));
}

/** "18:30" from an ISO timestamp. */
export function formatTime(iso: string): string {
  return dtf({ hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

/** "24 nov. 2026, 18:30" */
export function formatDateTime(iso: string): string {
  return dtf({ day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

export function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** 0–1 score → "82 %" style label; engine scores may also come as 0–100. */
export function scoreLabel(score: number): string {
  const v = score <= 1 ? score * 100 : score;
  return `${Math.round(v)} %`;
}

export function normalizeScore(score: number): number {
  return score <= 1 ? score : score / 100;
}
