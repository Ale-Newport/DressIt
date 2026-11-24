import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { space, touchTarget, useTheme } from '@/theme';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export interface ListRowProps {
  title: string;
  subtitle?: string | null;
  icon?: IconName;
  value?: string | null;
  onPress?: () => void;
  chevron?: boolean;
  destructive?: boolean;
  right?: ReactNode;
  /** Renders a switch; `onPress` is ignored. */
  switchValue?: boolean;
  onSwitchChange?: (v: boolean) => void;
  switchDisabled?: boolean;
  testID?: string;
  accessibilityHint?: string;
}

export function ListRow({
  title,
  subtitle,
  icon,
  value,
  onPress,
  chevron = !!onPress,
  destructive,
  right,
  switchValue,
  onSwitchChange,
  switchDisabled,
  testID,
  accessibilityHint,
}: ListRowProps) {
  const { colors } = useTheme();
  const isSwitch = switchValue !== undefined;
  const body = (
    <>
      {icon ? (
        <View style={[styles.iconWrap, { backgroundColor: colors.surfaceAlt }]}>
          <Icon name={icon} size={18} color={destructive ? colors.danger : colors.ink} />
        </View>
      ) : null}
      <View style={styles.texts}>
        <Text variant="body" tone={destructive ? 'danger' : 'default'}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="small" tone="muted">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text variant="small" tone="muted" numberOfLines={1} style={styles.value}>
          {value}
        </Text>
      ) : null}
      {right}
      {isSwitch ? (
        <Switch
          value={switchValue}
          onValueChange={onSwitchChange}
          disabled={switchDisabled}
          trackColor={{ true: colors.accent, false: colors.lineStrong }}
          accessibilityLabel={title}
          accessibilityHint={accessibilityHint}
          testID={testID ? `${testID}-switch` : undefined}
        />
      ) : chevron ? (
        <Icon name="chevron-right" size={18} color={colors.inkSubtle} />
      ) : null}
    </>
  );
  if (isSwitch || !onPress) {
    return (
      <View style={styles.row} testID={testID}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={value ? `${title}, ${value}` : title}
      accessibilityHint={accessibilityHint}
      testID={testID}
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: touchTarget + 8, paddingVertical: space.sm },
  iconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  texts: { flex: 1, gap: 2 },
  value: { maxWidth: '40%' },
});
