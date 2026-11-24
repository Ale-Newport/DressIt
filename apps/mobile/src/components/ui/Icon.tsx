import Feather from '@expo/vector-icons/Feather';
import type { ComponentProps } from 'react';

import { useTheme } from '@/theme';

export type IconName = ComponentProps<typeof Feather>['name'];

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
}

/** Decorative line icon (hidden from screen readers; the parent control carries the label). */
export function Icon({ name, size = 20, color }: IconProps) {
  const { colors } = useTheme();
  return <Feather name={name} size={size} color={color ?? colors.ink} accessible={false} importantForAccessibility="no" />;
}
