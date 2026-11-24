import type { CalendarEventDto, PlanDto } from '@dressit/shared';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Badge, Button, Card, Divider, Icon, OutfitCanvas, SectionHeader, Text } from '@/components/ui';
import { toISODate } from '@/lib/dates';
import { capitalize, formatLongDate, formatTime } from '@/lib/format';
import { occasionLabel } from '@/lib/vocab';
import { radius, space, useTheme } from '@/theme';

/** "Plan de hoy": the outfit planned for today (→ outfit detail). */
export function TodayPlanCard({ plan }: { plan: PlanDto }) {
  const { t } = useTranslation('home');
  const router = useRouter();
  const open = () => router.push({ pathname: '/outfit/[id]', params: { id: plan.outfit.id } });
  return (
    <Card onPress={open} accessibilityLabel={`${t('plan.overline')}: ${plan.outfit.name ?? occasionLabel(plan.outfit.occasion)}`} accessibilityHint={t('plan.open')} testID="home-today-plan">
      <View style={styles.planRow}>
        <View style={styles.planCanvas}>
          <OutfitCanvas items={plan.outfit.items} layout={plan.outfit.layout} aspectRatio={1} testID="home-today-plan-canvas" />
        </View>
        <View style={{ flex: 1, gap: space.xs }}>
          <Text variant="overline" tone="accent">
            {t('plan.overline')}
          </Text>
          <Text variant="subheading" numberOfLines={2}>
            {plan.outfit.name ?? (plan.outfit.occasion ? occasionLabel(plan.outfit.occasion) : t('plan.title'))}
          </Text>
          {plan.event ? (
            <Text variant="small" tone="muted" numberOfLines={1}>
              {t('plan.forEvent', { title: plan.event.title })}
            </Text>
          ) : null}
          {plan.note ? (
            <Text variant="small" tone="muted" numberOfLines={2}>
              {plan.note}
            </Text>
          ) : null}
        </View>
        <Icon name="chevron-right" size={18} />
      </View>
    </Card>
  );
}

function describeWhen(e: CalendarEventDto): string {
  const day = capitalize(formatLongDate(toISODate(new Date(e.startsAt))));
  const start = formatTime(e.startsAt);
  return e.endsAt ? `${day} · ${start}–${formatTime(e.endsAt)}` : `${day} · ${start}`;
}

/** Upcoming events (from the API) with entry points to create one and to the planner. */
export function UpcomingEvents({ events }: { events: CalendarEventDto[] }) {
  const { t } = useTranslation('home');
  const router = useRouter();
  const { colors } = useTheme();
  return (
    <View testID="home-events">
      <SectionHeader
        overline={t('events.overline')}
        title={t('events.title')}
        action={<Button label={t('events.add')} size="sm" variant="secondary" icon="plus" onPress={() => router.push('/events/new')} testID="home-events-add" />}
      />
      {events.length === 0 ? (
        <Text variant="small" tone="muted">
          {t('events.empty')}
        </Text>
      ) : (
        <View style={[styles.eventsBox, { borderColor: colors.line }]}>
          {events.slice(0, 4).map((e, i) => {
            const when = describeWhen(e);
            return (
              <View key={e.id}>
                {i > 0 ? <Divider /> : null}
                <Pressable
                  onPress={() => router.push('/planner')}
                  accessibilityRole="button"
                  accessibilityLabel={t('events.eventA11y', { title: e.title, when })}
                  accessibilityHint={t('events.planner')}
                  style={({ pressed }) => [styles.event, { opacity: pressed ? 0.6 : 1 }]}
                  testID={`home-event-${e.id}`}
                >
                  <View style={[styles.eventDot, { backgroundColor: colors.accent }]} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="bodyStrong" numberOfLines={1}>
                      {e.title}
                    </Text>
                    <Text variant="small" tone="muted" numberOfLines={1}>
                      {when}
                      {e.locationName ? ` · ${e.locationName}` : ''}
                    </Text>
                  </View>
                  <View style={styles.eventBadges}>
                    {e.occasion ? <Badge label={occasionLabel(e.occasion)} /> : null}
                    {e.isOutdoor !== null ? <Badge label={e.isOutdoor ? t('events.outdoor') : t('events.indoor')} tone="info" /> : null}
                  </View>
                </Pressable>
              </View>
            );
          })}
        </View>
      )}
      <Button label={t('events.planner')} variant="ghost" iconRight="arrow-right" onPress={() => router.push('/planner')} style={{ alignSelf: 'flex-start' }} testID="home-events-planner" />
    </View>
  );
}

/** Banner when photo imports are waiting for the user's review. */
export function PendingReviewsBanner({ count }: { count: number }) {
  const { t } = useTranslation('home');
  const router = useRouter();
  const { colors } = useTheme();
  return (
    <Card tone="accent" onPress={() => router.push('/capture/imports')} accessibilityLabel={t('reviews.title', { count })} accessibilityHint={t('reviews.body')} testID="home-pending-reviews">
      <View style={styles.bannerRow}>
        <Icon name="inbox" size={22} color={colors.accent} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong">{t('reviews.title', { count })}</Text>
          <Text variant="small" tone="muted">
            {t('reviews.body')}
          </Text>
        </View>
        <Text variant="smallStrong" tone="accent">
          {t('reviews.action')}
        </Text>
      </View>
    </Card>
  );
}

/** Entry point to the conversational stylist. */
export function AssistantEntry() {
  const { t } = useTranslation('home');
  const router = useRouter();
  const { colors } = useTheme();
  return (
    <Card tone="inverse" onPress={() => router.push('/assistant')} accessibilityLabel={t('assistant.title')} accessibilityHint={t('assistant.hint')} testID="home-assistant-entry">
      <View style={styles.bannerRow}>
        <View style={[styles.assistantIcon, { borderColor: colors.inkInverse }]}>
          <Icon name="message-circle" size={20} color={colors.inkInverse} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="subheading" color={colors.inkInverse}>
            {t('assistant.title')}
          </Text>
          <Text variant="small" color={colors.inkInverse} style={{ opacity: 0.8 }}>
            {t('assistant.body')}
          </Text>
        </View>
        <Icon name="arrow-right" size={18} color={colors.inkInverse} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  planRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  planCanvas: { width: 92 },
  eventsBox: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, paddingHorizontal: space.lg },
  event: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 60, paddingVertical: space.sm },
  eventDot: { width: 6, height: 6, borderRadius: 3 },
  eventBadges: { alignItems: 'flex-end', gap: 4 },
  bannerRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  assistantIcon: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
