import { describe, expect, it } from 'vitest';
import { fillWorkflow, loadWorkflow } from '../../src/modules/imagegen/comfy.ts';
import { avatarFidelity, cosine, studioFidelity } from '../../src/modules/imagegen/service.ts';
import { maskFor, sequentialPlan, stepKey, wornFidelity } from '../../src/modules/imagegen/avatar.ts';

const unit = (i: number, n = 8) => Array.from({ length: n }, (_, k) => (k === i ? 1 : 0));
const mix = (a: number[], b: number[], t: number) => a.map((x, i) => x * (1 - t) + b[i]! * t);

describe('studio fidelity gate', () => {
  const limits = { minSimilarity: 0.85, maxDeltaE: 12 };
  const garment = { embedding: unit(0), colorHex: '#c5a996', subcategory: 'jersey_grueso' };
  it('accepts the same garment with a close colour', () => {
    // Real measurement: cardigan photo vs its Qwen studio photo → cosine 0.966, beige #cbab97 vs #c5a996.
    const f = studioFidelity({ embedding: mix(unit(0), unit(1), 0.2), colorHex: '#cbab97', subcategory: 'jersey_grueso' }, garment, limits);
    expect(f.passed).toBe(true);
    expect(f.colorDeltaE).toBeLessThan(3);
  });
  it('rejects a different-looking garment, a changed colour or another type', () => {
    expect(studioFidelity({ embedding: mix(unit(0), unit(1), 0.6), colorHex: '#c5a996', subcategory: 'jersey_grueso' }, garment, limits)).toMatchObject({ passed: false, reason: expect.stringMatching(/no se parece/) });
    expect(studioFidelity({ embedding: unit(0), colorHex: '#1d3b8f', subcategory: 'jersey_grueso' }, garment, limits)).toMatchObject({ passed: false, reason: expect.stringMatching(/color/) });
    expect(studioFidelity({ embedding: unit(0), colorHex: '#c5a996', subcategory: 'vaquero' }, garment, limits)).toMatchObject({ passed: false, reason: expect.stringMatching(/otro tipo/) });
    expect(studioFidelity({ embedding: null, colorHex: null, subcategory: null }, garment, limits).passed).toBe(false);
  });
  it('accepts a type the classifier abstained on or a sibling of the same category', () => {
    expect(studioFidelity({ embedding: unit(0), colorHex: '#c5a996', subcategory: null }, garment, limits).passed).toBe(true);
    expect(studioFidelity({ embedding: unit(0), colorHex: '#c5a996', subcategory: 'cardigan' }, garment, limits).passed).toBe(true);
  });
});

describe('avatar fidelity gate', () => {
  it('needs every garment to be found in the render', () => {
    expect(avatarFidelity([unit(0), unit(1)], [unit(0), unit(1)], 0.7)).toMatchObject({ passed: true, similarity: 1 });
    expect(avatarFidelity([unit(0)], [unit(0), unit(1)], 0.7)).toMatchObject({ passed: false });
    expect(avatarFidelity([], [unit(0)], 0.7).reason).toMatch(/No se distinguen/);
    expect(cosine(unit(0), unit(0))).toBe(1);
  });
});

describe('ComfyUI workflows', () => {
  for (const name of ['studio', 'studio-fast', 'avatar', 'avatar-fast']) {
    it(`${name}: fills every placeholder with the right types`, () => {
      const values = { INPUT_IMAGE: 'in.png', FACE_IMAGE: 'f.jpg', BODY_IMAGE: 'b.jpg', OUTFIT_IMAGE: 'o.png', DESCRIPTION: 'jersey, camel', SEED: 42 };
      const wf = fillWorkflow(loadWorkflow(name), values);
      const json = JSON.stringify(wf);
      expect(json).not.toMatch(/\{\{/);
      const seeds = Object.values(wf).flatMap((n) => [n.inputs.seed, n.inputs.noise_seed]).filter((v) => v !== undefined);
      expect(seeds).toEqual([42]);
      expect(Object.values(wf).some((n) => n.class_type === 'SaveImage')).toBe(true);
      // Every link points at an existing node.
      for (const node of Object.values(wf)) for (const v of Object.values(node.inputs)) if (Array.isArray(v) && typeof v[0] === 'string') expect(wf[v[0]]).toBeDefined();
    });
  }
  it('refuses missing values and unsafe names', () => {
    expect(() => fillWorkflow(loadWorkflow('studio'), { INPUT_IMAGE: 'x' })).toThrow(/Faltan valores/);
    expect(() => loadWorkflow('../secrets')).toThrow();
  });
});

describe('what the avatar shows', () => {
  it('keeps the outermost layer, bottom, shoes and one accessory (max 4)', async () => {
    const { visibleForAvatar } = await import('../../src/modules/imagegen/service.ts');
    const items = ['outer', 'mid', 'base', 'bottom', 'footwear', 'accessory:neck', 'accessory:head'].map((slot) => ({ slot }));
    const { shown, layered } = visibleForAvatar(items);
    expect(shown.map((i) => i.slot)).toEqual(['outer', 'bottom', 'footwear', 'accessory:head']);
    expect(layered.map((i) => i.slot)).toEqual(['mid', 'base']);
    expect(visibleForAvatar([{ slot: 'one_piece' }, { slot: 'footwear' }]).shown.map((i) => i.slot)).toEqual(['one_piece', 'footwear']);
  });
});

describe('studio detail gate', () => {
  const detail = (over: Record<string, unknown> = {}) => ({ shape_iou: 0.97, mean_delta_e: 1.8, p90_delta_e: 2.8, max_cell_delta_e: 6.4, ssim: 0.75, cells: 60, passed: true, reasons: [], ...over });
  it('passes a faithful photo and reports the measures', async () => {
    const { studioDetailFidelity } = await import('../../src/modules/imagegen/service.ts');
    expect(studioDetailFidelity(detail(), { generated: 'jersey_grueso', garment: 'jersey_grueso' }, 0.97)).toMatchObject({ passed: true, detail: { ssim: 0.75, maxCellDeltaE: 6.4 } });
  });
  it('rejects with the comparator’s reasons (the cardigan with changed buttons) or another type', async () => {
    const { studioDetailFidelity } = await import('../../src/modules/imagegen/service.ts');
    // Real measurement of the first Qwen attempt: max cell ΔE 21.2, SSIM 0.19, global similarity 0.966.
    const bad = studioDetailFidelity(detail({ max_cell_delta_e: 21.2, ssim: 0.19, passed: false, reasons: ['Ha cambiado el color de alguna zona (botones, bolsillos, estampado…).', 'Ha cambiado la textura o el dibujo del tejido.'] }), { generated: 'jersey_grueso', garment: 'jersey_grueso' }, 0.966);
    expect(bad.passed).toBe(false);
    expect(bad.reason).toMatch(/botones.*textura/);
    expect(studioDetailFidelity(detail(), { generated: 'vaquero', garment: 'jersey_grueso' }, 0.9).reason).toMatch(/otro tipo/);
  });
});

describe('sequential try-on', () => {
  const p = (slot: string) => ({ slot, garmentId: slot, cutoutImageId: `c-${slot}`, label: slot });

  it('dresses inner to outer layers, then one pass for shoes and one accessory (hat first)', () => {
    const plan = sequentialPlan([p('outer'), p('footwear'), p('base'), p('accessory:bag'), p('bottom'), p('mid'), p('accessory:head')]);
    expect(plan.clothes.map((c) => c.slot)).toEqual(['bottom', 'base', 'mid', 'outer']);
    expect(plan.extras.map((c) => c.slot)).toEqual(['footwear', 'accessory:head']);
    // A bag is never tried on (it would need the whole arm and torso region).
    expect(sequentialPlan([p('base'), p('accessory:bag')]).extras).toEqual([]);
    expect(sequentialPlan([p('one_piece'), p('outer')]).clothes.map((c) => c.slot)).toEqual(['one_piece', 'outer']);
  });

  it('replaces the clothes of a region with its first garment and dresses later layers over it', () => {
    expect(maskFor([], 'bottom')).toBe(true);
    expect(maskFor([p('bottom')], 'base')).toBe(true);
    expect(maskFor([p('bottom'), p('base')], 'mid')).toBe(false);
    expect(maskFor([p('bottom'), p('base'), p('mid')], 'outer')).toBe(false);
    expect(maskFor([p('bottom')], 'outer')).toBe(true); // a jacket alone replaces whatever the photo shows
    expect(maskFor([], 'one_piece')).toBe(true);
  });

  it('keys each step by the base and the garments dressed so far, in order', () => {
    const a = stepKey('base', [p('bottom'), p('base')], 'fashn:20');
    expect(stepKey('base', [p('bottom'), p('base')], 'fashn:20')).toBe(a);
    expect(stepKey('base', [p('base'), p('bottom')], 'fashn:20')).not.toBe(a);
    expect(stepKey('otra', [p('bottom'), p('base')], 'fashn:20')).not.toBe(a);
    expect(stepKey('base', [p('bottom'), p('base')], 'fashn:30')).not.toBe(a);
    expect(stepKey('base', [p('bottom'), { ...p('base'), cutoutImageId: 'recortada-de-nuevo' }], 'fashn:20')).not.toBe(a);
  });

  it('rejects a render where a garment is missing or does not look like the real one', () => {
    const limits = { minSimilarity: 0.6, maxDeltaE: 15 };
    const ok = { label: 'camiseta, azul marino', slot: 'base', found: true, similarity: 0.8, deltaE: 6 };
    expect(wornFidelity([ok, { ...ok, label: 'vaquero', slot: 'bottom' }], limits)).toMatchObject({ passed: true, reason: null, similarity: 0.8, colorDeltaE: 6 });
    expect(wornFidelity([ok, { ...ok, label: 'vaquero', found: false, similarity: null, deltaE: null }], limits)).toMatchObject({ passed: false, reason: 'No se ve vaquero en la imagen generada.' });
    expect(wornFidelity([{ ...ok, deltaE: 22 }], limits).reason).toBe('La imagen generada no reproduce bien camiseta, azul marino.');
    expect(wornFidelity([{ ...ok, similarity: 0.4 }], limits).passed).toBe(false);
  });
});
