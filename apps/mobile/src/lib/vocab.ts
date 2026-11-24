import {
  ACCESSORY_SLOTS,
  CATEGORIES,
  CATEGORY_LABELS,
  COLOR_FAMILIES,
  CONDITIONS,
  FIT_LABELS,
  FITS,
  GARMENT_STATUS_LABELS,
  GARMENT_STATUSES,
  getColorFamily,
  getMaterial,
  getOccasion,
  getSubcategory,
  IMAGE_POLICIES,
  INTEGRATION_STATUS_LABELS,
  MATERIALS,
  OCCASIONS,
  PATTERNS,
  SEASON_LABELS,
  SEASONS,
  SPACE_KINDS,
  STYLE_LABELS,
  STYLES,
  subcategoriesOf,
  type AccessorySlot,
  type Category,
  type Condition,
  type Fit,
  type GarmentStatus,
  type ImagePolicy,
  type IntegrationStatus,
  type OutfitSlot,
  type Season,
  type SpaceKind,
  type StyleId,
} from '@dressit/shared';

/**
 * Labels for the shared domain vocabulary. Lists always come from
 * `@dressit/shared` (single source of truth); Spanish labels too. Labels that the
 * shared package does not define (conditions, spaces, slots, image policies) live here.
 */

export const CONDITION_LABELS: Record<Condition, string> = {
  nuevo: 'Nuevo',
  como_nuevo: 'Como nuevo',
  bueno: 'Buen estado',
  usado: 'Usado',
  desgastado: 'Desgastado',
};

export const SPACE_KIND_LABELS: Record<SpaceKind, string> = {
  armario: 'Armario',
  cajon: 'Cajón',
  zapatero: 'Zapatero',
  almacenaje: 'Almacenaje',
  maleta: 'Maleta',
  otro: 'Otro',
};

export const ACCESSORY_SLOT_LABELS: Record<AccessorySlot, string> = {
  neck: 'Cuello',
  head: 'Cabeza',
  bag: 'Bolso',
  waist: 'Cintura',
  eyes: 'Gafas',
  wrist: 'Muñeca',
  jewelry: 'Joyería',
  hands: 'Manos',
  umbrella: 'Paraguas',
};

export const BASE_SLOT_LABELS: Record<string, string> = {
  base: 'Parte de arriba',
  mid: 'Capa intermedia',
  outer: 'Abrigo / chaqueta',
  bottom: 'Parte de abajo',
  one_piece: 'Pieza única',
  footwear: 'Calzado',
};

export const IMAGE_POLICY_LABELS: Record<ImagePolicy, string> = {
  licensed: 'Imágenes con licencia',
  link_preview: 'Solo vista previa del enlace',
  none: 'Sin imágenes',
};

export const AVAILABILITY_LABELS: Record<string, string> = {
  in_stock: 'Disponible',
  out_of_stock: 'Agotado',
  preorder: 'En reserva',
  unknown: 'Disponibilidad desconocida',
};

export const categoryLabel = (c: Category | string | null | undefined) => (c ? (CATEGORY_LABELS as Record<string, string>)[c] ?? c : '');
export const subcategoryLabel = (id: string | null | undefined) => (id ? getSubcategory(id)?.label ?? humanize(id) : '');
export const styleLabel = (s: StyleId | string) => (STYLE_LABELS as Record<string, string>)[s] ?? humanize(s);
export const seasonLabel = (s: Season | string) => (SEASON_LABELS as Record<string, string>)[s] ?? humanize(s);
export const statusLabel = (s: GarmentStatus | string) => (GARMENT_STATUS_LABELS as Record<string, string>)[s] ?? humanize(s);
export const fitLabel = (f: Fit | string | null | undefined) => (f ? (FIT_LABELS as Record<string, string>)[f] ?? humanize(f) : '');
export const conditionLabel = (c: Condition | string | null | undefined) => (c ? (CONDITION_LABELS as Record<string, string>)[c] ?? humanize(c) : '');
export const materialLabel = (m: string) => getMaterial(m)?.label ?? humanize(m);
export const patternLabel = (p: string | null | undefined) => (p ? PATTERNS.find((x) => x.id === p)?.label ?? humanize(p) : '');
export const occasionLabel = (o: string | null | undefined) => (o ? getOccasion(o)?.label ?? humanize(o) : '');
export const colorLabel = (family: string | null | undefined) => (family ? getColorFamily(family)?.label ?? humanize(family) : '');
export const colorHex = (family: string | null | undefined) => (family ? getColorFamily(family)?.hex ?? null : null);
export const spaceKindLabel = (k: SpaceKind | string) => (SPACE_KIND_LABELS as Record<string, string>)[k] ?? humanize(k);
export const integrationStatusLabel = (s: IntegrationStatus) => INTEGRATION_STATUS_LABELS[s] ?? s;
export const imagePolicyLabel = (p: ImagePolicy) => IMAGE_POLICY_LABELS[p] ?? p;

export function slotLabel(slot: OutfitSlot | string): string {
  if (slot.startsWith('accessory:')) {
    const sub = slot.slice('accessory:'.length) as AccessorySlot;
    return `Complemento · ${ACCESSORY_SLOT_LABELS[sub] ?? humanize(sub)}`;
  }
  return BASE_SLOT_LABELS[slot] ?? humanize(slot);
}

export function humanize(id: string): string {
  const s = id.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Options lists for pickers/filters (id + Spanish label), all derived from shared vocabulary. */
export const options = {
  categories: CATEGORIES.map((id) => ({ id, label: CATEGORY_LABELS[id] })),
  subcategories: (category?: Category) =>
    (category ? subcategoriesOf(category) : (CATEGORIES.flatMap((c) => subcategoriesOf(c)) as ReturnType<typeof subcategoriesOf>)).map((s) => ({
      id: s.id,
      label: s.label,
    })),
  styles: STYLES.map((id) => ({ id, label: STYLE_LABELS[id] })),
  seasons: SEASONS.map((id) => ({ id, label: SEASON_LABELS[id] })),
  statuses: GARMENT_STATUSES.map((id) => ({ id, label: GARMENT_STATUS_LABELS[id] })),
  occasions: OCCASIONS.map((o) => ({ id: o.id, label: o.label })),
  colors: COLOR_FAMILIES.map((c) => ({ id: c.id, label: c.label, hex: c.hex })),
  materials: MATERIALS.map((m) => ({ id: m.id, label: m.label })),
  patterns: PATTERNS.map((p) => ({ id: p.id, label: p.label })),
  fits: FITS.map((id) => ({ id, label: FIT_LABELS[id] })),
  conditions: CONDITIONS.map((id) => ({ id, label: CONDITION_LABELS[id] })),
  spaceKinds: SPACE_KINDS.map((id) => ({ id, label: SPACE_KIND_LABELS[id] })),
  imagePolicies: IMAGE_POLICIES.map((id) => ({ id, label: IMAGE_POLICY_LABELS[id] })),
  accessorySlots: ACCESSORY_SLOTS.map((id) => ({ id, label: ACCESSORY_SLOT_LABELS[id] })),
};

/** Slot for a subcategory when building a manual outfit. */
export function slotForSubcategory(subcategoryId: string): OutfitSlot | null {
  const sub = getSubcategory(subcategoryId);
  if (!sub) return null;
  if (sub.layer === 'accessory') return `accessory:${sub.accessorySlot ?? 'jewelry'}`;
  if (sub.layer === 'swim') return 'one_piece';
  return sub.layer as OutfitSlot;
}
