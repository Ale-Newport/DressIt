import { getColorFamily, getOccasion, STYLE_LABELS, type StyleId } from '@dressit/shared';
import { daysSinceWorn } from './scoring.ts';
import type { EngineContext, EngineHistory, EngineProfile, FeatureName, ScoredOutfit } from './types.ts';

const KIND_LABEL: Record<string, string> = {
  neutra: 'neutra',
  monocromatica: 'monocromática',
  analoga: 'análoga',
  complementaria: 'complementaria',
  triadica: 'triádica',
  contraste: 'de contraste',
  choque: 'arriesgada',
};

const colorLabel = (f: string) => (getColorFamily(f)?.label ?? f).toLowerCase();
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

function fmtTemp(n: number): string {
  return `${Math.round(n)} °C`;
}

/**
 * Human explanations derived from the actual feature contributions (not from an LLM),
 * so every sentence is traceable to a score component.
 */
export function explainOutfit(
  outfit: ScoredOutfit,
  ctx: EngineContext,
  profile: EngineProfile,
  history: EngineHistory,
  extra: { colorKind: string; chromaticFamilies: string[] },
): { reasons: string[]; weatherNote: string | null } {
  const reasons: Array<{ text: string; weight: number }> = [];
  const c = outfit.contributions;
  const f = outfit.features;
  const byFeature = (name: FeatureName) => c[name];
  const items = outfit.items;
  const name = (slot: string) => items.find((i) => i.slot === slot)?.garment.name;

  // Colors.
  if (f.color >= 0.75) {
    const fams = [...new Set(items.filter((i) => !i.slot.startsWith('accessory')).map((i) => i.garment.colors[0]?.family).filter(Boolean))] as string[];
    const list = fams.slice(0, 3).map(colorLabel);
    const joined = list.length > 1 ? `${list.slice(0, -1).join(', ')} y ${list.at(-1)}` : list[0] ?? '';
    const accents = extra.chromaticFamilies.map(colorLabel);
    const text =
      extra.colorKind === 'neutra' && accents.length
        ? `Base neutra con un toque de ${accents.slice(0, 2).join(' y ')}: ${joined} combinan bien.`
        : `Paleta ${KIND_LABEL[extra.colorKind] ?? 'equilibrada'}: ${joined} combinan bien.`;
    reasons.push({ text, weight: byFeature('color') + 0.05 });
  } else if (f.color < 0.5) {
    reasons.push({ text: 'Combinación de color atrevida: funciona si buscas un look llamativo.', weight: 0.01 });
  }

  // Weather.
  let weatherNote: string | null = null;
  const w = ctx.weather;
  const th = outfit.thermal;
  if (w && th) {
    const outer = name('outer');
    const parts: string[] = [];
    parts.push(`Pensado para ${Math.round(w.apparentMin)}–${fmtTemp(w.apparentMax)} de sensación térmica`);
    if (w.apparentMax - w.apparentMin >= 6 && th.hasRemovableLayer) {
      parts.push(outer ? `: ${lower(outer)} se puede quitar cuando suba la temperatura` : ': lleva una capa que puedes quitarte');
    }
    if (th.coldDeficit > 0.25) parts.push('. Puede quedarse corto de abrigo a primera hora');
    if (th.hotExcess > 0.3) parts.push('. Puede resultar caluroso en las horas centrales');
    weatherNote = parts.join('') + '.';
    if (w.precipProbMax >= 40) {
      const when = w.rainFromHour !== null ? ` a partir de las ${String(w.rainFromHour).padStart(2, '0')}:00` : '';
      if (th.rainProtected) {
        const prot = items.find((i) => (i.slot === 'outer' && i.garment.waterproof) || i.slot === 'accessory:umbrella')?.garment.name;
        reasons.push({ text: `Lluvia probable (${Math.round(w.precipProbMax)} %)${when}: ${prot ? lower(prot) : 'una prenda'} te protege.`, weight: 0.3 });
      } else {
        reasons.push({ text: `Ojo: hay ${Math.round(w.precipProbMax)} % de probabilidad de lluvia${when} y este conjunto no incluye protección impermeable.`, weight: 0.05 });
      }
    }
    if (f.weather >= 0.8) reasons.push({ text: weatherNote, weight: byFeature('weather') + 0.04 });
  }

  // Occasion & formality.
  const occ = getOccasion(ctx.occasion.id);
  if (f.formality >= 0.8 && occ) reasons.push({ text: `Nivel de formalidad adecuado para ${occ.label.toLowerCase()}.`, weight: byFeature('formality') });
  else if (f.formality < 0.5 && occ) reasons.push({ text: `Quizá ${outfit.formality < occ.formality[0] ? 'demasiado informal' : 'demasiado arreglado'} para ${occ.label.toLowerCase()}.`, weight: 0.01 });
  if (occ?.tip && f.occasionStyle >= 0.6) reasons.push({ text: occ.tip, weight: 0.02 });

  // Style.
  if (outfit.dominantStyle && f.style >= 0.7) {
    reasons.push({ text: `Estilo coherente: ${STYLE_LABELS[outfit.dominantStyle as StyleId].toLowerCase()}.`, weight: byFeature('style') });
  }
  if (f.personal >= 0.75 && profile.preferredStyles.length) {
    const match = profile.preferredStyles.filter((s) => items.some((i) => (i.garment.styleVector[s] ?? 0) >= 0.6));
    if (match.length) reasons.push({ text: `Encaja con tu estilo ${match.slice(0, 2).map((s) => STYLE_LABELS[s].toLowerCase()).join(' y ')}.`, weight: byFeature('personal') });
  }
  const fav = items.flatMap((i) => i.garment.colors.map((col) => col.family)).find((fam) => profile.favoriteColors.includes(fam));
  if (fav) reasons.push({ text: `Incluye uno de tus colores favoritos: ${colorLabel(fav)}.`, weight: 0.03 });

  // Learned affinity.
  if (f.affinity >= 0.65) reasons.push({ text: 'Se parece a conjuntos que te han gustado.', weight: byFeature('affinity') });

  // Rotation / underused items.
  const neglected = items
    .filter((i) => !i.slot.startsWith('accessory') && !i.garment.isCandidate)
    .map((i) => ({ g: i.garment, d: daysSinceWorn(i.garment, history, ctx.date) }))
    .filter((x) => Number.isFinite(x.d) && x.d >= 21)
    .sort((a, b) => b.d - a.d)[0];
  if (neglected) {
    reasons.push({ text: `Recupera ${lower(neglected.g.name)}: no lo usas desde hace ${neglected.d} días.`, weight: 0.04 });
  } else {
    const never = items.find((i) => !i.slot.startsWith('accessory') && i.garment.wearCount === 0 && !i.garment.isCandidate);
    if (never) reasons.push({ text: `Estrena ${lower(never.garment.name)}: todavía no lo has usado.`, weight: 0.03 });
  }

  // Silhouette.
  if (f.silhouette >= 0.9) reasons.push({ text: 'Proporciones equilibradas entre volumen arriba y abajo.', weight: byFeature('silhouette') });
  if (f.pattern < 0.5) reasons.push({ text: 'Mezcla dos estampados: es un look con carácter.', weight: 0.005 });

  reasons.sort((a, b) => b.weight - a.weight);
  const texts = [...new Set(reasons.map((r) => r.text))].slice(0, 4);
  return { reasons: texts, weatherNote };
}
