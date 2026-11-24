import { type Category, getSubcategory } from '@dressit/shared';

export { colorHex } from '@/lib/vocab';

export function getSubcategoryCategory(subcategory: string | null | undefined): Category | null {
  return subcategory ? (getSubcategory(subcategory)?.category ?? null) : null;
}
