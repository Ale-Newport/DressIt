import type { PlanDto } from '@dressit/shared';
import { useTranslation } from 'react-i18next';

import { MonthCalendar } from '@/components/DateField';
import { outfitTitle } from '@/components/outfits/OutfitThumb';
import { addDays, startOfWeek } from '@/lib/dates';
import { capitalize, formatLongDate } from '@/lib/format';

import { ChipGroup, Sheet, Text } from '../ui';

export interface MoveSheetProps {
  plan: PlanDto | null;
  onClose: () => void;
  onMove: (plan: PlanDto, date: string) => void;
}

/** Accessible alternative to drag & drop: choose the target day. */
export function MoveSheet({ plan, onClose, onMove }: MoveSheetProps) {
  const { t } = useTranslation('planner');
  if (!plan) return null;
  const weekStart = startOfWeek(plan.date);
  const week = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).filter((d) => d !== plan.date);
  const pick = (date: string) => {
    onMove(plan, date);
    onClose();
  };
  return (
    <Sheet visible onClose={onClose} title={t('plan.moveTitle')} subtitle={outfitTitle(plan.outfit)} testID="planner-move-sheet">
      <Text variant="smallStrong">{capitalize(formatLongDate(plan.date))}</Text>
      <ChipGroup
        options={week.map((d) => ({ id: d, label: capitalize(formatLongDate(d)) }))}
        value={null}
        onChange={(v) => typeof v === 'string' && pick(v)}
        testIDPrefix="planner-move"
        accessibilityLabel={t('plan.moveTitle')}
      />
      <MonthCalendar value={plan.date} onChange={(d) => d !== plan.date && pick(d)} testID="planner-move-calendar" />
    </Sheet>
  );
}
