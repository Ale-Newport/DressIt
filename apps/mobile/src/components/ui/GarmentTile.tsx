import type { GarmentDto } from '@dressit/shared';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { colorHex, colorLabel, statusLabel, subcategoryLabel } from '@/lib/vocab';
import { radius, space, useTheme } from '@/theme';

import { Badge } from './Badge';
import { CutoutImage } from './CutoutImage';
import { GarmentSilhouette } from './GarmentSilhouette';
import { Icon } from './Icon';
import { Text } from './Text';

export function garmentColor(g: Pick<GarmentDto, 'colors' | 'primaryColor'>): string | null {
  return g.colors[0]?.hex ?? colorHex(g.primaryColor);
}

/** Accessible one-line description: "Camisa blanca de Marca, en la colada". */
export function describeGarment(g: GarmentDto): string {
  const parts = [g.name || subcategoryLabel(g.subcategory)];
  if (g.primaryColor) parts.push(colorLabel(g.primaryColor).toLowerCase());
  if (g.brand) parts.push(`de ${g.brand}`);
  let s = parts.join(' ');
  if (g.status !== 'available') s += `, ${statusLabel(g.status).toLowerCase()}`;
  if (g.favorite) s += ', favorita';
  return s;
}

export interface GarmentTileProps {
  garment: GarmentDto;
  onPress?: () => void;
  onLongPress?: () => void;
  selected?: boolean;
  selectionMode?: boolean;
  showMeta?: boolean;
  testID?: string;
  /** Extra line under the name (e.g. "3 usos"). */
  caption?: string | null;
}

export function GarmentTile({ garment, onPress, onLongPress, selected, selectionMode, showMeta = true, testID, caption }: GarmentTileProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const img = garment.image;
  const label = describeGarment(garment);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={!onPress && !onLongPress}
      accessibilityRole={selectionMode ? 'checkbox' : 'button'}
      accessibilityLabel={label}
      accessibilityState={selectionMode ? { checked: !!selected } : undefined}
      testID={testID ?? `garment-tile-${garment.id}`}
      style={({ pressed }) => [styles.tile, { opacity: pressed ? 0.85 : 1 }]}
    >
      <View
        style={[
          styles.media,
          { backgroundColor: colors.surfaceAlt, borderColor: selected ? colors.accent : 'transparent' },
          garment.status !== 'available' && styles.dimmed,
        ]}
      >
        {img ? (
          <CutoutImage image={img} inset={0.1} compactLabel recyclingKey={garment.id} testID={`${testID ?? `garment-tile-${garment.id}`}-image`} />
        ) : (
          <GarmentSilhouette
            category={garment.category}
            subcategory={garment.subcategory}
            color={garmentColor(garment)}
            testID={`${testID ?? `garment-tile-${garment.id}`}-placeholder`}
          />
        )}
        <View style={styles.topRow} pointerEvents="none">
          {garment.isDemo ? <Badge label={t('badges.demo')} tone="inverse" /> : <View />}
          {selectionMode ? (
            <View style={[styles.check, { backgroundColor: selected ? colors.accent : colors.surface, borderColor: colors.lineStrong }]}>
              {selected ? <Icon name="check" size={14} color={colors.accentInk} /> : null}
            </View>
          ) : garment.favorite ? (
            <Icon name="heart" size={16} color={colors.accent} />
          ) : null}
        </View>
        {garment.status !== 'available' ? (
          <View style={styles.status} pointerEvents="none">
            <Badge label={statusLabel(garment.status)} tone="warning" />
          </View>
        ) : null}
      </View>
      {showMeta ? (
        <View style={styles.meta}>
          <Text variant="smallStrong" numberOfLines={1}>
            {garment.name || subcategoryLabel(garment.subcategory)}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {caption ?? (garment.brand ? `${garment.brand} · ${subcategoryLabel(garment.subcategory)}` : subcategoryLabel(garment.subcategory))}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: { flex: 1, gap: space.sm },
  media: { width: '100%', aspectRatio: 4 / 5, borderRadius: radius.md, overflow: 'hidden', borderWidth: 2 },
  dimmed: { opacity: 0.7 },
  topRow: { position: 'absolute', top: space.sm, left: space.sm, right: space.sm, flexDirection: 'row', justifyContent: 'space-between' },
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  status: { position: 'absolute', bottom: space.sm, left: space.sm },
  meta: { gap: 1, paddingHorizontal: 2 },
});
