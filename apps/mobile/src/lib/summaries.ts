import type { WardrobeStatsDto } from '@dressit/shared';

import { formatMoney } from './format';
import { categoryLabel, colorLabel, styleLabel, subcategoryLabel } from './vocab';

const top = (rows: Array<{ key: string; count: number }>, label: (k: string) => string, n = 3) =>
  [...rows]
    .sort((a, b) => b.count - a.count)
    .slice(0, n)
    .map((r) => `${label(r.key).toLowerCase()} (${r.count})`)
    .join(', ');

/**
 * Plain facts from the wardrobe statistics, in Spanish. They are the ONLY input the on-device
 * model gets for the summary, so it can't mention anything that isn't here.
 */
export function wardrobeFacts(d: WardrobeStatsDto): string {
  const lines = [`Prendas en el armario: ${d.totalGarments}.`];
  if (d.byCategory.length) lines.push(`Por tipo: ${top(d.byCategory, categoryLabel, 4)}.`);
  if (d.byColor.length) lines.push(`Colores más frecuentes: ${top(d.byColor, colorLabel)}.`);
  if (d.byStyle.length) lines.push(`Estilos más frecuentes: ${top(d.byStyle, styleLabel)}.`);
  lines.push(`Conjuntos usados en los últimos 30 días: ${d.outfitsWornLast30Days}.`);
  if (d.neverWorn.length) lines.push(`Prendas sin estrenar: ${d.neverWorn.length} (por ejemplo: ${d.neverWorn.slice(0, 2).map((g) => g.name || subcategoryLabel(g.subcategory)).join(', ')}).`);
  if (d.mostWorn[0]) lines.push(`La prenda más usada: ${d.mostWorn[0].name || subcategoryLabel(d.mostWorn[0].subcategory)} (${d.mostWorn[0].wearCount} usos).`);
  for (const o of d.overRepresented.slice(0, 2)) lines.push(`Repetición: ${o.message}`);
  if (d.duplicateGroups.length) lines.push(`Posibles duplicados: ${d.duplicateGroups.length} grupos.`);
  if (d.avgCostPerWear) lines.push(`Coste medio por uso: ${formatMoney(d.avgCostPerWear)}.`);
  return lines.join('\n');
}

export const WARDROBE_SUMMARY_STYLE =
  'Escribe dos frases como estilista: qué caracteriza el armario y una sugerencia práctica para aprovecharlo mejor (por ejemplo, estrenar algo o combinar lo menos usado). No uses listas ni cifras que no aparezcan en los datos.';
