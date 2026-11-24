import type { PlanDto } from '@dressit/shared';
import { Pressable, StyleSheet, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import { useTranslation } from 'react-i18next';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { outfitTitle } from '@/components/outfits/OutfitThumb';
import { formatLongDate } from '@/lib/format';
import { elevation, radius, space, useTheme } from '@/theme';

import { IconButton, OutfitCanvas, Text } from '../ui';

export interface PlanCardProps {
  plan: PlanDto;
  conflictCount?: number;
  /** Drag & drop handlers (week view). Omit to render a static card. */
  drag?: {
    onStart: (plan: PlanDto) => void;
    onMove: (absoluteX: number, absoluteY: number) => void;
    onEnd: (plan: PlanDto, absoluteX: number, absoluteY: number, canceled: boolean) => void;
  };
  onOpen: (plan: PlanDto) => void;
  onMoveTo: (plan: PlanDto) => void;
  onRemove: (plan: PlanDto) => void;
}

/**
 * Planned outfit. Long-press then drag to move it to another day (week view);
 * screen-reader users get the same through the "Mover a…" accessibility action
 * and the visible menu button.
 */
export function PlanCard({ plan, conflictCount = 0, drag, onOpen, onMoveTo, onRemove }: PlanCardProps) {
  const { colors, reduceMotion } = useTheme();
  const { t } = useTranslation('planner');
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const lifted = useSharedValue(0);
  const title = outfitTitle(plan.outfit);

  const pan = usePanGesture({
    enabled: !!drag,
    activateAfterLongPress: 280,
    runOnJS: true,
    onActivate: () => {
      lifted.value = reduceMotion ? 1 : withTiming(1, { duration: 120 });
      drag?.onStart(plan);
    },
    onUpdate: (e) => {
      tx.value = e.translationX;
      ty.value = e.translationY;
      drag?.onMove(e.absoluteX, e.absoluteY);
    },
    onDeactivate: (e) => {
      drag?.onEnd(plan, e.absoluteX, e.absoluteY, e.canceled);
    },
    onFinalize: () => {
      tx.value = reduceMotion ? 0 : withSpring(0, { damping: 20, stiffness: 220 });
      ty.value = reduceMotion ? 0 : withSpring(0, { damping: 20, stiffness: 220 });
      lifted.value = reduceMotion ? 0 : withTiming(0, { duration: 120 });
    },
  });

  const animated = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: reduceMotion ? 1 : 1 + lifted.value * 0.04 }],
    zIndex: lifted.value > 0 ? 100 : 0,
    shadowOpacity: lifted.value * 0.18,
  }));

  const card = (
    <Animated.View style={[styles.card, elevation.card, { backgroundColor: colors.surface, borderColor: colors.line }, animated]}>
      <Pressable
        onPress={() => onOpen(plan)}
        accessibilityRole="button"
        accessibilityLabel={t('plan.a11y', { name: title, date: formatLongDate(plan.date) })}
        accessibilityHint={drag ? t('plan.a11yHint') : undefined}
        accessibilityActions={[
          { name: 'activate', label: t('plan.open') },
          { name: 'move', label: t('plan.moveTo') },
          { name: 'remove', label: t('plan.remove') },
        ]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'move') onMoveTo(plan);
          else if (e.nativeEvent.actionName === 'remove') onRemove(plan);
          else onOpen(plan);
        }}
        testID={`plan-card-${plan.id}`}
        style={styles.main}
      >
        <View style={styles.canvas}>
          <OutfitCanvas items={plan.outfit.items} accessibilityLabel="" testID={`plan-card-${plan.id}-canvas`} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="smallStrong" numberOfLines={2}>
            {title}
          </Text>
          {plan.event ? (
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {plan.event.title}
            </Text>
          ) : null}
          {plan.note ? (
            <Text variant="caption" tone="muted" numberOfLines={2}>
              {plan.note}
            </Text>
          ) : null}
          {conflictCount > 0 ? (
            <Text variant="caption" tone="warning">
              {conflictCount === 1 ? '1 aviso' : `${conflictCount} avisos`}
            </Text>
          ) : null}
        </View>
      </Pressable>
      <View style={styles.side}>
        <IconButton icon="move" label={t('plan.moveTo')} size={18} onPress={() => onMoveTo(plan)} testID={`plan-card-${plan.id}-move`} />
        <IconButton icon="x" label={t('plan.remove')} size={18} onPress={() => onRemove(plan)} testID={`plan-card-${plan.id}-remove`} />
      </View>
    </Animated.View>
  );

  return drag ? <GestureDetector gesture={pan}>{card}</GestureDetector> : card;
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, padding: space.sm, gap: space.xs },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md },
  canvas: { width: 64 },
  side: { alignItems: 'center' },
});
