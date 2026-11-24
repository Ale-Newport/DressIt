import type { WardrobeStatsDto } from '@dressit/shared';

import { describeGarmentPhoto, intelligenceStatus, liftSubjectPreview, readAssistantRequest, summarizeFacts, todayPhrase, unavailableReason } from '@/lib/intelligence';
import { wardrobeFacts } from '@/lib/summaries';

import { garment } from '../fixtures';

describe('on-device intelligence without the native module (Android, tests, old iPhones)', () => {
  it('reports unavailable and every helper falls back to null', async () => {
    expect(intelligenceStatus()).toEqual({ model: 'unsupportedOS', vision: false, spanish: false, subjectLifting: false });
    expect(unavailableReason(intelligenceStatus())).toMatch(/Apple Intelligence/);
    await expect(readAssistantRequest('¿qué me pongo?')).resolves.toBeNull();
    await expect(summarizeFacts('Prendas: 3.')).resolves.toBeNull();
    await expect(describeGarmentPhoto('file:///x.png', 'Gorro')).resolves.toBeNull();
    await expect(liftSubjectPreview('file:///x.jpg')).resolves.toBeNull();
  });

  it('explains why the model is unavailable in Spanish', () => {
    expect(unavailableReason({ model: 'appleIntelligenceNotEnabled', vision: false, spanish: true, subjectLifting: true })).toBe('Activa Apple Intelligence en Ajustes para usarla.');
    expect(unavailableReason({ model: 'available', vision: true, spanish: true, subjectLifting: true })).toBeNull();
  });

  it('gives the model the date in words for relative days', () => {
    expect(todayPhrase(new Date(2026, 10, 24))).toBe('martes 24 de noviembre de 2026');
  });
});

describe('wardrobe facts for the on-device summary', () => {
  it('only contains figures from the statistics', () => {
    const stats: WardrobeStatsDto = {
      totalGarments: 10,
      byCategory: [{ key: 'top', count: 4 }, { key: 'bottom', count: 2 }],
      byColor: [{ key: 'negro', count: 3 }],
      byStyle: [],
      byStatus: [],
      bySeason: [],
      totalValue: null,
      avgCostPerWear: null,
      neverWorn: [garment({ name: 'Jersey grueso en camel' })],
      mostWorn: [garment({ name: 'Vaquero recto', wearCount: 7 })],
      leastWorn: [],
      overRepresented: [],
      duplicateGroups: [],
      outfitsWornLast30Days: 5,
    };
    const facts = wardrobeFacts(stats);
    expect(facts).toContain('Prendas en el armario: 10.');
    expect(facts).toContain('Colores más frecuentes: negro (3).');
    expect(facts).toContain('Prendas sin estrenar: 1 (por ejemplo: Jersey grueso en camel).');
    expect(facts).toContain('La prenda más usada: Vaquero recto (7 usos).');
    expect(facts).not.toMatch(/Coste medio|duplicados/);
  });
});
