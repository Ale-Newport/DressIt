import type { SimulationRequest, SimulationResponse } from '@dressit/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useSimulation } from '@/api/hooks';
import { openProduct } from '@/components/shop/ProductRail';
import {
  Badge,
  type BadgeTone,
  Card,
  ChipGroup,
  EmptyState,
  ErrorState,
  GarmentTile,
  OfflineBanner,
  OutfitCanvas,
  ProductCard,
  Screen,
  SectionHeader,
  SkeletonCard,
  Text,
} from '@/components/ui';
import { normalizeScore } from '@/lib/format';
import { options, subcategoryLabel } from '@/lib/vocab';
import { hairline, space, useTheme } from '@/theme';

const UTILITY_TONE: Record<SimulationResponse['utility']['label'], BadgeTone> = {
  alta: 'success',
  media: 'info',
  baja: 'warning',
  redundante: 'danger',
};

export default function SimulateScreen() {
  const { t } = useTranslation('shop');
  const params = useLocalSearchParams<{ kind?: string; id?: string }>();
  const [occasion, setOccasion] = useState<string | null>(null);
  const req = useMemo<SimulationRequest | null>(
    () =>
      params.id
        ? { product: { kind: params.kind === 'imported' ? 'imported' : 'catalog', id: params.id }, ...(occasion ? { occasion } : {}), limit: 6 }
        : null,
    [params.id, params.kind, occasion],
  );
  const sim = useSimulation(req);
  const occasionOptions = useMemo(() => [{ id: 'any', label: t('simulate.anyOccasion') }, ...options.occasions], [t]);

  return (
    <Screen testID="simulate-screen" contentStyle={{ paddingTop: space.md }} onRefresh={() => sim.refetch()} refreshing={sim.isRefetching}>
      <OfflineBanner />
      <View style={{ gap: space.sm }}>
        <Text variant="smallStrong">{t('simulate.occasion')}</Text>
        <ChipGroup
          options={occasionOptions}
          value={occasion ?? 'any'}
          onChange={(v) => setOccasion(!v || v === 'any' ? null : (v as string))}
          allowDeselect={false}
          scroll
          testIDPrefix="simulate-occasion"
          accessibilityLabel={t('simulate.occasion')}
        />
      </View>
      {!req ? (
        <EmptyState icon="alert-triangle" title={t('product.title')} />
      ) : sim.data ? (
        <SimulationView data={sim.data} />
      ) : sim.isError ? (
        <ErrorState error={sim.error} onRetry={() => sim.refetch()} />
      ) : (
        <View style={{ gap: space.md }}>
          <Text variant="small" tone="muted" accessibilityLiveRegion="polite">
            {t('simulate.loading')}
          </Text>
          <SkeletonCard height={300} testID="simulate-loading" />
        </View>
      )}
    </Screen>
  );
}

function SimulationView({ data }: { data: SimulationResponse }) {
  const { t } = useTranslation('shop');
  const { colors } = useTheme();
  const router = useRouter();
  const pct = (v: number) => `${Math.round(normalizeScore(v) * 100)}`;

  return (
    <View style={{ gap: space.xl }}>
      <ProductCard product={data.product} layout="horizontal" onPress={() => openProduct(router, data.product)} testID="simulate-product" />

      <Card tone={data.utility.label === 'alta' ? 'accent' : 'surface'} style={{ gap: space.sm }} testID="simulate-utility">
        <Badge label={t('simulate.utility', { label: t(`simulate.utilityLabels.${data.utility.label}`) })} tone={UTILITY_TONE[data.utility.label]} icon="trending-up" />
        <Text variant="body">{data.utility.explanation}</Text>
      </Card>

      <View style={[styles.compare, { borderColor: colors.line }]} testID="simulate-compare">
        <CompareColumn title={t('simulate.baseline')} rows={[[t('simulate.outfitCount'), String(data.baseline.outfitCount)], [t('simulate.avgScore'), pct(data.baseline.avgScore)]]} />
        <View style={{ width: hairline, backgroundColor: colors.line }} />
        <CompareColumn
          title={t('simulate.withProduct')}
          highlight
          rows={[
            [t('simulate.outfitCount'), String(data.withProduct.outfitCount)],
            [t('simulate.newOutfits'), `+${data.withProduct.newOutfits}`],
            [t('simulate.avgScore'), pct(data.withProduct.avgScore)],
          ]}
        />
      </View>

      <View style={{ gap: space.xs }}>
        <Text variant="small" tone="muted">
          {t('simulate.inferred', { label: subcategoryLabel(data.inferred.subcategory).toLowerCase(), percent: Math.round(data.inferred.confidence * 100) })}
        </Text>
        {data.inferred.warnings.map((w, i) => (
          <Text key={i} variant="small" tone="warning">
            {w}
          </Text>
        ))}
      </View>

      <View>
        <SectionHeader title={t('simulate.outfits')} />
        {data.outfits.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.md, paddingRight: space.xl }}>
            {data.outfits.map((o) => (
              <View key={o.id} style={styles.outfit}>
                <OutfitCanvas items={o.items} layout={o.layout} testID={`simulate-outfit-${o.id}`} />
                {o.explanation[0] ? (
                  <Text variant="caption" tone="muted" numberOfLines={3}>
                    {o.explanation[0]}
                  </Text>
                ) : null}
              </View>
            ))}
          </ScrollView>
        ) : (
          <Card tone="sunken">
            <Text variant="small" tone="muted">
              {t('simulate.noOutfits')}
            </Text>
          </Card>
        )}
      </View>

      {data.partners.length ? (
        <View>
          <SectionHeader title={t('simulate.partners')} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.md, paddingRight: space.xl }}>
            {data.partners.map((g) => (
              <View key={g.id} style={styles.tile}>
                <GarmentTile garment={g} onPress={() => router.push({ pathname: '/garment/[id]', params: { id: g.id } })} />
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {data.similarOwned.length ? (
        <View>
          <SectionHeader title={t('simulate.similarOwned')} />
          <View style={{ gap: space.md }}>
            {data.similarOwned.map((s) => (
              <View key={s.garment.id} style={styles.similarRow}>
                <View style={styles.tileSmall}>
                  <GarmentTile garment={s.garment} showMeta={false} onPress={() => router.push({ pathname: '/garment/[id]', params: { id: s.garment.id } })} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="smallStrong">{s.garment.name}</Text>
                  <Badge label={t('simulate.similarity', { percent: Math.round(s.similarity * 100) })} tone="warning" />
                  <Text variant="small" tone="muted">
                    {s.reason}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function CompareColumn({ title, rows, highlight }: { title: string; rows: Array<[string, string]>; highlight?: boolean }) {
  return (
    <View style={styles.column} accessible accessibilityLabel={`${title}: ${rows.map(([k, v]) => `${k} ${v}`).join(', ')}`}>
      <Text variant="overline" tone={highlight ? 'accent' : 'muted'}>
        {title}
      </Text>
      {rows.map(([k, v]) => (
        <View key={k} style={{ gap: 0 }}>
          <Text variant="heading">{v}</Text>
          <Text variant="caption" tone="muted">
            {k}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  compare: { flexDirection: 'row', borderWidth: hairline, borderRadius: 18, padding: space.lg, gap: space.lg },
  column: { flex: 1, gap: space.sm },
  outfit: { width: 220, gap: space.sm },
  tile: { width: 120 },
  tileSmall: { width: 72 },
  similarRow: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
});
