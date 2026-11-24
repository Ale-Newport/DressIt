import type { ImageRefDto } from '@dressit/shared';
import { Image } from 'expo-image';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { elevation } from '@/theme';

import { Text } from './Text';

export interface CutoutImageProps {
  image: Pick<ImageRefDto, 'id' | 'url' | 'thumbUrl' | 'isCutout'> & { generatedBy?: string | null };
  /** Visible "Generada con IA" label on AI-generated images (default true; EU AI Act art. 50). */
  aiLabel?: boolean;
  /** Small "IA" label for small pictures (flat lays, grids). */
  compactLabel?: boolean;
  /** Use the small thumbnail (grids) or the full image (large canvases). */
  variant?: 'thumb' | 'full';
  /** Inner margin around a cutout, as a fraction of the box (photos always fill the box). */
  inset?: number;
  /** Shadow under cutouts (iOS). */
  shadow?: boolean;
  recyclingKey?: string;
  style?: ViewStyle;
  testID?: string;
}

const pct = (v: number): `${number}%` => `${Number((v * 100).toFixed(3))}%`;

/**
 * A garment picture. Background-free cutouts are shown whole ("contain"), with breathing room
 * and a soft shadow that follows their outline, so they read like a product shot on any
 * background. Ordinary photos (no cutout available) fill the box ("cover").
 */
export function CutoutImage({ image, variant = 'thumb', inset = 0, shadow = true, recyclingKey, style, testID, aiLabel = true, compactLabel = false }: CutoutImageProps) {
  const uri = variant === 'thumb' ? image.thumbUrl || image.url : image.url;
  const picture = (
    <Image
      source={{ uri, cacheKey: `img-${image.id}-${variant}` }}
      style={StyleSheet.absoluteFill}
      contentFit={image.isCutout ? 'contain' : 'cover'}
      cachePolicy="memory-disk"
      recyclingKey={recyclingKey}
      transition={140}
      accessible={false}
      testID={testID}
    />
  );
  const badge = aiLabel && image.generatedBy ? <AiBadge compact={compactLabel} testID={testID ? `${testID}-ai` : undefined} /> : null;
  if (!image.isCutout)
    return (
      <View style={[StyleSheet.absoluteFill, style]}>
        {picture}
        {badge}
      </View>
    );
  return (
    <View style={[StyleSheet.absoluteFill, { padding: 0 }, style]} pointerEvents="none">
      <View style={[styles.inset, { top: pct(inset), bottom: pct(inset), left: pct(inset), right: pct(inset) }, shadow && elevation.cutout]}>{picture}</View>
      {badge}
    </View>
  );
}

/** "Generada con IA": shown on every AI-generated picture. */
export function AiBadge({ testID, compact }: { testID?: string; compact?: boolean }) {
  return (
    <View style={[styles.badge, compact && styles.badgeCompact]} accessible accessibilityLabel="Imagen generada con IA" testID={testID}>
      <Text variant="caption" color="#fff" style={compact ? { fontSize: 10, lineHeight: 12 } : undefined}>
        {compact ? 'IA' : 'Generada con IA'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  inset: { position: 'absolute' },
  badgeCompact: { left: 2, bottom: 2, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4 },
  badge: { position: 'absolute', left: 6, bottom: 6, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: 'rgba(20,16,12,0.62)' },
});
