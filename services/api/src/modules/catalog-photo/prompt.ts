/**
 * Instructions for the generative packshot: the owner's base prompt, specialised per kind of garment
 * and filled with what we know about this garment (type, colours, pattern, material, text/logos read
 * by OCR). A retry adds corrections for what the previous attempt got wrong (fidelity or
 * presentation codes from the vision service's catalogue check).
 *
 * English on purpose: every model used (FASHN, Qwen-Image-Edit) follows English instructions best.
 */
import { getSubcategory } from '@dressit/shared';

export const PROMPT_VERSION = '2026-11-24.3';

export type PresentationKind = 'top' | 'shirt' | 'knit' | 'trousers' | 'shorts' | 'skirt' | 'dress' | 'jacket' | 'shoes' | 'bag' | 'accessory';

const SUBCATEGORY_EN: Record<string, string> = {
  camiseta: 't-shirt', camiseta_manga_larga: 'long-sleeve t-shirt', camiseta_tecnica: 'sports t-shirt', polo: 'polo shirt',
  camisa: 'button-up shirt', camisa_manga_corta: 'short-sleeve button-up shirt', blusa: 'blouse', top: 'top', body: 'bodysuit',
  sobrecamisa: 'overshirt', sudadera: 'sweatshirt', jersey: 'sweater', jersey_grueso: 'chunky knit sweater', cardigan: 'cardigan',
  chaleco_punto: 'knit vest', pantalon: 'trousers', pantalon_vestir: 'tailored trousers', vaquero: 'jeans', chino: 'chinos',
  jogger: 'joggers', leggings: 'leggings', pantalon_corto: 'shorts', pantalon_deportivo_corto: 'sports shorts', bermuda: 'bermuda shorts',
  falda: 'skirt', falda_larga: 'long skirt', vestido: 'dress', vestido_fiesta: 'evening dress', vestido_punto: 'knit dress',
  mono: 'jumpsuit', traje_chandal: 'tracksuit', abrigo: 'coat', gabardina: 'trench coat', parka: 'parka', plumifero: 'puffer jacket',
  chaleco_acolchado: 'padded vest', chaqueta: 'jacket', americana: 'blazer', bomber: 'bomber jacket', cazadora_vaquera: 'denim jacket',
  chaqueta_cuero: 'leather jacket', chaqueta_deportiva: 'track jacket', impermeable: 'raincoat', zapatillas: 'sneakers',
  zapatillas_lona: 'canvas sneakers', zapatillas_running: 'running shoes', zapatos: 'shoes', mocasines: 'loafers', botas: 'boots',
  botines: 'ankle boots', sandalias: 'sandals', tacones: 'high-heel shoes', bailarinas: 'ballet flats', alpargatas: 'espadrilles',
  bolso: 'handbag', mochila: 'backpack', bufanda: 'scarf', panuelo: 'neckerchief', gorro: 'beanie', gorra: 'cap', sombrero: 'hat',
  cinturon: 'belt', gafas_sol: 'sunglasses', reloj: 'watch', joyeria: 'jewellery', guantes: 'gloves', corbata: 'tie', paraguas: 'umbrella',
  banador: 'swim shorts', bikini: 'bikini',
};

const COLOR_EN: Record<string, string> = {
  negro: 'black', antracita: 'charcoal grey', gris: 'grey', blanco: 'white', crudo: 'off-white', beige: 'beige', camel: 'camel',
  marron: 'brown', azul_marino: 'navy blue', denim: 'denim blue', azul: 'blue', celeste: 'light blue', turquesa: 'turquoise',
  verde: 'green', verde_oliva: 'olive green', caqui: 'khaki', menta: 'mint green', amarillo: 'yellow', mostaza: 'mustard yellow',
  naranja: 'orange', terracota: 'terracotta', rojo: 'red', burdeos: 'burgundy', rosa: 'pink', fucsia: 'fuchsia', lila: 'lilac',
  morado: 'purple', dorado: 'gold', plateado: 'silver',
};

const PATTERN_EN: Record<string, string> = {
  rayas: 'striped', cuadros: 'checked', pata_de_gallo: 'houndstooth', espiguilla: 'herringbone', lunares: 'polka-dot', floral: 'floral print',
  animal: 'animal print', geometrico: 'geometric print', cachemir: 'paisley', camuflaje: 'camouflage', grafico: 'with a printed graphic',
  tie_dye: 'tie-dye', abstracto: 'abstract print',
};

const MATERIAL_EN: Record<string, string> = {
  algodon: 'cotton', lino: 'linen', lana: 'wool', cachemira: 'cashmere', seda: 'silk', saten: 'satin', poliester: 'polyester',
  viscosa: 'viscose', denim: 'denim', punto: 'knit', pana: 'corduroy', tweed: 'tweed', cuero: 'leather', ante: 'suede', lona: 'canvas',
  tecnico: 'technical fabric', plumon: 'down-filled', nailon: 'nylon', sintetico: 'synthetic', terciopelo: 'velvet',
};

const SHIRTS = new Set(['camisa', 'camisa_manga_corta', 'blusa', 'polo', 'sobrecamisa']);
const KNITS = new Set(['jersey', 'jersey_grueso', 'cardigan', 'chaleco_punto', 'sudadera']);
const SHORTS = new Set(['pantalon_corto', 'pantalon_deportivo_corto', 'bermuda']);
const SKIRTS = new Set(['falda', 'falda_larga']);
const BAGS = new Set(['bolso', 'mochila']);

export function presentationKind(category: string, subcategory: string): PresentationKind {
  if (category === 'footwear') return 'shoes';
  if (category === 'accessory') return BAGS.has(subcategory) ? 'bag' : 'accessory';
  if (category === 'outerwear') return 'jacket';
  if (category === 'one_piece') return 'dress';
  if (category === 'bottom') return SHORTS.has(subcategory) ? 'shorts' : SKIRTS.has(subcategory) ? 'skirt' : 'trousers';
  if (category === 'swimwear') return 'accessory';
  if (KNITS.has(subcategory)) return 'knit';
  if (SHIRTS.has(subcategory)) return 'shirt';
  return 'top';
}

/** Per-kind presentation, following the owner's brief (and e-commerce conventions). */
export const KIND_INSTRUCTIONS: Record<PresentationKind, { style: string; text: string }> = {
  top: {
    style: 'flat lay',
    text: 'Flat lay seen from directly above, front side up: torso fully extended and flat, both sleeves unfolded and laid out symmetrically at the same angle on each side, neckline centred and round, shoulders level, hem straight and horizontal.',
  },
  shirt: {
    style: 'flat lay',
    text: 'Flat lay seen from directly above, front side up, buttoned as in the reference: torso extended and flat, collar correctly folded and centred with both points symmetric, placket straight down the centre, both sleeves unfolded and laid out symmetrically, cuffs neat, hem straight.',
  },
  knit: {
    style: 'flat lay',
    text: 'Flat lay seen from directly above: body extended, both sleeves unfolded and arranged symmetrically alongside the body, neckline centred, ribbed cuffs and hem straight; keep the exact knit stitch, its scale and the natural soft silhouette and volume of the knit.',
  },
  trousers: {
    style: 'flat lay',
    text: 'Flat lay seen from directly above, front side up, unfolded: waistband horizontal at the top, fly closed and centred, both legs fully extended straight down, aligned and side by side, completely visible from waistband to hems, pockets and belt loops where they are.',
  },
  shorts: {
    style: 'flat lay',
    text: 'Flat lay seen from directly above, front side up, unfolded: waistband horizontal at the top, both legs extended, symmetric and side by side, hems straight.',
  },
  skirt: {
    style: 'flat lay',
    text: 'Flat lay seen from directly above, front side up: waistband horizontal at the top, the skirt falling naturally and symmetrically to a straight hem, full length visible, pleats or flare as in the reference.',
  },
  dress: {
    style: 'ghost mannequin',
    text: 'Ghost mannequin (invisible mannequin) front view: natural drape and fall, symmetric, straps or sleeves and neckline correctly placed, waist where the reference shows it, full silhouette from neckline to hem visible with realistic proportions and length.',
  },
  jacket: {
    style: 'ghost mannequin',
    text: 'Ghost mannequin (invisible mannequin) front view: shoulders level, both sleeves hanging naturally and symmetrically, collar and lapels correctly placed and symmetric, front closed as in the reference with buttons, zip and pockets coherent, appropriate volume for the fabric (padding, structure), full length visible.',
  },
  shoes: {
    style: 'product',
    text: 'Professional footwear product photo: the shoe(s) shown whole in a clean three-quarter side view at eye level, laces tidy, the true shape of the toe, heel and sole visible, materials and colours exactly as in the reference; if the reference shows a pair, show the pair neatly side by side.',
  },
  bag: {
    style: 'product',
    text: 'Professional handbag product photo: front view, standing upright with a natural shape, handles or strap arranged neatly above the bag, closure, hardware, stitching and logo exactly as in the reference, the whole bag visible.',
  },
  accessory: {
    style: 'product',
    text: 'Professional accessory product photo: the item in its most commercial, readable orientation, laid out neatly and completely visible, centred.',
  },
};

export interface GarmentDescription {
  category: string;
  subcategory: string;
  colors: Array<{ family: string; share: number }>;
  pattern: string | null;
  materials: string[];
  /** Text or logos read on the garment (OCR), to be kept legible. */
  text: string | null;
  brand: string | null;
}

export function describeGarment(g: GarmentDescription): string {
  const noun = SUBCATEGORY_EN[g.subcategory] ?? getSubcategory(g.subcategory)?.label ?? 'garment';
  const colours = g.colors
    .filter((c) => c.share >= 0.12)
    .slice(0, 3)
    .map((c) => COLOR_EN[c.family] ?? c.family);
  const colour = colours.length > 1 ? `${colours.slice(0, -1).join(', ')} and ${colours.at(-1)}` : (colours[0] ?? '');
  const material = g.materials.map((m) => MATERIAL_EN[m]).find(Boolean);
  const pattern = g.pattern && g.pattern !== 'liso' ? PATTERN_EN[g.pattern] : null;
  const parts = [colour, material, noun].filter(Boolean).join(' ');
  return [g.brand ? `${g.brand} ${parts}` : parts, pattern].filter(Boolean).join(', ');
}

/** What the previous attempt got wrong (codes from the catalogue check) → extra instructions. */
const CORRECTIONS: Record<string, string> = {
  asymmetric: 'IMPORTANT: the previous attempt was not arranged properly. Lay the garment out perfectly symmetric about a vertical centre line: both sleeves (or legs) unfolded, extended, at the same angle and length on each side.',
  tilted: 'IMPORTANT: the garment must be perfectly straight and upright, its centre line exactly vertical, photographed from directly in front.',
  messy: 'IMPORTANT: the previous attempt still looked like a casual photo. Fully unfold and smooth the garment into a crisp, professionally styled catalogue presentation with no crumples, folds over itself or twisted parts.',
  cropped: 'IMPORTANT: show the ENTIRE garment with generous white margin on every side; nothing may touch or leave the frame.',
  small: 'The garment must fill most of the frame, centred, with a moderate white margin.',
  background: 'IMPORTANT: pure seamless white background only, no floor, bed, furniture, props, shadows on the background or texture.',
  multiple: 'Show ONLY this one garment: no other clothes, hangers, hands, mannequin parts or objects.',
  worn: 'Do NOT show any person, body part or model: the garment alone, flat lay or invisible mannequin.',
  color: 'IMPORTANT: the previous attempt changed the colours. Keep exactly the colours of the reference garment ({COLORS}); do not tint, brighten or darken it.',
  lightness: 'Keep the true lightness of the fabric: do not make it lighter or darker than in the reference.',
  pattern: 'IMPORTANT: keep the exact print/pattern of the reference ({PATTERN}); do not add, remove or redesign it.',
  texture: 'IMPORTANT: keep the exact fabric texture and knit/weave of the reference; do not smooth it into a different material.',
  text: 'IMPORTANT: keep the printed text and logos exactly as in the reference ({TEXT}), legible, in the same place, size and colour.',
  extra_garment: 'IMPORTANT: the previous attempt added other clothes. Show ONLY this single garment, alone on the white background: no trousers, shirt, skirt, shoes, person or outfit.',
  different: 'IMPORTANT: the previous attempt drifted into a different garment. Reproduce THIS exact garment: same cut, collar, sleeve length, length, pockets, buttons, seams and details.',
  type: 'IMPORTANT: it must remain the same type of garment as in the reference.',
};

export interface PackshotPrompt {
  prompt: string;
  negative: string;
  style: string;
  version: string;
}

export function buildPackshotPrompt(g: GarmentDescription, corrections: string[] = []): PackshotPrompt {
  const kind = presentationKind(g.category, g.subcategory);
  const { style, text } = KIND_INSTRUCTIONS[kind];
  const description = describeGarment(g);
  const presentation =
    style === 'flat lay'
      ? 'Present it in a clean, perfectly organized flat-lay style, photographed directly from above'
      : style === 'ghost mannequin'
        ? 'Present it in a clean ghost-mannequin (invisible mannequin) style, photographed directly from the front'
        : 'Present it as a clean studio product shot';
  const rearrange =
    kind === 'shoes' || kind === 'bag' || kind === 'accessory'
      ? 'Physically rearrange it into its ideal product presentation: correct perspective and orientation, tidy straps or laces, restore its natural shape.'
      : 'Physically rearrange the garment into its ideal product presentation: straighten and symmetrically position sleeves, align collars and shoulders, extend trouser legs naturally, flatten excessive wrinkles, correct perspective, and restore a clean, aesthetically balanced silhouette.';
  const keepText = g.text ? ` The garment shows the text/logo "${g.text}": reproduce it exactly, legible, in the same position, size and colour.` : '';
  const fill = (s: string) =>
    s
      .replace('{COLORS}', description)
      .replace('{PATTERN}', g.pattern && g.pattern !== 'liso' ? (PATTERN_EN[g.pattern] ?? g.pattern) : 'plain, no print')
      .replace('{TEXT}', g.text ?? 'as shown');
  const extra = [...new Set(corrections)].map((c) => CORRECTIONS[c]).filter((c): c is string => !!c).map(fill);
  const prompt = [
    `Transform the uploaded reference photograph into a premium professional e-commerce product photograph of the EXACT SAME garment: ${description}.`,
    `Reconstruct the garment as if carefully arranged by a professional fashion stylist for a luxury clothing catalogue. ${presentation}.`,
    rearrange,
    text,
    'Remove the original background, furniture, hands, hangers, distracting shadows and surrounding objects. Use a seamless pure white background.',
    `CRITICAL PRODUCT FIDELITY: Preserve the garment's exact original color, fabric texture, stitching, logos, graphics, prints, buttons, pockets, seams, collar shape, sleeve length, proportions and distinctive details. Do not redesign, embellish, simplify or replace the original clothing. Do not invent parts that are not visible in the reference: keep hidden areas plain and consistent with the visible ones.${keepText}`,
    'Show ONLY this one garment, by itself: do not add any other clothing item (no trousers, shirt, skirt, shoes) and do not style it as an outfit.',
    'Show the entire garment, centered, evenly illuminated, high resolution, sharp, realistic and suitable for a professional online fashion catalogue.',
    `This is a product photography transformation, NOT the creation of a different garment, NOT a simple background removal, and NOT a photo of a person wearing the garment.`,
    ...extra,
  ].join(' ');
  const negative =
    'person, model, hands, mannequin parts, hanger, bed, furniture, floor, wrinkled, crumpled, folded sleeves, twisted, cropped, cut off, tilted, perspective distortion, extra garments, text artifacts, watermark, different garment, changed colour, changed logo';
  return { prompt, negative, style, version: PROMPT_VERSION };
}
