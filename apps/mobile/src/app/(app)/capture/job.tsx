import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { isJobRunning, useImportJob } from '@/api/hooks';
import { Badge, Button, Card, EmptyState, ErrorState, OfflineBanner, ProgressBar, Screen, Skeleton, SkeletonGroup, Text } from '@/components/ui';
import { JOB_TONE, jobProgress } from '@/components/capture/jobUtils';
import { radius, space } from '@/theme';

/** Polls each import job (1.5 s) until it can be reviewed. */
export default function CaptureJobScreen() {
  const { t } = useTranslation('capture');
  const router = useRouter();
  const { ids } = useLocalSearchParams<{ ids?: string }>();
  const jobIds = (ids ?? '').split(',').filter(Boolean);

  return (
    <Screen
      testID="capture-job"
      footer={
        <Button
          label={t('job.viewWardrobe')}
          variant="secondary"
          onPress={() => router.navigate('/armario')}
          fullWidth
          testID="job-view-wardrobe"
        />
      }
    >
      <OfflineBanner />
      <View style={{ gap: space.xs, paddingTop: space.md }}>
        <Text variant="title">{t('job.title')}</Text>
        <Text variant="small" tone="muted">
          {t('job.keepUsing')}
        </Text>
      </View>
      {jobIds.length === 0 ? (
        <EmptyState icon="inbox" title={t('job.noIds')} actionLabel={t('session.goImports')} onAction={() => router.replace('/capture/imports')} />
      ) : (
        jobIds.map((id) => <JobCard key={id} id={id} autoOpen={jobIds.length === 1} />)
      )}
    </Screen>
  );
}

function JobCard({ id, autoOpen }: { id: string; autoOpen: boolean }) {
  const { t } = useTranslation('capture');
  const router = useRouter();
  const job = useImportJob(id);
  const data = job.data;

  // Single job: jump straight into review as soon as it is ready (fast digitising).
  useEffect(() => {
    if (autoOpen && data?.status === 'needs_review') router.replace({ pathname: '/capture/review/[jobId]', params: { jobId: id } });
  }, [autoOpen, data?.status, id, router]);

  if (!data) {
    if (job.isError) return <ErrorState error={job.error} onRetry={() => job.refetch()} compact />;
    return (
      <SkeletonGroup>
        <Skeleton height={120} radius={radius.lg} />
      </SkeletonGroup>
    );
  }
  const pending = data.detections.filter((d) => d.state === 'pending').length;
  return (
    <Card testID={`job-card-${id}`}>
      <View style={{ gap: space.sm }} accessibilityLiveRegion="polite">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Text variant="subheading" style={{ flex: 1 }}>
            {t(`job.kind.${data.kind}`)}
          </Text>
          <Badge label={t(`job.status.${data.status}`)} tone={JOB_TONE[data.status]} />
        </View>
        <ProgressBar value={jobProgress(data)} testID={`job-progress-${id}`} />
        {data.total > 0 ? (
          <Text variant="small" tone="muted">
            {t('job.processed', { processed: data.processed, total: data.total })}
          </Text>
        ) : null}
        {data.detections.length ? (
          <Text variant="small">{t('job.detections', { count: data.detections.length })}</Text>
        ) : null}
        {data.status === 'failed' ? (
          <Text variant="small" tone="danger">
            {t('job.failed')}
            {data.error ? `: ${data.error}` : ''}
          </Text>
        ) : null}
        {data.status === 'needs_review' || (data.status === 'completed' && data.detections.length) || (isJobRunning(data) && pending > 0) ? (
          <Button
            label={pending > 0 ? t('job.review', { count: pending }) : t('job.reviewAll')}
            onPress={() => router.push({ pathname: '/capture/review/[jobId]', params: { jobId: id } })}
            testID={`job-review-${id}`}
          />
        ) : null}
      </View>
    </Card>
  );
}
