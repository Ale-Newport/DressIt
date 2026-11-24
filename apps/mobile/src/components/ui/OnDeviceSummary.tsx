import { useQuery } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';

import { intelligenceStatus, summarizeFacts } from '@/lib/intelligence';
import { radius, space, useTheme } from '@/theme';

import { Icon } from './Icon';
import { Skeleton } from './States';
import { Text } from './Text';

export interface OnDeviceSummaryProps {
  title: string;
  /** The only input the model sees. */
  facts: string;
  style?: string;
  testID?: string;
}

/**
 * A short text written on the iPhone by Apple Intelligence from the facts given (never sent
 * anywhere). Renders nothing when the on-device model isn't available or turned off.
 */
export function OnDeviceSummary({ title, facts, style, testID = 'ondevice-summary' }: OnDeviceSummaryProps) {
  const { colors } = useTheme();
  const available = intelligenceStatus().model === 'available';
  const q = useQuery({
    queryKey: ['ondevice-summary', facts, style ?? ''],
    queryFn: async () => (await summarizeFacts(facts, style)) ?? '',
    enabled: available,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: false,
  });
  if (!available || (q.isFetched && !q.data)) return null;
  return (
    <View style={[styles.card, { backgroundColor: colors.surfaceAlt, borderColor: colors.line }]} testID={testID} accessible accessibilityLabel={`${title}. ${q.data ?? ''}`}>
      <View style={styles.header}>
        <Icon name="cpu" size={14} color={colors.inkMuted} />
        <Text variant="overline" tone="muted">
          {title}
        </Text>
      </View>
      {q.isLoading ? <Skeleton height={44} radius={radius.sm} /> : <Text variant="body">{q.data}</Text>}
      <Text variant="caption" tone="subtle">
        Escrito en tu iPhone con Apple Intelligence a partir de tus estadísticas. No sale del dispositivo.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: space.lg, gap: space.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
});
