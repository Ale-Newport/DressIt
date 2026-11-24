import type { ProductSummaryDto } from '@dressit/shared';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { errorMessage } from '@/api/client';
import { findWishlistItem, useAddToWishlist, useCatalogProduct, useImportedProduct, useRemoveFromWishlist, useWishlist } from '@/api/hooks';
import { importedToSummary } from '@/components/shop/importedSummary';
import { OutboundButton } from '@/components/shop/OutboundButton';
import { OwnItSheet } from '@/components/shop/OwnItSheet';
import {
  Badge,
  Button,
  Card,
  Divider,
  ErrorState,
  GarmentSilhouette,
  OfflineBanner,
  priceFreshness,
  Screen,
  SkeletonCard,
  Text,
  useToast,
} from '@/components/ui';
import { formatDateTime, formatMoney } from '@/lib/format';
import { AVAILABILITY_LABELS, categoryLabel, colorHex, colorLabel, subcategoryLabel } from '@/lib/vocab';
import { radius, space, useTheme } from '@/theme';

export default function ProductDetailScreen() {
  const params = useLocalSearchParams<{ id: string; kind?: string }>();
  const kind = params.kind === 'imported' ? 'imported' : 'catalog';
  const catalog = useCatalogProduct(kind === 'catalog' ? params.id : undefined);
  const imported = useImportedProduct(kind === 'imported' ? params.id : undefined);
  const query = kind === 'catalog' ? catalog : imported;
  const product: ProductSummaryDto | undefined = kind === 'catalog' ? catalog.data : imported.data ? importedToSummary(imported.data) : undefined;

  return (
    <Screen testID="product-detail-screen" contentStyle={{ paddingTop: space.md }} onRefresh={() => query.refetch()} refreshing={query.isRefetching}>
      <OfflineBanner />
      {product ? (
        <ProductDetail product={product} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <SkeletonCard height={360} testID="product-detail-loading" />
      )}
    </Screen>
  );
}

function ProductDetail({ product }: { product: ProductSummaryDto }) {
  const { t } = useTranslation('shop');
  const { t: tc } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const wishlist = useWishlist();
  const add = useAddToWishlist();
  const remove = useRemoveFromWishlist();
  const [ownOpen, setOwnOpen] = useState(false);
  const ref = { kind: product.kind, id: product.id };
  const wished = findWishlistItem(wishlist.data, ref);
  const fresh = priceFreshness(product);
  const store = product.retailer.name;

  const toggleWishlist = () => {
    if (wished) {
      remove.mutate(wished.id, {
        onSuccess: () => toast.show({ message: t('product.wishlistRemoved') }),
        onError: (e) => toast.show({ message: errorMessage(e), tone: 'error' }),
      });
    } else {
      add.mutate(
        { product: ref },
        {
          onSuccess: () => toast.show({ message: t('product.wishlistAdded'), tone: 'success' }),
          onError: (e) => toast.show({ message: errorMessage(e), tone: 'error' }),
        },
      );
    }
  };

  return (
    <View style={{ gap: space.xl }}>
      <Stack.Screen options={{ title: store }} />
      <View style={[styles.hero, { backgroundColor: colors.surfaceAlt }]}>
        {product.image ? (
          <Image
            source={{ uri: product.image.url, cacheKey: `img-${product.image.id}-full` }}
            style={StyleSheet.absoluteFill}
            contentFit={product.image.isCutout ? 'contain' : 'cover'}
            cachePolicy="memory-disk"
            accessibilityLabel={product.title}
          />
        ) : (
          <GarmentSilhouette category={product.category} subcategory={product.subcategory} color={colorHex(product.colorFamily)} />
        )}
      </View>
      {product.image?.attribution ? (
        <Text variant="caption" tone="subtle">
          {product.image.attribution}
        </Text>
      ) : null}

      <View style={{ gap: space.sm }}>
        <Text variant="overline" tone="muted" testID="product-detail-store">
          {store}
          {product.brand && product.brand !== store ? ` · ${product.brand}` : ''}
        </Text>
        <Text variant="title">{product.title}</Text>
        <View style={styles.priceRow}>
          <Text variant="heading" testID="product-detail-price">
            {product.price ? formatMoney(product.price) : '—'}
          </Text>
          {product.originalPrice && product.price && product.originalPrice.cents > product.price.cents ? (
            <Text variant="body" tone="muted" style={styles.strike}>
              {formatMoney(product.originalPrice)}
            </Text>
          ) : null}
          {product.discountPercent ? <Badge label={`−${Math.round(product.discountPercent)} %`} tone="accent" /> : null}
        </View>
        <Text variant="small" tone={fresh.verified ? 'success' : 'warning'} testID={fresh.verified ? 'product-detail-verified' : 'product-detail-unverified'}>
          {fresh.label}
        </Text>
        <View style={styles.badges}>
          <Badge label={tc('badges.forSale')} tone="info" icon="shopping-bag" />
          {wished ? <Badge label={t('product.inWishlist')} tone="accent" icon="heart" testID="product-detail-in-wishlist" /> : null}
          {product.isSponsored ? <Badge label={tc('badges.sponsored')} tone="inverse" testID="product-detail-sponsored" /> : null}
          {product.isAffiliate ? <Badge label={tc('badges.affiliate')} tone="neutral" testID="product-detail-affiliate" /> : null}
          {product.availability !== 'in_stock' ? (
            <Badge label={AVAILABILITY_LABELS[product.availability] ?? product.availability} tone={product.availability === 'out_of_stock' ? 'danger' : 'neutral'} />
          ) : null}
        </View>
      </View>

      {product.isStale ? (
        <Card tone="sunken">
          <Text variant="small" tone="warning">
            {t('product.staleWarning')}
          </Text>
        </Card>
      ) : null}

      <View style={{ gap: space.md }}>
        <Button
          label={t('product.simulate')}
          icon="layers"
          onPress={() => router.push({ pathname: '/shop/simulate', params: { kind: product.kind, id: product.id } })}
          fullWidth
          accessibilityHint={t('product.simulateHint')}
          testID="product-simulate"
        />
        <OutboundButton product={ref} storeName={store} variant="secondary" context="product_detail" testID="product-outbound" />
        <Button
          label={wished ? t('product.removeWishlist') : t('product.addWishlist')}
          icon="heart"
          variant="ghost"
          onPress={toggleWishlist}
          loading={add.isPending || remove.isPending}
          fullWidth
          testID="product-wishlist-toggle"
        />
        <Button
          label={t('product.alreadyOwn')}
          icon="check-square"
          variant="ghost"
          onPress={() => setOwnOpen(true)}
          fullWidth
          accessibilityHint={t('product.alreadyOwnHint')}
          testID="product-already-own"
        />
      </View>

      <Divider />

      <View style={{ gap: space.md }}>
        <Text variant="subheading">{t('product.details')}</Text>
        {product.subcategory || product.category ? (
          <Detail label={t('product.category')} value={product.subcategory ? subcategoryLabel(product.subcategory) : categoryLabel(product.category)} />
        ) : null}
        {product.colorName || product.colorFamily ? (
          <Detail label={t('product.color')} value={[product.colorName, product.colorFamily ? colorLabel(product.colorFamily) : null].filter(Boolean).join(' · ')} />
        ) : null}
        <Detail label={t('product.availability')} value={AVAILABILITY_LABELS[product.availability] ?? product.availability} />
        <Detail label={t('product.lastVerified')} value={product.verifiedAt ? formatDateTime(product.verifiedAt) : t('product.never')} />
        {product.sizes.length ? (
          <View style={{ gap: space.sm }}>
            <Text variant="caption" tone="muted">
              {t('product.sizes')}
            </Text>
            <View style={styles.badges}>
              {product.sizes.map((s) => (
                <View
                  key={s.label}
                  style={[styles.size, { borderColor: colors.line, opacity: s.available === false ? 0.45 : 1 }]}
                  accessible
                  accessibilityLabel={s.available === false ? t('product.sizeUnavailable', { size: s.label }) : s.label}
                >
                  <Text variant="small" style={s.available === false ? styles.strike : undefined}>
                    {s.label}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}
        {product.kind === 'imported' ? (
          <Button
            label={t('product.viewImportDetails')}
            variant="ghost"
            size="sm"
            icon="info"
            onPress={() => router.push({ pathname: '/import/product/[id]', params: { id: product.id } })}
          />
        ) : null}
      </View>

      <OwnItSheet
        visible={ownOpen}
        product={product}
        wishlistItemId={wished?.id ?? null}
        onClose={() => setOwnOpen(false)}
        onOwned={(g) => {
          setOwnOpen(false);
          toast.show({ message: t('product.ownedToast'), tone: 'success' });
          router.replace({ pathname: '/garment/[id]', params: { id: g.id } });
        }}
      />
    </View>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detail} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text variant="small" tone="muted" style={{ width: 140 }}>
        {label}
      </Text>
      <Text variant="small" style={{ flex: 1 }}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { width: '100%', aspectRatio: 4 / 5, borderRadius: radius.lg, overflow: 'hidden' },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, flexWrap: 'wrap' },
  strike: { textDecorationLine: 'line-through' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  detail: { flexDirection: 'row', gap: space.md },
  size: { minWidth: 44, minHeight: 36, paddingHorizontal: space.sm, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: radius.sm },
});
