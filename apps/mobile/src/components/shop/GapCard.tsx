import type { WardrobeGapDto } from '@dressit/shared';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Badge, Button, Card, GarmentSilhouette, Text } from '@/components/ui';
import { colorHex, getSubcategoryCategory } from '@/components/shop/vocabHelpers';
import { radius, space, useTheme } from '@/theme';

import { ProductRail } from './ProductRail';

/** "Con una chaqueta beige podrías crear 7 conjuntos nuevos" + matching licensed products. */
export function GapCard({ gap, testID }: { gap: WardrobeGapDto; testID?: string }) {
  const { t } = useTranslation('shop');
  const { colors } = useTheme();
  const router = useRouter();
  const hex = colorHex(gap.colorFamily);
  return (
    <Card style={styles.card} testID={testID ?? `gap-${gap.key}`}>
      <View style={styles.head}>
        <View style={[styles.swatch, { backgroundColor: colors.surfaceAlt }]}>
          <GarmentSilhouette category={getSubcategoryCategory(gap.subcategory)} subcategory={gap.subcategory} color={hex} />
        </View>
        <View style={{ flex: 1, gap: space.xs }}>
          <Text variant="subheading">{gap.label}</Text>
          <Text variant="small">{gap.reason}</Text>
          <View style={styles.badges}>
            <Badge label={t('discover.gapNewOutfits', { count: gap.newOutfits })} tone="accent" icon="layers" />
            <Badge label={t('discover.gapPartners', { count: gap.partners })} tone="neutral" />
          </View>
        </View>
      </View>
      {gap.matchingProducts.length ? (
        <ProductRail items={gap.matchingProducts.map((product) => ({ product }))} testID={`gap-${gap.key}-products`} />
      ) : (
        <Text variant="caption" tone="muted">
          {t('discover.gapNoProducts')}
        </Text>
      )}
      <Button
        label={t('discover.gapSearch')}
        icon="search"
        variant="ghost"
        size="sm"
        onPress={() => router.push({ pathname: '/shop/search', params: { subcategory: gap.subcategory, color: gap.colorFamily, q: gap.label } })}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  head: { flexDirection: 'row', gap: space.md },
  swatch: { width: 64, height: 80, borderRadius: radius.md, overflow: 'hidden' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
});
