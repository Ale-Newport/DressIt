import { Pressable, type PressableProps, StyleSheet, type ViewStyle } from 'react-native';

import { radius, touchTarget, useTheme } from '@/theme';

import { Icon, type IconName } from './Icon';

export interface IconButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  icon: IconName;
  /** Required: screen-reader label. */
  label: string;
  size?: number;
  color?: string;
  variant?: 'plain' | 'filled' | 'outline';
  style?: ViewStyle;
  selected?: boolean;
}

export function IconButton({ icon, label, size = 22, color, variant = 'plain', style, selected, disabled, ...rest }: IconButtonProps) {
  const { colors } = useTheme();
  const bg = variant === 'filled' ? colors.surfaceAlt : 'transparent';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, selected }}
      disabled={disabled}
      hitSlop={6}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: bg,
          borderColor: variant === 'outline' ? colors.lineStrong : 'transparent',
          opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
        },
        style,
      ]}
      {...rest}
    >
      <Icon name={icon} size={size} color={color ?? (selected ? colors.accent : colors.ink)} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    width: touchTarget,
    height: touchTarget,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
});
