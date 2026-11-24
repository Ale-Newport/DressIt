import { StyleSheet, View } from 'react-native';

import { radius, space, useTheme } from '@/theme';

import { Text } from './Text';

export interface BarDatum {
  key: string;
  label: string;
  value: number;
  color?: string | null;
}

/** Simple accessible horizontal bar chart (no chart library needed). */
export function BarChart({ data, max, testID, unit = '' }: { data: BarDatum[]; max?: number; testID?: string; unit?: string }) {
  const { colors } = useTheme();
  const top = max ?? Math.max(1, ...data.map((d) => d.value));
  return (
    <View style={styles.list} testID={testID}>
      {data.map((d) => (
        <View key={d.key} style={styles.row} accessible accessibilityLabel={`${d.label}: ${d.value}${unit}`}>
          <Text variant="small" style={styles.label} numberOfLines={1}>
            {d.label}
          </Text>
          <View style={[styles.track, { backgroundColor: colors.surfaceAlt }]}>
            <View
              style={[
                styles.bar,
                {
                  width: `${Math.max(2, (d.value / top) * 100)}%`,
                  backgroundColor: d.color ?? colors.ink,
                  borderColor: colors.lineStrong,
                },
              ]}
            />
          </View>
          <Text variant="smallStrong" style={styles.value}>
            {d.value}
            {unit}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  label: { width: 112 },
  track: { flex: 1, height: 10, borderRadius: radius.pill, overflow: 'hidden' },
  bar: { height: '100%', borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth },
  value: { width: 40, textAlign: 'right' },
});
