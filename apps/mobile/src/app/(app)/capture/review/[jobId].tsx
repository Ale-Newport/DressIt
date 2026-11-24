import type { DetectionDto, GarmentWriteDto } from '@dressit/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { api, errorMessage } from '@/api/client';
import { isJobRunning, useAcceptAllDetections, useAcceptDetection, useImportJob, useRejectDetection } from '@/api/hooks';
import { DetectionCard, draftFromDetection } from '@/components/capture/DetectionCard';
import { jobProgress } from '@/components/capture/jobUtils';
import {
  Badge,
  Button,
  Card,
  Divider,
  EmptyState,
  ErrorState,
  OfflineBanner,
  ProgressBar,
  Screen,
  Sheet,
  SkeletonCard,
  Text,
  useToast,
} from '@/components/ui';
import { type FieldKey, GarmentFieldEditor } from '@/components/wardrobe/GarmentFields';
import { subcategoryLabel } from '@/lib/vocab';
import { space } from '@/theme';

const EDIT_FIELDS: FieldKey[] = ['category', 'subcategory', 'name', 'brand', 'colors', 'pattern', 'materials', 'styles', 'seasons', 'occasions', 'fit', 'size'];

export default function ReviewScreen() {
  const { t } = useTranslation('capture');
  const router = useRouter();
  const toast = useToast();
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const job = useImportJob(jobId);
  const accept = useAcceptDetection(jobId);
  const reject = useRejectDetection(jobId);
  const acceptAll = useAcceptAllDetections(jobId);
  const [overrides, setOverrides] = useState<Record<string, GarmentWriteDto>>({});
  const [editing, setEditing] = useState<DetectionDto | null>(null);
  const [showReviewed, setShowReviewed] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [busyId, setBusyId] = useState<{ id: string; action: 'accept' | 'reject' } | null>(null);

  const data = job.data;
  if (!data) {
    return (
      <Screen>
        {job.isError ? <ErrorState error={job.error} onRetry={() => job.refetch()} /> : <SkeletonCard height={280} testID="review-loading" />}
      </Screen>
    );
  }

  const pending = data.detections.filter((d) => d.state === 'pending');
  const reviewed = data.detections.filter((d) => d.state !== 'pending');
  const running = isJobRunning(data);

  const setOverride = (id: string, patch: Partial<GarmentWriteDto>) => setOverrides((o) => ({ ...o, [id]: { ...o[id], ...patch } }));

  const doAccept = (d: DetectionDto) => {
    const draft = draftFromDetection(d, overrides[d.id]);
    if (!draft.category || !draft.subcategory) {
      // The API requires category + subcategory: ask the user first.
      setEditing(d);
      return;
    }
    setBusyId({ id: d.id, action: 'accept' });
    accept.mutate(
      { detectionId: d.id, overrides: overrides[d.id] },
      {
        onSuccess: () => toast.show({ message: t('review.accepted'), tone: 'success' }),
        onError: (e) => toast.show({ message: errorMessage(e), tone: 'error' }),
        onSettled: () => setBusyId(null),
      },
    );
  };

  const doReject = (d: DetectionDto) => {
    setBusyId({ id: d.id, action: 'reject' });
    reject.mutate(d.id, {
      onSuccess: () => toast.show({ message: t('review.rejected') }),
      onError: (e) => toast.show({ message: errorMessage(e), tone: 'error' }),
      onSettled: () => setBusyId(null),
    });
  };

  /** Edited detections are accepted with their overrides first; the rest via accept-all. */
  const doAcceptAll = async () => {
    setBulkBusy(true);
    try {
      let accepted = 0;
      for (const d of pending) {
        const o = overrides[d.id];
        if (o && Object.keys(o).length) {
          await api.post(`/v1/imports/${jobId}/detections/${d.id}/accept`, { overrides: o });
          accepted += 1;
        }
      }
      const res = await acceptAll.mutateAsync();
      toast.show({ message: t('review.acceptAllDone', { count: accepted + res.accepted }), tone: 'success' });
      job.refetch();
    } catch (e) {
      toast.show({ message: errorMessage(e), tone: 'error' });
      job.refetch();
    } finally {
      setBulkBusy(false);
    }
  };

  const total = data.detections.length;
  const done = reviewed.length;

  return (
    <Screen refreshing={job.isRefetching} onRefresh={() => job.refetch()} testID="review-screen">
      <OfflineBanner />
      <View style={{ gap: space.sm, paddingTop: space.md }} accessibilityLiveRegion="polite">
        <Text variant="title">{t('review.title')}</Text>
        {total ? (
          <>
            <Text variant="small" tone="muted">
              {t('review.counter', { done, total })} · {t('review.pending', { count: pending.length })}
            </Text>
            <ProgressBar value={total ? done / total : 0} testID="review-progress" />
          </>
        ) : null}
      </View>

      {running ? (
        <Card tone="sunken">
          <View style={{ gap: space.sm }}>
            <Text variant="small">{t('review.stillProcessing')}</Text>
            <ProgressBar value={jobProgress(data)} />
          </View>
        </Card>
      ) : null}
      {data.status === 'failed' ? (
        <Card tone="sunken">
          <Text variant="small" tone="danger">
            {t('job.failed')}
            {data.error ? `: ${data.error}` : ''}
          </Text>
        </Card>
      ) : null}

      {pending.length > 1 ? (
        <Button label={t('review.acceptAll')} icon="check-circle" onPress={doAcceptAll} loading={bulkBusy} testID="review-accept-all" />
      ) : null}

      {pending.map((d) => (
        <DetectionCard
          key={d.id}
          detection={d}
          index={data.detections.indexOf(d)}
          overrides={overrides[d.id]}
          onOverride={(p) => setOverride(d.id, p)}
          onAccept={() => doAccept(d)}
          onReject={() => doReject(d)}
          onEdit={() => setEditing(d)}
          accepting={busyId?.id === d.id && busyId.action === 'accept'}
          rejecting={busyId?.id === d.id && busyId.action === 'reject'}
        />
      ))}

      {pending.length === 0 && !running ? (
        total === 0 ? (
          <EmptyState icon="image" title={t('result.noLines')} body={data.error ?? t('review.noPrediction')} />
        ) : (
          <EmptyState
            icon="check-circle"
            title={t('review.doneTitle')}
            body={t('review.doneBody')}
            actionLabel={t('job.viewWardrobe')}
            onAction={() => router.navigate('/armario')}
            secondaryLabel={t('review.addMore')}
            onSecondary={() => router.navigate({ pathname: '/armario', params: { add: '1' } })}
            testID="review-done"
          />
        )
      ) : null}

      {reviewed.length ? (
        <View style={{ gap: space.sm }}>
          <Button
            label={showReviewed ? t('review.hideReviewed') : t('review.showReviewed', { count: reviewed.length })}
            variant="ghost"
            onPress={() => setShowReviewed((v) => !v)}
          />
          {showReviewed
            ? reviewed.map((d, i) => (
                <View key={d.id}>
                  {i > 0 ? <Divider /> : null}
                  <View style={styles.reviewedRow}>
                    <Text variant="small" style={{ flex: 1 }}>
                      {d.predicted.subcategory ? subcategoryLabel(d.predicted.subcategory.value) : t('review.detection', { index: data.detections.indexOf(d) + 1 })}
                    </Text>
                    <Badge
                      label={d.state === 'accepted' ? t('review.accepted') : d.state === 'merged' ? t('review.merged') : t('review.rejected')}
                      tone={d.state === 'accepted' ? 'success' : 'neutral'}
                    />
                    {d.garmentId ? (
                      <Button
                        label={t('review.viewGarment')}
                        size="sm"
                        variant="ghost"
                        onPress={() => router.push({ pathname: '/garment/[id]', params: { id: d.garmentId! } })}
                      />
                    ) : null}
                  </View>
                </View>
              ))
            : null}
        </View>
      ) : null}

      <EditSheet
        detection={editing}
        overrides={editing ? overrides[editing.id] : undefined}
        onClose={() => setEditing(null)}
        onApply={(draft) => {
          if (editing) setOverrides((o) => ({ ...o, [editing.id]: draft }));
          setEditing(null);
        }}
      />
    </Screen>
  );
}

function EditSheet({
  detection,
  overrides,
  onClose,
  onApply,
}: {
  detection: DetectionDto | null;
  overrides?: GarmentWriteDto;
  onClose: () => void;
  onApply: (draft: GarmentWriteDto) => void;
}) {
  const { t } = useTranslation('capture');
  const [draft, setDraft] = useState<GarmentWriteDto>({});
  useEffect(() => {
    if (detection) setDraft(draftFromDetection(detection, overrides));
    // Re-seed only when a different detection is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detection?.id]);
  const invalid = !draft.category || !draft.subcategory;
  return (
    <Sheet
      visible={!!detection}
      onClose={onClose}
      title={t('review.editTitle')}
      testID="review-edit-sheet"
      footer={<Button label={t('review.editApply')} onPress={() => onApply(draft)} disabled={invalid} fullWidth testID="review-edit-apply" />}
    >
      {EDIT_FIELDS.map((f) => (
        <GarmentFieldEditor key={f} field={f} draft={draft} onChange={(p) => setDraft((d) => ({ ...d, ...p }))} testIDPrefix="review-edit" />
      ))}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  reviewedRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44 },
});
