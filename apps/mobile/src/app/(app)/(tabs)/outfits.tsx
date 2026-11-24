import type { OutfitDto } from '@dressit/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { type OutfitFilter, useOutfitFeedback, useOutfits, useRecommendations } from '@/api/hooks';
import { errorMessage } from '@/api/client';
import { OutfitCard } from '@/components/OutfitCard';
import { OutfitThumb } from '@/components/outfits/OutfitThumb';
import {
  Button,
  EmptyState,
  ErrorState,
  Icon,
  type IconName,
  OfflineBanner,
  Screen,
  ScreenHeader,
  SegmentedControl,
  SkeletonCard,
  SkeletonGrid,
  Text,
  useToast,
} from '@/components/ui';
import { today } from '@/lib/dates';
import { occasionLabel } from '@/lib/vocab';
import { hairline, radius, space, useTheme } from '@/theme';

type Segment = 'suggested' | 'saved' | 'favorites';

export default function OutfitsScreen() {
  const { t } = useTranslation('outfits');
  const router = useRouter();
  const [segment, setSegment] = useState<Segment>('suggested');
  const [seed, setSeed] = useState<number | undefined>(undefined);
  const date = today();
  const suggested = useRecommendations({ date, count: 4, seed }, segment === 'suggested');
  const saved = useOutfits('saved');
  const favorites = useOutfits('favorites');
  const listQuery = segment === 'favorites' ? favorites : saved;

  const refreshing = segment === 'suggested' ? suggested.isRefetching : listQuery.isRefetching;
  const onRefresh = () => (segment === 'suggested' ? suggested.refetch() : listQuery.refetch());

  return (
    <Screen edges={['top']} refreshing={refreshing} onRefresh={onRefresh} testID="outfits-screen">
      <ScreenHeader overline={t('overline')} title={t('title')} />
      <OfflineBanner />
      <EntryTiles />
      <SegmentedControl<Segment>
        value={segment}
        onChange={setSegment}
        accessibilityLabel={t('title')}
        segments={[
          { id: 'suggested', label: t('segments.suggested'), testID: 'outfits-segment-suggested' },
          { id: 'saved', label: t('segments.saved'), testID: 'outfits-segment-saved' },
          { id: 'favorites', label: t('segments.favorites'), testID: 'outfits-segment-favorites' },
        ]}
      />
      {segment === 'suggested' ? (
        <SuggestedList
          query={suggested}
          onRegenerate={() => setSeed(Math.floor(Math.random() * 1_000_000))}
          onAddGarments={() => router.push({ pathname: '/armario', params: { add: '1' } })}
        />
      ) : (
        <OutfitGrid filter={segment} query={listQuery} />
      )}
    </Screen>
  );
}

function EntryTiles() {
  const { t } = useTranslation('outfits');
  const router = useRouter();
  const tiles: Array<{ id: string; icon: IconName; label: string; hint: string; onPress: () => void }> = [
    { id: 'builder', icon: 'plus-square', label: t('tiles.builder'), hint: t('tiles.builderHint'), onPress: () => router.push('/outfit/builder') },
    { id: 'planner', icon: 'calendar', label: t('tiles.planner'), hint: t('tiles.plannerHint'), onPress: () => router.push('/planner') },
    { id: 'history', icon: 'clock', label: t('tiles.history'), hint: t('tiles.historyHint'), onPress: () => router.push('/history') },
    { id: 'trips', icon: 'briefcase', label: t('tiles.trips'), hint: t('tiles.tripsHint'), onPress: () => router.push('/trips') },
    { id: 'compare', icon: 'columns', label: t('tiles.compare'), hint: t('tiles.compareHint'), onPress: () => router.push('/outfit/compare') },
  ];
  return (
    <View style={styles.tiles}>
      {tiles.map((tile) => (
        <Tile key={tile.id} {...tile} />
      ))}
    </View>
  );
}

function Tile({ id, icon, label, hint, onPress }: { id: string; icon: IconName; label: string; hint: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      testID={`outfits-tile-${id}`}
      style={({ pressed }) => [styles.tile, { borderColor: colors.line, backgroundColor: colors.surface, opacity: pressed ? 0.7 : 1 }]}
    >
      <Icon name={icon} size={20} color={colors.ink} />
      <Text variant="smallStrong" numberOfLines={1}>
        {label}
      </Text>
      <Text variant="caption" tone="muted" numberOfLines={1}>
        {hint}
      </Text>
    </Pressable>
  );
}

function SuggestedList({
  query,
  onRegenerate,
  onAddGarments,
}: {
  query: ReturnType<typeof useRecommendations>;
  onRegenerate: () => void;
  onAddGarments: () => void;
}) {
  const { t } = useTranslation('outfits');
  const router = useRouter();
  const data = query.data;

  if (data === undefined) {
    if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
    return (
      <View style={{ gap: space.xl }}>
        <SkeletonCard />
        <SkeletonCard />
      </View>
    );
  }

  return (
    <View style={{ gap: space.xl }} testID="outfits-suggested">
      <View style={styles.suggestedHead}>
        <View style={{ flex: 1 }}>
          <Text variant="overline" tone="muted">
            {t('suggested.today')}
          </Text>
          <Text variant="small" tone="muted">
            {t('suggested.occasion', { occasion: data.occasion.label || occasionLabel(data.occasion.id) })}
          </Text>
        </View>
        <Button
          label={query.isFetching ? t('suggested.regenerating') : t('suggested.regenerate')}
          icon="refresh-cw"
          size="sm"
          variant="secondary"
          loading={query.isFetching}
          onPress={onRegenerate}
          accessibilityHint={t('suggested.regenerateHint')}
          testID="outfits-regenerate"
        />
      </View>
      {data.warnings.map((w, i) => (
        <Text key={i} variant="small" tone="warning">
          {w}
        </Text>
      ))}
      {data.outfits.length === 0 ? (
        <EmptyState
          icon="layers"
          title={t('empty.suggestedTitle')}
          body={t('empty.suggestedBody')}
          actionLabel={t('empty.addGarments')}
          onAction={onAddGarments}
          testID="outfits-suggested-empty"
        />
      ) : (
        data.outfits.map((o) => (
          <OutfitCard
            key={o.id}
            outfit={o}
            maxExplanation={2}
            onPress={() => router.push({ pathname: '/outfit/[id]', params: { id: o.id } })}
            footer={<QuickActions outfit={o} />}
          />
        ))
      )}
    </View>
  );
}

function QuickActions({ outfit }: { outfit: OutfitDto }) {
  const { t } = useTranslation('outfits');
  const router = useRouter();
  const toast = useToast();
  const feedback = useOutfitFeedback();
  const act = (action: 'save' | 'unsave' | 'favorite' | 'unfavorite', message: string) =>
    feedback.mutate(
      { id: outfit.id, action },
      {
        onSuccess: () => toast.show({ message, tone: 'success' }),
        onError: (e) => toast.show({ message: errorMessage(e), tone: 'error' }),
      },
    );
  return (
    <View style={styles.actions}>
      <Button
        size="sm"
        variant={outfit.isSaved ? 'primary' : 'secondary'}
        icon="bookmark"
        label={outfit.isSaved ? t('card.saved') : t('actions.save')}
        accessibilityHint={outfit.isSaved ? t('actions.unsave') : undefined}
        disabled={feedback.isPending}
        onPress={() => (outfit.isSaved ? act('unsave', t('detail.unsavedToast')) : act('save', t('detail.savedToast')))}
        testID={`outfit-${outfit.id}-save`}
      />
      <Button
        size="sm"
        variant={outfit.isFavorite ? 'accent' : 'secondary'}
        icon="heart"
        label={outfit.isFavorite ? t('card.favorite') : t('actions.favorite')}
        accessibilityHint={outfit.isFavorite ? t('actions.unfavorite') : undefined}
        disabled={feedback.isPending}
        onPress={() => (outfit.isFavorite ? act('unfavorite', t('detail.unfavoriteToast')) : act('favorite', t('detail.favoriteToast')))}
        testID={`outfit-${outfit.id}-favorite`}
      />
      <Button
        size="sm"
        variant="ghost"
        iconRight="arrow-right"
        label={t('card.open')}
        onPress={() => router.push({ pathname: '/outfit/[id]', params: { id: outfit.id } })}
      />
    </View>
  );
}

function OutfitGrid({ filter, query }: { filter: OutfitFilter; query: ReturnType<typeof useOutfits> }) {
  const { t } = useTranslation('outfits');
  const router = useRouter();
  if (query.data === undefined) {
    if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
    return <SkeletonGrid columns={2} items={4} aspect={1.25} />;
  }
  if (query.data.length === 0) {
    return filter === 'favorites' ? (
      <EmptyState icon="heart" title={t('empty.favoritesTitle')} body={t('empty.favoritesBody')} testID="outfits-favorites-empty" />
    ) : (
      <EmptyState
        icon="bookmark"
        title={t('empty.savedTitle')}
        body={t('empty.savedBody')}
        actionLabel={t('empty.createOutfit')}
        onAction={() => router.push('/outfit/builder')}
        testID="outfits-saved-empty"
      />
    );
  }
  return (
    <View style={styles.grid} testID={`outfits-grid-${filter}`}>
      {query.data.map((o) => (
        <View key={o.id} style={styles.cell}>
          <OutfitThumb outfit={o} onPress={() => router.push({ pathname: '/outfit/[id]', params: { id: o.id } })} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: {
    width: '31.5%',
    minHeight: 88,
    padding: space.md,
    gap: 4,
    borderRadius: radius.md,
    borderWidth: hairline,
  },
  suggestedHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg, justifyContent: 'space-between' },
  cell: { width: '47%' },
});
