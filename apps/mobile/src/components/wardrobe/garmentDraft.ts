import type { GarmentDetailDto, GarmentAttributeDto, GarmentWriteDto } from '@dressit/shared';

import { formatCents, formatShortDate } from '@/lib/format';
import {
  categoryLabel,
  colorLabel,
  conditionLabel,
  fitLabel,
  materialLabel,
  occasionLabel,
  patternLabel,
  seasonLabel,
  styleLabel,
  subcategoryLabel,
} from '@/lib/vocab';

import { familiesFromColors, type FieldKey } from './GarmentFields';

/** Editable draft from a garment detail. */
export function garmentToDraft(g: GarmentDetailDto): GarmentWriteDto {
  return {
    name: g.name,
    category: g.category,
    subcategory: g.subcategory,
    brand: g.brand,
    model: g.model,
    colors: g.colors.map((c) => ({ hex: c.hex, share: c.share })),
    pattern: g.pattern,
    materials: g.materials,
    styles: g.styles,
    seasons: g.seasons,
    occasions: g.occasions,
    formality: g.formality,
    warmth: g.warmth,
    waterproof: g.waterproof,
    fit: g.fit,
    size: g.size,
    condition: g.condition,
    favorite: g.favorite,
    spaceId: g.spaceId,
    tags: g.tags,
    notes: g.notes,
    purchaseDate: g.purchaseDate,
    purchasePriceCents: g.purchasePrice?.cents ?? null,
  };
}

/** Fields that are edited together (category requires a matching subcategory). */
export function editorFieldsFor(field: FieldKey): FieldKey[] {
  if (field === 'category' || field === 'subcategory') return ['category', 'subcategory'];
  if (field === 'purchaseDate' || field === 'purchasePrice') return ['purchaseDate', 'purchasePrice'];
  return [field];
}

const FIELD_TO_WRITE: Record<FieldKey, Array<keyof GarmentWriteDto>> = {
  name: ['name'],
  category: ['category', 'subcategory'],
  subcategory: ['category', 'subcategory'],
  brand: ['brand'],
  colors: ['colors'],
  pattern: ['pattern'],
  materials: ['materials'],
  styles: ['styles'],
  seasons: ['seasons'],
  occasions: ['occasions'],
  fit: ['fit'],
  size: ['size'],
  condition: ['condition'],
  waterproof: ['waterproof'],
  spaceId: ['spaceId'],
  tags: ['tags'],
  notes: ['notes'],
  purchaseDate: ['purchaseDate', 'purchasePriceCents'],
  purchasePrice: ['purchaseDate', 'purchasePriceCents'],
  formality: ['formality'],
  warmth: ['warmth'],
};

/** Minimal PATCH body for the edited field(s). */
export function patchFor(field: FieldKey, draft: GarmentWriteDto): GarmentWriteDto {
  const out: GarmentWriteDto = {};
  for (const k of FIELD_TO_WRITE[field]) (out as Record<string, unknown>)[k] = draft[k];
  return out;
}

/** Attribute names the API may use for each field in `attributes` (provenance/confidence). */
const ATTRIBUTE_ALIASES: Partial<Record<FieldKey, string[]>> = {
  colors: ['colors', 'color', 'primaryColor', 'primary_color'],
  subcategory: ['subcategory', 'type'],
  materials: ['materials', 'material'],
  styles: ['styles', 'style'],
  seasons: ['seasons', 'season'],
  occasions: ['occasions', 'occasion'],
  spaceId: ['spaceId', 'space'],
  purchasePrice: ['purchasePrice', 'purchasePriceCents', 'price'],
};

export function currentAttribute(attrs: GarmentAttributeDto[], field: FieldKey): GarmentAttributeDto | undefined {
  const names = ATTRIBUTE_ALIASES[field] ?? [field];
  return attrs.find((a) => a.isCurrent && names.includes(a.attribute));
}

export interface DisplayContext {
  yes: string;
  no: string;
  none: string;
  spaceName: (id: string | null) => string | null;
}

/** Readable value for an attribute row. */
export function displayValue(g: GarmentDetailDto, field: FieldKey, ctx: DisplayContext): string {
  const list = (xs: string[], fn: (x: string) => string) => (xs.length ? xs.map(fn).join(', ') : ctx.none);
  switch (field) {
    case 'name':
      return g.name || ctx.none;
    case 'category':
      return categoryLabel(g.category);
    case 'subcategory':
      return subcategoryLabel(g.subcategory);
    case 'brand':
      return g.brand ?? ctx.none;
    case 'colors':
      return list(familiesFromColors(g.colors), colorLabel);
    case 'pattern':
      return g.pattern ? patternLabel(g.pattern) : ctx.none;
    case 'materials':
      return list(g.materials, materialLabel);
    case 'styles':
      return list(g.styles, styleLabel);
    case 'seasons':
      return list(g.seasons, seasonLabel);
    case 'occasions':
      return list(g.occasions, occasionLabel);
    case 'fit':
      return g.fit ? fitLabel(g.fit) : ctx.none;
    case 'size':
      return g.size ?? ctx.none;
    case 'condition':
      return g.condition ? conditionLabel(g.condition) : ctx.none;
    case 'waterproof':
      return g.waterproof ? ctx.yes : ctx.no;
    case 'spaceId':
      return ctx.spaceName(g.spaceId) ?? ctx.none;
    case 'tags':
      return list(g.tags, (x) => `#${x}`);
    case 'notes':
      return g.notes ?? ctx.none;
    case 'purchaseDate':
      return g.purchaseDate ? formatShortDate(g.purchaseDate) : ctx.none;
    case 'purchasePrice':
      return g.purchasePrice ? formatCents(g.purchasePrice.cents, g.purchasePrice.currency) : ctx.none;
    case 'formality':
      return formatScale(g.formality);
    case 'warmth':
      return formatScale(g.warmth);
    default:
      return ctx.none;
  }
}

function formatScale(n: number): string {
  return n <= 1 ? `${Math.round(n * 100)} %` : String(Math.round(n));
}

export const DETAIL_FIELDS: FieldKey[] = [
  'name',
  'category',
  'subcategory',
  'brand',
  'colors',
  'pattern',
  'materials',
  'styles',
  'seasons',
  'occasions',
  'fit',
  'size',
  'condition',
  'formality',
  'warmth',
  'waterproof',
  'spaceId',
  'tags',
  'purchaseDate',
  'purchasePrice',
  'notes',
];

/** i18n key for each field label (namespace `wardrobe`). */
export const FIELD_LABEL_KEYS = {
  name: 'fields.name',
  category: 'fields.category',
  subcategory: 'fields.subcategory',
  brand: 'fields.brand',
  colors: 'fields.colors',
  pattern: 'fields.pattern',
  materials: 'fields.materials',
  styles: 'fields.styles',
  seasons: 'fields.seasons',
  occasions: 'fields.occasions',
  fit: 'fields.fit',
  size: 'fields.size',
  condition: 'fields.condition',
  waterproof: 'fields.waterproof',
  spaceId: 'fields.space',
  tags: 'fields.tags',
  notes: 'fields.notes',
  purchaseDate: 'fields.purchaseDate',
  purchasePrice: 'fields.purchasePrice',
  formality: 'fields.formality',
  warmth: 'fields.warmth',
} as const satisfies Record<FieldKey, string>;
