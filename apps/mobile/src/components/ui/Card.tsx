import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { elevation, hairline, radius, space, useTheme } from '@/theme';

export interface CardProps {
  children: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  style?: ViewStyle | ViewStyle[];
  padded?: boolean;
  tone?: 'surface' | 'sunken' | 'accent' | 'inverse';
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
  raised?: boolean;
}

export function Card({ children, onPress, onLongPress, style, padded = true, tone = 'surface', accessibilityLabel, accessibilityHint, testID, raised }: CardProps) {
  const { colors } = useTheme();
  const bg = { surface: colors.surface, sunken: colors.surfaceAlt, accent: colors.accentSoft, inverse: colors.surfaceInverse }[tone];
  const base = [styles.card, { backgroundColor: bg, borderColor: colors.line }, padded && styles.padded, raised && elevation.card, style];
  if (onPress || onLongPress) {
    return (
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        testID={testID}
        style={({ pressed }) => [...base, { opacity: pressed ? 0.85 : 1 }]}
      >
        {children}
      </Pressable>
    );
  }
  return (
    <View style={base} testID={testID} accessibilityLabel={accessibilityLabel}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: hairline, overflow: 'hidden' },
  padded: { padding: space.lg },
});
