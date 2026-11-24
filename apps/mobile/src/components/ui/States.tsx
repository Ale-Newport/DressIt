import { onlineManager } from '@tanstack/react-query';
import { type ReactNode, useEffect, useSyncExternalStore } from 'react';
import { type DimensionValue, StyleSheet, View, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { asApiError } from '@/api/client';
import { radius, space, useTheme } from '@/theme';

import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export interface EmptyStateProps {
  icon?: IconName;
  title: string;
  body?: string | null;
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  testID?: string;
  compact?: boolean;
}

export function EmptyState({ icon = 'feather', title, body, actionLabel, onAction, secondaryLabel, onSecondary, testID, compact }: EmptyStateProps) {
  const { colors } = useTheme();
  return (
    <View style={[styles.state, compact && styles.compact]} testID={testID}>
      <View style={[styles.iconRing, { borderColor: colors.line }]}>
        <Icon name={icon} size={22} color={colors.inkMuted} />
      </View>
      <Text variant="heading" align="center">
        {title}
      </Text>
      {body ? (
        <Text variant="body" tone="muted" align="center" style={styles.body}>
          {body}
        </Text>
      ) : null}
      {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} testID={testID ? `${testID}-action` : undefined} /> : null}
      {secondaryLabel && onSecondary ? <Button label={secondaryLabel} variant="ghost" onPress={onSecondary} /> : null}
    </View>
  );
}

export interface ErrorStateProps {
  error: unknown;
  onRetry?: () => void;
  title?: string;
  compact?: boolean;
  testID?: string;
}

/** Shows the API's Spanish `error.message`, with a network-specific variant. */
export function ErrorState({ error, onRetry, title, compact, testID = 'error-state' }: ErrorStateProps) {
  const { t } = useTranslation();
  const e = asApiError(error);
  return (
    <EmptyState
      testID={testID}
      compact={compact}
      icon={e.isNetwork || e.isTimeout ? 'wifi-off' : 'alert-triangle'}
      title={title ?? t('states.errorTitle')}
      body={e.message}
      actionLabel={onRetry ? t('actions.retry') : undefined}
      onAction={onRetry}
    />
  );
}

export function useIsOnline(): boolean {
  return useSyncExternalStore(
    (cb) => onlineManager.subscribe(cb),
    () => onlineManager.isOnline(),
    () => true,
  );
}

/** Thin banner shown when the device is offline and cached data is displayed. */
export function OfflineBanner({ style }: { style?: ViewStyle }) {
  const online = useIsOnline();
  const { colors } = useTheme();
  const { t } = useTranslation();
  if (online) return null;
  return (
    <View
      style={[styles.offline, { backgroundColor: colors.warningSoft }, style]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      testID="offline-banner"
    >
      <Icon name="wifi-off" size={14} color={colors.warning} />
      <Text variant="caption" color={colors.warning} style={{ flex: 1 }}>
        {t('states.offline')}
      </Text>
    </View>
  );
}

// --- Skeletons ---------------------------------------------------------------

export function Skeleton({ width = '100%', height = 16, radius: r = radius.sm, style }: { width?: DimensionValue; height?: DimensionValue; radius?: number; style?: ViewStyle }) {
  const { colors, reduceMotion } = useTheme();
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) return;
    pulse.value = withRepeat(withTiming(1, { duration: 900 }), -1, true);
    return () => cancelAnimation(pulse);
  }, [pulse, reduceMotion]);
  const animated = useAnimatedStyle(() => ({ opacity: 0.55 + pulse.value * 0.45 }));
  return <Animated.View style={[{ width, height, borderRadius: r, backgroundColor: colors.skeleton }, animated, style]} />;
}

/** Accessible wrapper: announces loading once instead of reading every block. */
export function SkeletonGroup({ children, label, style, testID = 'skeleton' }: { children: ReactNode; label?: string; style?: ViewStyle; testID?: string }) {
  const { t } = useTranslation();
  return (
    <View style={style} accessible accessibilityRole="progressbar" accessibilityLabel={label ?? t('states.loading')} accessibilityState={{ busy: true }} testID={testID}>
      {children}
    </View>
  );
}

export function SkeletonList({ rows = 5, testID }: { rows?: number; testID?: string }) {
  return (
    <SkeletonGroup style={styles.list} testID={testID}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={styles.listRow}>
          <Skeleton width={44} height={44} radius={22} />
          <View style={{ flex: 1, gap: 6 }}>
            <Skeleton width="60%" height={14} />
            <Skeleton width="35%" height={12} />
          </View>
        </View>
      ))}
    </SkeletonGroup>
  );
}

export function SkeletonGrid({ columns = 2, items = 6, aspect = 1.25, testID }: { columns?: number; items?: number; aspect?: number; testID?: string }) {
  return (
    <SkeletonGroup style={styles.grid} testID={testID}>
      {Array.from({ length: items }, (_, i) => (
        <View key={i} style={{ width: `${100 / columns - 3}%`, gap: 6 }}>
          <View style={{ width: '100%', aspectRatio: 1 / aspect }}>
            <Skeleton height="100%" radius={radius.md} />
          </View>
          <Skeleton width="70%" height={12} />
        </View>
      ))}
    </SkeletonGroup>
  );
}

export function SkeletonCard({ height = 320, testID }: { height?: number; testID?: string }) {
  return (
    <SkeletonGroup style={{ gap: space.md }} testID={testID}>
      <Skeleton height={height} radius={radius.lg} />
      <Skeleton width="55%" height={18} />
      <Skeleton width="80%" height={14} />
    </SkeletonGroup>
  );
}

const styles = StyleSheet.create({
  state: { alignItems: 'center', justifyContent: 'center', gap: space.md, paddingVertical: space.huge, paddingHorizontal: space.xl },
  compact: { paddingVertical: space.xxl },
  iconRing: { width: 56, height: 56, borderRadius: 28, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: space.xs },
  body: { maxWidth: 340 },
  offline: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.sm },
  list: { gap: space.lg, paddingVertical: space.md },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, justifyContent: 'space-between' },
});
