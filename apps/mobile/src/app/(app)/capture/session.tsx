import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { QueueThumb } from '@/components/capture/QueueThumb';
import { Button, Card, EmptyState, OfflineBanner, ProgressBar, Screen, Text } from '@/components/ui';
import { uploadQueue, useImportSession } from '@/state/uploadQueue';
import { space } from '@/theme';

/** Upload progress of a capture/gallery session. Creates the import job(s) when uploads settle. */
export default function CaptureSessionScreen() {
  const { t } = useTranslation('capture');
  const router = useRouter();
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const { session, items } = useImportSession(sessionId);

  // Submitting is idempotent: the job is created as soon as every upload settles.
  useEffect(() => {
    if (session && session.status === 'collecting') uploadQueue.submit(session.id).catch(() => {});
  }, [session]);

  useEffect(() => {
    if (session?.status === 'submitted' && session.jobIds.length) {
      const ids = session.jobIds.join(',');
      router.replace({ pathname: '/capture/job', params: { ids } });
      const id = session.id;
      setTimeout(() => uploadQueue.clearSession(id), 500);
    }
  }, [session, router]);

  if (!session) {
    return (
      <Screen>
        <EmptyState
          icon="upload-cloud"
          title={t('session.notFound')}
          body={t('session.notFoundBody')}
          actionLabel={t('session.goImports')}
          onAction={() => router.replace('/capture/imports')}
        />
      </Screen>
    );
  }

  const done = items.filter((i) => i.status === 'done').length;
  const failed = items.filter((i) => i.status === 'error');
  const pending = items.filter((i) => i.status === 'queued' || i.status === 'uploading');
  const overall = items.length ? items.reduce((acc, i) => acc + (i.status === 'done' ? 1 : i.progress), 0) / items.length : 0;

  return (
    <Screen
      testID="capture-session"
      footer={
        <>
          {session.status === 'error' ? (
            <Button label={t('session.retrySubmit')} onPress={() => uploadQueue.submit(session.id).catch(() => {})} fullWidth testID="session-retry-submit" />
          ) : null}
          <Button
            label={t('session.background')}
            variant="secondary"
            accessibilityHint={t('session.backgroundHint')}
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/armario'))}
            fullWidth
            testID="session-background"
          />
        </>
      }
    >
      <OfflineBanner />
      <Card>
        <View style={{ gap: space.sm }} accessibilityLiveRegion="polite">
          <Text variant="heading">
            {session.status === 'submitting' ? t('session.submitting') : session.status === 'submitted' ? t('session.submitted') : t('session.progress', { done, total: items.length })}
          </Text>
          <ProgressBar value={session.status === 'submitting' || session.status === 'submitted' ? 1 : overall} testID="session-progress" />
          <Text variant="small" tone="muted">
            {pending.length ? t('session.waiting') : t('session.backgroundHint')}
          </Text>
          {session.error ? (
            <Text variant="small" tone="danger">
              {session.error}
            </Text>
          ) : null}
        </View>
      </Card>

      {failed.length ? (
        <Button
          label={t('session.retryFailed')}
          variant="secondary"
          icon="refresh-cw"
          onPress={() => failed.forEach((f) => uploadQueue.retry(f.localId))}
          testID="session-retry-failed"
        />
      ) : null}

      <View style={styles.grid}>
        {items.map((item, i) => (
          <QueueThumb key={item.localId} item={item} index={i} size={96} />
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
});
