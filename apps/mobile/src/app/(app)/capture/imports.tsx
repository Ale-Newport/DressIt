import type { ImportJobDto } from '@dressit/shared';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { isJobRunning, useImportJobs } from '@/api/hooks';
import { JOB_TONE, jobProgress } from '@/components/capture/jobUtils';
import { Badge, Button, Divider, EmptyState, Icon, OfflineBanner, ProgressBar, QueryView, Screen, SkeletonList, Text } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { space, useTheme } from '@/theme';

const ORDER: Record<ImportJobDto['status'], number> = { needs_review: 0, processing: 1, queued: 2, failed: 3, completed: 4, cancelled: 5 };

export default function ImportsScreen() {
  const { t } = useTranslation('capture');
  const router = useRouter();
  const jobs = useImportJobs();
  return (
    <Screen refreshing={jobs.isRefetching} onRefresh={() => jobs.refetch()} testID="imports-screen">
      <OfflineBanner />
      <QueryView
        query={jobs}
        loading={<SkeletonList rows={5} />}
        isEmpty={(d) => d.length === 0}
        empty={
          <EmptyState
            icon="inbox"
            title={t('imports.emptyTitle')}
            body={t('imports.emptyBody')}
            actionLabel={t('review.addMore')}
            onAction={() => router.navigate({ pathname: '/armario', params: { add: '1' } })}
          />
        }
      >
        {(list) => {
          const sorted = [...list].sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.updatedAt.localeCompare(a.updatedAt));
          return (
            <View style={{ paddingTop: space.md }}>
              {sorted.map((job, i) => (
                <View key={job.id}>
                  {i > 0 ? <Divider /> : null}
                  <JobRow job={job} />
                </View>
              ))}
            </View>
          );
        }}
      </QueryView>
      {jobs.data?.length ? (
        <Button label={t('review.addMore')} variant="secondary" icon="plus" onPress={() => router.navigate({ pathname: '/armario', params: { add: '1' } })} />
      ) : null}
    </Screen>
  );
}

function JobRow({ job }: { job: ImportJobDto }) {
  const { t } = useTranslation('capture');
  const { colors } = useTheme();
  const router = useRouter();
  const pending = job.detections.filter((d) => d.state === 'pending').length;
  const open = () => {
    if (job.status === 'needs_review' || job.status === 'completed' || pending > 0) {
      router.push({ pathname: '/capture/review/[jobId]', params: { jobId: job.id } });
    } else {
      router.push({ pathname: '/capture/job', params: { ids: job.id } });
    }
  };
  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={`${t(`job.kind.${job.kind}`)}, ${t(`job.status.${job.status}`)}${pending ? `, ${t('imports.pendingReview', { count: pending })}` : ''}`}
      accessibilityHint={t('imports.open')}
      testID={`import-row-${job.id}`}
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <View style={styles.head}>
          <Text variant="bodyStrong" style={{ flex: 1 }}>
            {t(`job.kind.${job.kind}`)}
          </Text>
          <Badge label={t(`job.status.${job.status}`)} tone={JOB_TONE[job.status]} />
        </View>
        <Text variant="small" tone="muted">
          {t('imports.created', { date: formatDateTime(job.createdAt) })}
          {job.detections.length ? ` · ${t('job.detections', { count: job.detections.length })}` : ''}
        </Text>
        {pending ? (
          <Text variant="small" tone="accent">
            {t('imports.pendingReview', { count: pending })}
          </Text>
        ) : null}
        {isJobRunning(job) ? <ProgressBar value={jobProgress(job)} /> : null}
        {job.status === 'failed' && job.error ? (
          <Text variant="small" tone="danger">
            {job.error}
          </Text>
        ) : null}
      </View>
      <Icon name="chevron-right" size={18} color={colors.inkSubtle} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, minHeight: 64 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
