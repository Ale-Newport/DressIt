import { getSubcategory, type Category } from '@dressit/shared';

/**
 * Infers subcategory from a retailer product title / breadcrumb (Spanish first,
 * English fallbacks). Order matters: more specific phrases first.
 * The result is always flagged as inferred (never "verified").
 */
const RULES: Array<[RegExp, string]> = [
  [/cazadora vaquera|chaqueta vaquera|denim jacket|trucker/i, 'cazadora_vaquera'],
  [/chaleco acolchado|chaleco plum|puffer vest|gilet/i, 'chaleco_acolchado'],
  [/chaleco (de )?punto|knit vest|sweater vest/i, 'chaleco_punto'],
  [/sobrecamisa|overshirt/i, 'sobrecamisa'],
  [/camisa (de )?manga corta|short sleeve shirt/i, 'camisa_manga_corta'],
  [/camiseta (de )?manga larga|long sleeve t-?shirt/i, 'camiseta_manga_larga'],
  [/camiseta t[eé]cnica|camiseta (de )?running|camiseta deportiva|training (t-)?shirt/i, 'camiseta_tecnica'],
  [/pantal[oó]n corto deportivo|short(s)? (de )?running|running shorts/i, 'pantalon_deportivo_corto'],
  [/pantal[oó]n (de )?(traje|vestir)|pantal[oó]n sastre|tailored trousers|suit trousers/i, 'pantalon_vestir'],
  [/pantal[oó]n corto|shorts?\b/i, 'pantalon_corto'],
  [/bermuda/i, 'bermuda'],
  [/vaquero|jeans?\b|denim/i, 'vaquero'],
  [/\bchinos?\b/i, 'chino'],
  [/jogger|pantal[oó]n (de )?ch[aá]ndal|sweatpants|track pants/i, 'jogger'],
  [/leggings?|mallas/i, 'leggings'],
  [/pantal[oó]n(es)?|trousers|pants\b/i, 'pantalon'],
  [/falda (larga|midi|maxi)|maxi skirt|midi skirt/i, 'falda_larga'],
  [/falda|skirt/i, 'falda'],
  [/vestido (de )?(fiesta|noche)|evening dress|gown/i, 'vestido_fiesta'],
  [/vestido (de )?punto|knit dress/i, 'vestido_punto'],
  [/vestido|dress\b/i, 'vestido'],
  [/\bmono\b|jumpsuit|peto/i, 'mono'],
  [/ch[aá]ndal|tracksuit/i, 'traje_chandal'],
  [/americana|blazer/i, 'americana'],
  [/gabardina|trench/i, 'gabardina'],
  [/plum[ií]fero|anorak acolchado|chaqueta acolchada|down jacket|puffer/i, 'plumifero'],
  [/parka/i, 'parka'],
  [/abrigo|coat\b/i, 'abrigo'],
  [/chubasquero|impermeable|rain ?jacket|cortavientos/i, 'impermeable'],
  [/bomber/i, 'bomber'],
  [/(chaqueta|cazadora) (de )?(cuero|piel|polipiel|biker)|leather jacket|biker/i, 'chaqueta_cuero'],
  [/chaqueta (deportiva|de ch[aá]ndal|running)|track jacket/i, 'chaqueta_deportiva'],
  [/c[aá]rdigan|cardigan|chaqueta (de )?punto/i, 'cardigan'],
  [/chaqueta|cazadora|jacket/i, 'chaqueta'],
  [/sudadera|hoodie|sweatshirt/i, 'sudadera'],
  [/jersey (grueso|ochos|trenzado)|chunky (knit|sweater)/i, 'jersey_grueso'],
  [/jersey|su[eé]ter|sweater|pullover|punto/i, 'jersey'],
  [/\bpolo\b/i, 'polo'],
  [/blusa|blouse/i, 'blusa'],
  [/\bbody\b|bodysuit/i, 'body'],
  [/camisa|shirt\b/i, 'camisa'],
  [/camiseta|t-?shirt|\btee\b/i, 'camiseta'],
  [/\btop\b|crop|tirantes/i, 'top'],
  [/zapatillas? (de )?(running|correr|training|deporte)|running shoes|trainers? de running/i, 'zapatillas_running'],
  [/zapatillas? (de )?lona|canvas sneakers/i, 'zapatillas_lona'],
  [/zapatillas?|deportivas|sneakers?|trainers?/i, 'zapatillas'],
  [/bot[ií]n(es)?\b|ankle boots/i, 'botines'],
  [/botas?|boots?\b/i, 'botas'],
  [/mocas[ií]n|mocasines|loafers?/i, 'mocasines'],
  [/sandalias?|sandals?/i, 'sandalias'],
  [/alpargatas?|espadrilles?/i, 'alpargatas'],
  [/bailarinas?|ballet flats?/i, 'bailarinas'],
  [/tac[oó]n|stilettos?|salones|heels?/i, 'tacones'],
  [/zapatos?|oxford|derby|shoes?\b/i, 'zapatos'],
  [/mochila|backpack/i, 'mochila'],
  [/bolso|bandolera|shopper|tote|clutch|\bbag\b/i, 'bolso'],
  [/cintur[oó]n|belt\b/i, 'cinturon'],
  [/bufanda|scarf/i, 'bufanda'],
  [/pa[nñ]uelo|foulard/i, 'panuelo'],
  [/corbata|\btie\b/i, 'corbata'],
  [/gorra|\bcap\b/i, 'gorra'],
  [/gorro|beanie/i, 'gorro'],
  [/sombrero|\bhat\b/i, 'sombrero'],
  [/gafas de sol|sunglasses/i, 'gafas_sol'],
  [/reloj|watch\b/i, 'reloj'],
  [/collar|pendientes|pulsera|anillo|necklace|earrings|bracelet|ring\b/i, 'joyeria'],
  [/guantes|gloves/i, 'guantes'],
  [/paraguas|umbrella/i, 'paraguas'],
  [/bikini/i, 'bikini'],
  [/ba[nñ]ador|swim/i, 'banador'],
];

export interface CategoryGuess {
  category: Category;
  subcategory: string;
  confidence: number;
  matched: string;
}

export function inferSubcategory(...texts: Array<string | null | undefined>): CategoryGuess | null {
  // Title first: it's the most specific; breadcrumbs/categories next.
  for (let idx = 0; idx < texts.length; idx++) {
    const t = texts[idx];
    if (!t) continue;
    for (const [re, sub] of RULES) {
      const m = re.exec(t);
      if (m) {
        const def = getSubcategory(sub);
        if (!def) continue;
        return { category: def.category, subcategory: sub, confidence: idx === 0 ? 0.8 : 0.6, matched: m[0] };
      }
    }
  }
  return null;
}

const MATERIAL_RULES: Array<[RegExp, string]> = [
  [/algod[oó]n|cotton/i, 'algodon'],
  [/lino|linen/i, 'lino'],
  [/cachemir|cashmere/i, 'cachemira'],
  [/\blana\b|wool|merino/i, 'lana'],
  [/seda|silk/i, 'seda'],
  [/sat[eé]n|satin/i, 'saten'],
  [/poli[eé]ster|polyester/i, 'poliester'],
  [/viscosa|viscose|rayon/i, 'viscosa'],
  [/denim|vaquero/i, 'denim'],
  [/\bpana\b|corduroy/i, 'pana'],
  [/tweed/i, 'tweed'],
  [/\bante\b|suede/i, 'ante'],
  [/piel|cuero|leather/i, 'cuero'],
  [/lona|canvas/i, 'lona'],
  [/plum[oó]n|down\b/i, 'plumon'],
  [/nylon|nail[oó]n|poliamida/i, 'nailon'],
  [/terciopelo|velvet/i, 'terciopelo'],
  [/gore-?tex|t[eé]cnico|dri-?fit|climacool|aeroready/i, 'tecnico'],
];

export function inferMaterials(...texts: Array<string | null | undefined>): string[] {
  const found = new Set<string>();
  for (const t of texts) {
    if (!t) continue;
    for (const [re, m] of MATERIAL_RULES) if (re.test(t)) found.add(m);
  }
  return [...found].slice(0, 3);
}
