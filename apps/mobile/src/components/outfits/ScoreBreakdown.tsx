import type { ScoreBreakdownDto } from '@dressit/shared';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { normalizeScore } from '@/lib/format';
import { radius, space, useTheme } from '@/theme';

import { Text } from '../ui';

export const BREAKDOWN_KEYS = ['total', 'color', 'style', 'formality', 'weather', 'material', 'silhouette', 'personal', 'rotation'] as const;
export type BreakdownKey = (typeof BREAKDOWN_KEYS)[number];

function pct(v: number): number {
  return Math.round(Math.max(0, Math.min(1, normalizeScore(v))) * 100);
}

/** Full score breakdown as labelled bars. */
export function ScoreBreakdown({ breakdown, testID = 'score-breakdown' }: { breakdown: ScoreBreakdownDto; testID?: string }) {
  const { colors } = useTheme();
  const { t } = useTranslation('outfits');
  return (
    <View style={styles.list} testID={testID}>
      {BREAKDOWN_KEYS.map((k) => {
        const value = pct(breakdown[k]);
        return (
          <View key={k} style={styles.row} accessible accessibilityLabel={`${t(`breakdown.${k}`)}: ${value} sobre 100`}>
            <Text variant={k === 'total' ? 'smallStrong' : 'small'} style={styles.label}>
              {t(`breakdown.${k}`)}
            </Text>
            <View style={[styles.track, { backgroundColor: colors.surfaceAlt }]}>
              <View style={[styles.fill, { width: `${value}%`, backgroundColor: k === 'total' ? colors.accent : colors.ink }]} />
            </View>
            <Text variant="smallStrong" style={styles.value}>
              {value}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** Two-column comparison table (A vs B) with the better value highlighted. */
export function ScoreCompareTable({
  a,
  b,
  labelA,
  labelB,
  testID = 'score-compare',
}: {
  a: ScoreBreakdownDto;
  b: ScoreBreakdownDto;
  labelA: string;
  labelB: string;
  testID?: string;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation('outfits');
  return (
    <View style={[styles.table, { borderColor: colors.line }]} testID={testID}>
      <View style={[styles.tr, { borderBottomColor: colors.line }]}>
        <Text variant="caption" tone="muted" style={styles.th}>
          {t('compare.metric')}
        </Text>
        <Text variant="caption" tone="muted" style={styles.td} numberOfLines={1}>
          {labelA}
        </Text>
        <Text variant="caption" tone="muted" style={styles.td} numberOfLines={1}>
          {labelB}
        </Text>
      </View>
      {BREAKDOWN_KEYS.map((k) => {
        const va = pct(a[k]);
        const vb = pct(b[k]);
        const label = t(`breakdown.${k}`);
        const verdict = va === vb ? t('compare.tie') : `${va > vb ? labelA : labelB} ${t('compare.better')}`;
        return (
          <View
            key={k}
            style={[styles.tr, { borderBottomColor: colors.line }]}
            accessible
            accessibilityLabel={`${label}: ${labelA} ${va}, ${labelB} ${vb}. ${verdict}`}
          >
            <Text variant={k === 'total' ? 'smallStrong' : 'small'} style={styles.th}>
              {label}
            </Text>
            <Cell value={va} best={va > vb} />
            <Cell value={vb} best={vb > va} />
          </View>
        );
      })}
    </View>
  );
}

function Cell({ value, best }: { value: number; best: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={styles.td}>
      <View style={[styles.pill, best && { backgroundColor: colors.accentSoft }]}>
        <Text variant={best ? 'smallStrong' : 'small'} tone={best ? 'accent' : 'default'}>
          {value}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  label: { width: 96 },
  track: { flex: 1, height: 6, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill },
  value: { width: 32, textAlign: 'right' },
  table: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, overflow: 'hidden' },
  tr: { flexDirection: 'row', alignItems: 'center', minHeight: 40, paddingHorizontal: space.md, borderBottomWidth: StyleSheet.hairlineWidth },
  th: { flex: 1.2 },
  td: { flex: 1, alignItems: 'center' },
  pill: { paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.pill },
});
