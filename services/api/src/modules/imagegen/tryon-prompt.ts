/**
 * The instruction for the one-pass try-on with FLUX.2 klein (multi-reference editing): image 1 is the
 * person, images 2… the garments. Same text as services/imagegen/mlx/bench_tryon.py (keep both in step:
 * the bench measures this exact prompt).
 */
export const TRYON_PROMPT_VERSION = '2026-11-28.1';

// Where a bottom, dress or coat ends, from the length the detection read: named in the label, because
// klein put full-length jeans on a person in leggings as knee shorts over blue leggings.
const LENGTH_WORDS: Record<string, string> = {
  full: 'full length, down to the ankles',
  ankle: 'ankle length',
  midi: 'midi length, below the knee',
  knee: 'knee length',
  'mid-thigh': 'mid-thigh length',
  'upper-thigh': 'very short, upper-thigh length',
};

/** "light blue denim jeans" + full → "light blue denim jeans (full length, down to the ankles)". */
export function tryonLabel(name: string, length: string | null | undefined, category: string | null | undefined): string {
  const words = length && ['bottom', 'one_piece', 'outerwear', 'swimwear'].includes(category ?? '') ? LENGTH_WORDS[length] : undefined;
  return words ? `${name} (${words})` : name;
}

export function buildTryonPrompt(labels: string[]): string {
  const pieces = labels.map((label, i) => `the ${label} shown in image ${i + 2}`).join('; ');
  // Each body zone named: klein sometimes kept the person's own leggings instead of the skirt.
  return (
    `The person from image 1 wearing this outfit: ${pieces}. Take off every piece of clothing image 1 shows ` +
    'where a new garment goes (a top replaces their top, a skirt, shorts or trousers replace their trousers, ' +
    'leggings or skirt, shoes replace their shoes) and dress them in exactly these garments; each garment ' +
    'keeps the colours, print, fabric, length, fit and details of its image, worn naturally with realistic ' +
    'folds. Keep the person exactly as in ' +
    'image 1: the same face and facial features, hairstyle and hair colour, skin tone, body shape and ' +
    'proportions, height, pose, expression, camera angle, framing, lighting and background; anyone or ' +
    'anything else in image 1 stays unchanged. No other clothes or accessories than these and those image 1 ' +
    'already shows that the outfit does not replace.'
  );
}
