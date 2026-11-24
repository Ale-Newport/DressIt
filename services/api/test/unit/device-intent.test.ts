import { describe, expect, it } from 'vitest';
import type { DeviceIntent } from '@dressit/shared';
import { groundDeviceIntent } from '../../src/modules/assistant/service.ts';

// Today is Tuesday 2026-11-24. The intents below are real outputs of Apple's on-device model
// (Foundation Models, macOS 27.2) for these sentences, hallucinations included.
const TODAY = '2026-11-24';
const base: DeviceIntent = { kind: 'outfit', when: 'sin_fecha', weekday: null, dayOfMonth: 0, occasion: 'ninguna', formality: 0, warmth: 0, destination: '', days: 0, subcategory: 'ninguna', color: '', maxPrice: 0, garmentPhrase: '', exclude: [] };

describe('grounding the on-device reading of an assistant request', () => {
  it('drops a garment type the user never mentioned', () => {
    const g = groundDeviceIntent({ ...base, when: 'manana', weekday: 'lunes', occasion: 'trabajo', formality: 1, subcategory: 'camisa' }, '¿Qué me pongo mañana para ir a trabajar?', TODAY);
    expect(g.subcategory).toBeNull();
    expect(g.date).toBe('2026-11-25');
    expect(g.occasion).toBe('trabajo');
    // "más formal" was not asked for: the model's formality bump is ignored.
    expect(g.formality).toBe(0);
  });

  it('keeps a destination and day count that appear in the text', () => {
    const g = groundDeviceIntent({ ...base, kind: 'trip', occasion: 'viaje', destination: 'Lisboa', days: 4 }, 'Necesito ropa para un viaje de cuatro días a Lisboa', TODAY);
    expect(g).toMatchObject({ kind: 'trip', destination: 'Lisboa', days: 4 });
  });

  it('rejects an invented destination or price', () => {
    const g = groundDeviceIntent({ ...base, kind: 'trip', destination: 'París', days: 5, maxPrice: 80 }, 'me voy de viaje la semana que viene', TODAY);
    expect(g.destination).toBeNull();
    expect(g.days).toBeNull();
    expect(g.maxPrice).toBeNull();
  });

  it('resolves weekdays and "el 3" itself, only when the text says so', () => {
    expect(groundDeviceIntent({ ...base, when: 'dia_semana', weekday: 'viernes', occasion: 'boda', exclude: ['tacones'] }, 'el viernes tengo una boda y no quiero llevar tacones', TODAY)).toMatchObject({ date: '2026-11-27', occasion: 'boda', exclude: ['tacones'] });
    expect(groundDeviceIntent({ ...base, when: 'fecha', dayOfMonth: 3, occasion: 'entrevista', formality: 1 }, 'tengo una entrevista el 3 y quiero ir más formal pero sin corbata', TODAY)).toMatchObject({ date: '2026-12-03', occasion: 'entrevista', formality: 1 });
    // A weekday the text doesn't contain is ignored.
    expect(groundDeviceIntent({ ...base, when: 'dia_semana', weekday: 'lunes' }, 'qué me pongo', TODAY).date).toBeNull();
  });

  it('rejects occasion ids outside the vocabulary', () => {
    expect(groundDeviceIntent({ ...base, occasion: 'excursión' }, 'algo cómodo para el sábado que voy de excursión al monte', TODAY).occasion).toBeNull();
  });

  it('accepts a garment phrase copied from the text and a warmer request', () => {
    expect(groundDeviceIntent({ ...base, garmentPhrase: 'mis pantalones negros' }, 'quiero ir arreglada esta noche a cenar con mis pantalones negros', TODAY).garmentPhrase).toBe('mis pantalones negros');
    expect(groundDeviceIntent({ ...base, occasion: 'universidad', warmth: 1, subcategory: 'abrigo' }, 'hace un frío que pela, dame algo abrigado para la uni', TODAY)).toMatchObject({ occasion: 'universidad', warmth: 1, subcategory: null });
  });

  it('keeps shopping filters grounded in the text', () => {
    expect(groundDeviceIntent({ ...base, kind: 'shopping', when: 'hoy', subcategory: 'zapatillas', color: 'blanca', maxPrice: 80 }, 'búscame unas zapatillas blancas por menos de 80 euros', TODAY)).toMatchObject({ kind: 'shopping', subcategory: 'zapatillas', color: 'blanco', maxPrice: 80, date: null });
  });

  it('is a no-op without a device intent', () => {
    expect(groundDeviceIntent(null, 'hola', TODAY).kind).toBeNull();
  });
});
