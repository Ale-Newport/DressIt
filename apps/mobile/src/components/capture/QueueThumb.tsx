import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Icon, ProgressBar, Text } from '@/components/ui';
import { intelligenceStatus, liftSubjectPreview } from '@/lib/intelligence';
import { type QueueItem, uploadQueue } from '@/state/uploadQueue';
import { radius, useTheme } from '@/theme';

/** One queued photo: preview, upload progress, error with retry, remove. */
export function QueueThumb({ item, index, size = 72, onDark }: { item: QueueItem; index: number; size?: number; onDark?: boolean }) {
  const { t } = useTranslation('capture');
  const { colors } = useTheme();
  // Instant preview: Apple's Vision lifts the subject on the phone (~0.1 s) while the server
  // makes the real cutout. Falls back to the photo when unavailable.
  const lifted = useQuery({
    queryKey: ['lift-preview', item.uri],
    queryFn: async () => (await liftSubjectPreview(item.uri))?.uri ?? null,
    enabled: intelligenceStatus().subjectLifting,
    staleTime: Infinity,
    gcTime: 10 * 60_000,
    retry: false,
  });
  const status =
    item.status === 'queued'
      ? t('item.queued')
      : item.status === 'uploading'
        ? t('item.uploading', { percent: Math.round(item.progress * 100) })
        : item.status === 'done'
          ? item.duplicateOfImageId
            ? t('item.duplicate')
            : t('item.done')
          : t('item.error');
  return (
    <View style={{ width: size, gap: 4 }} testID={`queue-item-${index}`}>
      <View
        style={[styles.thumb, { width: size, height: size * 1.25, backgroundColor: colors.surfaceAlt, borderColor: item.status === 'error' ? colors.danger : 'transparent' }]}
        accessible
        accessibilityLabel={`${t('item.photo', { index: index + 1 })}: ${status}`}
      >
        {lifted.data ? (
          <Image source={{ uri: lifted.data }} style={[StyleSheet.absoluteFill, styles.lifted]} contentFit="contain" accessible={false} testID={`queue-item-${index}-lifted`} />
        ) : (
          <Image source={{ uri: item.uri }} style={StyleSheet.absoluteFill} contentFit="cover" accessible={false} />
        )}
        {item.status === 'done' ? (
          <View style={[styles.badge, { backgroundColor: colors.success }]}>
            <Icon name="check" size={12} color="#fff" />
          </View>
        ) : null}
        {item.status === 'error' ? (
          <Pressable
            style={[styles.overlay, { backgroundColor: colors.scrim }]}
            onPress={() => uploadQueue.retry(item.localId)}
            accessibilityRole="button"
            accessibilityLabel={t('item.retry', { index: index + 1 })}
          >
            <Icon name="refresh-cw" size={20} color="#fff" />
          </Pressable>
        ) : null}
        {item.status !== 'uploading' ? (
          <Pressable
            style={[styles.remove, { backgroundColor: colors.surfaceInverse }]}
            onPress={() => uploadQueue.remove(item.localId)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t('item.remove', { index: index + 1 })}
          >
            <Icon name="x" size={12} color={colors.inkInverse} />
          </Pressable>
        ) : null}
      </View>
      {item.status === 'uploading' || item.status === 'queued' ? <ProgressBar value={item.progress} /> : null}
      <Text variant="caption" color={onDark ? '#fff' : undefined} tone={item.status === 'error' ? 'danger' : 'muted'} numberOfLines={2}>
        {item.status === 'error' && item.error ? item.error : status}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  lifted: { margin: 4 },
  thumb: { borderRadius: radius.sm, overflow: 'hidden', borderWidth: 2 },
  badge: { position: 'absolute', bottom: 4, right: 4, width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  remove: { position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});

