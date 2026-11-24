import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { elevation, radius, space, useTheme } from '@/theme';

import { Button } from './Button';
import { Text } from './Text';
import { TextField } from './TextField';

export interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  /** Optional input (e.g. password confirmation, "prestada a…"). */
  input?: { label: string; placeholder?: string; secure?: boolean; required?: boolean; initialValue?: string };
  error?: string | null;
  onConfirm: (inputValue?: string) => void;
  onCancel: () => void;
  testID?: string;
}

export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel,
  destructive,
  loading,
  input,
  error,
  onConfirm,
  onCancel,
  testID,
}: ConfirmDialogProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [value, setValue] = useState(input?.initialValue ?? '');
  useEffect(() => {
    if (visible) setValue(input?.initialValue ?? '');
  }, [visible, input?.initialValue]);
  const blocked = !!input?.required && !value.trim();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.backdrop, { backgroundColor: colors.scrim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} accessibilityRole="button" accessibilityLabel={cancelLabel ?? t('actions.cancel')} />
        <View
          style={[styles.dialog, elevation.sheet, { backgroundColor: colors.background }]}
          accessibilityViewIsModal
          accessibilityRole="alert"
          onAccessibilityEscape={onCancel}
          testID={testID}
        >
          <Text variant="heading">{title}</Text>
          {message ? (
            <Text variant="body" tone="muted">
              {message}
            </Text>
          ) : null}
          {input ? (
            <TextField
              label={input.label}
              placeholder={input.placeholder}
              value={value}
              onChangeText={setValue}
              secureTextEntry={input.secure}
              secureToggle={input.secure}
              autoFocus
              autoCapitalize="none"
              testID={testID ? `${testID}-input` : undefined}
            />
          ) : null}
          {error ? (
            <Text variant="small" tone="danger" accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
          <View style={styles.actions}>
            <Button label={cancelLabel ?? t('actions.cancel')} variant="ghost" onPress={onCancel} testID={testID ? `${testID}-cancel` : undefined} />
            <Button
              label={confirmLabel ?? t('actions.confirm')}
              variant={destructive ? 'danger' : 'primary'}
              loading={loading}
              disabled={blocked}
              onPress={() => onConfirm(input ? value : undefined)}
              testID={testID ? `${testID}-confirm` : undefined}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', padding: space.xl },
  dialog: { borderRadius: radius.lg, padding: space.xl, gap: space.md },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm, marginTop: space.sm, flexWrap: 'wrap' },
});
