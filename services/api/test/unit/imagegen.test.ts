import { describe, expect, it } from 'vitest';
import { ComfyClient, fillWorkflow, loadWorkflow } from '../../src/modules/imagegen/comfy.ts';
import { avatarFidelity, cosine } from '../../src/modules/imagegen/service.ts';
import { workflowCanvas } from '../../src/modules/imagegen/generator.ts';
import { maskFor, sequentialPlan, stepKey, wornFidelity } from '../../src/modules/imagegen/avatar.ts';

const unit = (i: number, n = 8) => Array.from({ length: n }, (_, k) => (k === i ? 1 : 0));

describe('avatar fidelity gate', () => {
  it('needs every garment to be found in the render', () => {
    expect(avatarFidelity([unit(0), unit(1)], [unit(0), unit(1)], 0.7)).toMatchObject({ passed: true, similarity: 1 });
    expect(avatarFidelity([unit(0)], [unit(0), unit(1)], 0.7)).toMatchObject({ passed: false });
    expect(avatarFidelity([], [unit(0)], 0.7).reason).toMatch(/No se distinguen/);
    expect(cosine(unit(0), unit(0))).toBe(1);
  });
});

describe('ComfyUI workflows', () => {
  for (const name of ['packshot', 'packshot-fast', 'avatar', 'avatar-fast']) {
    it(`${name}: fills every placeholder with the right types`, () => {
      const values = { INPUT_IMAGE: 'in.png', FACE_IMAGE: 'f.jpg', BODY_IMAGE: 'b.jpg', OUTFIT_IMAGE: 'o.png', DESCRIPTION: 'jersey, camel', PROMPT: 'Transform…', SEED: 42, WIDTH: 896, HEIGHT: 1120 };
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
  it('packshot-fast: fp16 compute, its own canvas, and no Qwen negative encoder pass', () => {
    const fast = loadWorkflow('packshot-fast');
    expect(Object.values(fast).find((n) => n.class_type === 'ModelComputeDtype')?.inputs.dtype).toBe('fp16');
    expect(workflowCanvas('packshot-fast')).toEqual({ width: 832, height: 1040 });
    expect(workflowCanvas('packshot')).toBeNull();
    // cfg 1.0: the negative of the Qwen workflows is a zeroed copy, not a second 7B encoder pass.
    expect(Object.values(loadWorkflow('packshot')).filter((n) => n.class_type === 'TextEncodeQwenImageEditPlus')).toHaveLength(1);
  });
  it('refuses missing values and unsafe names', () => {
    expect(() => fillWorkflow(loadWorkflow('packshot'), { INPUT_IMAGE: 'x' })).toThrow(/Faltan valores/);
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

describe('fast one-pass try-on', () => {
  it('shows at most 4 pieces: outer layer, an inner layer under it, bottom and shoes', async () => {
    const { piecesForFastRender } = await import('../../src/modules/imagegen/service.ts');
    const slots = (xs: string[]) => piecesForFastRender(xs.map((slot) => ({ slot }))).map((i) => i.slot);
    expect(slots(['outer', 'base', 'bottom', 'footwear'])).toEqual(['outer', 'base', 'bottom', 'footwear']);
    expect(slots(['outer', 'mid', 'base', 'bottom', 'footwear', 'accessory:head'])).toEqual(['outer', 'bottom', 'footwear', 'accessory:head']);
    expect(slots(['base', 'bottom'])).toEqual(['base', 'bottom']);
  });
  it('names each garment by its image and keeps the person as in their photo', async () => {
    const { buildTryonPrompt } = await import('../../src/modules/imagegen/tryon-prompt.ts');
    const p = buildTryonPrompt(['black polo shirt', 'plaid pleated skirt']);
    expect(p).toMatch(/^The person from image 1 wearing this outfit: the black polo shirt shown in image 2; the plaid pleated skirt shown in image 3\. Take off every piece of clothing/);
    expect(p).toMatch(/the same face and facial features, hairstyle and hair colour, skin tone, body shape/);
  });
  it('names where bottoms, dresses and coats end (jeans came out as knee shorts over leggings)', async () => {
    const { tryonLabel } = await import('../../src/modules/imagegen/tryon-prompt.ts');
    expect(tryonLabel('light blue denim jeans', 'full', 'bottom')).toBe('light blue denim jeans (full length, down to the ankles)');
    expect(tryonLabel('denim shorts', 'upper-thigh', 'bottom')).toBe('denim shorts (very short, upper-thigh length)');
    expect(tryonLabel('floral dress', 'midi', 'one_piece')).toBe('floral dress (midi length, below the knee)');
    // Tops, shoes and unknown lengths keep their name.
    expect(tryonLabel('white t-shirt', 'hip', 'top')).toBe('white t-shirt');
    expect(tryonLabel('black polo', 'full', 'top')).toBe('black polo');
    expect(tryonLabel('plaid skirt', null, 'bottom')).toBe('plaid skirt');
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

describe('ComfyUI client timeouts', () => {
  const client = (running: string) => {
    const calls: string[] = [];
    const fetcher = (async (url: string | URL | Request, init: RequestInit = {}) => {
      const u = String(url);
      calls.push(`${init.method ?? 'GET'} ${u.replace('http://comfy', '')}${init.body && u.endsWith('/queue') ? ` ${String(init.body)}` : ''}`);
      if (u.endsWith('/prompt')) return new Response(JSON.stringify({ prompt_id: 'mine' }));
      if (u.includes('/history/')) return new Response('{}');
      if (u.endsWith('/queue') && (init.method ?? 'GET') === 'GET') return new Response(JSON.stringify({ queue_running: [[1, running]], queue_pending: [[2, 'mine']] }));
      return new Response('{}');
    }) as typeof fetch;
    return { c: new ComfyClient('http://comfy', fetcher), calls };
  };
  it('takes its own queued prompt out of the queue, never interrupting someone else’s', async () => {
    const { c, calls } = client('someone-else');
    await expect(c.run({}, 30, 5)).rejects.toThrow(/demasiado/);
    expect(calls).toContain('POST /queue {"delete":["mine"]}');
    expect(calls.some((x) => x.includes('/interrupt'))).toBe(false);
  });
  it('interrupts only when its own prompt is the one running', async () => {
    const { c, calls } = client('mine');
    await expect(c.run({}, 30, 5)).rejects.toThrow(/demasiado/);
    expect(calls).toContain('POST /interrupt');
  });
});
