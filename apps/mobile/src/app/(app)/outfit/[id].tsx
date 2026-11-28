import type { FeedbackRequest, OutfitDto } from '@dressit/shared';
import * as Sharing from 'expo-sharing';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { type HostInstance, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { captureRef } from 'react-native-view-shot';

import { errorMessage } from '@/api/client';
import { useCreatePlan, useDeleteOutfit, useOutfit, useOutfitFeedback, useWearOutfit } from '@/api/hooks';
import { DateField } from '@/components/DateField';
import { OutfitCard } from '@/components/OutfitCard';
import { AlternativesSheet } from '@/components/outfits/AlternativesSheet';
import { OutfitPickerSheet } from '@/components/outfits/OutfitPickerSheet';
import { outfitTitle } from '@/components/outfits/OutfitThumb';
import { RatingStars } from '@/components/outfits/RatingStars';
import { RejectSheet } from '@/components/outfits/RejectSheet';
import { AvatarRenderCard } from '@/components/outfits/AvatarRenderCard';
import { ScoreBreakdown } from '@/components/outfits/ScoreBreakdown';
import {
  Badge,
  Button,
  ConfirmDialog,
  Divider,
  ErrorState,
  GarmentTile,
  OfflineBanner,
  ProductCard,
  Screen,
  SectionHeader,
  SkeletonCard,
  Text,
  useToast,
} from '@/components/ui';
import { today } from '@/lib/dates';
import { formatLongDate } from '@/lib/format';
import { occasionLabel, slotLabel } from '@/lib/vocab';
import { space } from '@/theme';

export default function OutfitDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation('outfits');
  const query = useOutfit(id);

  if (query.data === undefined) {
    return (
      <Screen testID="outfit-detail-screen">
        <Stack.Screen options={{ title: '' }} />
        {query.isError ? <ErrorState error={query.error} onRetry={() => query.refetch()} title={t('detail.notFound')} /> : <SkeletonCard height={420} />}
      </Screen>
    );
  }
  return <OutfitDetail outfit={query.data} refreshing={query.isRefetching} onRefresh={() => query.refetch()} />;
}

function OutfitDetail({ outfit, refreshing, onRefresh }: { outfit: OutfitDto; refreshing: boolean; onRefresh: () => void }) {
  const { t } = useTranslation('outfits');
  const router = useRouter();
  const toast = useToast();
  const canvasRef = useRef<HostInstance>(null);
  const feedback = useOutfitFeedback();
  const wear = useWearOutfit();
  const plan = useCreatePlan();
  const del = useDeleteOutfit();

  const [swapOpen, setSwapOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [rating, setRating] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  const title = outfitTitle(outfit, t('card.untitled'));

  const sendFeedback = (body: Omit<FeedbackRequest & { id: string }, 'id'>, message: string, after?: () => void) =>
    feedback.mutate(
      { id: outfit.id, ...body },
      {
        onSuccess: () => {
          toast.show({ message, tone: 'success' });
          after?.();
        },
        onError: (e) => toast.show({ message: errorMessage(e), tone: 'error' }),
      },
    );

  const exportImage = async () => {
    setExporting(true);
    try {
      if (!(await Sharing.isAvailableAsync())) {
        toast.show({ message: t('detail.exportUnavailable'), tone: 'error' });
        return;
      }
      const uri = await captureRef(canvasRef as unknown as Parameters<typeof captureRef>[0], { format: 'png', quality: 1, result: 'tmpfile' });
      await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: t('detail.shareTitle') });
    } catch {
      toast.show({ message: t('detail.exportError'), tone: 'error' });
    } finally {
      setExporting(false);
    }
  };

  const garments = outfit.items.filter((i) => i.garment);
  const candidates = outfit.items.filter((i) => !i.garment && i.candidateProduct);

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh} testID="outfit-detail-screen">
      <Stack.Screen options={{ title }} />
      <OfflineBanner />
      <OutfitCard ref={canvasRef} outfit={outfit} title={title} maxExplanation={0} testID="outfit-detail-card" />

      <View style={styles.badges}>
        <Badge label={`${t('detail.status')}: ${t(`status.${outfit.status}`)}`} tone={outfit.status === 'rejected' ? 'danger' : 'neutral'} />
        <Badge label={t(`sources.${outfit.source}`)} tone="neutral" />
        {outfit.occasion ? <Badge label={occasionLabel(outfit.occasion)} tone="info" /> : null}
      </View>

      {/* Primary actions */}
      <View style={styles.actions}>
        <Button
          size="sm"
          icon="bookmark"
          variant={outfit.isSaved ? 'primary' : 'secondary'}
          label={outfit.isSaved ? t('actions.unsave') : t('actions.save')}
          disabled={feedback.isPending}
          onPress={() =>
            outfit.isSaved ? sendFeedback({ action: 'unsave' }, t('detail.unsavedToast')) : sendFeedback({ action: 'save' }, t('detail.savedToast'))
          }
          testID="outfit-detail-save"
        />
        <Button
          size="sm"
          icon="heart"
          variant={outfit.isFavorite ? 'accent' : 'secondary'}
          label={outfit.isFavorite ? t('actions.unfavorite') : t('actions.favorite')}
          disabled={feedback.isPending}
          onPress={() =>
            outfit.isFavorite
              ? sendFeedback({ action: 'unfavorite' }, t('detail.unfavoriteToast'))
              : sendFeedback({ action: 'favorite' }, t('detail.favoriteToast'))
          }
          testID="outfit-detail-favorite"
        />
        <Button size="sm" icon="shuffle" variant="secondary" label={t('actions.swap')} onPress={() => setSwapOpen(true)} testID="outfit-detail-swap" />
      </View>
      {outfit.status === 'suggested' || outfit.status === 'saved' ? (
        <View style={styles.actions}>
          <Button
            size="sm"
            icon="check"
            label={t('actions.accept')}
            disabled={feedback.isPending}
            onPress={() => sendFeedback({ action: 'accept' }, t('detail.acceptedToast'))}
            testID="outfit-detail-accept"
          />
          <Button size="sm" icon="x" variant="secondary" label={t('actions.reject')} onPress={() => setRejectOpen(true)} testID="outfit-detail-reject" />
        </View>
      ) : null}
      <Button
        icon="check-circle"
        variant="secondary"
        label={t('actions.wearToday')}
        loading={wear.isPending}
        onPress={() =>
          wear.mutate(
            { id: outfit.id, date: today() },
            {
              onSuccess: () => toast.show({ message: t('detail.wornToast'), tone: 'success' }),
              onError: (e) => toast.show({ message: errorMessage(e), tone: 'error' }),
            },
          )
        }
        testID="outfit-detail-wear"
      />

      <View style={{ gap: space.sm }}>
        <Text variant="smallStrong">{t('detail.rating')}</Text>
        <RatingStars
          value={rating}
          disabled={feedback.isPending}
          onChange={(r) => {
            setRating(r);
            sendFeedback({ action: 'rate', rating: r }, t('detail.ratedToast'));
          }}
          testID="outfit-detail-rating"
        />
      </View>

      <DateField
        label={t('actions.planDate')}
        value={null}
        min={today()}
        testID="outfit-detail-plan"
        onChange={(date) =>
          plan.mutate(
            { date, outfitId: outfit.id },
            {
              onSuccess: () => toast.show({ message: t('detail.planned', { date: formatLongDate(date) }), tone: 'success' }),
              onError: (e) => toast.show({ message: errorMessage(e), tone: 'error' }),
            },
          )
        }
      />

      <AvatarRenderCard outfit={outfit} />

      {outfit.explanation.length ? (
        <View style={{ gap: space.sm }}>
          <SectionHeader title={t('detail.why')} />
          {outfit.explanation.map((line, i) => (
            <Text key={i} variant="body">
              — {line}
            </Text>
          ))}
        </View>
      ) : null}

      <View>
        <SectionHeader title={t('detail.breakdown')} />
        <ScoreBreakdown breakdown={outfit.breakdown} />
      </View>

      {garments.length ? (
        <View>
          <SectionHeader title={t('detail.items')} />
          <View style={styles.grid}>
            {garments.map((item) => (
              <View key={item.slot} style={styles.cell}>
                <GarmentTile
                  garment={item.garment!}
                  caption={slotLabel(item.slot)}
                  onPress={() => router.push({ pathname: '/garment/[id]', params: { id: item.garment!.id } })}
                />
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {candidates.length ? (
        <View style={{ gap: space.md }}>
          <SectionHeader title={t('detail.candidate')} />
          {candidates.map((item) => (
            <ProductCard
              key={item.slot}
              layout="horizontal"
              product={item.candidateProduct!}
              onPress={() =>
                router.push({ pathname: '/shop/product/[id]', params: { id: item.candidateProduct!.id, kind: item.candidateProduct!.kind } })
              }
            />
          ))}
        </View>
      ) : null}

      <Divider />
      <View style={{ gap: space.sm }}>
        <Button icon="columns" variant="secondary" label={t('actions.compare')} onPress={() => setCompareOpen(true)} testID="outfit-detail-compare" />
        <Button
          icon="share"
          variant="secondary"
          label={exporting ? t('detail.exporting') : t('actions.export')}
          loading={exporting}
          onPress={exportImage}
          testID="outfit-detail-export"
        />
        <Button icon="trash-2" variant="danger" label={t('actions.delete')} onPress={() => setDeleteOpen(true)} testID="outfit-detail-delete" />
      </View>

      <AlternativesSheet outfit={outfit} visible={swapOpen} onClose={() => setSwapOpen(false)} />
      <RejectSheet
        visible={rejectOpen}
        onClose={() => setRejectOpen(false)}
        loading={feedback.isPending}
        onSubmit={(reasons) =>
          sendFeedback({ action: 'reject', reasons: reasons.length ? reasons : undefined }, t('detail.rejectedToast'), () => setRejectOpen(false))
        }
      />
      <OutfitPickerSheet
        visible={compareOpen}
        onClose={() => setCompareOpen(false)}
        excludeId={outfit.id}
        title={t('actions.compare')}
        onPick={(other) => router.push({ pathname: '/outfit/compare', params: { a: outfit.id, b: other.id } })}
      />
      <ConfirmDialog
        visible={deleteOpen}
        title={t('detail.deleteTitle')}
        message={t('detail.deleteBody')}
        destructive
        confirmLabel={t('actions.delete')}
        loading={del.isPending}
        error={del.isError ? errorMessage(del.error) : null}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() =>
          del.mutate(outfit.id, {
            onSuccess: () => {
              setDeleteOpen(false);
              toast.show({ message: t('detail.deletedToast'), tone: 'success' });
              if (router.canGoBack()) router.back();
              else router.replace('/outfits');
            },
          })
        }
        testID="outfit-delete-dialog"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  cell: { width: '30%' },
});
