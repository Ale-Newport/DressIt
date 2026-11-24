import type { PlanDto, PlannerDayDto } from '@dressit/shared';
import { useCallback, useRef, useState } from 'react';
import { AccessibilityInfo, type HostInstance, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { today } from '@/lib/dates';
import { capitalize, formatLongDate } from '@/lib/format';
import { hairline, radius, space, useTheme } from '@/theme';

import { Badge, Text } from '../ui';
import { DayContent, type DayContentProps } from './DayContent';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WeekPlannerProps extends Pick<DayContentProps, 'onOpen' | 'onMoveTo' | 'onRemove' | 'onPlan' | 'onAddEvent'> {
  days: string[];
  byDate: Map<string, PlannerDayDto>;
  /** Called when a plan is dropped on another day. */
  onDrop: (plan: PlanDto, date: string) => void;
  /** Lets the parent disable scrolling while a card is being dragged. */
  onDraggingChange?: (dragging: boolean) => void;
}

/**
 * Week (Mon–Sun) as stacked day rows. Plan cards can be long-pressed and dragged
 * onto another day; day rows are measured in window coordinates when a drag starts.
 */
export function WeekPlanner({ days, byDate, onDrop, onDraggingChange, ...handlers }: WeekPlannerProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('planner');
  const rowRefs = useRef(new Map<string, HostInstance | null>());
  const rects = useRef(new Map<string, Rect>());
  const [draggingFrom, setDraggingFrom] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const hoverRef = useRef<string | null>(null);
  const todayDate = today();

  const hitTest = useCallback((y: number): string | null => {
    for (const [date, r] of rects.current) {
      if (y >= r.y && y <= r.y + r.h) return date;
    }
    return null;
  }, []);

  const drag = {
    onStart: (plan: PlanDto) => {
      rects.current.clear();
      for (const [date, el] of rowRefs.current) {
        el?.measureInWindow((x, y, w, h) => rects.current.set(date, { x, y, w, h }));
      }
      setDraggingFrom(plan.date);
      onDraggingChange?.(true);
      AccessibilityInfo.announceForAccessibility(t('plan.dragging'));
    },
    onMove: (_x: number, y: number) => {
      const target = hitTest(y);
      if (target !== hoverRef.current) {
        hoverRef.current = target;
        setHover(target);
      }
    },
    onEnd: (plan: PlanDto, _x: number, y: number, canceled: boolean) => {
      const target = hitTest(y);
      hoverRef.current = null;
      setHover(null);
      setDraggingFrom(null);
      onDraggingChange?.(false);
      if (!canceled && target && target !== plan.date) onDrop(plan, target);
    },
  };

  return (
    <View style={{ gap: space.sm }} testID="week-planner">
      {days.map((date) => {
        const day = byDate.get(date);
        const isHover = hover === date && draggingFrom !== null && hover !== draggingFrom;
        return (
          <View
            key={date}
            ref={(el) => {
              rowRefs.current.set(date, el);
            }}
            collapsable={false}
            testID={`planner-day-${date}`}
            style={[
              styles.row,
              {
                borderColor: isHover ? colors.accent : colors.line,
                backgroundColor: isHover ? colors.accentSoft : colors.background,
                zIndex: draggingFrom === date ? 10 : 0,
              },
            ]}
          >
            <View style={styles.head}>
              <Text variant="subheading" accessibilityRole="header" style={{ flex: 1 }}>
                {capitalize(formatLongDate(date))}
              </Text>
              {date === todayDate ? <Badge label="Hoy" tone="inverse" /> : null}
              {isHover ? (
                <Text variant="caption" tone="accent">
                  {t('plan.dropHere')}
                </Text>
              ) : null}
            </View>
            <DayContent date={date} day={day} drag={drag} {...handlers} />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { borderWidth: hairline, borderRadius: radius.lg, padding: space.md, gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
