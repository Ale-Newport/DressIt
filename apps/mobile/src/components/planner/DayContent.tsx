import type { CalendarEventDto, PlanDto, PlannerDayDto } from '@dressit/shared';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { formatTime } from '@/lib/format';
import { occasionLabel } from '@/lib/vocab';
import { radius, space, useTheme } from '@/theme';

import { Badge, Button, Icon, Text } from '../ui';
import { PlanCard, type PlanCardProps } from './PlanCard';

export interface DayContentProps {
  date: string;
  day: PlannerDayDto | undefined;
  drag?: PlanCardProps['drag'];
  onOpen: (plan: PlanDto) => void;
  onMoveTo: (plan: PlanDto) => void;
  onRemove: (plan: PlanDto) => void;
  onPlan: (date: string) => void;
  onAddEvent: (date: string) => void;
}

export function EventRow({ event }: { event: CalendarEventDto }) {
  const { colors } = useTheme();
  const { t } = useTranslation('planner');
  const time = isAllDay(event) ? t('day.allDay') : `${safeTime(event.startsAt)}${event.endsAt ? `–${safeTime(event.endsAt)}` : ''}`;
  const parts = [time, event.title, event.occasion ? occasionLabel(event.occasion) : null, event.locationName].filter(Boolean);
  return (
    <View style={[styles.event, { backgroundColor: colors.infoSoft }]} accessible accessibilityLabel={parts.join(', ')} testID={`planner-event-${event.id}`}>
      <Icon name={event.isOutdoor ? 'sun' : 'calendar'} size={14} color={colors.info} />
      <Text variant="caption" color={colors.info} style={{ flex: 1 }} numberOfLines={2}>
        {time} · {event.title}
        {event.occasion ? ` · ${occasionLabel(event.occasion)}` : ''}
      </Text>
    </View>
  );
}

function isAllDay(e: CalendarEventDto): boolean {
  return /T00:00(:00)?/.test(e.startsAt) && (!e.endsAt || /T00:00(:00)?/.test(e.endsAt) || /T23:59/.test(e.endsAt));
}

function safeTime(iso: string): string {
  try {
    return formatTime(iso);
  } catch {
    return iso.slice(11, 16);
  }
}

/** Events, planned outfits and conflicts for a single day. */
export function DayContent({ date, day, drag, onOpen, onMoveTo, onRemove, onPlan, onAddEvent }: DayContentProps) {
  const { t } = useTranslation('planner');
  const plans = [...(day?.plans ?? [])].sort((a, b) => a.position - b.position);
  const events = day?.events ?? [];
  const conflicts = day?.conflicts ?? [];
  const orphanConflicts = conflicts.filter((c) => !plans.some((p) => p.id === c.planId));
  return (
    <View style={{ gap: space.sm }}>
      {events.map((e) => (
        <EventRow key={e.id} event={e} />
      ))}
      {plans.map((p) => {
        const planConflicts = conflicts.filter((c) => c.planId === p.id);
        return (
          <View key={p.id} style={{ gap: 4 }}>
            <PlanCard plan={p} conflictCount={planConflicts.length} drag={drag} onOpen={onOpen} onMoveTo={onMoveTo} onRemove={onRemove} />
            {planConflicts.map((c, i) => (
              <Badge key={`${c.garmentId}-${i}`} tone="warning" icon="alert-triangle" label={`${t(`conflicts.${c.kind}`)}: ${c.message}`} testID={`planner-conflict-${p.id}-${i}`} />
            ))}
          </View>
        );
      })}
      {orphanConflicts.map((c, i) => (
        <Badge key={`orphan-${i}`} tone="warning" icon="alert-triangle" label={c.message} />
      ))}
      {plans.length === 0 && events.length === 0 ? (
        <Text variant="small" tone="subtle">
          {t('day.nothing')}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Button size="sm" variant="secondary" icon="plus" label={t('day.plan')} accessibilityHint={t('day.planHint')} onPress={() => onPlan(date)} testID={`planner-plan-${date}`} />
        <Button size="sm" variant="ghost" icon="calendar" label={t('day.addEvent')} accessibilityHint={t('day.addEventHint')} onPress={() => onAddEvent(date)} testID={`planner-event-add-${date}`} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  event: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.sm, paddingVertical: 6, borderRadius: radius.sm },
  actions: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
});
