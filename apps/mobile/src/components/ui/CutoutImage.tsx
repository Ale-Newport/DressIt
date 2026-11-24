import type { ImageRefDto } from '@dressit/shared';
import { Image } from 'expo-image';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { elevation } from '@/theme';

export interface CutoutImageProps {
  image: Pick<ImageRefDto, 'id' | 'url' | 'thumbUrl' | 'isCutout'>;
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
export function CutoutImage({ image, variant = 'thumb', inset = 0, shadow = true, recyclingKey, style, testID }: CutoutImageProps) {
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
  if (!image.isCutout) return <View style={[StyleSheet.absoluteFill, style]}>{picture}</View>;
  return (
    <View style={[StyleSheet.absoluteFill, { padding: 0 }, style]} pointerEvents="none">
      <View style={[styles.inset, { top: pct(inset), bottom: pct(inset), left: pct(inset), right: pct(inset) }, shadow && elevation.cutout]}>{picture}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  inset: { position: 'absolute' },
});
