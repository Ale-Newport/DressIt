import type { WishlistItemDto } from '@dressit/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { errorMessage } from '@/api/client';
import { useRemoveFromWishlist, useWishlist } from '@/api/hooks';
import { OwnItSheet } from '@/components/shop/OwnItSheet';
import { openProduct } from '@/components/shop/ProductRail';
import { Button, Divider, EmptyState, ErrorState, OfflineBanner, ProductCard, SkeletonList, Text, useToast } from '@/components/ui';
import { timeAgo } from '@/lib/format';
import { space, useTheme } from '@/theme';

export default function WishlistScreen() {
  const { t } = useTranslation('shop');
  const { colors } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const wishlist = useWishlist();
  const remove = useRemoveFromWishlist();
  const [owning, setOwning] = useState<WishlistItemDto | null>(null);

  const header = (
    <View style={{ gap: space.md, paddingBottom: space.md }}>
      <OfflineBanner />
      <Text variant="body" tone="muted">
        {t('wishlist.intro')}
      </Text>
    </View>
  );

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]} testID="wishlist-screen">
      {wishlist.data ? (
        <FlatList
          data={wishlist.data}
          keyExtractor={(w) => w.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={header}
          ItemSeparatorComponent={() => <Divider style={{ marginVertical: space.lg }} />}
          refreshing={wishlist.isRefetching}
          onRefresh={() => wishlist.refetch()}
          ListEmptyComponent={
            <EmptyState
              icon="heart"
              title={t('wishlist.emptyTitle')}
              body={t('wishlist.emptyBody')}
              actionLabel={t('wishlist.emptyAction')}
              onAction={() => router.push('/import/link')}
              testID="wishlist-empty"
            />
          }
          renderItem={({ item }) => (
            <View style={{ gap: space.md }} testID={`wishlist-item-${item.id}`}>
              <ProductCard product={item.product} layout="horizontal" onPress={() => openProduct(router, item.product)} testID={`wishlist-product-${item.id}`} />
              {item.note ? (
                <Text variant="small" tone="muted">
                  {t('wishlist.note', { note: item.note })}
                </Text>
              ) : null}
              <View style={styles.actions}>
                <Text variant="caption" tone="subtle" style={{ flex: 1 }}>
                  {t('wishlist.added', { ago: timeAgo(item.createdAt) ?? '' })}
                </Text>
                <Button
                  label={t('wishlist.remove')}
                  size="sm"
                  variant="ghost"
                  icon="trash-2"
                  accessibilityLabel={t('wishlist.removeA11y', { title: item.product.title })}
                  onPress={() =>
                    remove.mutate(item.id, {
                      onSuccess: () => toast.show({ message: t('product.wishlistRemoved') }),
                      onError: (e) => toast.show({ message: errorMessage(e), tone: 'error' }),
                    })
                  }
                  testID={`wishlist-remove-${item.id}`}
                />
                <Button label={t('wishlist.alreadyOwn')} size="sm" variant="secondary" icon="check-square" onPress={() => setOwning(item)} testID={`wishlist-own-${item.id}`} />
              </View>
            </View>
          )}
        />
      ) : wishlist.isError ? (
        <View style={styles.list}>
          {header}
          <ErrorState error={wishlist.error} onRetry={() => wishlist.refetch()} />
        </View>
      ) : (
        <View style={styles.list}>
          {header}
          <SkeletonList rows={4} testID="wishlist-loading" />
        </View>
      )}
      {owning ? (
        <OwnItSheet
          visible
          product={owning.product}
          wishlistItemId={owning.id}
          onClose={() => setOwning(null)}
          onOwned={(g) => {
            setOwning(null);
            toast.show({ message: t('product.ownedToast'), tone: 'success' });
            router.push({ pathname: '/garment/[id]', params: { id: g.id } });
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  list: { paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.huge },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
});
