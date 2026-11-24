import * as Haptics from 'expo-haptics';
import { ActivityIndicator, Pressable, type PressableProps, StyleSheet, View, type ViewStyle } from 'react-native';

import { hairline, radius, space, touchTarget, useTheme } from '@/theme';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'accent' | 'danger';

export interface ButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  label: string;
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
  fullWidth?: boolean;
  style?: ViewStyle;
  haptic?: boolean;
}

export function Button({
  label,
  variant = 'primary',
  size = 'md',
  icon,
  iconRight,
  loading,
  disabled,
  fullWidth,
  style,
  haptic = true,
  onPress,
  accessibilityHint,
  testID,
  ...rest
}: ButtonProps) {
  const { colors } = useTheme();
  const isDisabled = disabled || loading;
  const palette: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
    primary: { bg: colors.ink, fg: colors.inkInverse, border: colors.ink },
    secondary: { bg: 'transparent', fg: colors.ink, border: colors.lineStrong },
    ghost: { bg: 'transparent', fg: colors.ink, border: 'transparent' },
    accent: { bg: colors.accent, fg: colors.accentInk, border: colors.accent },
    danger: { bg: 'transparent', fg: colors.danger, border: colors.danger },
  };
  const p = palette[variant];
  const height = size === 'sm' ? 36 : 50;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      disabled={isDisabled}
      testID={testID}
      hitSlop={size === 'sm' ? { top: (touchTarget - height) / 2, bottom: (touchTarget - height) / 2 } : undefined}
      onPress={(e) => {
        if (haptic) Haptics.selectionAsync().catch(() => {});
        onPress?.(e);
      }}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: height,
          paddingHorizontal: size === 'sm' ? space.md : space.xl,
          backgroundColor: p.bg,
          borderColor: p.border,
          opacity: isDisabled ? 0.45 : pressed ? 0.78 : 1,
          alignSelf: fullWidth ? 'stretch' : 'auto',
        },
        style,
      ]}
      {...rest}
    >
      <View style={styles.row}>
        {loading ? (
          <ActivityIndicator color={p.fg} size="small" />
        ) : icon ? (
          <Icon name={icon} size={size === 'sm' ? 16 : 18} color={p.fg} />
        ) : null}
        <Text variant={size === 'sm' ? 'smallStrong' : 'button'} color={p.fg} numberOfLines={2} align="center">
          {label}
        </Text>
        {iconRight && !loading ? <Icon name={iconRight} size={size === 'sm' ? 16 : 18} color={p.fg} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.pill,
    borderWidth: hairline * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
