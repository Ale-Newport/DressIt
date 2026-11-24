import { composeFlatLay, type OutfitDto, type OutfitItemDto, type OutfitSlot } from '@dressit/shared';
import { forwardRef } from 'react';
import { type HostInstance, StyleSheet, View, type ViewStyle } from 'react-native';

import { colorHex, slotLabel, subcategoryLabel } from '@/lib/vocab';
import { radius, useTheme } from '@/theme';

import { CutoutImage } from './CutoutImage';
import { GarmentSilhouette } from './GarmentSilhouette';
import { garmentColor } from './GarmentTile';

export type LayoutBox = OutfitDto['layout'][number];

/** Width ÷ height of the picture that will be drawn for an item, when the API reports it. */
function imageAspect(item: OutfitItemDto): number | null {
  const img = item.garment?.image ?? item.candidateProduct?.image ?? null;
  return img?.width && img?.height ? img.width / img.height : null;
}

/**
 * Flat-lay boxes for the actual canvas: the shared composer (same one the server uses) with
 * this canvas' aspect ratio and each cutout's real proportions, so pieces keep their relative
 * size and never overlap. Sorted by z so later pieces render on top.
 */
export function computeLayout(items: OutfitItemDto[], canvasAspect = 4 / 5): Array<LayoutBox & { item: OutfitItemDto }> {
  const present = items.filter((it) => it.garment || it.candidateProduct);
  const bySlot = new Map(present.map((it) => [it.slot, it]));
  return composeFlatLay(
    present.map((it) => ({
      key: it.slot,
      slot: it.slot,
      category: it.garment?.category ?? it.candidateProduct?.category ?? null,
      subcategory: it.garment?.subcategory ?? it.candidateProduct?.subcategory ?? null,
      aspect: imageAspect(it),
    })),
    { canvasAspect },
  )
    .map(({ key, x, y, w, h, z }) => ({ slot: key as OutfitSlot, x, y, w, h, z, item: bySlot.get(key as OutfitSlot)! }))
    .sort((a, b) => a.z - b.z);
}

/** Normalised 0–1 → CSS-like percentage string without float noise. */
const pct = (v: number): `${number}%` => `${Number((v * 100).toFixed(3))}%`;

export function describeOutfitItems(items: OutfitItemDto[]): string {
  return items
    .map((it) => it.garment?.name || (it.garment ? subcategoryLabel(it.garment.subcategory) : it.candidateProduct?.title) || slotLabel(it.slot))
    .join(', ');
}

export interface OutfitCanvasProps {
  items: OutfitItemDto[];
  /** Canvas width ÷ height (the composition adapts to it). */
  aspectRatio?: number;
  style?: ViewStyle;
  testID?: string;
  accessibilityLabel?: string;
  /** Highlight a slot (e.g. while swapping). */
  highlightSlot?: OutfitSlot | null;
}

/**
 * Flat-lay renderer. Boxes are normalised (0–1) and applied as percentages, so no measuring
 * pass is needed; cutouts render whole with a soft outline shadow, garments without image
 * render as colour silhouettes.
 */
export const OutfitCanvas = forwardRef<HostInstance, OutfitCanvasProps>(function OutfitCanvas(
  { items, aspectRatio = 4 / 5, style, testID = 'outfit-canvas', accessibilityLabel, highlightSlot },
  ref,
) {
  const { colors } = useTheme();
  const boxes = computeLayout(items, aspectRatio);
  return (
    <View
      ref={ref}
      collapsable={false}
      testID={testID}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel ?? `Conjunto: ${describeOutfitItems(items)}`}
      style={[styles.canvas, { aspectRatio, backgroundColor: colors.surfaceAlt }, style]}
    >
      {boxes.map((b) => {
        const g = b.item.garment;
        const p = b.item.candidateProduct;
        const image = g?.image ?? p?.image ?? null;
        return (
          <View
            key={b.slot}
            testID={`${testID}-item-${b.slot}`}
            style={[
              styles.item,
              { left: pct(b.x), top: pct(b.y), width: pct(b.w), height: pct(b.h), zIndex: Math.round(b.z) },
              highlightSlot === b.slot && { borderColor: colors.accent, borderWidth: 2, borderRadius: radius.sm },
              p && !g && { borderColor: colors.accent, borderWidth: 1, borderStyle: 'dashed', borderRadius: radius.sm },
            ]}
          >
            {image ? (
              <CutoutImage image={image} variant={image.isCutout ? 'full' : 'thumb'} style={image.isCutout ? undefined : styles.photo} />
            ) : (
              <GarmentSilhouette
                testID={`${testID}-item-${b.slot}-silhouette`}
                category={g?.category ?? p?.category ?? null}
                subcategory={g?.subcategory ?? p?.subcategory ?? null}
                color={g ? garmentColor(g) : colorHex(p?.colorFamily)}
              />
            )}
          </View>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  canvas: { width: '100%', borderRadius: radius.lg, overflow: 'hidden' },
  item: { position: 'absolute' },
  photo: { borderRadius: radius.sm, overflow: 'hidden' },
});
