import type { GarmentDto, GarmentListQuery } from '@dressit/shared';
import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useGarments } from '@/api/hooks';
import {
  Button,
  Chip,
  EmptyState,
  ErrorState,
  GarmentTile,
  IconButton,
  OfflineBanner,
  ScreenHeader,
  SkeletonGrid,
  Text,
  TextField,
} from '@/components/ui';
import { AddGarmentSheet } from '@/components/wardrobe/AddGarmentSheet';
import { UploadQueuePill } from '@/components/wardrobe/UploadQueuePill';
import {
  BulkEditSheet,
  countFilters,
  FiltersSheet,
  SortSheet,
  useActiveFilterChips,
  type WardrobeFilters,
  type WardrobeSort,
} from '@/components/wardrobe/WardrobeSheets';
import { elevation, radius, space, useTheme } from '@/theme';

const GUTTER = 6;

export default function ArmarioScreen() {
  const { t } = useTranslation('wardrobe');
  const { t: tc } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ add?: string; spaceId?: string; tag?: string }>();

  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [filters, setFilters] = useState<WardrobeFilters>({});
  const [sort, setSort] = useState<WardrobeSort>('recent');
  const [selection, setSelection] = useState<Set<string> | null>(null);
  const [sheet, setSheet] = useState<'add' | 'filters' | 'sort' | 'bulk' | null>(null);

  // Deep-link params: open the add sheet / pre-filter by space or tag.
  useEffect(() => {
    if (params.add === '1') {
      setSheet('add');
      router.setParams({ add: undefined });
    }
  }, [params.add, router]);
  useEffect(() => {
    if (params.spaceId || params.tag) {
      setFilters((f) => ({ ...f, spaceId: params.spaceId || f.spaceId, tag: params.tag || f.tag }));
      router.setParams({ spaceId: undefined, tag: undefined });
    }
  }, [params.spaceId, params.tag, router]);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  const query = useMemo<GarmentListQuery>(() => ({ ...filters, q: debounced || undefined, sort }), [filters, debounced, sort]);
  const garments = useGarments(query);
  const items = useMemo(() => garments.data?.pages.flatMap((p) => p.items) ?? [], [garments.data]);
  const filterCount = countFilters(filters);
  const chips = useActiveFilterChips(filters);
  const isFiltered = filterCount > 0 || !!debounced;
  const selecting = selection !== null;

  const toggle = (id: string) =>
    setSelection((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const header = (
    <View style={styles.header}>
      {selecting ? (
        <View style={styles.selectionBar}>
          <IconButton icon="x" label={t('actions.cancelSelection')} onPress={() => setSelection(null)} testID="armario-selection-cancel" />
          <Text variant="subheading" style={{ flex: 1 }} accessibilityLiveRegion="polite">
            {t('selection.count', { count: selection.size })}
          </Text>
          <Button
            label={t('actions.bulkEdit')}
            size="sm"
            disabled={selection.size === 0}
            onPress={() => setSheet('bulk')}
            testID="armario-bulk-edit"
          />
        </View>
      ) : (
        <ScreenHeader
          overline={t('overline')}
          title={t('title')}
          subtitle={garments.data ? t('count', { count: items.length }) + (garments.hasNextPage ? '+' : '') : null}
          right={
            <>
              <IconButton icon="bar-chart-2" label={t('actions.stats')} onPress={() => router.push('/wardrobe/stats')} testID="armario-stats" />
              <IconButton icon="archive" label={t('actions.spaces')} onPress={() => router.push('/wardrobe/spaces')} testID="armario-spaces" />
              <IconButton icon="inbox" label={t('actions.imports')} onPress={() => router.push('/capture/imports')} testID="armario-imports" />
            </>
          }
        />
      )}
      <OfflineBanner />
      <UploadQueuePill />
      <TextField
        icon="search"
        placeholder={t('searchPlaceholder')}
        accessibilityLabel={t('searchLabel')}
        value={search}
        onChangeText={setSearch}
        onClear={() => setSearch('')}
        returnKeyType="search"
        autoCorrect={false}
        testID="armario-search"
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.toolbar} style={styles.toolbarScroll}>
        <Chip
          label={filterCount ? t('actions.filtersCount', { count: filterCount }) : t('actions.filters')}
          icon="sliders"
          selected={filterCount > 0}
          onPress={() => setSheet('filters')}
          testID="armario-filters"
        />
        <Chip label={`${t('actions.sort')}: ${t(`sort.${sort}`)}`} icon="bar-chart" onPress={() => setSheet('sort')} testID="armario-sort" />
        {!selecting && items.length > 0 ? (
          <Chip label={t('actions.select')} icon="check-square" onPress={() => setSelection(new Set())} accessibilityHint={t('actions.selectHint')} testID="armario-select" />
        ) : null}
      </ScrollView>
      {chips.length ? (
        <View style={styles.chips}>
          {chips.map((c) => (
            <Chip
              key={c.key}
              size="sm"
              label={c.label}
              icon="x"
              selected
              accessibilityHint={t('actions.removeFilter', { label: c.label })}
              onPress={() => setFilters((f) => ({ ...f, [c.key]: undefined }))}
            />
          ))}
        </View>
      ) : null}
    </View>
  );

  const renderEmpty = () => {
    if (garments.isPending) return <SkeletonGrid columns={2} items={6} testID="armario-loading" />;
    if (garments.isError && !garments.data) return <ErrorState error={garments.error} onRetry={() => garments.refetch()} />;
    if (isFiltered) {
      return (
        <EmptyState
          icon="filter"
          title={t('empty.filteredTitle')}
          body={t('empty.filteredBody')}
          actionLabel={t('actions.clearFilters')}
          onAction={() => {
            setFilters({});
            setSearch('');
          }}
          testID="armario-filtered-empty"
        />
      );
    }
    return (
      <EmptyState
        icon="grid"
        title={t('empty.title')}
        body={t('empty.body')}
        actionLabel={t('empty.action')}
        onAction={() => setSheet('add')}
        testID="armario-empty"
      />
    );
  };

  return (
    <SafeAreaView edges={['top']} style={[styles.fill, { backgroundColor: colors.background }]} testID="armario-screen">
      <FlashList<GarmentDto>
        data={items}
        numColumns={2}
        keyExtractor={(g) => g.id}
        extraData={selection}
        ListHeaderComponent={header}
        ListEmptyComponent={renderEmpty()}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        renderItem={({ item }) => (
          <View style={styles.cell}>
            <GarmentTile
              garment={item}
              selectionMode={selecting}
              selected={selection?.has(item.id)}
              onPress={() => (selecting ? toggle(item.id) : router.push({ pathname: '/garment/[id]', params: { id: item.id } }))}
              onLongPress={() => {
                if (!selecting) setSelection(new Set([item.id]));
                else toggle(item.id);
              }}
            />
          </View>
        )}
        onEndReachedThreshold={0.6}
        onEndReached={() => {
          if (garments.hasNextPage && !garments.isFetchingNextPage) garments.fetchNextPage();
        }}
        ListFooterComponent={
          garments.isFetchingNextPage ? (
            <View style={styles.footer}>
              <SkeletonGrid columns={2} items={2} />
            </View>
          ) : garments.isFetchNextPageError ? (
            <View style={styles.footer}>
              <Button label={tc('actions.loadMore')} variant="secondary" onPress={() => garments.fetchNextPage()} />
            </View>
          ) : (
            <View style={{ height: 96 }} />
          )
        }
        refreshControl={
          <RefreshControl refreshing={garments.isRefetching && !garments.isFetchingNextPage} onRefresh={() => void garments.refetch()} tintColor={colors.inkMuted} />
        }
      />
      {!selecting ? (
        <View style={styles.fabWrap} pointerEvents="box-none">
          <Button
            label={t('actions.add')}
            icon="plus"
            accessibilityHint={t('actions.addHint')}
            onPress={() => setSheet('add')}
            style={{ ...styles.fab, ...elevation.sheet }}
            testID="armario-add"
          />
        </View>
      ) : null}

      <AddGarmentSheet visible={sheet === 'add'} onClose={() => setSheet(null)} />
      <FiltersSheet visible={sheet === 'filters'} onClose={() => setSheet(null)} value={filters} onApply={setFilters} />
      <SortSheet visible={sheet === 'sort'} onClose={() => setSheet(null)} value={sort} onChange={setSort} />
      <BulkEditSheet visible={sheet === 'bulk'} onClose={() => setSheet(null)} ids={[...(selection ?? [])]} onDone={() => setSelection(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  list: { paddingHorizontal: space.xl - GUTTER },
  header: { paddingHorizontal: GUTTER, gap: space.md, paddingBottom: space.md },
  selectionBar: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingTop: space.lg, minHeight: 72 },
  toolbar: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  toolbarScroll: { flexGrow: 0 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs + 2 },
  cell: { flex: 1, padding: GUTTER, paddingBottom: space.lg },
  footer: { padding: GUTTER, paddingBottom: 96 },
  fabWrap: { position: 'absolute', right: space.xl, bottom: space.lg },
  fab: { borderRadius: radius.pill },
});
