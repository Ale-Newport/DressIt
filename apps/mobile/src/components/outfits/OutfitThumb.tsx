import type { OutfitDto } from '@dressit/shared';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';

import { normalizeScore } from '@/lib/format';
import { occasionLabel } from '@/lib/vocab';
import { radius, space, useTheme } from '@/theme';

import { describeOutfitItems, Icon, OutfitCanvas, Text } from '../ui';

export function outfitTitle(outfit: OutfitDto, fallback = 'Conjunto'): string {
  return outfit.name || (outfit.occasion ? occasionLabel(outfit.occasion) : fallback);
}

export interface OutfitThumbProps {
  outfit: OutfitDto;
  onPress?: () => void;
  onLongPress?: () => void;
  selected?: boolean;
  showScore?: boolean;
  subtitle?: string | null;
  style?: ViewStyle;
  testID?: string;
  accessibilityHint?: string;
}

/** Compact outfit card: flat lay + title + score. */
export function OutfitThumb({ outfit, onPress, onLongPress, selected, showScore = true, subtitle, style, testID, accessibilityHint }: OutfitThumbProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('outfits');
  const title = outfitTitle(outfit, t('card.untitled'));
  const score = Math.round(normalizeScore(outfit.score) * 100);
  const count = outfit.items.filter((i) => i.garment || i.candidateProduct).length;
  const items = count === 1 ? t('card.itemsOne') : t('card.itemsOther', { count });
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={!onPress && !onLongPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${title}. ${describeOutfitItems(outfit.items)}. ${t('card.score', { score })}`}
      accessibilityHint={accessibilityHint}
      accessibilityState={selected !== undefined ? { selected } : undefined}
      testID={testID ?? `outfit-thumb-${outfit.id}`}
      style={({ pressed }) => [styles.wrap, { opacity: pressed ? 0.85 : 1 }, style]}
    >
      <View style={[styles.canvasWrap, { borderColor: selected ? colors.accent : 'transparent' }]}>
        <OutfitCanvas items={outfit.items} layout={outfit.layout} accessibilityLabel="" testID={`${testID ?? `outfit-thumb-${outfit.id}`}-canvas`} />
        {outfit.isFavorite ? (
          <View style={styles.fav} pointerEvents="none">
            <Icon name="heart" size={14} color={colors.accent} />
          </View>
        ) : null}
      </View>
      <View style={styles.meta}>
        <Text variant="smallStrong" numberOfLines={1}>
          {title}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {subtitle ?? (showScore ? `${items} · ${score}` : items)}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, gap: space.sm },
  canvasWrap: { borderRadius: radius.lg, borderWidth: 2, overflow: 'hidden' },
  fav: { position: 'absolute', top: space.sm, right: space.sm },
  meta: { gap: 1, paddingHorizontal: 2 },
});
