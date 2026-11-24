import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, type ScrollViewProps, StyleSheet, View, type ViewStyle } from 'react-native';
import { type Edge, SafeAreaView } from 'react-native-safe-area-context';

import { space, useTheme } from '@/theme';

import { Text } from './Text';

export interface ScreenProps {
  children: ReactNode;
  /** Wrap in a ScrollView (default true). */
  scroll?: boolean;
  /** Safe-area edges to pad (screens with a native header only need bottom). */
  edges?: Edge[];
  padded?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentStyle?: ViewStyle;
  footer?: ReactNode;
  testID?: string;
  scrollProps?: Omit<ScrollViewProps, 'children'>;
}

export function Screen({ children, scroll = true, edges = ['bottom'], padded = true, refreshing, onRefresh, contentStyle, footer, testID, scrollProps }: ScreenProps) {
  const { colors } = useTheme();
  const content = [padded && styles.padded, contentStyle];
  return (
    <SafeAreaView edges={edges} style={[styles.fill, { backgroundColor: colors.background }]} testID={testID}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[styles.scrollContent, ...content]}
          keyboardShouldPersistTaps="handled"
          contentInsetAdjustmentBehavior="automatic"
          refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.inkMuted} /> : undefined}
          {...scrollProps}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.fill, ...content]}>{children}</View>
      )}
      {footer ? <View style={[styles.footer, { borderTopColor: colors.line, backgroundColor: colors.background }]}>{footer}</View> : null}
    </SafeAreaView>
  );
}

export interface ScreenHeaderProps {
  overline?: string;
  title: string;
  subtitle?: string | null;
  right?: ReactNode;
  style?: ViewStyle;
  testID?: string;
}

/** Large editorial header used at the top of tab screens (no native header). */
export function ScreenHeader({ overline, title, subtitle, right, style, testID }: ScreenHeaderProps) {
  return (
    <View style={[styles.header, style]} testID={testID}>
      <View style={{ flex: 1, gap: 2 }}>
        {overline ? (
          <Text variant="overline" tone="muted">
            {overline}
          </Text>
        ) : null}
        <Text variant="display">{title}</Text>
        {subtitle ? (
          <Text variant="body" tone="muted">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ? <View style={styles.headerRight}>{right}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  padded: { paddingHorizontal: space.xl },
  scrollContent: { paddingBottom: space.huge, gap: space.xl },
  footer: { paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.sm, borderTopWidth: StyleSheet.hairlineWidth, gap: space.sm },
  header: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md, paddingTop: space.lg },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
});
