import { z } from 'zod';
import { badRequest } from './errors.ts';

/** Parse with zod and turn issues into a Spanish 400 error. */
export function parse<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const r = schema.safeParse(value);
  if (!r.success) {
    const first = r.error.issues[0];
    const where = first?.path.length ? ` (${first.path.join('.')})` : '';
    throw badRequest(`Datos no válidos${where}: ${first?.message ?? 'revisa los campos'}`, r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  return r.data;
}

export const uuid = z.string().uuid({ message: 'identificador no válido' });
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha con formato AAAA-MM-DD');
export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'hora con formato HH:MM');
export const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'color hexadecimal #RRGGBB');
