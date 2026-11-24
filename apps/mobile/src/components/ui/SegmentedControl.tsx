import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { radius, space, useTheme } from '@/theme';

import { Text } from './Text';

export interface Segment<T extends string> {
  id: T;
  label: string;
  testID?: string;
}

export interface SegmentedControlProps<T extends string> {
  segments: ReadonlyArray<Segment<T>>;
  value: T;
  onChange: (v: T) => void;
  style?: ViewStyle;
  accessibilityLabel?: string;
}

/** Underlined editorial tabs (role tablist). */
export function SegmentedControl<T extends string>({ segments, value, onChange, style, accessibilityLabel }: SegmentedControlProps<T>) {
  const { colors } = useTheme();
  return (
    <View style={[styles.row, { borderBottomColor: colors.line }, style]} accessibilityRole="tablist" accessibilityLabel={accessibilityLabel}>
      {segments.map((s) => {
        const active = s.id === value;
        return (
          <Pressable
            key={s.id}
            testID={s.testID}
            onPress={() => onChange(s.id)}
            accessibilityRole="tab"
            accessibilityLabel={s.label}
            accessibilityState={{ selected: active }}
            style={[styles.tab, { borderBottomColor: active ? colors.ink : 'transparent' }]}
          >
            <Text variant={active ? 'smallStrong' : 'small'} tone={active ? 'default' : 'muted'} numberOfLines={1}>
              {s.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, gap: space.lg },
  tab: { minHeight: 44, justifyContent: 'center', borderBottomWidth: 2, marginBottom: -StyleSheet.hairlineWidth, paddingHorizontal: 2, borderRadius: radius.xs },
});
