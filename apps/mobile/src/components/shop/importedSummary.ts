import type { ImportedProductDto, ProductSummaryDto } from '@dressit/shared';

import { hostnameOf } from '@/lib/urls';

/**
 * Maps an imported product (link import / page capture) to the summary shape
 * used by ProductCard and the shopping screens. Only *verified* price data is
 * treated as fresh; anything else renders as "precio no verificado".
 */
export function importedToSummary(p: ImportedProductDto): ProductSummaryDto {
  const price = p.price?.value ?? null;
  const original = p.originalPrice?.value ?? null;
  const discount = price && original && original.cents > price.cents ? Math.round((1 - price.cents / original.cents) * 100) : null;
  const sizeLabels = new Set<string>([...(p.sizes?.value ?? []), ...p.variants.map((v) => v.size).filter((s): s is string => !!s)]);
  const sizes = [...sizeLabels].map((label) => {
    const variants = p.variants.filter((v) => v.size === label);
    const available = variants.length ? (variants.some((v) => v.available === true) ? true : variants.every((v) => v.available === false) ? false : null) : null;
    return { label, available };
  });
  return {
    id: p.id,
    kind: 'imported',
    retailer: p.retailer ?? { id: 'unknown', name: hostnameOf(p.url), group: null },
    brand: p.brand?.value ?? null,
    title: p.title?.value ?? hostnameOf(p.url),
    category: p.category?.value ?? null,
    subcategory: p.subcategory?.value ?? null,
    colorName: p.colorName?.value ?? null,
    colorFamily: p.colorFamily?.value ?? null,
    price,
    originalPrice: original,
    discountPercent: discount,
    sizes,
    availability: p.availability?.value ?? 'unknown',
    image: p.images[0] ?? null,
    productUrl: p.canonicalUrl ?? p.url,
    verifiedAt: p.price?.verified ? p.verifiedAt : null,
    isStale: !p.price?.verified,
    isSponsored: false,
    isAffiliate: false,
  };
}
