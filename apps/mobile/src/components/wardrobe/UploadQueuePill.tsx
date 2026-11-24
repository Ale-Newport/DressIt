import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Icon, ProgressBar, Text } from '@/components/ui';
import { summarizeQueue, useUploadQueue } from '@/state/uploadQueue';
import { radius, space, useTheme } from '@/theme';

/** Global indicator of background uploads; tap to open the latest session. */
export function UploadQueuePill() {
  const { t } = useTranslation('wardrobe');
  const { colors } = useTheme();
  const router = useRouter();
  const state = useUploadQueue();
  const s = summarizeQueue(state);
  if (s.pending === 0 && s.failed === 0 && s.submitting === 0) return null;
  const latest = [...state.sessions].reverse().find((x) => x.status !== 'submitted');
  const label =
    s.pending > 0 ? t('queue.uploading', { count: s.pending }) : s.failed > 0 ? t('queue.failed', { count: s.failed }) : t('queue.submitting');
  return (
    <Pressable
      onPress={latest ? () => router.push({ pathname: '/capture/session', params: { sessionId: latest.id } }) : undefined}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={t('queue.open')}
      testID="upload-queue-pill"
      style={[styles.pill, { backgroundColor: colors.surface, borderColor: colors.line }]}
    >
      <Icon name={s.failed > 0 && s.pending === 0 ? 'alert-circle' : 'upload-cloud'} size={18} color={s.failed > 0 && s.pending === 0 ? colors.danger : colors.ink} />
      <View style={{ flex: 1, gap: 6 }}>
        <Text variant="smallStrong">{label}</Text>
        {s.pending > 0 ? <ProgressBar value={s.progress} /> : null}
      </View>
      <Icon name="chevron-right" size={16} color={colors.inkSubtle} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 52,
  },
});
