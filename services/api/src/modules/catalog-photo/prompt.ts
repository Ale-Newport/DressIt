/**
 * Instructions for the generative packshot: the owner's base prompt, specialised per kind of garment
 * and filled with what we know about this garment (type, colours, pattern, material, text/logos read
 * by OCR). A retry adds corrections for what the previous attempt got wrong (fidelity or
 * presentation codes from the vision service's catalogue check).
 *
 * English on purpose: every model used (FASHN, Qwen-Image-Edit) follows English instructions best.
 */
import { COLOR_FAMILIES, getSubcategory } from '@dressit/shared';

export const PROMPT_VERSION = '2026-11-24.6';

export type PresentationKind = 'top' | 'shirt' | 'knit' | 'trousers' | 'shorts' | 'skirt' | 'dress' | 'jacket' | 'shoes' | 'bag' | 'hosiery' | 'accessory';

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
  negro: 'black', antracita: 'near-black charcoal', gris: 'grey', blanco: 'white', crudo: 'off-white', beige: 'beige', camel: 'camel',
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
  // As if worn: with an invisible body the hem sits where it should. Laid flat, klein drew every pair of
  // very short shorts as knee-length bermudas, however the length was written.
  shorts: {
    style: 'ghost mannequin',
    text: 'Hollow 3D front view, as if worn by an invisible body: waistband at the waist, both legs open and symmetric{LENGTH}; empty inside, no legs, nothing holding it.',
  },
  // On an invisible body too: laid flat, klein drew a mid-thigh plaid skirt as a midi.
  skirt: {
    style: 'ghost mannequin',
    text: 'Hollow 3D front view, as if worn by an invisible body: waistband at the waist, the skirt falling naturally and symmetrically{LENGTH}, pleats or flare as in the reference; empty inside, no legs, nothing holding it.',
  },
  dress: {
    style: 'ghost mannequin',
    text: 'Hollow 3D front view, as if worn by an invisible body: natural drape and fall, symmetric, straps or sleeves and neckline correctly placed, waist where the reference shows it, full silhouette from neckline to hem visible with realistic proportions and length; empty inside, the inner back of the neck visible through the neck opening, nothing holding it.',
  },
  jacket: {
    style: 'ghost mannequin',
    text: 'Hollow 3D front view, as if worn by an invisible body: shoulders level, both sleeves hanging naturally and symmetrically, collar and lapels correctly placed and symmetric, front closed as in the reference with buttons, zip and pockets coherent, appropriate volume for the fabric (padding, structure), full length visible; empty inside, the inner back of the neck visible through the neck opening, nothing holding it.',
  },
  shoes: {
    style: 'product',
    text: 'Professional footwear product photo: the shoe(s) shown whole in a clean three-quarter side view at eye level, the true shape of the toe, heel and sole visible, materials and colours exactly as in the reference; if the reference shows a pair, show the pair neatly side by side, the two shoes identical mirror images with the same details. Empty shoes with nothing inside them: no feet, legs, socks or tights.',
  },
  bag: {
    style: 'product',
    text: 'Professional bag product photo: front view, standing upright with a natural shape, {HANDLES}, closure, hardware, stitching and logo exactly as in the reference, the whole bag visible.',
  },
  hosiery: {
    style: 'flat lay',
    text: 'Hosiery flat lay seen from directly above: the tights, stockings or socks laid flat and empty, legs straight side by side, waistband or cuffs at the top, each leg ending in a closed foot with the toes at the bottom (tights are not leggings), sheer hosiery see-through with the background showing through, nothing else; they are not worn and there is no body, top or sleeves.',
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

/** Shades of one tone: under real light one fabric measures as several of them (lit and shaded sides). */
const TONE: Record<string, string> = {
  negro: 'grey', antracita: 'grey', gris: 'grey', blanco: 'white', crudo: 'white', beige: 'brown', camel: 'brown', marron: 'brown',
  azul_marino: 'blue', denim: 'blue', azul: 'blue', celeste: 'blue', verde: 'green', verde_oliva: 'green', caqui: 'green', menta: 'green',
  amarillo: 'yellow', mostaza: 'yellow', dorado: 'yellow', rojo: 'red', burdeos: 'red', terracota: 'red', rosa: 'pink', fucsia: 'pink',
  lila: 'purple', morado: 'purple',
};
const HIGHLIGHT_NEUTRALS = new Set(['blanco', 'crudo', 'gris']);
const NEUTRAL = new Set<string>(COLOR_FAMILIES.filter((f) => f.neutral).map((f) => f.id));

/**
 * The garment's colours worth naming. The generators follow these words over the photo: a navy puffer
 * measured as "blue, light blue and white" (sunlit side and specular highlights) came out light blue,
 * and a black polo measured "charcoal and grey" came out grey. So only the main shade of each tone is
 * named, and a small white/grey share on a plain garment of a vivid colour is taken as highlights (on
 * a navy or black garment it is more likely a real white detail, a collar or a stripe).
 */
function namedColours(g: GarmentDescription): string[] {
  const plain = !g.pattern || g.pattern === 'liso';
  const tones = new Set<string>();
  const out: string[] = [];
  for (const c of g.colors) {
    if (c.share < 0.12 || out.length >= 3) continue;
    if (out.length && plain && !NEUTRAL.has(g.colors[0]!.family) && HIGHLIGHT_NEUTRALS.has(c.family) && c.share < 0.25) continue;
    const tone = TONE[c.family] ?? c.family;
    if (tones.has(tone)) continue;
    tones.add(tone);
    out.push(COLOR_EN[c.family] ?? c.family);
  }
  return out;
}

/** "red hooded sweatshirt": an English label from the app's type and main colour (for image models). */
export function englishLabel(subcategory: string, colour: string | null): string {
  const noun = SUBCATEGORY_EN[subcategory] ?? getSubcategory(subcategory)?.label ?? 'garment';
  return [colour ? (COLOR_EN[colour] ?? null) : null, noun].filter(Boolean).join(' ');
}

export function describeGarment(g: GarmentDescription): string {
  const noun = SUBCATEGORY_EN[g.subcategory] ?? getSubcategory(g.subcategory)?.label ?? 'garment';
  const colours = namedColours(g);
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
  multiple: 'Show ONLY this one garment: no other clothes, hangers, hands, stands or objects.',
  worn: 'Do NOT show any person, body part or model: the garment alone, flat lay or hollow as if worn by an invisible body.',
  color: 'IMPORTANT: the previous attempt changed the colours. Keep exactly the colours of the reference garment ({COLORS}); do not tint, brighten or darken it.',
  lightness: 'Keep the true lightness of the fabric: do not make it lighter or darker than in the reference.',
  pattern: 'IMPORTANT: keep the exact print/pattern of the reference ({PATTERN}); do not add, remove or redesign it.',
  texture: 'IMPORTANT: keep the exact fabric texture and knit/weave of the reference; do not smooth it into a different material.',
  text: 'IMPORTANT: keep the printed text and logos exactly as in the reference ({TEXT}), legible, in the same place, size and colour.',
  extra_garment: 'IMPORTANT: the previous attempt added other clothes. Show ONLY this single garment ({NOUN}), alone on the white background, with nothing above, below or beside it.',
  identity: 'IMPORTANT: the previous attempt drew a different kind of item. It must be exactly this {NOUN}, as described, nothing else.',
  different: 'IMPORTANT: the previous attempt drifted into a different garment. Reproduce THIS exact garment: same cut, collar, sleeve length, length, pockets, buttons, seams and details.',
  type: 'IMPORTANT: it must remain the same type of garment as in the reference.',
};

/**
 * The parts to straighten, per kind. Only the garment's own parts are named: a small text encoder
 * (FLUX.2 klein) drew trousers under a cardigan when a top's prompt said "extend trouser legs" and
 * "no trousers".
 */
const REARRANGE_PARTS: Record<PresentationKind, string> = {
  top: 'straighten and symmetrically position the sleeves, align the neckline and shoulders',
  shirt: 'straighten and symmetrically position the sleeves, align the collar, placket and shoulders',
  knit: 'straighten and symmetrically position the sleeves, align the neckline and shoulders',
  trousers: 'extend both legs naturally and straight, align the waistband',
  shorts: 'extend both legs naturally, align the waistband',
  skirt: 'let the skirt fall naturally, align the waistband',
  dress: 'straighten and symmetrically position the straps or sleeves, align the neckline and shoulders',
  jacket: 'straighten and symmetrically position the sleeves, align the collar, lapels and shoulders',
  shoes: '',
  bag: '',
  hosiery: '',
  accessory: '',
};

export interface PackshotPrompt {
  prompt: string;
  negative: string;
  style: string;
  version: string;
}

export function buildPackshotPrompt(g: GarmentDescription, corrections: string[] = []): PackshotPrompt {
  const kind = presentationKind(g.category, g.subcategory);
  const { style } = KIND_INSTRUCTIONS[kind];
  const text = KIND_INSTRUCTIONS[kind].text.replace('{LENGTH}', '');
  const description = describeGarment(g);
  const noun = SUBCATEGORY_EN[g.subcategory] ?? 'garment';
  const presentation =
    style === 'flat lay'
      ? 'Present it in a clean, perfectly organized flat-lay style, photographed directly from above'
      : style === 'ghost mannequin'
        ? 'Present it in the clean hollow "ghost" e-commerce style, photographed directly from the front'
        : 'Present it as a clean studio product shot';
  const rearrange =
    kind === 'shoes' || kind === 'bag' || kind === 'accessory'
      ? 'Physically rearrange it into its ideal product presentation: correct perspective and orientation, tidy straps or laces, restore its natural shape.'
      : `Physically rearrange the garment into its ideal product presentation: ${REARRANGE_PARTS[kind]}, flatten excessive wrinkles, correct perspective, and restore a clean, aesthetically balanced silhouette.`;
  const keepText = g.text ? ` The garment shows the text/logo "${g.text}": reproduce it exactly, legible, in the same position, size and colour.` : '';
  const fill = (s: string) =>
    s
      .replace('{COLORS}', description)
      .replace('{PATTERN}', g.pattern && g.pattern !== 'liso' ? (PATTERN_EN[g.pattern] ?? g.pattern) : 'plain, no print')
      .replace('{TEXT}', g.text ?? 'as shown')
      .replace('{NOUN}', noun);
  const extra = [...new Set(corrections)].map((c) => CORRECTIONS[c]).filter((c): c is string => !!c).map(fill);
  const prompt = [
    `Transform the uploaded reference photograph into a premium professional e-commerce product photograph of the EXACT SAME garment: ${description}.`,
    `Reconstruct the garment as if carefully arranged by a professional fashion stylist for a luxury clothing catalogue. ${presentation}.`,
    rearrange,
    text,
    'Remove the original background, furniture, hands, hangers, distracting shadows and surrounding objects. Use a seamless pure white background.',
    `CRITICAL PRODUCT FIDELITY: Preserve the garment's exact original colours and their lightness as seen in the reference photograph (the colour words above are only approximate), fabric texture, stitching, logos, graphics, prints, buttons, pockets, seams, collar shape, sleeve length, proportions and distinctive details. Do not redesign, embellish, simplify or replace the original clothing. Do not invent parts that are not visible in the reference: keep hidden areas plain and consistent with the visible ones.${keepText}`,
    `Show ONLY this ${noun}, by itself, alone on the white background: nothing else is in the image, it is not styled as an outfit.`,
    'Show the entire garment, centered, evenly illuminated, high resolution, sharp, realistic and suitable for a professional online fashion catalogue.',
    `This is a product photography transformation, NOT the creation of a different garment, NOT a simple background removal, and NOT a photo of a person wearing the garment.`,
    ...extra,
  ].join(' ');
  const negative =
    'person, model, hands, mannequin parts, hanger, bed, furniture, floor, wrinkled, crumpled, folded sleeves, twisted, cropped, cut off, tilted, perspective distortion, extra garments, text artifacts, watermark, different garment, changed colour, changed logo';
  return { prompt, negative, style, version: PROMPT_VERSION };
}

export const STUDIO_PROMPT_VERSION = '2026-11-28.3';

/** Where the hem of shorts or a skirt falls on the invisible body, per length seen at detection. */
const HEM: Record<string, string> = {
  'upper-thigh': 'the hem at the very top of the thighs, just below the crotch',
  'mid-thigh': 'the hem at mid-thigh',
  knee: 'the hem at the knees',
  midi: 'the hem at mid-calf',
  ankle: 'the hem at the ankles',
};

/** "dress shirt", "dress pants", "dress shoes"… are formal versions of the noun, not dresses. */
const undress = (name: string) => name.toLowerCase().replace(/\bdress (shirts?|pants|trousers|shoes|socks|boots|coat|jacket)\b/g, '$1');

/**
 * The app's subcategory for a garment named by a vision-language model ("Navy Blue Puffer Jacket" →
 * plumifero), or null when the name says nothing the vocabulary has (socks, tights). Most specific
 * phrases first; hyphens join words ("boot-cut jeans" are jeans, not boots).
 */
const NAME_TO_SUBCATEGORY: Array<[RegExp, string]> = [
  [/top hat|cowboy hat|bucket hat|sun hat/, 'sombrero'],
  [/hooded jacket|hooded sweatshirt|hooded top|zip hoodie|zip-up hoodie|hoodie/, 'sudadera'],
  [/tail ?coat|suit jacket|blazer|sport coat|tuxedo jacket/, 'americana'],
  [/puffer vest|down vest|quilted vest|padded vest|gilet|puffer gilet/, 'chaleco_acolchado'],
  [/sweater vest|knit vest|knitted vest/, 'chaleco_punto'],
  [/denim jacket|jean jacket|trucker jacket/, 'cazadora_vaquera'],
  [/leather jacket|moto jacket|biker jacket|motorcycle jacket|suede jacket/, 'chaqueta_cuero'],
  [/puffer jacket|puffer coat|down jacket|down coat|quilted jacket|padded jacket|puffer/, 'plumifero'],
  [/trench coat|trench|mac/, 'gabardina'],
  [/raincoat|rain jacket|waterproof jacket|anorak|windbreaker/, 'impermeable'],
  [/track jacket|zip-up sports jacket/, 'chaqueta_deportiva'],
  [/bomber jacket|bomber/, 'bomber'],
  [/parka/, 'parka'],
  [/overcoat|coat|duster|peacoat/, 'abrigo'],
  [/overshirt|shirt jacket|shacket/, 'sobrecamisa'],
  [/jacket/, 'chaqueta'],
  [/tracksuit/, 'traje_chandal'],
  [/jumpsuit|playsuit|romper|dungarees|overalls|boiler suit/, 'mono'],
  [/evening dress|evening gown|gown|cocktail dress|party dress/, 'vestido_fiesta'],
  [/knit dress|sweater dress|knitted dress/, 'vestido_punto'],
  [/dress/, 'vestido'],
  [/hoodie|hooded sweatshirt|sweatshirt|hooded top/, 'sudadera'],
  [/cardigan/, 'cardigan'],
  [/chunky knit sweater|cable knit sweater|cable-knit sweater|chunky sweater|chunky jumper|fisherman sweater/, 'jersey_grueso'],
  [/sweater|jumper|pullover|turtleneck|knit top/, 'jersey'],
  [/polo shirt|polo/, 'polo'],
  [/long sleeve t-shirt|long-sleeve t-shirt|long sleeve tee|long sleeve top|long-sleeve top/, 'camiseta_manga_larga'],
  [/sports t-shirt|running shirt|athletic shirt|jersey top/, 'camiseta_tecnica'],
  [/t-shirt|tee|t shirt/, 'camiseta'],
  [/bodysuit/, 'body'],
  [/blouse/, 'blusa'],
  [/short sleeve shirt|short-sleeve shirt|short sleeve button/, 'camisa_manga_corta'],
  [/shirt|button-up|button-down/, 'camisa'],
  [/tank top|tank|camisole|cami|crop top|top/, 'top'],
  [/sports shorts|running shorts|athletic shorts|gym shorts/, 'pantalon_deportivo_corto'],
  [/bermuda shorts|bermudas|bermuda/, 'bermuda'],
  [/swim shorts|swim trunks|board shorts/, 'banador'],
  [/shorts/, 'pantalon_corto'],
  [/maxi skirt|long skirt|midi skirt/, 'falda_larga'],
  [/skirt|kilt/, 'falda'],
  [/jeans|denim trousers|denim pants/, 'vaquero'],
  [/chinos|chino/, 'chino'],
  [/joggers|sweatpants|track pants/, 'jogger'],
  [/leggings/, 'leggings'],
  [/suit trousers|dress pants|tailored trousers|tailored pants|formal trousers/, 'pantalon_vestir'],
  [/trousers|pants|slacks|cargo pants/, 'pantalon'],
  [/running shoes|running sneakers|trail shoes|hiking shoes|athletic shoes/, 'zapatillas_running'],
  [/canvas sneakers|canvas shoes|high-top sneakers|high tops|high-tops|plimsolls/, 'zapatillas_lona'],
  [/sneakers|trainers|sneaker|trainer/, 'zapatillas'],
  [/ankle boots|chelsea boots|booties|ankle boot|chelsea boot/, 'botines'],
  [/boots|boot/, 'botas'],
  [/high heels|heels|pumps|stilettos|heel|pump/, 'tacones'],
  [/ballet flats|flats/, 'bailarinas'],
  [/loafers|moccasins|loafer/, 'mocasines'],
  [/espadrilles|espadrille/, 'alpargatas'],
  [/sandals|sandal|flip-flops|slides/, 'sandalias'],
  [/shoes|oxfords|brogues|derbies|shoe/, 'zapatos'],
  [/backpack|rucksack/, 'mochila'],
  [/bag|handbag|tote|purse|clutch|satchel|wallet/, 'bolso'],
  [/belt/, 'cinturon'],
  [/bandana|neckerchief|silk scarf|kerchief/, 'panuelo'],
  [/scarf|shawl|stole/, 'bufanda'],
  [/tie|bow tie/, 'corbata'],
  [/beanie|knit hat|bobble hat|toque/, 'gorro'],
  [/baseball cap|trucker cap|cap/, 'gorra'],
  [/hat|fedora|top hat|panama|beret/, 'sombrero'],
  [/sunglasses|shades/, 'gafas_sol'],
  [/watch/, 'reloj'],
  [/necklace|bracelet|earrings|earring|ring|choker|jewellery|jewelry|brooch/, 'joyeria'],
  [/gloves|mittens|glove/, 'guantes'],
  [/umbrella/, 'paraguas'],
  [/bikini|swimsuit|bathing suit/, 'bikini'],
];

export function subcategoryFromName(name: string, category?: string | null, opts: { strict?: boolean } = {}): string | null {
  const n = ` ${undress(name)} `;
  // With the model's own category, only types of that category count: "Red Nike Blazer High" sneakers
  // are not a blazer.
  const valid = category && ['top', 'bottom', 'one_piece', 'outerwear', 'footwear', 'accessory', 'swimwear'].includes(category) ? category : null;
  const find = (only: string | null) => {
    for (const [re, id] of NAME_TO_SUBCATEGORY) {
      const def = getSubcategory(id);
      if (!def || (only && def.category !== only)) continue;
      if (new RegExp(`(?<![\\w-])(?:${re.source})(?![\\w-])`).test(n)) return id;
    }
    return null;
  };
  // Nothing of that category in the name ("red hooded jacket" said to be a top): any category, unless
  // strict (checking what a studio photo shows: "Red Nike Blazer High" sneakers are no blazer).
  return find(valid) ?? (valid && !opts.strict ? find(null) : null);
}

const ITEM_GROUP: Record<string, string> = {
  tacones: 'heels', botas: 'boots', botines: 'boots', zapatillas: 'sneakers', zapatillas_lona: 'sneakers', zapatillas_running: 'sneakers',
  sandalias: 'sandals', alpargatas: 'sandals', zapatos: 'flat', mocasines: 'flat', bailarinas: 'flat',
  // Outerwear: hip-length jackets / long coats / vests (a tailcoat drawn as an overcoat is wrong).
  americana: 'jacket', chaqueta: 'jacket', cazadora_vaquera: 'jacket', chaqueta_cuero: 'jacket', bomber: 'jacket',
  chaqueta_deportiva: 'jacket', impermeable: 'jacket', plumifero: 'jacket', abrigo: 'coat', gabardina: 'coat', parka: 'coat',
  chaleco_acolchado: 'vest',
  // One piece: dresses / jumpsuits.
  vestido: 'dress', vestido_punto: 'dress', vestido_fiesta: 'dress', mono: 'jumpsuit', traje_chandal: 'jumpsuit',
};

/** Subcategories that a bare generic word maps to ("shoes", "jacket"): they say little about the shape. */
const GENERIC = new Set(['zapatos', 'chaqueta']);

/**
 * Whether two names (the garment's, and what a generated photo shows) are the same kind of item:
 * same category, and among bottoms trousers / shorts / skirt, and among shoes heels / boots /
 * sneakers / sandals / flat shoes. Finer differences ("denim jacket" vs "jacket", "chunky sweater" vs
 * "sweater") are left to the fidelity check. Null when either name says nothing the vocabulary knows.
 */
export function sameKindOfItem(garment: string, shown: string, categories: { garment?: string | null; shown?: string | null } = {}): boolean | null {
  // A set drawn for one piece (trousers drawn with the waistcoat that covered them, as a suit).
  // ("suit jacket", "suit trousers" and "swimsuit" are single pieces.)
  const SET = /(?<![\w-])(suit(?!\s+(?:jacket|blazer|trousers|pants|vest|waistcoat|skirt))|set|outfit|ensemble|co-ord|two-piece|three-piece|tracksuit|jumpsuit|bodysuit)(?![\w-])/i;
  if (SET.test(shown) && !SET.test(garment)) return false;
  // A defining part that the photo shows and the studio photo lost (a hoodie drawn without its hood).
  const HOOD = /(?<![\w-])(hood|hooded|hoodie)(?![\w-])/i;
  if (HOOD.test(garment) && !HOOD.test(shown) && /(?<![\w-])(sweatshirt|jumper|pullover|sweater|top)(?![\w-])/i.test(shown)) return false;
  const a = subcategoryFromName(garment, categories.garment, { strict: true });
  const b = subcategoryFromName(shown, categories.shown, { strict: true });
  if (!a || !b) {
    // Not in the vocabulary (socks, tights): still, hosiery must not come out as a top or trousers.
    const ka = kindFromName(garment, categories.garment ?? '', 'accessory');
    const kb = kindFromName(shown, categories.shown ?? '', 'accessory');
    if ((ka === 'hosiery') !== (kb === 'hosiery') && [ka, kb].some((k) => k !== 'accessory')) return false;
    return null;
  }
  const ca = getSubcategory(a)!.category;
  const cb = getSubcategory(b)!.category;
  if (ca !== cb) return false;
  if (ca === 'bottom') return kindFromName(garment, ca, 'trousers') === kindFromName(shown, cb, 'trousers');
  // A generic word ("shoes", "jacket") is compatible with any item of its group.
  if (GENERIC.has(a) || GENERIC.has(b)) return ca !== 'outerwear' || ITEM_GROUP[a] === ITEM_GROUP[b] || [a, b].includes('chaqueta');
  if (ca === 'footwear' || ca === 'outerwear' || ca === 'one_piece') return (ITEM_GROUP[a] ?? a) === (ITEM_GROUP[b] ?? b);
  return true;
}

/** Presentation for a garment named by a vision-language model; `fallback` (the classifier's) if the name says nothing. */
export function kindFromName(name: string, category: string, fallback: PresentationKind): PresentationKind {
  // Words are whole words where a hyphen also joins: "tie-dye", "cap-sleeve" and "boot-cut" are not a
  // tie, a cap or boots; a "dress shirt" is a shirt.
  const n = ` ${undress(name)} `;
  const has = (re: RegExp) => new RegExp(`(?<![\\w-])(?:${re.source})(?![\\w-])`).test(n);
  if (has(/dress|jumpsuit|playsuit|romper|dungarees|overalls/)) return 'dress';
  if (has(/sneakers?|trainers?|shoes?|boots?|heels?|pumps?|sandals?|loafers?|flats|espadrilles?|mules?|clogs?|slippers?/)) return 'shoes';
  if (has(/bag|handbag|backpack|tote|purse|clutch|satchel|rucksack/)) return 'bag';
  if (has(/tights|stockings|pantyhose|hosiery|socks?|knee-highs?/)) return 'hosiery';
  if (has(/hat|cap|beanie|scarf|belt|gloves?|mittens?|sunglasses|glasses|watch|tie|necklace|bracelet|earrings?|umbrella/)) return 'accessory';
  if (has(/jacket|coat|blazer|parka|puffer|bomber|trench|gilet|anorak|raincoat|windbreaker|duster/)) return 'jacket';
  if (has(/shorts|bermudas?/)) return 'shorts';
  if (has(/skirt/)) return 'skirt';
  if (has(/jeans|trousers|pants|chinos|joggers|leggings|sweatpants/)) return 'trousers';
  if (has(/cardigan|sweater|jumper|hoodie|sweatshirt|pullover|knit/)) return 'knit';
  if (has(/t-shirt|tee|tank|camisole|crop top|top|vest/)) return 'top';
  if (has(/shirt|blouse|polo|overshirt/)) return 'shirt';
  const byCategory: Record<string, PresentationKind> = { top: 'top', bottom: 'trousers', one_piece: 'dress', outerwear: 'jacket', footwear: 'shoes', accessory: 'accessory' };
  return byCategory[category] ?? fallback;
}

/**
 * Studio photo first, cutout afterwards (2026-11-25). The model gets the original photo (or, with
 * several garments, this garment's region with generous context) and makes a clean product photo of
 * the named garment on a plain light grey background; the background is removed from that clean image
 * afterwards, which is far more reliable than cutting the garment out of a messy home photo first.
 *
 * Light grey rather than white: white and cream garments keep a clear edge against it, so the later
 * cutout does not eat into them (it still passes the check's "studio background" test: L* ≥ 84).
 * Shorter than buildPackshotPrompt: klein's small text encoder follows a few clear sentences better,
 * and only the garment's own parts are named (it draws whatever is named).
 */
export function buildStudioPrompt(
  g: GarmentDescription,
  opts: { multi?: boolean; corrections?: string[]; name?: { name: string; category: string } | null; description?: string | null; partial?: boolean; fixes?: string[]; length?: string | null; topHandle?: boolean | null } = {},
): PackshotPrompt {
  // A vision-language model's name ("navy blue puffer jacket") beats the classifier's label and measured
  // colours: it reads a black polo under flash as black, and a backpack the classifier took for a scarf
  // as a backpack. The editor draws what the prompt names.
  const named = opts.name?.name ? opts.name.name.toLowerCase().replace(/\s+/g, ' ').trim() : null;
  const kind = named ? kindFromName(named, opts.name!.category, presentationKind(g.category, g.subcategory)) : presentationKind(g.category, g.subcategory);
  const { style } = KIND_INSTRUCTIONS[kind];
  const description = named ? (g.brand && !named.includes(g.brand.toLowerCase()) ? `${g.brand} ${named}` : named) : describeGarment(g);
  const noun = named ?? SUBCATEGORY_EN[g.subcategory] ?? 'garment';
  const which = opts.multi
    ? ` Use only the ${noun} in the centre of the reference photo; ignore every other item of clothing, person or object in it.`
    : '';
  const keepText = g.text ? ` Reproduce the text/logo "${g.text}" exactly, legible, in the same position, size and colour.` : '';
  // A bag without a top handle (chain or shoulder strap only): with its strap "arranged neatly above the
  // bag", klein drew a short handle on every chain bag; laid in a curve in front of it, none (8 of 8).
  // A clutch held in the hand reads as "top handle" to the detection ("the bag has a short handle"), and
  // klein drew a tote with handles, then a clutch with an invented chain: a clutch, pouch or wallet is
  // small, flat and has no handle; a strap or chain only when the description names one.
  const clutch = !!named && /\b(clutch(es)?|pouch(es)?|wallets?)\b/.test(named);
  const strapped = /\b(strap|chain)s?\b/i.test(opts.description ?? '');
  const handles = clutch
    ? strapped
      ? 'a small flat clutch with no handles, its strap or chain laid in a loose curve in front of it'
      : 'a small flat clutch with no handles, no strap and no chain'
    : opts.topHandle === false
      ? 'any chain or shoulder strap it has laid in a loose curve in front of and around the bag, not raised above it; there is no handle on top of the bag'
      : 'handles or strap arranged neatly above the bag';
  // Gloves: klein draws forearm-length ones; most are wrist-length, and long ones say so in their name.
  const gloves = named && /\b(gloves?|mittens?)\b/.test(named) && !/\b(long|opera|elbow|evening|gauntlets?)\b/.test(`${named} ${opts.description ?? ''}`.toLowerCase()) ? 'Short gloves ending at the wrist, the pair side by side.' : '';
  // Where the hem falls on the invisible body, from what the detection saw (shorts, skirts).
  const length = opts.length && HEM[opts.length] ? `, ${HEM[opts.length]}` : '';
  const fill = (s: string) =>
    s
      .replace('{LENGTH}', length)
      .replace('{HANDLES}', handles)
      .replaceAll('pure seamless white background', 'plain light grey studio background')
      .replaceAll('white background', 'light grey background')
      .replaceAll('white margin', 'margin')
      .replace('{COLORS}', description)
      .replace('{PATTERN}', g.pattern && g.pattern !== 'liso' ? (PATTERN_EN[g.pattern] ?? g.pattern) : 'plain, no print')
      .replace('{TEXT}', g.text ?? 'as shown')
      .replace('{NOUN}', noun);
  const extra = [...new Set(opts.corrections ?? [])].map((c) => CORRECTIONS[c]).filter((c): c is string => !!c).map(fill);
  // The vision-language model's description of the COMPLETE item (closures, trims, lining, prints…):
  // what the editor needs to rebuild parts the photo hides (the body of a hoodie worn under its hood).
  const said = clutch ? (opts.description ?? '').replace(/[^.]*\bhandles?\b[^.]*\.?/gi, '').trim() : opts.description;
  const details = named && said ? `: ${said.trim().replace(/[.\s]+$/, '')}` : '';
  const hidden = opts.partial
    ? 'Only part of it is visible in the reference (worn by someone, covered by something or cut by the frame): show the COMPLETE item, every hidden part as described above and consistent with the visible ones.'
    : 'Hidden parts plain and consistent with the visible ones.';
  // Small editors put laces on every shoe (white pumps and loafers came out lace-up): a shoe described
  // without laces is said to have none.
  const laceless = kind === 'shoes' && !/\blac(e|es|ed|ing)\b|eyelet/i.test(`${named ?? ''} ${opts.description ?? ''}`) ? 'No laces and no eyelets.' : '';
  // What the verifier saw wrong in the previous attempt, as it must look instead ("very short denim
  // shorts ending at the top of the thigh"): named right after the item, where the editor weighs it most.
  const fixes = [...new Set((opts.fixes ?? []).map((f) => f.trim().replace(/[.\s]+$/, '')).filter(Boolean))].map((f) => `It must be exactly like this: ${f}.`);
  const prompt = [
    `Professional e-commerce studio product photo of the exact ${description} from the reference photo${details}.${which}`,
    ...fixes,
    `${fill(KIND_INSTRUCTIONS[kind].text)} ${kind === 'shoes' || kind === 'bag' || kind === 'accessory' ? '' : 'Neatly arranged by a stylist, smooth, no crumples. '}`.trim(),
    `The ${noun} alone on a plain, seamless, evenly lit very light grey (almost white) studio background, no cast shadow, no person, no hands, no hanger, no furniture, no other clothes or objects.`,
    `Keep exactly the same colours and their lightness, fabric, texture, print, logos, buttons, pockets, seams and proportions as in the reference; do not redesign it. Do not add any logo, brand mark, text, label, graphic, print, strap, lace or trim that the reference does not show: plain areas stay plain.${keepText}`,
    hidden,
    laceless,
    gloves,
    `The whole ${noun} visible and centred, filling most of the frame, sharp and high resolution.`,
    ...extra,
  ]
    .filter(Boolean)
    .join(' ');
  return { prompt, negative: '', style, version: STUDIO_PROMPT_VERSION };
}
