import type { CatalogSearchQuery, Category, StyleId } from '@dressit/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useCatalogSearch, useRetailers } from '@/api/hooks';
import { parseEuros } from '@/components/shop/money';
import { openProduct } from '@/components/shop/ProductRail';
import {
  Button,
  Chip,
  ChipGroup,
  EmptyState,
  ErrorState,
  IconButton,
  ListRow,
  OfflineBanner,
  ProductCard,
  Sheet,
  SkeletonGrid,
  Text,
  TextField,
} from '@/components/ui';
import { categoryLabel, colorLabel, options, styleLabel } from '@/lib/vocab';
import { space, useTheme } from '@/theme';

type Sort = NonNullable<CatalogSearchQuery['sort']>;

interface Filters {
  retailer?: string;
  brand?: string;
  category?: Category;
  subcategory?: string;
  color?: string;
  style?: StyleId;
  size?: string;
  minPrice?: string;
  maxPrice?: string;
  inStock?: boolean;
  sort?: Sort;
}

const SORTS: Sort[] = ['relevance', 'price_asc', 'price_desc', 'newest', 'discount'];

function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

function activeCount(f: Filters): number {
  return Object.entries(f).filter(([k, v]) => k !== 'sort' && v !== undefined && v !== '' && v !== false).length + (f.sort && f.sort !== 'relevance' ? 1 : 0);
}

export default function CatalogSearchScreen() {
  const { t } = useTranslation('shop');
  const { colors } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ q?: string; category?: string; subcategory?: string; color?: string; brand?: string; retailer?: string; maxPrice?: string }>();
  const [q, setQ] = useState(params.q ?? '');
  const [filters, setFilters] = useState<Filters>(() => ({
    category: (params.category as Category | undefined) || undefined,
    subcategory: params.subcategory || undefined,
    color: params.color || undefined,
    brand: params.brand || undefined,
    retailer: params.retailer || undefined,
    maxPrice: params.maxPrice || undefined,
  }));
  const [sheetOpen, setSheetOpen] = useState(false);
  const debouncedQ = useDebounced(q.trim());

  const query = useMemo<CatalogSearchQuery>(
    () => ({
      q: debouncedQ || undefined,
      retailer: filters.retailer,
      brand: filters.brand?.trim() || undefined,
      category: filters.category,
      subcategory: filters.subcategory,
      color: filters.color,
      style: filters.style,
      size: filters.size?.trim() || undefined,
      minPrice: filters.minPrice ? parseEuros(filters.minPrice) : undefined,
      maxPrice: filters.maxPrice ? parseEuros(filters.maxPrice) : undefined,
      inStock: filters.inStock || undefined,
      sort: filters.sort,
    }),
    [debouncedQ, filters],
  );
  const search = useCatalogSearch(query);
  const items = useMemo(() => search.data?.pages.flatMap((p) => p.items) ?? [], [search.data]);
  const count = activeCount(filters);
  const unfiltered = !debouncedQ && count === 0;

  // Chips summarising active filters (tap to remove).
  const activeChips: Array<{ key: keyof Filters; label: string }> = [];
  if (filters.category) activeChips.push({ key: 'category', label: categoryLabel(filters.category) });
  if (filters.subcategory) activeChips.push({ key: 'subcategory', label: options.subcategories().find((s) => s.id === filters.subcategory)?.label ?? filters.subcategory });
  if (filters.color) activeChips.push({ key: 'color', label: colorLabel(filters.color) });
  if (filters.style) activeChips.push({ key: 'style', label: styleLabel(filters.style) });
  if (filters.brand) activeChips.push({ key: 'brand', label: filters.brand });
  if (filters.size) activeChips.push({ key: 'size', label: `${t('search.size')} ${filters.size}` });
  if (filters.minPrice) activeChips.push({ key: 'minPrice', label: `≥ ${filters.minPrice} €` });
  if (filters.maxPrice) activeChips.push({ key: 'maxPrice', label: `≤ ${filters.maxPrice} €` });
  if (filters.inStock) activeChips.push({ key: 'inStock', label: t('search.inStockOnly') });

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]} testID="shop-search-screen">
      <View style={styles.header}>
        <OfflineBanner />
        <View style={styles.searchRow}>
          <View style={{ flex: 1 }}>
            <TextField
              placeholder={t('search.placeholder')}
              value={q}
              onChangeText={setQ}
              onClear={() => setQ('')}
              icon="search"
              returnKeyType="search"
              accessibilityLabel={t('search.title')}
              autoCorrect={false}
              testID="shop-search-input"
            />
          </View>
          <IconButton
            icon="sliders"
            label={t('search.filtersA11y', { count })}
            variant={count ? 'filled' : 'outline'}
            selected={count > 0}
            onPress={() => setSheetOpen(true)}
            testID="shop-search-filters"
          />
        </View>
        {activeChips.length ? (
          <View style={styles.chips}>
            {activeChips.map((c) => (
              <Chip
                key={c.key}
                label={c.label}
                icon="x"
                size="sm"
                selected
                onPress={() => setFilters((f) => ({ ...f, [c.key]: undefined }))}
                accessibilityHint="Quitar filtro"
              />
            ))}
          </View>
        ) : null}
        {search.data && items.length ? (
          <Text variant="caption" tone="muted">
            {t('search.results', { count: items.length })}
            {search.hasNextPage ? '+' : ''}
          </Text>
        ) : null}
      </View>

      {search.data ? (
        <FlatList
          data={items}
          keyExtractor={(p) => `${p.kind}-${p.id}`}
          numColumns={2}
          columnWrapperStyle={styles.column}
          contentContainerStyle={styles.list}
          onEndReachedThreshold={0.6}
          onEndReached={() => {
            if (search.hasNextPage && !search.isFetchingNextPage) search.fetchNextPage();
          }}
          refreshing={search.isRefetching}
          onRefresh={() => search.refetch()}
          renderItem={({ item }) => (
            <View style={styles.cell}>
              <ProductCard product={item} onPress={() => openProduct(router, item)} testID={`search-product-${item.id}`} />
            </View>
          )}
          ListEmptyComponent={
            unfiltered ? (
              <EmptyState
                icon="shopping-bag"
                title={t('search.emptyTitle')}
                body={t('search.noCatalogBody')}
                actionLabel={t('wishlist.emptyAction')}
                onAction={() => router.push('/import/link')}
                testID="shop-search-no-catalog"
              />
            ) : (
              <EmptyState
                icon="search"
                title={t('search.emptyTitle')}
                body={t('search.emptyBody')}
                actionLabel={count ? t('search.reset') : undefined}
                onAction={count ? () => setFilters({}) : undefined}
                testID="shop-search-empty"
              />
            )
          }
          ListFooterComponent={search.isFetchingNextPage ? <ActivityIndicator style={{ margin: space.lg }} color={colors.inkMuted} /> : undefined}
        />
      ) : search.isError ? (
        <ErrorState error={search.error} onRetry={() => search.refetch()} />
      ) : (
        <View style={styles.list}>
          <SkeletonGrid columns={2} items={6} testID="shop-search-loading" />
        </View>
      )}

      <FiltersSheet
        visible={sheetOpen}
        initial={filters}
        onClose={() => setSheetOpen(false)}
        onApply={(f) => {
          setFilters(f);
          setSheetOpen(false);
        }}
      />
    </View>
  );
}

function FiltersSheet({ visible, initial, onClose, onApply }: { visible: boolean; initial: Filters; onClose: () => void; onApply: (f: Filters) => void }) {
  const { t } = useTranslation('shop');
  const retailers = useRetailers();
  const [draft, setDraft] = useState<Filters>(initial);
  useEffect(() => {
    if (visible) setDraft(initial);
  }, [visible, initial]);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const retailerOptions = useMemo(() => {
    const all = retailers.data ?? [];
    const searchable = all.filter((r) => r.capabilities.catalogSearch);
    return (searchable.length ? searchable : all).map((r) => ({ id: r.retailer.id, label: r.retailer.name }));
  }, [retailers.data]);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={t('search.filters')}
      testID="shop-filters-sheet"
      footer={
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button label={t('search.reset')} variant="ghost" onPress={() => setDraft({})} />
          <Button label={t('search.apply')} onPress={() => onApply(draft)} style={{ flex: 1 }} testID="shop-filters-apply" />
        </View>
      }
    >
      <Section title={t('search.sort')}>
        <ChipGroup
          options={SORTS.map((s) => ({ id: s, label: t(`search.sortOptions.${s}`) }))}
          value={draft.sort ?? 'relevance'}
          onChange={(v) => set('sort', (v as Sort) ?? 'relevance')}
          allowDeselect={false}
          testIDPrefix="sort"
        />
      </Section>
      {retailerOptions.length ? (
        <Section title={t('search.store')}>
          <ChipGroup options={retailerOptions} value={draft.retailer ?? null} onChange={(v) => set('retailer', (v as string) ?? undefined)} scroll testIDPrefix="filter-store" />
        </Section>
      ) : null}
      <Section title={t('search.category')}>
        <ChipGroup
          options={options.categories}
          value={draft.category ?? null}
          onChange={(v) => setDraft((d) => ({ ...d, category: (v as Category) ?? undefined, subcategory: undefined }))}
          testIDPrefix="filter-category"
        />
      </Section>
      <Section title={t('search.color')}>
        <ChipGroup options={options.colors} value={draft.color ?? null} onChange={(v) => set('color', (v as string) ?? undefined)} scroll testIDPrefix="filter-color" />
      </Section>
      <Section title={t('search.style')}>
        <ChipGroup options={options.styles} value={draft.style ?? null} onChange={(v) => set('style', (v as StyleId) ?? undefined)} scroll testIDPrefix="filter-style" />
      </Section>
      <TextField label={t('search.brand')} placeholder={t('search.brandPlaceholder')} value={draft.brand ?? ''} onChangeText={(v) => set('brand', v)} testID="filter-brand" />
      <TextField label={t('search.size')} placeholder={t('search.sizePlaceholder')} value={draft.size ?? ''} onChangeText={(v) => set('size', v)} autoCapitalize="characters" testID="filter-size" />
      <Section title={t('search.price')}>
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <View style={{ flex: 1 }}>
            <TextField label={t('search.minPrice')} value={draft.minPrice ?? ''} onChangeText={(v) => set('minPrice', v)} keyboardType="decimal-pad" testID="filter-min-price" />
          </View>
          <View style={{ flex: 1 }}>
            <TextField label={t('search.maxPrice')} value={draft.maxPrice ?? ''} onChangeText={(v) => set('maxPrice', v)} keyboardType="decimal-pad" testID="filter-max-price" />
          </View>
        </View>
      </Section>
      <ListRow title={t('search.inStockOnly')} subtitle={t('search.availability')} switchValue={!!draft.inStock} onSwitchChange={(v) => set('inStock', v)} testID="filter-in-stock" />
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <Text variant="smallStrong">{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { paddingHorizontal: space.xl, paddingTop: space.md, gap: space.sm },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  list: { paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.huge, gap: space.lg },
  column: { gap: space.md },
  cell: { flex: 1, maxWidth: '50%' },
});
