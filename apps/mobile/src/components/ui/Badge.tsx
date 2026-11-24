import { StyleSheet, View, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';

import { radius, space, useTheme } from '@/theme';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'inverse';

export interface BadgeProps {
  label: string;
  tone?: BadgeTone;
  icon?: IconName;
  style?: ViewStyle;
  testID?: string;
  accessibilityLabel?: string;
}

export function Badge({ label, tone = 'neutral', icon, style, testID, accessibilityLabel }: BadgeProps) {
  const { colors } = useTheme();
  const map: Record<BadgeTone, { bg: string; fg: string }> = {
    neutral: { bg: colors.surfaceAlt, fg: colors.inkMuted },
    accent: { bg: colors.accentSoft, fg: colors.accent },
    success: { bg: colors.successSoft, fg: colors.success },
    warning: { bg: colors.warningSoft, fg: colors.warning },
    danger: { bg: colors.dangerSoft, fg: colors.danger },
    info: { bg: colors.infoSoft, fg: colors.info },
    inverse: { bg: colors.surfaceInverse, fg: colors.inkInverse },
  };
  const c = map[tone];
  return (
    <View
      style={[styles.badge, { backgroundColor: c.bg }, style]}
      testID={testID}
      accessible
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel ?? label}
    >
      {icon ? <Icon name={icon} size={11} color={c.fg} /> : null}
      <Text variant="caption" color={c.fg} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** Confidence of a predicted attribute (0–1) with optional source. */
export function ConfidenceBadge({ confidence, source, testID }: { confidence: number; source?: string | null; testID?: string }) {
  const { t } = useTranslation();
  const pct = Math.round(Math.max(0, Math.min(1, confidence)) * 100);
  const tone: BadgeTone = pct >= 85 ? 'success' : pct >= 60 ? 'neutral' : 'warning';
  const label = pct >= 60 ? t('badges.confidence', { percent: pct }) : `${t('badges.lowConfidence')} · ${pct} %`;
  return (
    <Badge
      testID={testID}
      label={source ? `${label} · ${source}` : label}
      tone={tone}
      icon={pct >= 60 ? 'check' : 'alert-circle'}
    />
  );
}

/** Verified / unverified provenance badge for imported product fields. */
export function ProvenanceBadge({ verified, source }: { verified: boolean; source?: string }) {
  const { t } = useTranslation();
  return (
    <Badge
      label={verified ? t('badges.verified') : t('badges.unverified')}
      tone={verified ? 'success' : 'warning'}
      icon={verified ? 'check-circle' : 'help-circle'}
      accessibilityLabel={`${verified ? t('badges.verified') : t('badges.unverified')}${source ? `, ${source}` : ''}`}
    />
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
});
