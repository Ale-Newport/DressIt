import { Linking, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { radius, space, useTheme } from '@/theme';

import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export type PermissionKind = 'camera' | 'photos' | 'location' | 'calendar';

export interface PermissionPromptProps {
  kind: PermissionKind;
  /** `undetermined` → explain + ask; `denied` with canAskAgain=false → send to Settings. */
  status: 'undetermined' | 'denied' | 'granted' | null | undefined;
  canAskAgain?: boolean;
  onRequest: () => void;
  onSkip?: () => void;
  skipLabel?: string;
  testID?: string;
  compact?: boolean;
}

const ICONS: Record<PermissionKind, IconName> = { camera: 'camera', photos: 'image', location: 'map-pin', calendar: 'calendar' };

/**
 * Pre-permission explainer. We always explain *why* before the system prompt,
 * and offer a path to Settings when the permission was permanently denied.
 */
export function PermissionPrompt({ kind, status, canAskAgain = true, onRequest, onSkip, skipLabel, testID, compact }: PermissionPromptProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const blocked = status === 'denied' && !canAskAgain;
  return (
    <View style={[styles.box, compact && styles.compact, { backgroundColor: colors.surface, borderColor: colors.line }]} testID={testID ?? `permission-${kind}`}>
      <View style={[styles.icon, { backgroundColor: colors.accentSoft }]}>
        <Icon name={ICONS[kind]} size={22} color={colors.accent} />
      </View>
      <Text variant="heading" align="center">
        {blocked ? t('permission.deniedTitle') : t(`permission.${kind}.title`)}
      </Text>
      <Text variant="body" tone="muted" align="center">
        {t(`permission.${kind}.body`)}
      </Text>
      {blocked ? (
        <>
          <Text variant="small" tone="muted" align="center">
            {t('permission.deniedBody')}
          </Text>
          <Button label={t('actions.openSettings')} icon="settings" onPress={() => Linking.openSettings()} testID={`permission-${kind}-settings`} />
        </>
      ) : (
        <Button label={t('actions.allow')} onPress={onRequest} testID={`permission-${kind}-allow`} />
      )}
      {onSkip ? <Button label={skipLabel ?? t('actions.notNow')} variant="ghost" onPress={onSkip} testID={`permission-${kind}-skip`} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', gap: space.md, padding: space.xxl, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  compact: { padding: space.lg },
  icon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
});
