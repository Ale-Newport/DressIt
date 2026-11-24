import type { DeviceCalendarSyncRequest } from '@dressit/shared';
import * as Calendar from 'expo-calendar';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { PermissionsAndroid, Platform, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { errorMessage } from '@/api/client';
import { isConsentGranted, useConsents, useSetConsent } from '@/api/hooks/me';
import { useEvents, useSyncDeviceCalendar } from '@/api/hooks/planner';
import { Badge, Button, Card, Divider, EmptyState, ErrorState, ListRow, OfflineBanner, PermissionPrompt, Screen, SectionHeader, SkeletonList, Text, useToast } from '@/components/ui';
import { addDays, today } from '@/lib/dates';
import { formatDateTime } from '@/lib/format';
import { space } from '@/theme';

type PermState = { status: 'undetermined' | 'denied' | 'granted'; canAskAgain: boolean };

const SYNC_DAYS = 14;

/**
 * Read-only calendar permission. On Android we request READ_CALENDAR only
 * (WRITE_CALENDAR is blocked in app.config.ts); expo-calendar's own request
 * would ask for both.
 */
async function getCalendarPermission(request: boolean): Promise<PermState> {
  if (Platform.OS === 'android') {
    const perm = PermissionsAndroid.PERMISSIONS.READ_CALENDAR;
    if (await PermissionsAndroid.check(perm)) return { status: 'granted', canAskAgain: true };
    if (!request) return { status: 'undetermined', canAskAgain: true };
    const res = await PermissionsAndroid.request(perm);
    if (res === PermissionsAndroid.RESULTS.GRANTED) return { status: 'granted', canAskAgain: true };
    return { status: 'denied', canAskAgain: res !== PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN };
  }
  const res = request ? await Calendar.requestCalendarPermissions() : await Calendar.getCalendarPermissions();
  return { status: res.granted ? 'granted' : res.status === 'denied' ? 'denied' : 'undetermined', canAskAgain: res.canAskAgain };
}

function toIso(d: string | Date): string {
  return (d instanceof Date ? d : new Date(d)).toISOString();
}

export default function CalendarScreen() {
  const { t } = useTranslation('profile');
  const router = useRouter();
  const toast = useToast();
  const consents = useConsents();
  const setConsent = useSetConsent();
  const sync = useSyncDeviceCalendar();
  const from = today();
  const to = addDays(from, SYNC_DAYS);
  const events = useEvents(from, to);
  const [perm, setPerm] = useState<PermState | null>(null);
  const [reading, setReading] = useState(false);
  const consent = isConsentGranted(consents.data, 'calendar');

  useEffect(() => {
    getCalendarPermission(false).then(setPerm).catch(() => setPerm({ status: 'undetermined', canAskAgain: true }));
  }, []);

  const request = async () => setPerm(await getCalendarPermission(true));

  const doSync = async () => {
    setReading(true);
    try {
      const calendars = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
      if (!calendars.length) {
        toast.show({ message: t('calendar.noCalendars') });
        return;
      }
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date(start.getTime() + SYNC_DAYS * 86_400_000);
      const list = await Calendar.listEvents(calendars, start, end);
      // Data minimisation: never send notes, attendees, alarms or URLs.
      const body: DeviceCalendarSyncRequest = {
        events: list.map((e) => ({
          externalId: e.id,
          title: e.title,
          startsAt: toIso(e.startDate),
          endsAt: e.endDate ? toIso(e.endDate) : null,
          allDay: !!e.allDay,
          locationName: e.location || null,
        })),
        rangeStart: start.toISOString(),
        rangeEnd: end.toISOString(),
      };
      sync.mutate(body, {
        onSuccess: (r) => toast.show({ message: t('calendar.synced', { upserted: r.upserted, removed: r.removed }), tone: 'success' }),
        onError: (e) => toast.show({ message: errorMessage(e), tone: 'error' }),
      });
    } catch (e) {
      toast.show({ message: e instanceof Error ? e.message : String(e), tone: 'error' });
    } finally {
      setReading(false);
    }
  };

  return (
    <Screen testID="calendar-screen" refreshing={events.isRefetching} onRefresh={() => events.refetch()}>
      <OfflineBanner />
      <Text variant="body" tone="muted">
        {t('calendar.intro')}
      </Text>
      <Badge label={t('calendar.readOnly')} icon="lock" tone="info" />

      {!consent ? (
        <Card tone="sunken">
          <View style={{ gap: space.sm }}>
            <Text variant="body">{t('calendar.consentNeeded')}</Text>
            <Button
              label={t('calendar.enableConsent')}
              variant="secondary"
              loading={setConsent.isPending}
              onPress={() => setConsent.mutate({ kind: 'calendar', granted: true }, { onError: (e) => toast.show({ message: errorMessage(e), tone: 'error' }) })}
              testID="calendar-consent"
            />
          </View>
        </Card>
      ) : perm?.status !== 'granted' ? (
        <PermissionPrompt kind="calendar" status={perm?.status ?? 'undetermined'} canAskAgain={perm?.canAskAgain ?? true} onRequest={request} />
      ) : (
        <Button
          label={reading || sync.isPending ? t('calendar.syncing') : t('calendar.sync')}
          icon="refresh-cw"
          onPress={doSync}
          loading={reading || sync.isPending}
          testID="calendar-sync"
        />
      )}

      <View>
        <SectionHeader title={t('calendar.upcoming')} action={<Button label={t('calendar.addManual')} size="sm" variant="ghost" icon="plus" onPress={() => router.push('/events/new')} />} />
        {events.isPending ? (
          <SkeletonList rows={3} />
        ) : events.isError && !events.data ? (
          <ErrorState error={events.error} onRetry={() => events.refetch()} compact />
        ) : !events.data?.length ? (
          <EmptyState compact icon="calendar" title={t('calendar.noEvents')} />
        ) : (
          events.data.map((e, i) => (
            <View key={e.id}>
              {i > 0 ? <Divider /> : null}
              <ListRow title={e.title} subtitle={[formatDateTime(e.startsAt), e.locationName].filter(Boolean).join(' · ')} value={t(`calendar.sources.${e.source}`)} />
            </View>
          ))
        )}
      </View>
    </Screen>
  );
}
