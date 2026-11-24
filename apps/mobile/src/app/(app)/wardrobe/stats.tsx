import type { GarmentDto, WardrobeStatsDto } from '@dressit/shared';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useGarment, useWardrobeStats } from '@/api/hooks';
import {
  BarChart,
  type BarDatum,
  Card,
  EmptyState,
  GarmentTile,
  OfflineBanner,
  QueryView,
  Screen,
  SectionHeader,
  Skeleton,
  SkeletonGroup,
  SkeletonList,
  Text,
} from '@/components/ui';
import { formatMoney } from '@/lib/format';
import { categoryLabel, colorHex, colorLabel, seasonLabel, statusLabel, styleLabel, subcategoryLabel } from '@/lib/vocab';
import { radius, space } from '@/theme';

export default function StatsScreen() {
  const { t } = useTranslation('wardrobe');
  const router = useRouter();
  const stats = useWardrobeStats();
  return (
    <Screen refreshing={stats.isRefetching} onRefresh={() => stats.refetch()} testID="stats-screen">
      <OfflineBanner />
      <QueryView
        query={stats}
        loading={
          <SkeletonGroup style={{ gap: space.lg, paddingTop: space.lg }}>
            <Skeleton height={96} radius={radius.lg} />
            <SkeletonList rows={6} />
          </SkeletonGroup>
        }
        isEmpty={(d) => d.totalGarments === 0}
        empty={
          <EmptyState
            icon="bar-chart-2"
            title={t('stats.emptyTitle')}
            body={t('stats.emptyBody')}
            actionLabel={t('actions.add')}
            onAction={() => router.push({ pathname: '/armario', params: { add: '1' } })}
          />
        }
      >
        {(d) => <StatsBody stats={d} />}
      </QueryView>
    </Screen>
  );
}

function StatsBody({ stats: d }: { stats: WardrobeStatsDto }) {
  const { t } = useTranslation('wardrobe');
  const toBars = (rows: Array<{ key: string; count: number }>, label: (k: string) => string, color?: (k: string) => string | null): BarDatum[] =>
    [...rows].sort((a, b) => b.count - a.count).map((r) => ({ key: r.key, label: label(r.key), value: r.count, color: color?.(r.key) ?? null }));

  return (
    <>
      <View style={styles.kpis}>
        <Kpi label={t('stats.total')} value={String(d.totalGarments)} />
        <Kpi label={t('stats.value')} value={d.totalValue ? formatMoney(d.totalValue, { compact: true }) : '—'} />
        <Kpi label={t('stats.avgCpw')} value={d.avgCostPerWear ? formatMoney(d.avgCostPerWear) : '—'} />
        <Kpi label={t('stats.worn30')} value={String(d.outfitsWornLast30Days)} />
      </View>

      <ChartSection title={t('stats.byCategory')} data={toBars(d.byCategory, categoryLabel)} />
      <ChartSection title={t('stats.byColor')} data={toBars(d.byColor, colorLabel, colorHex)} />
      <ChartSection title={t('stats.byStyle')} data={toBars(d.byStyle, styleLabel)} />
      <ChartSection title={t('stats.bySeason')} data={toBars(d.bySeason, seasonLabel)} />
      <ChartSection title={t('stats.byStatus')} data={toBars(d.byStatus, statusLabel)} />

      {d.overRepresented.length ? (
        <View>
          <SectionHeader title={t('stats.overRepresented')} />
          <View style={{ gap: space.sm }}>
            {d.overRepresented.map((o, i) => (
              <Card key={`${o.subcategory}-${o.colorFamily ?? ''}-${i}`} tone="sunken">
                <Text variant="smallStrong">
                  {subcategoryLabel(o.subcategory)}
                  {o.colorFamily ? ` · ${colorLabel(o.colorFamily)}` : ''} · {o.count}
                </Text>
                <Text variant="small" tone="muted">
                  {o.message}
                </Text>
              </Card>
            ))}
          </View>
        </View>
      ) : null}

      <GarmentRow title={t('stats.neverWorn')} garments={d.neverWorn} />
      <GarmentRow title={t('stats.mostWorn')} garments={d.mostWorn} caption={(g) => t('detail.wearCount', { count: g.wearCount })} />
      <GarmentRow title={t('stats.leastWorn')} garments={d.leastWorn} caption={(g) => t('detail.wearCount', { count: g.wearCount })} />

      {d.duplicateGroups.length ? (
        <View>
          <SectionHeader title={t('stats.duplicates')} />
          <View style={{ gap: space.lg }}>
            {d.duplicateGroups.map((grp, i) => (
              <View key={i} style={{ gap: space.sm }}>
                <Text variant="small" tone="muted">
                  {t('stats.duplicateGroup', { reason: grp.reason, percent: Math.round((grp.score <= 1 ? grp.score : grp.score / 100) * 100) })}
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
                  {grp.garmentIds.slice(0, 6).map((id) => (
                    <DuplicateTile key={id} id={id} />
                  ))}
                </ScrollView>
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Card style={styles.kpi} accessibilityLabel={`${label}: ${value}`}>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <Text variant="heading">{value}</Text>
    </Card>
  );
}

function ChartSection({ title, data }: { title: string; data: BarDatum[] }) {
  const { t } = useTranslation('wardrobe');
  return (
    <View>
      <SectionHeader title={title} />
      {data.length ? (
        <BarChart data={data} />
      ) : (
        <Text variant="small" tone="muted">
          {t('stats.noData')}
        </Text>
      )}
    </View>
  );
}

function GarmentRow({ title, garments, caption }: { title: string; garments: GarmentDto[]; caption?: (g: GarmentDto) => string }) {
  const router = useRouter();
  if (!garments.length) return null;
  return (
    <View>
      <SectionHeader title={title} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {garments.map((g) => (
          <View key={g.id} style={styles.tile}>
            <GarmentTile garment={g} caption={caption?.(g)} onPress={() => router.push({ pathname: '/garment/[id]', params: { id: g.id } })} />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function DuplicateTile({ id }: { id: string }) {
  const router = useRouter();
  const q = useGarment(id);
  return (
    <View style={styles.tile}>
      {q.data ? (
        <GarmentTile garment={q.data} onPress={() => router.push({ pathname: '/garment/[id]', params: { id } })} />
      ) : (
        <Skeleton height={150} radius={radius.md} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, paddingTop: space.md },
  kpi: { flexBasis: '46%', flexGrow: 1, gap: 2 },
  row: { flexDirection: 'row', gap: space.md },
  tile: { width: 120 },
});
