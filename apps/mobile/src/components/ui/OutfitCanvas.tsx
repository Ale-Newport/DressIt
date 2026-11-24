import type { OutfitDto, OutfitItemDto, OutfitSlot } from '@dressit/shared';
import { Image } from 'expo-image';
import { forwardRef } from 'react';
import { type HostInstance, StyleSheet, View, type ViewStyle } from 'react-native';

import { colorHex, slotLabel, subcategoryLabel } from '@/lib/vocab';
import { radius, useTheme } from '@/theme';

import { GarmentSilhouette } from './GarmentSilhouette';
import { garmentColor } from './GarmentTile';

export type LayoutBox = OutfitDto['layout'][number];

/**
 * Client fallback when the server sent no layout for a slot: a simple editorial
 * flat-lay grid (tops upper-left, bottoms lower-left, shoes bottom-right…).
 */
const FALLBACK: Record<string, Omit<LayoutBox, 'slot'>> = {
  outer: { x: 0.04, y: 0.04, w: 0.46, h: 0.5, z: 1 },
  mid: { x: 0.08, y: 0.08, w: 0.4, h: 0.4, z: 2 },
  base: { x: 0.12, y: 0.12, w: 0.36, h: 0.36, z: 3 },
  one_piece: { x: 0.08, y: 0.06, w: 0.44, h: 0.8, z: 2 },
  bottom: { x: 0.5, y: 0.06, w: 0.42, h: 0.6, z: 2 },
  footwear: { x: 0.56, y: 0.7, w: 0.36, h: 0.24, z: 3 },
};

export function computeLayout(items: OutfitItemDto[], layout: LayoutBox[] | null | undefined): Array<LayoutBox & { item: OutfitItemDto }> {
  const bySlot = new Map((layout ?? []).map((l) => [l.slot, l]));
  let accessoryIndex = 0;
  return items
    .filter((it) => it.garment || it.candidateProduct)
    .map((item) => {
      const fromServer = bySlot.get(item.slot);
      if (fromServer) return { ...fromServer, item };
      if (item.slot.startsWith('accessory:')) {
        const i = accessoryIndex++;
        return { slot: item.slot, x: 0.06 + (i % 3) * 0.16, y: 0.7 + Math.floor(i / 3) * 0.14, w: 0.15, h: 0.15, z: 4, item };
      }
      const fb = FALLBACK[item.slot] ?? { x: 0.3, y: 0.3, w: 0.4, h: 0.4, z: 1 };
      return { slot: item.slot, ...fb, item };
    })
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
  layout?: LayoutBox[] | null;
  aspectRatio?: number;
  style?: ViewStyle;
  testID?: string;
  accessibilityLabel?: string;
  /** Highlight a slot (e.g. while swapping). */
  highlightSlot?: OutfitSlot | null;
}

/**
 * Flat-lay renderer. Positions use the server's normalised (0–1) boxes as
 * percentages so no measuring pass is needed; cutouts render with `contain`,
 * garments without image render as colour silhouettes.
 */
export const OutfitCanvas = forwardRef<HostInstance, OutfitCanvasProps>(function OutfitCanvas(
  { items, layout, aspectRatio = 4 / 5, style, testID = 'outfit-canvas', accessibilityLabel, highlightSlot },
  ref,
) {
  const { colors } = useTheme();
  const boxes = computeLayout(items, layout);
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
              {
                left: pct(b.x),
                top: pct(b.y),
                width: pct(b.w),
                height: pct(b.h),
                zIndex: Math.round(b.z),
              },
              highlightSlot === b.slot && { borderColor: colors.accent, borderWidth: 2, borderRadius: radius.sm },
              p && !g && { borderColor: colors.accent, borderWidth: 1, borderStyle: 'dashed', borderRadius: radius.sm },
            ]}
          >
            {image ? (
              <Image
                source={{ uri: image.isCutout ? image.url : image.thumbUrl || image.url, cacheKey: `img-${image.id}-${image.isCutout ? 'cutout' : 'thumb'}` }}
                style={StyleSheet.absoluteFill}
                contentFit="contain"
                cachePolicy="memory-disk"
                transition={120}
                accessible={false}
              />
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
});
