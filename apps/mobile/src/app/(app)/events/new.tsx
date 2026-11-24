import type { CalendarEventWrite } from '@dressit/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { errorMessage } from '@/api/client';
import { useCreateEvent } from '@/api/hooks';
import { DateField, TimeField } from '@/components/DateField';
import { Button, ChipGroup, ListRow, OfflineBanner, Screen, Text, TextField, useToast } from '@/components/ui';
import { hhmmToMinutes, parseISODate, today } from '@/lib/dates';
import { options } from '@/lib/vocab';
import { space } from '@/theme';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Local date + `HH:MM` → ISO-8601 timestamp (with the device's offset applied). */
function toIso(date: string, hhmm: string): string {
  const d = parseISODate(date);
  const minutes = hhmmToMinutes(hhmm);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d.toISOString();
}

export default function NewEventScreen() {
  const { t } = useTranslation('home');
  const router = useRouter();
  const toast = useToast();
  const params = useLocalSearchParams<{ date?: string }>();
  const create = useCreateEvent();

  const [title, setTitle] = useState('');
  const [occasion, setOccasion] = useState<string | null>(null);
  const [date, setDate] = useState<string>(params.date && DATE_RE.test(params.date) ? params.date : today());
  const [start, setStart] = useState('09:00');
  const [hasEnd, setHasEnd] = useState(true);
  const [end, setEnd] = useState('10:00');
  const [outdoor, setOutdoor] = useState(false);
  const [location, setLocation] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const titleError = submitted && !title.trim() ? t('newEvent.nameRequired') : null;
  const endError = hasEnd && hhmmToMinutes(end) <= hhmmToMinutes(start) ? t('newEvent.endBeforeStart') : null;

  const save = () => {
    setSubmitted(true);
    if (!title.trim() || endError) return;
    const body: CalendarEventWrite = {
      title: title.trim(),
      occasion,
      startsAt: toIso(date, start),
      endsAt: hasEnd ? toIso(date, end) : null,
      isOutdoor: outdoor,
      locationName: location.trim() || null,
    };
    create.mutate(body, {
      onSuccess: () => {
        toast.show({ message: t('newEvent.saved'), tone: 'success' });
        router.back();
      },
    });
  };

  return (
    <Screen
      testID="event-new-screen"
      footer={
        <>
          {create.isError ? (
            <Text variant="small" tone="danger" accessibilityLiveRegion="polite">
              {errorMessage(create.error)}
            </Text>
          ) : null}
          <Button label={t('newEvent.save')} onPress={save} loading={create.isPending} fullWidth testID="event-new-save" />
        </>
      }
    >
      <View style={{ height: space.sm }} />
      <OfflineBanner />
      <TextField
        label={t('newEvent.name')}
        placeholder={t('newEvent.namePlaceholder')}
        value={title}
        onChangeText={setTitle}
        error={titleError}
        autoFocus
        returnKeyType="next"
        maxLength={120}
        testID="event-new-title"
      />
      <View style={{ gap: space.sm }}>
        <Text variant="smallStrong">{t('newEvent.occasion')}</Text>
        <Text variant="small" tone="muted">
          {t('newEvent.occasionHint')}
        </Text>
        <ChipGroup
          options={options.occasions}
          value={occasion}
          onChange={(v) => setOccasion(typeof v === 'string' ? v : null)}
          testIDPrefix="event-new-occasion"
          accessibilityLabel={t('newEvent.occasion')}
        />
      </View>
      <DateField label={t('newEvent.date')} value={date} onChange={setDate} min={today()} testID="event-new-date" />
      <View style={{ flexDirection: 'row', gap: space.md }}>
        <View style={{ flex: 1 }}>
          <TimeField label={t('newEvent.start')} value={start} onChange={setStart} testID="event-new-start" />
        </View>
        {hasEnd ? (
          <View style={{ flex: 1 }}>
            <TimeField label={t('newEvent.end')} value={end} onChange={setEnd} testID="event-new-end" />
          </View>
        ) : null}
      </View>
      {endError ? (
        <Text variant="small" tone="danger" accessibilityLiveRegion="polite">
          {endError}
        </Text>
      ) : null}
      <View>
        <ListRow title={t('newEvent.hasEnd')} switchValue={hasEnd} onSwitchChange={setHasEnd} testID="event-new-has-end" />
        <ListRow
          title={t('newEvent.outdoor')}
          subtitle={t('newEvent.outdoorHint')}
          switchValue={outdoor}
          onSwitchChange={setOutdoor}
          accessibilityHint={t('newEvent.outdoorHint')}
          testID="event-new-outdoor"
        />
      </View>
      <TextField
        label={t('newEvent.location')}
        placeholder={t('newEvent.locationPlaceholder')}
        value={location}
        onChangeText={setLocation}
        maxLength={120}
        testID="event-new-location"
      />
      <Text variant="caption" tone="muted">
        {t('newEvent.privacy')}
      </Text>
    </Screen>
  );
}
