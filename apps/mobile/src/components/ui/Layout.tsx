import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';

import { hairline, radius, space, useTheme } from '@/theme';

import { Text } from './Text';

export function Divider({ inset = 0, style }: { inset?: number; style?: ViewStyle }) {
  const { colors } = useTheme();
  return <View style={[{ height: hairline, backgroundColor: colors.line, marginLeft: inset }, style]} />;
}

export function Spacer({ size = space.lg }: { size?: number }) {
  return <View style={{ height: size }} />;
}

export function Row({ children, gap = space.sm, style, wrap }: { children: ReactNode; gap?: number; style?: ViewStyle; wrap?: boolean }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap, flexWrap: wrap ? 'wrap' : 'nowrap' }, style]}>{children}</View>;
}

export interface SectionHeaderProps {
  overline?: string;
  title: string;
  action?: ReactNode;
  style?: ViewStyle;
}

/** Editorial section heading: small caps overline + serif title + optional action. */
export function SectionHeader({ overline, title, action, style }: SectionHeaderProps) {
  return (
    <View style={[styles.section, style]}>
      <View style={{ flex: 1 }}>
        {overline ? (
          <Text variant="overline" tone="muted">
            {overline}
          </Text>
        ) : null}
        <Text variant="heading">{title}</Text>
      </View>
      {action}
    </View>
  );
}

export function ProgressBar({ value, label, style, testID }: { value: number; label?: string; style?: ViewStyle; testID?: string }) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label ?? t('a11y.progress', { percent: pct })}
      accessibilityValue={{ min: 0, max: 100, now: pct }}
      style={[styles.track, { backgroundColor: colors.surfaceAlt }, style]}
    >
      <View style={[styles.fill, { width: `${pct}%`, backgroundColor: colors.accent }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md, marginBottom: space.md },
  track: { height: 4, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill },
});
