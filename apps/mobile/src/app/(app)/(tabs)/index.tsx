import type { FeedbackRequest, GarmentDto, GarmentStatus, OutfitDto, RecommendationRequest } from '@dressit/shared';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { errorMessage } from '@/api/client';
import { useChangeGarmentStatus, useHome, useOutfitFeedback, useRecommendations, useWearOutfit } from '@/api/hooks';
import {
  type AdjustmentKey,
  ADJUSTMENT_KEYS,
  type Adjustments,
  compactAdjustments,
  isAdjustmentActive,
  MoreOptionsSheet,
  toggleAdjustment,
} from '@/components/home/MoreOptionsSheet';
import { AssistantEntry, PendingReviewsBanner, TodayPlanCard, UpcomingEvents } from '@/components/home/HomeSections';
import { OutfitActions } from '@/components/home/OutfitActions';
import { OutfitCard } from '@/components/OutfitCard';
import { AlternativesSheet } from '@/components/outfits/AlternativesSheet';
import { RejectSheet } from '@/components/outfits/RejectSheet';
import {
  Button,
  Chip,
  ChipGroup,
  EmptyState,
  ErrorState,
  Icon,
  OfflineBanner,
  Screen,
  ScreenHeader,
  SectionHeader,
  Skeleton,
  SkeletonCard,
  SkeletonGroup,
  Text,
  useToast,
} from '@/components/ui';
import { WeatherSummary } from '@/components/WeatherSummary';
import { today } from '@/lib/dates';
import { capitalize, formatLongDate } from '@/lib/format';
import { options, statusLabel, subcategoryLabel } from '@/lib/vocab';
import { radius, space, useTheme } from '@/theme';
import { greetingSubtitle, greetingTitle } from '@/lib/greeting';

type Busy = 'accept' | 'reject' | 'save' | 'wear';
type RejectReasons = NonNullable<FeedbackRequest['reasons']>;

const RECOMMENDATION_COUNT = 4;

export default function HomeScreen() {
  const { t } = useTranslation('home');
  const router = useRouter();
  const toast = useToast();
  const { colors } = useTheme();
  const date = today();

  const home = useHome();
  const [pickedOccasion, setPickedOccasion] = useState<string | null>(null);
  const [adjustments, setAdjustments] = useState<Adjustments>({});
  const [seed, setSeed] = useState<number | undefined>(undefined);
  const [exclude, setExclude] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const [swapOutfit, setSwapOutfit] = useState<OutfitDto | null>(null);
  const [rejectOutfit, setRejectOutfit] = useState<OutfitDto | null>(null);
  const [moreOutfit, setMoreOutfit] = useState<OutfitDto | null>(null);
  const [markingGarmentId, setMarkingGarmentId] = useState<string | null>(null);

  const suggested = home.data?.suggestedOccasion;
  const occasion = pickedOccasion ?? suggested?.id ?? undefined;
  const hasGarments = (home.data?.garmentCount ?? 1) > 0;

  const request = useMemo<RecommendationRequest>(() => {
    const req: RecommendationRequest = { date, count: RECOMMENDATION_COUNT };
    if (occasion) req.occasion = occasion;
    if (suggested?.fromEventId && occasion === suggested.id) req.eventId = suggested.fromEventId;
    const adj = compactAdjustments(adjustments);
    if (adj) req.adjustments = adj;
    if (seed !== undefined) req.seed = seed;
    if (exclude.length) req.exclude = exclude;
    return req;
  }, [date, occasion, suggested?.fromEventId, suggested?.id, adjustments, seed, exclude]);

  // Wait for /home (it tells us the suggested occasion) unless it failed.
  const homeSettled = home.data !== undefined || home.isError;
  const recs = useRecommendations(request, homeSettled && hasGarments);

  const feedback = useOutfitFeedback();
  const wear = useWearOutfit();
  const changeStatus = useChangeGarmentStatus();

  const busyFor = (outfitId: string): Busy | null => {
    if (wear.isPending && wear.variables?.id === outfitId) return 'wear';
    if (feedback.isPending && feedback.variables?.id === outfitId) {
      const a = feedback.variables.action;
      return a === 'accept' ? 'accept' : a === 'reject' ? 'reject' : 'save';
    }
    return null;
  };

  const regenerate = () => {
    setSeed(Math.floor(Math.random() * 1_000_000));
  };

  const sendFeedback = (outfit: OutfitDto, body: FeedbackRequest, successMessage: string, after?: () => void) => {
    feedback.mutate(
      { id: outfit.id, ...body },
      {
        onSuccess: () => {
          toast.show({ message: successMessage, tone: 'success' });
          after?.();
        },
        onError: (e) => toast.show({ message: errorMessage(e), tone: 'error' }),
      },
    );
  };

  const onReject = (reasons: RejectReasons) => {
    if (!rejectOutfit) return;
    const outfit = rejectOutfit;
    sendFeedback(outfit, { action: 'reject', reasons: reasons.length ? reasons : undefined }, t('toasts.rejected'), () => setRejectOutfit(null));
  };

  const onWear = (outfit: OutfitDto) => {
    wear.mutate(
      { id: outfit.id, date },
      {
        onSuccess: () => toast.show({ message: t('toasts.worn'), tone: 'success' }),
        onError: (e) => toast.show({ message: errorMessage(e), tone: 'error' }),
      },
    );
  };

  const onMarkUnavailable = (garment: GarmentDto, status: Extract<GarmentStatus, 'laundry' | 'stored'>) => {
    setMarkingGarmentId(garment.id);
    changeStatus.mutate(
      { id: garment.id, status },
      {
        onSuccess: () => {
          setMoreOutfit(null);
          setExclude((prev) => (prev.includes(garment.id) ? prev : [...prev, garment.id]));
          regenerate();
          toast.show({
            message: t('toasts.statusChanged', { name: garment.name || subcategoryLabel(garment.subcategory), status: statusLabel(status).toLowerCase() }),
            tone: 'success',
          });
        },
        onError: (e) => toast.show({ message: errorMessage(e), tone: 'error' }),
        onSettled: () => setMarkingGarmentId(null),
      },
    );
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([home.refetch(), hasGarments ? recs.refetch() : Promise.resolve()]);
    } finally {
      setRefreshing(false);
    }
  };

  const greeting = recs.data?.greeting ?? home.data?.greeting ?? null;
  const weather = recs.data?.weather ?? home.data?.weather ?? null;
  const weatherError = recs.data?.weatherError ?? home.data?.weatherError ?? null;
  const visibleOutfits = (recs.data?.outfits ?? []).filter((o) => o.status !== 'rejected');
  const activeAdjustments = ADJUSTMENT_KEYS.filter((k) => isAdjustmentActive(adjustments, k));

  // --- Full-screen states -----------------------------------------------------
  if (home.data === undefined && home.isError) {
    return (
      <Screen edges={['top']} testID="home-screen" onRefresh={onRefresh} refreshing={refreshing}>
        <ScreenHeader overline={capitalize(formatLongDate(date))} title={t('title')} />
        <OfflineBanner />
        <ErrorState error={home.error} onRetry={() => home.refetch()} title={t('errors.homeTitle')} />
        <AssistantEntry />
      </Screen>
    );
  }

  if (home.data === undefined) {
    return (
      <Screen edges={['top']} testID="home-screen">
        <SkeletonGroup label={t('outfits.loading')} style={{ gap: space.md, paddingTop: space.xl }}>
          <Skeleton width="40%" height={12} />
          <Skeleton width="80%" height={36} />
          <Skeleton height={96} radius={radius.lg} />
        </SkeletonGroup>
        <SkeletonCard height={360} />
      </Screen>
    );
  }

  const homeData = home.data;

  return (
    <Screen edges={['top']} testID="home-screen" onRefresh={onRefresh} refreshing={refreshing}>
      <View testID="home-greeting">
        <ScreenHeader overline={capitalize(formatLongDate(date))} title={greetingTitle(greeting) ?? t('greetingFallback')} subtitle={greetingSubtitle(greeting)} />
      </View>
      <OfflineBanner />

      <WeatherSummary weather={weather} weatherError={weatherError} />

      {homeData.pendingReviewCount > 0 ? <PendingReviewsBanner count={homeData.pendingReviewCount} /> : null}

      {homeData.todayPlan ? <TodayPlanCard plan={homeData.todayPlan} /> : null}

      {!hasGarments ? (
        <EmptyState
          icon="grid"
          title={t('emptyWardrobe.title')}
          body={t('emptyWardrobe.body')}
          actionLabel={t('emptyWardrobe.action')}
          onAction={() => router.push({ pathname: '/armario', params: { add: '1' } })}
          secondaryLabel={t('emptyWardrobe.secondary')}
          onSecondary={() => router.push('/assistant')}
          testID="home-empty-wardrobe"
        />
      ) : (
        <View style={{ gap: space.lg }}>
          <View style={{ gap: space.sm }}>
            <Text variant="smallStrong">{t('occasionsLabel')}</Text>
            <ChipGroup
              options={options.occasions}
              value={occasion ?? null}
              onChange={(v) => {
                if (typeof v === 'string') setPickedOccasion(v);
              }}
              allowDeselect={false}
              scroll
              testIDPrefix="home-occasion"
              accessibilityLabel={t('occasionsLabel')}
            />
            {suggested?.fromEventId && occasion === suggested.id ? (
              <Text variant="caption" tone="muted">
                {t('occasionFromEvent', { label: suggested.label })}
              </Text>
            ) : null}
          </View>

          <SectionHeader
            overline={t('outfits.overline')}
            title={recs.data?.occasion.label ? capitalize(recs.data.occasion.label) : t('outfits.title')}
            action={
              <Button
                label={t('outfits.regenerate')}
                size="sm"
                variant="secondary"
                icon="refresh-cw"
                onPress={regenerate}
                disabled={recs.isFetching}
                accessibilityHint={t('outfits.regenerateHint')}
                testID="home-regenerate"
              />
            }
          />

          {activeAdjustments.length ? (
            <View style={styles.adjustRow} accessibilityLabel={t('adjustments.overline')}>
              <Text variant="overline" tone="muted">
                {t('adjustments.overline')}
              </Text>
              {activeAdjustments.map((k: AdjustmentKey) => (
                <Chip
                  key={k}
                  label={t(`adjustments.${k}`)}
                  icon="x"
                  selected
                  size="sm"
                  onPress={() => setAdjustments((a) => toggleAdjustment(a, k))}
                  accessibilityHint={t('adjustments.removeHint')}
                  testID={`home-adjust-active-${k}`}
                />
              ))}
            </View>
          ) : null}

          {recs.isFetching && recs.data ? (
            <View style={styles.fetching} accessibilityLiveRegion="polite">
              <ActivityIndicator size="small" color={colors.inkMuted} />
              <Text variant="small" tone="muted">
                {t('toasts.regenerating')}
              </Text>
            </View>
          ) : null}

          {recs.data?.warnings.length ? (
            <View style={[styles.warnings, { backgroundColor: colors.warningSoft }]} accessibilityRole="summary" testID="home-warnings">
              <View style={styles.warningsHead}>
                <Icon name="alert-circle" size={16} color={colors.warning} />
                <Text variant="smallStrong" color={colors.warning}>
                  {t('outfits.warningsTitle')}
                </Text>
              </View>
              {recs.data.warnings.map((w, i) => (
                <Text key={i} variant="small" color={colors.warning}>
                  {w}
                </Text>
              ))}
            </View>
          ) : null}

          {recs.data === undefined ? (
            recs.isError ? (
              <ErrorState error={recs.error} onRetry={() => recs.refetch()} title={t('outfits.errorTitle')} compact />
            ) : (
              <SkeletonCard height={380} testID="home-outfits-loading" />
            )
          ) : visibleOutfits.length === 0 ? (
            <EmptyState
              compact
              icon="layers"
              title={t('outfits.noneTitle')}
              body={recs.data.outfits.length > 0 ? t('outfits.allRejected') : t('outfits.noneBody')}
              actionLabel={t('outfits.regenerate')}
              onAction={regenerate}
              testID="home-outfits-empty"
            />
          ) : (
            <View style={{ gap: space.xl }} testID="home-outfits">
              {recs.isError ? <Text variant="small" tone="danger">{errorMessage(recs.error)}</Text> : null}
              {visibleOutfits.map((outfit, i) => {
                const testID = `home-outfit-${i}`;
                return (
                  <OutfitCard
                    key={outfit.id}
                    outfit={outfit}
                    testID={testID}
                    title={outfit.name ?? t('outfits.outfitLabel', { index: i + 1 })}
                    onPress={() => router.push({ pathname: '/outfit/[id]', params: { id: outfit.id } })}
                    footer={
                      <OutfitActions
                        outfit={outfit}
                        testID={testID}
                        busy={busyFor(outfit.id)}
                        onAccept={() => sendFeedback(outfit, { action: 'accept' }, t('toasts.accepted'))}
                        onReject={() => setRejectOutfit(outfit)}
                        onToggleSave={() =>
                          sendFeedback(outfit, { action: outfit.isSaved ? 'unsave' : 'save' }, outfit.isSaved ? t('toasts.unsaved') : t('toasts.saved'))
                        }
                        onSwap={() => setSwapOutfit(outfit)}
                        onWear={() => onWear(outfit)}
                        onMore={() => setMoreOutfit(outfit)}
                        onOpen={() => router.push({ pathname: '/outfit/[id]', params: { id: outfit.id } })}
                      />
                    }
                  />
                );
              })}
            </View>
          )}
        </View>
      )}

      <UpcomingEvents events={homeData.upcomingEvents} />

      <AssistantEntry />

      <AlternativesSheet outfit={swapOutfit} visible={!!swapOutfit} onClose={() => setSwapOutfit(null)} />
      <RejectSheet visible={!!rejectOutfit} onClose={() => setRejectOutfit(null)} onSubmit={onReject} loading={feedback.isPending && feedback.variables?.action === 'reject'} />
      <MoreOptionsSheet
        outfit={moreOutfit}
        visible={!!moreOutfit}
        onClose={() => setMoreOutfit(null)}
        adjustments={adjustments}
        onToggleAdjustment={(k) => setAdjustments((a) => toggleAdjustment(a, k))}
        onRegenerate={regenerate}
        onMarkUnavailable={onMarkUnavailable}
        markingGarmentId={markingGarmentId}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  adjustRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  fetching: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  warnings: { padding: space.md, borderRadius: radius.md, gap: space.xs },
  warningsHead: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
});
