import type { OutfitDto } from '@dressit/shared';
import { forwardRef, type ReactNode } from 'react';
import { type HostInstance, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { normalizeScore } from '@/lib/format';
import { occasionLabel } from '@/lib/vocab';
import { hairline, radius, space, useTheme } from '@/theme';

import { Badge, Card, Icon, OutfitCanvas, Text } from './ui';

export interface OutfitCardProps {
  outfit: OutfitDto;
  onPress?: () => void;
  /** Action area under the card (accept/reject/save…). */
  footer?: ReactNode;
  /** Show the explanation bullets (default 3). */
  maxExplanation?: number;
  testID?: string;
  title?: string;
}

/** Three quick metrics shown under every outfit: weather fit, formality, style match. */
export function OutfitMetrics({ outfit }: { outfit: OutfitDto }) {
  const metrics = [
    { key: 'weather', label: 'Tiempo', value: normalizeScore(outfit.breakdown.weather) },
    { key: 'formality', label: 'Formalidad', value: normalizeScore(outfit.formality) },
    { key: 'style', label: 'Tu estilo', value: normalizeScore(outfit.styleMatch) },
  ];
  return (
    <View style={styles.metrics}>
      {metrics.map((m) => (
        <Meter key={m.key} label={m.label} value={m.value} />
      ))}
    </View>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  const { colors } = useTheme();
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <View style={styles.meter} accessible accessibilityLabel={`${label}: ${pct} por ciento`}>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <View style={[styles.meterTrack, { backgroundColor: colors.surfaceAlt }]}>
        <View style={[styles.meterFill, { width: `${pct}%`, backgroundColor: colors.ink }]} />
      </View>
    </View>
  );
}

export const OutfitCard = forwardRef<HostInstance, OutfitCardProps>(function OutfitCard(
  { outfit, onPress, footer, maxExplanation = 3, testID = `outfit-card-${outfit.id}`, title },
  canvasRef,
) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const heading = title ?? outfit.name ?? (outfit.occasion ? occasionLabel(outfit.occasion) : 'Conjunto');
  return (
    <Card padded={false} testID={testID} style={styles.card}>
      <View>
        <OutfitCanvas ref={canvasRef} items={outfit.items} layout={outfit.layout} style={styles.canvas} testID={`${testID}-canvas`} />
        <View style={styles.badgeRow} pointerEvents="none">
          {outfit.isExploration ? <Badge label={t('badges.exploration')} tone="accent" icon="compass" testID={`${testID}-exploration`} /> : null}
          {outfit.isFavorite ? <Badge label="Favorito" tone="inverse" icon="heart" /> : outfit.isSaved ? <Badge label="Guardado" tone="inverse" icon="bookmark" /> : null}
        </View>
      </View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text variant="heading" style={{ flex: 1 }} onPress={onPress} accessibilityRole={onPress ? 'link' : 'header'}>
            {heading}
          </Text>
          <Text variant="smallStrong" tone="muted" accessibilityLabel={`Puntuación ${Math.round(normalizeScore(outfit.score) * 100)} sobre 100`}>
            {Math.round(normalizeScore(outfit.score) * 100)}
          </Text>
        </View>
        <OutfitMetrics outfit={outfit} />
        {outfit.weatherNote ? (
          <View style={styles.note}>
            <Icon name="cloud" size={14} color={colors.inkMuted} />
            <Text variant="small" tone="muted" style={{ flex: 1 }}>
              {outfit.weatherNote}
            </Text>
          </View>
        ) : null}
        {outfit.explanation.slice(0, maxExplanation).map((line, i) => (
          <View key={i} style={styles.bullet}>
            <View style={[styles.dot, { backgroundColor: colors.accent }]} />
            <Text variant="small" style={{ flex: 1 }}>
              {line}
            </Text>
          </View>
        ))}
        {footer ? <View style={[styles.footer, { borderTopColor: colors.line }]}>{footer}</View> : null}
      </View>
    </Card>
  );
});

const styles = StyleSheet.create({
  card: { borderRadius: radius.xl },
  canvas: { borderRadius: 0 },
  badgeRow: { position: 'absolute', top: space.md, left: space.md, right: space.md, flexDirection: 'row', justifyContent: 'space-between' },
  body: { padding: space.lg, gap: space.md },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  metrics: { flexDirection: 'row', gap: space.md },
  meter: { flex: 1, gap: 4 },
  meterTrack: { height: 3, borderRadius: radius.pill, overflow: 'hidden' },
  meterFill: { height: '100%' },
  note: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  bullet: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  dot: { width: 5, height: 5, borderRadius: 3, marginTop: 8 },
  footer: { borderTopWidth: hairline, paddingTop: space.md, gap: space.sm },
});
