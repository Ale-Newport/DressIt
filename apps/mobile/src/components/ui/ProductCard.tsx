import type { ProductSummaryDto } from '@dressit/shared';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { formatMoney, timeAgo } from '@/lib/format';
import { AVAILABILITY_LABELS, colorHex } from '@/lib/vocab';
import { radius, space, useTheme } from '@/theme';

import { Badge } from './Badge';
import { GarmentSilhouette } from './GarmentSilhouette';
import { Text } from './Text';

/**
 * Price freshness wording. Stale or never-verified prices are NEVER presented as
 * current: they read "precio no verificado".
 */
export function priceFreshness(p: Pick<ProductSummaryDto, 'verifiedAt' | 'isStale'>, now = Date.now()): { verified: boolean; label: string } {
  const ago = timeAgo(p.verifiedAt, now);
  if (p.verifiedAt && !p.isStale && ago) return { verified: true, label: `verificado ${ago}` };
  if (p.verifiedAt && ago) return { verified: false, label: `precio no verificado · última comprobación ${ago}` };
  return { verified: false, label: 'precio no verificado' };
}

export interface ProductCardProps {
  product: ProductSummaryDto;
  onPress?: () => void;
  /** Horizontal compact row instead of a vertical card. */
  layout?: 'vertical' | 'horizontal';
  /** Extra line (e.g. "7 conjuntos nuevos"). */
  highlight?: string | null;
  /** "parecido" / "exacto" label for visual search. */
  matchLabel?: string | null;
  now?: number;
  testID?: string;
}

export function ProductCard({ product, onPress, layout = 'vertical', highlight, matchLabel, now, testID = 'product-card' }: ProductCardProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const fresh = priceFreshness(product, now);
  const price = product.price ? formatMoney(product.price) : null;
  const horizontal = layout === 'horizontal';

  const a11y = [
    product.title,
    product.brand,
    product.retailer.name,
    price ?? 'sin precio',
    fresh.label,
    product.isSponsored ? t('badges.sponsored') : null,
    product.isAffiliate ? t('badges.affiliate') : null,
    product.availability !== 'in_stock' ? AVAILABILITY_LABELS[product.availability] : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={a11y}
      testID={testID}
      style={({ pressed }) => [horizontal ? styles.rowCard : styles.card, { opacity: pressed ? 0.85 : 1 }]}
    >
      <View style={[horizontal ? styles.rowMedia : styles.media, { backgroundColor: colors.surfaceAlt }]}>
        {product.image ? (
          <Image
            source={{ uri: product.image.thumbUrl || product.image.url, cacheKey: `img-${product.image.id}-thumb` }}
            style={StyleSheet.absoluteFill}
            contentFit={product.image.isCutout ? 'contain' : 'cover'}
            cachePolicy="memory-disk"
            transition={140}
            accessible={false}
          />
        ) : (
          <GarmentSilhouette category={product.category} subcategory={product.subcategory} color={colorHex(product.colorFamily)} />
        )}
        {product.discountPercent && product.discountPercent > 0 ? (
          <View style={styles.discount}>
            <Badge label={`−${Math.round(product.discountPercent)} %`} tone="accent" />
          </View>
        ) : null}
      </View>
      <View style={[styles.body, horizontal && { flex: 1 }]}>
        <Text variant="overline" tone="muted" numberOfLines={1} testID={`${testID}-store`}>
          {product.retailer.name}
          {product.brand && product.brand !== product.retailer.name ? ` · ${product.brand}` : ''}
        </Text>
        <Text variant="smallStrong" numberOfLines={2}>
          {product.title}
        </Text>
        <View style={styles.priceRow}>
          <Text variant="bodyStrong" testID={`${testID}-price`}>
            {price ?? '—'}
          </Text>
          {product.originalPrice && product.price && product.originalPrice.cents > product.price.cents ? (
            <Text variant="small" tone="muted" style={styles.strike}>
              {formatMoney(product.originalPrice)}
            </Text>
          ) : null}
        </View>
        <Text
          variant="caption"
          tone={fresh.verified ? 'success' : 'warning'}
          numberOfLines={2}
          testID={fresh.verified ? `${testID}-verified` : `${testID}-unverified`}
        >
          {fresh.label}
        </Text>
        {highlight ? (
          <Text variant="caption" tone="accent" numberOfLines={2}>
            {highlight}
          </Text>
        ) : null}
        <View style={styles.badges}>
          {matchLabel ? <Badge label={matchLabel} tone="info" /> : null}
          {product.isSponsored ? <Badge label={t('badges.sponsored')} tone="inverse" testID={`${testID}-sponsored`} /> : null}
          {product.isAffiliate ? <Badge label={t('badges.affiliate')} tone="neutral" testID={`${testID}-affiliate`} /> : null}
          {product.availability !== 'in_stock' ? (
            <Badge label={AVAILABILITY_LABELS[product.availability] ?? product.availability} tone={product.availability === 'out_of_stock' ? 'danger' : 'neutral'} />
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1, gap: space.sm },
  rowCard: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  media: { width: '100%', aspectRatio: 4 / 5, borderRadius: radius.md, overflow: 'hidden' },
  rowMedia: { width: 96, aspectRatio: 4 / 5, borderRadius: radius.md, overflow: 'hidden' },
  discount: { position: 'absolute', top: space.sm, left: space.sm },
  body: { gap: 3 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  strike: { textDecorationLine: 'line-through' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: 2 },
});
