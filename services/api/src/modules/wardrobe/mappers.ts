import type { Selectable } from 'kysely';
import type { ColorDto, GarmentDto, ImageRefDto, Category, Condition, Fit, GarmentSource, GarmentStatus, Season, StyleId } from '@dressit/shared';
import type { GarmentImages, Garments } from '../../db/types.ts';
import type { UrlSigner } from '../../lib/signing.ts';

export type GarmentRow = Selectable<Garments> & {
  img_id?: string | null;
  img_kind?: string | null;
  img_width?: number | null;
  img_height?: number | null;
  img_license?: string | null;
  img_attribution?: string | null;
  img_source_url?: string | null;
  img_generated_by?: string | null;
  tag_names?: string[] | null;
};

export function imageRef(
  signer: UrlSigner,
  userId: string,
  img: Pick<Selectable<GarmentImages>, 'id' | 'kind' | 'width' | 'height' | 'license' | 'attribution'> & { source_url?: string | null; generated_by?: string | null },
): ImageRefDto {
  // Studio photos are transparent cutouts too (generated from the garment's own cutout).
  const isCutout = img.kind === 'cutout' || img.kind === 'studio';
  if (img.license === 'retailer_link_preview' && img.source_url) {
    // Retailer image shown by reference (never re-hosted), only when the retailer's policy allows it.
    return { id: img.id, url: img.source_url, thumbUrl: img.source_url, width: img.width, height: img.height, isCutout: false, license: 'retailer_link_preview', attribution: img.attribution };
  }
  return {
    id: img.id,
    url: signer.sign(userId, img.id, isCutout ? 'cutout' : 'original'),
    thumbUrl: signer.sign(userId, img.id, 'thumb'),
    width: img.width,
    height: img.height,
    isCutout,
    license: (img.license as ImageRefDto['license']) ?? 'user_owned',
    attribution: img.attribution,
    ...(img.generated_by ? { generatedBy: img.generated_by } : {}),
  };
}

export function toGarmentDto(row: GarmentRow, signer: UrlSigner): GarmentDto {
  const price = row.purchase_price_cents !== null ? { cents: row.purchase_price_cents, currency: row.currency } : null;
  const colors = (Array.isArray(row.colors) ? row.colors : []) as unknown as ColorDto[];
  return {
    id: row.id,
    name: row.name,
    category: row.category as Category,
    subcategory: row.subcategory,
    brand: row.brand,
    colors,
    primaryColor: row.primary_color,
    pattern: row.pattern,
    materials: row.materials,
    styles: row.styles as StyleId[],
    seasons: row.seasons as Season[],
    occasions: row.occasions,
    formality: row.formality,
    warmth: Number(row.warmth_clo),
    waterproof: row.waterproof,
    fit: row.fit as Fit | null,
    size: row.size,
    condition: row.condition as Condition | null,
    status: row.status as GarmentStatus,
    favorite: row.favorite,
    spaceId: row.space_id,
    tags: row.tag_names?.filter(Boolean) ?? [],
    image: row.img_id
      ? imageRef(signer, row.user_id, {
          id: row.img_id,
          kind: row.img_kind ?? 'original',
          width: row.img_width ?? null,
          height: row.img_height ?? null,
          license: row.img_license ?? 'user_owned',
          attribution: row.img_attribution ?? null,
          source_url: row.img_source_url ?? null,
          generated_by: row.img_generated_by ?? null,
        })
      : null,
    source: row.source as GarmentSource,
    sourceUrl: row.source_url,
    isDemo: row.is_demo,
    wearCount: row.wear_count,
    lastWornOn: row.last_worn_on,
    purchaseDate: row.purchase_date,
    purchasePrice: price,
    costPerWear: price ? { cents: Math.round(price.cents / Math.max(1, row.wear_count)), currency: price.currency } : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
