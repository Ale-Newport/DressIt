import { forwardRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, type TextInputInstance, type TextInputProps, View, type ViewStyle } from 'react-native';

import { fonts, hairline, radius, space, useTheme } from '@/theme';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export interface TextFieldProps extends TextInputProps {
  label?: string;
  hint?: string;
  error?: string | null;
  icon?: IconName;
  containerStyle?: ViewStyle;
  /** Shows a show/hide toggle for passwords. */
  secureToggle?: boolean;
  onClear?: () => void;
}

export const TextField = forwardRef<TextInputInstance, TextFieldProps>(function TextField(
  { label, hint, error, icon, containerStyle, secureTextEntry, secureToggle, onClear, style, multiline, accessibilityLabel, onFocus, onBlur, ...rest },
  ref,
) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(true);
  const isSecure = secureToggle ? hidden : secureTextEntry;
  return (
    <View style={[styles.container, containerStyle]}>
      {label ? (
        <Text variant="smallStrong" nativeID={rest.nativeID ? `${rest.nativeID}-label` : undefined}>
          {label}
        </Text>
      ) : null}
      <View
        style={[
          styles.field,
          multiline && styles.multiline,
          {
            backgroundColor: colors.surface,
            borderColor: error ? colors.danger : focused ? colors.ink : colors.line,
          },
        ]}
      >
        {icon ? <Icon name={icon} size={18} color={colors.inkMuted} /> : null}
        <TextInput
          ref={ref}
          placeholderTextColor={colors.inkSubtle}
          selectionColor={colors.accent}
          style={[styles.input, { color: colors.ink }, multiline && styles.inputMultiline, style]}
          secureTextEntry={isSecure}
          multiline={multiline}
          accessibilityLabel={accessibilityLabel ?? label}
          accessibilityHint={error ?? hint}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          {...rest}
        />
        {secureToggle ? (
          <Pressable
            onPress={() => setHidden((h) => !h)}
            accessibilityRole="button"
            accessibilityLabel={hidden ? 'Mostrar contraseña' : 'Ocultar contraseña'}
            hitSlop={12}
          >
            <Icon name={hidden ? 'eye' : 'eye-off'} size={18} color={colors.inkMuted} />
          </Pressable>
        ) : null}
        {onClear && rest.value ? (
          <Pressable onPress={onClear} accessibilityRole="button" accessibilityLabel="Borrar texto" hitSlop={12}>
            <Icon name="x-circle" size={18} color={colors.inkSubtle} />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text variant="small" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="small" tone="muted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: { gap: space.xs + 2 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 50,
    borderRadius: radius.md,
    borderWidth: hairline * 2,
    paddingHorizontal: space.md + 2,
  },
  multiline: { alignItems: 'flex-start', paddingVertical: space.sm },
  input: { flex: 1, fontFamily: fonts.sans, fontSize: 16, paddingVertical: 12 },
  inputMultiline: { minHeight: 96, textAlignVertical: 'top' },
});
