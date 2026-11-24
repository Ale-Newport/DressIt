import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { type TextVariant, typography, useTheme } from '@/theme';

export type TextTone = 'default' | 'muted' | 'subtle' | 'accent' | 'inverse' | 'danger' | 'success' | 'warning' | 'info';

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  tone?: TextTone;
  align?: 'left' | 'center' | 'right';
  color?: string;
}

const HEADING_VARIANTS: TextVariant[] = ['display', 'title', 'heading'];

/** Themed text. Supports Dynamic Type (font scaling) with a cap on display sizes to keep layouts intact. */
export function Text({ variant = 'body', tone = 'default', align, color, style, maxFontSizeMultiplier, accessibilityRole, ...rest }: TextProps) {
  const { colors } = useTheme();
  const toneColor: Record<TextTone, string> = {
    default: colors.ink,
    muted: colors.inkMuted,
    subtle: colors.inkSubtle,
    accent: colors.accent,
    inverse: colors.inkInverse,
    danger: colors.danger,
    success: colors.success,
    warning: colors.warning,
    info: colors.info,
  };
  const isHeading = HEADING_VARIANTS.includes(variant);
  return (
    <RNText
      accessibilityRole={accessibilityRole ?? (isHeading ? 'header' : undefined)}
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? (isHeading ? 1.35 : 1.8)}
      style={[typography[variant], { color: color ?? toneColor[tone], textAlign: align }, style]}
      {...rest}
    />
  );
}
