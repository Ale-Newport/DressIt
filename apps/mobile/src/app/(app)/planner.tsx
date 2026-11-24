import type { PlanDto, PlannerDayDto } from '@dressit/shared';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';

import { errorMessage } from '@/api/client';
import { useCreatePlan, useDeletePlan, usePlanner, useSuggestWeek, useUpdatePlan } from '@/api/hooks';
import { MonthCalendar } from '@/components/DateField';
import { OutfitPickerSheet } from '@/components/outfits/OutfitPickerSheet';
import { DayContent } from '@/components/planner/DayContent';
import { MoveSheet } from '@/components/planner/MoveSheet';
import { WeekPlanner } from '@/components/planner/WeekPlanner';
import {
  Button,
  EmptyState,
  ErrorState,
  IconButton,
  OfflineBanner,
  SegmentedControl,
  Sheet,
  SkeletonList,
  Text,
  useToast,
} from '@/components/ui';
import { addDays, addMonths, diffDays, monthGrid, rangeDays, startOfMonth, startOfWeek, today } from '@/lib/dates';
import { capitalize, formatLongDate, formatMonthYear, formatShortDate } from '@/lib/format';
import { space, useTheme } from '@/theme';

type View_ = 'week' | 'month';

export default function PlannerScreen() {
  const { t } = useTranslation('planner');
  const { colors } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const todayDate = today();

  const [view, setView] = useState<View_>('week');
  const [weekStart, setWeekStart] = useState(startOfWeek(todayDate));
  const [month, setMonth] = useState(startOfMonth(todayDate));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [planFor, setPlanFor] = useState<string | null>(null);
  const [moving, setMoving] = useState<PlanDto | null>(null);
  const [dragging, setDragging] = useState(false);

  const weekDays = useMemo(() => rangeDays(weekStart, 7), [weekStart]);
  const grid = useMemo(() => monthGrid(month), [month]);
  const from = view === 'week' ? weekDays[0]! : grid[0]!;
  const to = view === 'week' ? weekDays[6]! : grid[grid.length - 1]!;

  const planner = usePlanner(from, to);
  const createPlan = useCreatePlan();
  const updatePlan = useUpdatePlan();
  const deletePlan = useDeletePlan();
  const suggestWeek = useSuggestWeek();

  const byDate = useMemo(() => new Map<string, PlannerDayDto>((planner.data ?? []).map((d) => [d.date, d])), [planner.data]);

  const move = (plan: PlanDto, date: string) =>
    updatePlan.mutate(
      { id: plan.id, date },
      {
        onSuccess: () => toast.show({ message: t('plan.movedToast', { date: formatLongDate(date) }), tone: 'success' }),
        onError: (e) => toast.show({ message: errorMessage(e), tone: 'error' }),
      },
    );

  const remove = (plan: PlanDto) =>
    deletePlan.mutate(plan.id, {
      onSuccess: () => toast.show({ message: t('plan.removedToast'), tone: 'success' }),
      onError: (e) => toast.show({ message: errorMessage(e), tone: 'error' }),
    });

  const handlers = {
    onOpen: (plan: PlanDto) => router.push({ pathname: '/outfit/[id]', params: { id: plan.outfit.id } }),
    onMoveTo: (plan: PlanDto) => setMoving(plan),
    onRemove: remove,
    onPlan: (date: string) => setPlanFor(date),
    onAddEvent: (date: string) => router.push({ pathname: '/events/new', params: { date } }),
  };

  const suggest = () => {
    const start = weekStart < todayDate ? todayDate : weekStart;
    const days = Math.max(1, diffDays(start, weekDays[6]!) + 1);
    suggestWeek.mutate(
      { from: start, days },
      {
        onSuccess: () => toast.show({ message: t('suggestedToast'), tone: 'success' }),
        onError: (e) => toast.show({ message: errorMessage(e), tone: 'error' }),
      },
    );
  };

  const weekIsPast = weekDays[6]! < todayDate;
  const weekEmpty = view === 'week' && planner.data !== undefined && weekDays.every((d) => !byDate.get(d)?.plans.length && !byDate.get(d)?.events.length);

  return (
    <SafeAreaView edges={['bottom']} style={[styles.fill, { backgroundColor: colors.background }]} testID="planner-screen">
      <ScrollView
        scrollEnabled={!dragging}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={planner.isRefetching} onRefresh={() => void planner.refetch()} tintColor={colors.inkMuted} />}
      >
        <OfflineBanner />
        <SegmentedControl<View_>
          value={view}
          onChange={setView}
          accessibilityLabel={t('title')}
          segments={[
            { id: 'week', label: t('views.week'), testID: 'planner-view-week' },
            { id: 'month', label: t('views.month'), testID: 'planner-view-month' },
          ]}
        />

        {view === 'week' ? (
          <View style={styles.nav}>
            <IconButton icon="chevron-left" label={t('nav.prevWeek')} onPress={() => setWeekStart(addDays(weekStart, -7))} testID="planner-prev" />
            <Text variant="subheading" style={styles.navTitle} accessibilityRole="header" accessibilityLiveRegion="polite">
              {t('nav.weekOf', { from: formatShortDate(weekDays[0]!), to: formatShortDate(weekDays[6]!) })}
            </Text>
            <IconButton icon="chevron-right" label={t('nav.nextWeek')} onPress={() => setWeekStart(addDays(weekStart, 7))} testID="planner-next" />
          </View>
        ) : (
          <Text variant="subheading" accessibilityRole="header">
            {capitalize(formatMonthYear(month))}
          </Text>
        )}

        <View style={styles.toolbar}>
          {(view === 'week' && weekStart !== startOfWeek(todayDate)) || (view === 'month' && month !== startOfMonth(todayDate)) ? (
            <Button
              size="sm"
              variant="ghost"
              label={t('nav.today')}
              onPress={() => {
                setWeekStart(startOfWeek(todayDate));
                setMonth(startOfMonth(todayDate));
              }}
            />
          ) : null}
          {view === 'week' && !weekIsPast ? (
            <Button
              size="sm"
              icon="zap"
              label={suggestWeek.isPending ? t('suggesting') : t('suggestWeek')}
              accessibilityHint={t('suggestWeekHint')}
              loading={suggestWeek.isPending}
              onPress={suggest}
              testID="planner-suggest-week"
            />
          ) : null}
        </View>

        {planner.data === undefined ? (
          planner.isError ? (
            <ErrorState error={planner.error} onRetry={() => planner.refetch()} />
          ) : (
            <SkeletonList rows={5} />
          )
        ) : view === 'week' ? (
          <>
            {weekEmpty ? <EmptyState compact icon="calendar" title={t('empty.weekTitle')} body={t('empty.weekBody')} /> : null}
            <Text variant="caption" tone="muted">
              {t('dragHint')}
            </Text>
            <WeekPlanner days={weekDays} byDate={byDate} onDrop={move} onDraggingChange={setDragging} {...handlers} />
          </>
        ) : (
          <MonthCalendar
            value={selectedDay}
            month={month}
            onMonthChange={(m) => setMonth(startOfMonth(m))}
            onChange={(d) => setSelectedDay(d)}
            marked={(d) => !!byDate.get(d)?.plans.length || !!byDate.get(d)?.events.length}
            testID="planner-month"
          />
        )}
        {view === 'month' ? (
          <View style={styles.nav}>
            <Button size="sm" variant="secondary" icon="chevron-left" label={t('nav.prevMonth')} onPress={() => setMonth(addMonths(month, -1))} />
            <Button size="sm" variant="secondary" iconRight="chevron-right" label={t('nav.nextMonth')} onPress={() => setMonth(addMonths(month, 1))} />
          </View>
        ) : null}
      </ScrollView>

      <Sheet
        visible={!!selectedDay}
        onClose={() => setSelectedDay(null)}
        title={selectedDay ? capitalize(formatLongDate(selectedDay)) : undefined}
        testID="planner-day-sheet"
      >
        {selectedDay ? (
          <DayContent
            date={selectedDay}
            day={byDate.get(selectedDay)}
            {...handlers}
            onOpen={(p) => {
              setSelectedDay(null);
              handlers.onOpen(p);
            }}
            onAddEvent={(d) => {
              setSelectedDay(null);
              handlers.onAddEvent(d);
            }}
          />
        ) : null}
      </Sheet>

      <OutfitPickerSheet
        visible={!!planFor}
        onClose={() => setPlanFor(null)}
        subtitle={planFor ? capitalize(formatLongDate(planFor)) : undefined}
        onPick={(outfit) => {
          const date = planFor;
          if (!date) return;
          createPlan.mutate(
            { date, outfitId: outfit.id, position: byDate.get(date)?.plans.length ?? 0 },
            {
              onSuccess: () => toast.show({ message: t('plan.plannedToast', { date: formatLongDate(date) }), tone: 'success' }),
              onError: (e) => toast.show({ message: errorMessage(e), tone: 'error' }),
            },
          );
        }}
        testID="planner-outfit-picker"
      />

      <MoveSheet plan={moving} onClose={() => setMoving(null)} onMove={move} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.huge, gap: space.lg },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  navTitle: { flex: 1, textAlign: 'center' },
  toolbar: { flexDirection: 'row', gap: space.sm, justifyContent: 'flex-end', flexWrap: 'wrap' },
});
