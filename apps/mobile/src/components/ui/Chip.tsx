import { Pressable, ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';

import { hairline, radius, space, useTheme } from '@/theme';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  /** Colour swatch (hex) shown before the label. */
  swatch?: string | null;
  icon?: IconName;
  /** 'checkbox' for multi-select groups, 'radio' for single-select, 'button' for actions. */
  role?: 'checkbox' | 'radio' | 'button';
  disabled?: boolean;
  testID?: string;
  size?: 'md' | 'sm';
  accessibilityHint?: string;
  style?: ViewStyle;
}

export function Chip({ label, selected, onPress, swatch, icon, role = 'button', disabled, testID, size = 'md', accessibilityHint, style }: ChipProps) {
  const { colors } = useTheme();
  const content = (
    <>
      {swatch ? <View style={[styles.swatch, { backgroundColor: swatch, borderColor: colors.lineStrong }]} /> : null}
      {icon ? <Icon name={icon} size={14} color={selected ? colors.inkInverse : colors.ink} /> : null}
      <Text variant={size === 'sm' ? 'caption' : 'small'} color={selected ? colors.inkInverse : colors.ink} numberOfLines={1}>
        {label}
      </Text>
    </>
  );
  const baseStyle = [
    styles.chip,
    size === 'sm' && styles.chipSm,
    { backgroundColor: selected ? colors.ink : colors.surface, borderColor: selected ? colors.ink : colors.line },
    style,
  ];
  if (!onPress) {
    return (
      <View style={baseStyle} testID={testID} accessible accessibilityLabel={label}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={role === 'button' ? { disabled: !!disabled, selected: !!selected } : { checked: !!selected, disabled: !!disabled }}
      hitSlop={size === 'sm' ? 8 : 4}
      style={({ pressed }) => [...baseStyle, { opacity: disabled ? 0.4 : pressed ? 0.7 : 1 }]}
    >
      {content}
    </Pressable>
  );
}

export interface ChipOption<T extends string = string> {
  id: T;
  label: string;
  hex?: string | null;
}

export interface ChipGroupProps<T extends string> {
  options: ReadonlyArray<ChipOption<T>>;
  value: T | T[] | null | undefined;
  onChange: (value: T | T[] | null) => void;
  multiple?: boolean;
  /** Horizontal scroll (single line) instead of wrapping. */
  scroll?: boolean;
  allowDeselect?: boolean;
  testIDPrefix?: string;
  accessibilityLabel?: string;
  max?: number;
}

export function ChipGroup<T extends string>({
  options,
  value,
  onChange,
  multiple,
  scroll,
  allowDeselect = true,
  testIDPrefix,
  accessibilityLabel,
  max,
}: ChipGroupProps<T>) {
  const selected = Array.isArray(value) ? value : value ? [value] : [];
  const toggle = (id: T) => {
    if (multiple) {
      const set = new Set(selected);
      if (set.has(id)) set.delete(id);
      else {
        if (max && set.size >= max) return;
        set.add(id);
      }
      onChange([...set]);
    } else {
      onChange(selected[0] === id ? (allowDeselect ? null : id) : id);
    }
  };
  const chips = options.map((o) => (
    <Chip
      key={o.id}
      label={o.label}
      swatch={o.hex}
      selected={selected.includes(o.id)}
      role={multiple ? 'checkbox' : 'radio'}
      onPress={() => toggle(o.id)}
      testID={testIDPrefix ? `${testIDPrefix}-${o.id}` : undefined}
    />
  ));
  if (scroll) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        accessibilityRole={multiple ? undefined : 'radiogroup'}
        accessibilityLabel={accessibilityLabel}
      >
        {chips}
      </ScrollView>
    );
  }
  return (
    <View style={styles.wrap} accessibilityRole={multiple ? undefined : 'radiogroup'} accessibilityLabel={accessibilityLabel}>
      {chips}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs + 2,
    paddingHorizontal: space.md + 2,
    minHeight: 38,
    borderRadius: radius.pill,
    borderWidth: hairline * 2,
  },
  chipSm: { minHeight: 28, paddingHorizontal: space.sm + 2 },
  swatch: { width: 14, height: 14, borderRadius: 7, borderWidth: hairline * 2 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  scroll: { gap: space.sm, paddingRight: space.lg },
});
