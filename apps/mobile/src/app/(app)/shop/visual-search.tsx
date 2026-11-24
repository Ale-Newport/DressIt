import type { Category, VisualSearchResponse } from '@dressit/shared';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useVisualSearch } from '@/api/hooks';
import { uploadImage } from '@/api/upload';
import { openProduct } from '@/components/shop/ProductRail';
import {
  Button,
  Card,
  ChipGroup,
  EmptyState,
  ErrorState,
  Icon,
  OfflineBanner,
  ProductCard,
  ProgressBar,
  Screen,
  SectionHeader,
  SkeletonGrid,
  Text,
  useIsOnline,
  useToast,
} from '@/components/ui';
import { pickFromLibrary, takePhoto } from '@/lib/media';
import { options } from '@/lib/vocab';
import { radius, space, useTheme } from '@/theme';

type Phase = { kind: 'idle' } | { kind: 'uploading'; progress: number } | { kind: 'searching' } | { kind: 'done'; result: VisualSearchResponse } | { kind: 'error'; error: unknown };

export default function VisualSearchScreen() {
  const { t } = useTranslation('shop');
  const { colors } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const online = useIsOnline();
  const visualSearch = useVisualSearch();
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [imageId, setImageId] = useState<string | null>(null);
  const [category, setCategory] = useState<Category | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  const choose = async (source: 'camera' | 'library') => {
    const res = source === 'camera' ? await takePhoto() : await pickFromLibrary();
    if (res.status === 'denied') {
      toast.show({ message: t('visual.cameraDenied'), tone: 'error' });
      return;
    }
    if (res.status !== 'ok') return;
    const uri = res.uris[0]!;
    setPhotoUri(uri);
    setImageId(null);
    await run(uri, null);
  };

  /** Upload (once per photo) then search. */
  const run = async (uri: string, existingImageId: string | null, cat: Category | null = category) => {
    try {
      let id = existingImageId;
      if (!id) {
        setPhase({ kind: 'uploading', progress: 0 });
        const up = await uploadImage({ uri, kind: 'visual_search', onProgress: (p) => setPhase({ kind: 'uploading', progress: p.fraction }) });
        id = up.imageId;
        setImageId(id);
      }
      setPhase({ kind: 'searching' });
      const result = await visualSearch.mutateAsync({ imageId: id, ...(cat ? { category: cat } : {}), limit: 24 });
      setPhase({ kind: 'done', result });
    } catch (e) {
      setPhase({ kind: 'error', error: e });
    }
  };

  const busy = phase.kind === 'uploading' || phase.kind === 'searching';

  return (
    <Screen testID="visual-search-screen" contentStyle={{ paddingTop: space.md }}>
      <OfflineBanner />
      <Text variant="body" tone="muted">
        {t('visual.intro')}
      </Text>

      {photoUri ? (
        <View style={styles.photoRow}>
          <View style={[styles.photo, { backgroundColor: colors.surfaceAlt }]}>
            <Image source={{ uri: photoUri }} style={StyleSheet.absoluteFill} contentFit="cover" accessible={false} />
          </View>
          <View style={{ flex: 1, gap: space.sm }}>
            <Button label={t('visual.newPhoto')} icon="camera" size="sm" variant="secondary" onPress={() => choose('camera')} disabled={busy} />
            <Button label={t('visual.pickPhoto')} icon="image" size="sm" variant="ghost" onPress={() => choose('library')} disabled={busy} />
          </View>
        </View>
      ) : (
        <Card tone="sunken" style={styles.empty}>
          <Icon name="camera" size={28} color={colors.inkMuted} />
          <View style={{ gap: space.sm, alignSelf: 'stretch' }}>
            <Button label={t('visual.takePhoto')} icon="camera" onPress={() => choose('camera')} disabled={!online} fullWidth testID="visual-take-photo" />
            <Button label={t('visual.pickPhoto')} icon="image" variant="secondary" onPress={() => choose('library')} disabled={!online} fullWidth testID="visual-pick-photo" />
          </View>
        </Card>
      )}

      <View style={{ gap: space.sm }}>
        <Text variant="smallStrong">{t('visual.category')}</Text>
        <ChipGroup
          options={options.categories}
          value={category}
          onChange={(v) => {
            const next = (v as Category) ?? null;
            setCategory(next);
            if (photoUri && imageId && !busy) run(photoUri, imageId, next);
          }}
          scroll
          testIDPrefix="visual-category"
          accessibilityLabel={t('visual.category')}
        />
      </View>

      {phase.kind === 'uploading' ? (
        <View style={{ gap: space.sm }} accessibilityLiveRegion="polite">
          <Text variant="small" tone="muted">
            {t('visual.uploading', { percent: Math.round(phase.progress * 100) })}
          </Text>
          <ProgressBar value={phase.progress} />
        </View>
      ) : null}
      {phase.kind === 'searching' ? (
        <View style={{ gap: space.sm }}>
          <Text variant="small" tone="muted" accessibilityLiveRegion="polite">
            {t('visual.searching')}
          </Text>
          <SkeletonGrid columns={2} items={4} testID="visual-loading" />
        </View>
      ) : null}
      {phase.kind === 'error' ? (
        <ErrorState error={phase.error} compact onRetry={photoUri ? () => run(photoUri, imageId) : undefined} />
      ) : null}
      {phase.kind === 'done' ? <Results result={phase.result} onOpen={(p) => openProduct(router, p)} /> : null}

      <Text variant="caption" tone="subtle">
        {t('visual.disclaimer')}
      </Text>
    </Screen>
  );
}

function Results({ result, onOpen }: { result: VisualSearchResponse; onOpen: (p: { id: string; kind: 'catalog' | 'imported' }) => void }) {
  const { t } = useTranslation('shop');
  return (
    <View style={{ gap: space.md }} testID="visual-results">
      <SectionHeader title={t('visual.results')} />
      <View style={{ gap: 2 }}>
        <Text variant="caption" tone="muted">
          {t('visual.transparency', { count: result.searchedProducts })}
        </Text>
        {result.sources.length ? (
          <Text variant="caption" tone="muted">
            {t('visual.sources', { sources: result.sources.join(', ') })}
          </Text>
        ) : null}
      </View>
      {result.message ? <Text variant="small">{result.message}</Text> : null}
      {result.results.length ? (
        <View style={styles.grid}>
          {result.results.map((r) => (
            <View key={`${r.product.kind}-${r.product.id}`} style={styles.cell}>
              <ProductCard
                product={r.product}
                matchLabel={r.match === 'exact' ? t('visual.exact') : t('visual.similar')}
                highlight={t('visual.similarityA11y', { percent: Math.round(r.similarity * 100) })}
                onPress={() => onOpen(r.product)}
                testID={`visual-result-${r.product.id}`}
              />
            </View>
          ))}
        </View>
      ) : (
        <EmptyState compact icon="search" title={t('visual.emptyTitle')} body={result.message ?? t('visual.emptyBody')} testID="visual-empty" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  photoRow: { flexDirection: 'row', gap: space.lg, alignItems: 'center' },
  photo: { width: 120, aspectRatio: 4 / 5, borderRadius: radius.md, overflow: 'hidden' },
  empty: { alignItems: 'center', gap: space.lg, paddingVertical: space.xxl },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  cell: { width: '47%' },
});
