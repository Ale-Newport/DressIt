import type { ProductSummaryDto } from '@dressit/shared';
import { useRouter } from 'expo-router';
import { FlatList, StyleSheet, View } from 'react-native';

import { ProductCard } from '@/components/ui';
import { space } from '@/theme';

export interface RailItem {
  product: ProductSummaryDto;
  highlight?: string | null;
}

/** Horizontal rail of product cards; each opens the product detail. */
export function ProductRail({ items, testID }: { items: RailItem[]; testID?: string }) {
  const router = useRouter();
  return (
    <FlatList
      horizontal
      data={items}
      testID={testID}
      keyExtractor={(it) => `${it.product.kind}-${it.product.id}`}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.content}
      ItemSeparatorComponent={() => <View style={{ width: space.md }} />}
      renderItem={({ item }) => (
        <View style={styles.cell}>
          <ProductCard
            product={item.product}
            highlight={item.highlight}
            testID={`product-card-${item.product.id}`}
            onPress={() => openProduct(router, item.product)}
          />
        </View>
      )}
    />
  );
}

export function openProduct(router: ReturnType<typeof useRouter>, product: Pick<ProductSummaryDto, 'id' | 'kind'>) {
  router.push({ pathname: '/shop/product/[id]', params: { id: product.id, kind: product.kind } });
}

const styles = StyleSheet.create({
  content: { paddingRight: space.xl },
  cell: { width: 164 },
});
