import type { UsageHistoryDto } from '@dressit/shared';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useHistory } from '@/api/hooks';
import { OutfitThumb } from '@/components/outfits/OutfitThumb';
import {
  Button,
  Divider,
  EmptyState,
  ErrorState,
  GarmentTile,
  OfflineBanner,
  Screen,
  SectionHeader,
  SkeletonList,
  Text,
} from '@/components/ui';
import { addMonths, startOfMonth, today } from '@/lib/dates';
import { capitalize, formatLongDate, formatMonthYear } from '@/lib/format';
import { occasionLabel } from '@/lib/vocab';
import { space } from '@/theme';

export default function HistoryScreen() {
  const { t } = useTranslation('planner');
  const [months, setMonths] = useState(2);
  const to = today();
  const from = startOfMonth(addMonths(to, -(months - 1)));
  const query = useHistory(from, to);

  const groups = useMemo(() => {
    const byMonth = new Map<string, UsageHistoryDto[]>();
    for (const entry of [...(query.data ?? [])].sort((a, b) => b.wornOn.localeCompare(a.wornOn))) {
      const key = entry.wornOn.slice(0, 7);
      byMonth.set(key, [...(byMonth.get(key) ?? []), entry]);
    }
    return [...byMonth.entries()];
  }, [query.data]);

  return (
    <Screen refreshing={query.isRefetching} onRefresh={() => query.refetch()} testID="history-screen">
      <OfflineBanner />
      {query.data === undefined ? (
        query.isError ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : (
          <SkeletonList rows={6} />
        )
      ) : groups.length === 0 ? (
        <EmptyState icon="clock" title={t('history.empty')} body={t('history.emptyBody')} testID="history-empty" />
      ) : (
        groups.map(([month, entries]) => (
          <View key={month} style={{ gap: space.md }}>
            <SectionHeader overline={t('history.count', { count: entries.length })} title={capitalize(formatMonthYear(`${month}-01`))} />
            {entries.map((entry, i) => (
              <View key={entry.id} style={{ gap: space.md }}>
                {i > 0 ? <Divider /> : null}
                <HistoryEntry entry={entry} />
              </View>
            ))}
          </View>
        ))
      )}
      {query.data !== undefined ? (
        <Button
          label={t('history.loadMore')}
          variant="secondary"
          icon="chevron-down"
          loading={query.isFetching}
          onPress={() => setMonths((m) => m + 2)}
          testID="history-load-more"
        />
      ) : null}
    </Screen>
  );
}

function HistoryEntry({ entry }: { entry: UsageHistoryDto }) {
  const router = useRouter();
  const { t } = useTranslation('planner');
  return (
    <View style={styles.entry} testID={`history-entry-${entry.id}`}>
      <View style={{ gap: 2 }}>
        <Text variant="subheading">{capitalize(formatLongDate(entry.wornOn))}</Text>
        {entry.occasion ? (
          <Text variant="small" tone="muted">
            {occasionLabel(entry.occasion)}
          </Text>
        ) : null}
      </View>
      {entry.outfit ? (
        <View style={styles.thumb}>
          <OutfitThumb outfit={entry.outfit} onPress={() => router.push({ pathname: '/outfit/[id]', params: { id: entry.outfit!.id } })} />
        </View>
      ) : entry.garments.length ? (
        <View style={{ gap: space.sm }}>
          <Text variant="caption" tone="muted">
            {t('history.garments')}
          </Text>
          <View style={styles.grid}>
            {entry.garments.map((g) => (
              <View key={g.id} style={styles.cell}>
                <GarmentTile garment={g} onPress={() => router.push({ pathname: '/garment/[id]', params: { id: g.id } })} />
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  entry: { gap: space.md },
  thumb: { width: '55%' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  cell: { width: '30%' },
});
