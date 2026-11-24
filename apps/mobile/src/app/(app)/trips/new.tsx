import type { GeoSearchResult, TripRequest } from '@dressit/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { errorMessage } from '@/api/client';
import { useCreateTrip, useGeoSearch } from '@/api/hooks';
import { DateField } from '@/components/DateField';
import { useDebounced } from '@/components/outfits/useDebounced';
import {
  Button,
  Chip,
  ChipGroup,
  ErrorState,
  ListRow,
  OfflineBanner,
  Screen,
  Text,
  TextField,
} from '@/components/ui';
import { today } from '@/lib/dates';
import { options } from '@/lib/vocab';
import { space, useTheme } from '@/theme';

const LUGGAGE: TripRequest['luggage'][] = ['mochila', 'cabina', 'mediana', 'grande'];

export default function NewTripScreen() {
  const { t } = useTranslation('planner');
  const { colors } = useTheme();
  const router = useRouter();
  const create = useCreateTrip();

  const [search, setSearch] = useState('');
  const [destination, setDestination] = useState<GeoSearchResult | null>(null);
  const [startDate, setStartDate] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string | null>(null);
  const [activities, setActivities] = useState<string[]>([]);
  const [custom, setCustom] = useState<string[]>([]);
  const [customText, setCustomText] = useState('');
  const [luggage, setLuggage] = useState<TripRequest['luggage']>('cabina');
  const [submitted, setSubmitted] = useState(false);

  const q = useDebounced(search, 350);
  const geo = useGeoSearch(destination ? '' : q);

  const formError = !destination
    ? t('trips.form.missingDestination')
    : !startDate || !endDate
      ? t('trips.form.missingDates')
      : endDate < startDate
        ? t('trips.form.invalidDates')
        : null;

  const submit = () => {
    setSubmitted(true);
    if (formError || !destination || !startDate || !endDate) return;
    create.mutate(
      {
        destinationName: [destination.name, destination.admin1].filter(Boolean).join(', '),
        lat: destination.lat,
        lon: destination.lon,
        startDate,
        endDate,
        activities: [...activities, ...custom],
        luggage,
      },
      { onSuccess: (trip) => router.replace({ pathname: '/trips/[id]', params: { id: trip.id } }) },
    );
  };

  const addCustom = () => {
    const v = customText.trim();
    if (!v || custom.includes(v)) return;
    setCustom((c) => [...c, v]);
    setCustomText('');
  };

  return (
    <Screen
      testID="trip-new-screen"
      footer={
        <View style={{ gap: space.sm }}>
          {submitted && formError ? (
            <Text variant="small" tone="danger" accessibilityLiveRegion="polite">
              {formError}
            </Text>
          ) : null}
          {create.isError ? (
            <Text variant="small" tone="danger" accessibilityLiveRegion="polite">
              {errorMessage(create.error)}
            </Text>
          ) : null}
          <Button
            label={create.isPending ? t('trips.form.submitting') : t('trips.form.submit')}
            icon="briefcase"
            fullWidth
            loading={create.isPending}
            onPress={submit}
            testID="trip-new-submit"
          />
        </View>
      }
    >
      <OfflineBanner />
      <View style={{ gap: space.sm }}>
        {destination ? (
          <>
            <Text variant="smallStrong">{t('trips.form.selected')}</Text>
            <ListRow
              icon="map-pin"
              title={destination.name}
              subtitle={[destination.admin1, destination.country].filter(Boolean).join(', ')}
              right={<Button size="sm" variant="ghost" label={t('trips.form.changeDestination')} onPress={() => setDestination(null)} />}
              testID="trip-new-destination-selected"
            />
          </>
        ) : (
          <>
            <TextField
              label={t('trips.form.destination')}
              placeholder={t('trips.form.destinationPlaceholder')}
              hint={t('trips.form.destinationHint')}
              icon="search"
              value={search}
              onChangeText={setSearch}
              onClear={() => setSearch('')}
              autoCorrect={false}
              returnKeyType="search"
              testID="trip-new-destination"
            />
            {q.trim().length >= 2 ? (
              geo.isFetching && !geo.data ? (
                <View style={styles.inline}>
                  <ActivityIndicator color={colors.inkMuted} />
                  <Text variant="small" tone="muted">
                    {t('trips.form.searching')}
                  </Text>
                </View>
              ) : geo.isError ? (
                <ErrorState error={geo.error} onRetry={() => geo.refetch()} compact />
              ) : geo.data && geo.data.length === 0 ? (
                <Text variant="small" tone="muted">
                  {t('trips.form.noResults')}
                </Text>
              ) : (
                (geo.data ?? []).slice(0, 8).map((r, i) => (
                  <ListRow
                    key={`${r.name}-${r.lat}-${r.lon}-${i}`}
                    icon="map-pin"
                    title={r.name}
                    subtitle={[r.admin1, r.country].filter(Boolean).join(', ')}
                    onPress={() => {
                      setDestination(r);
                      setSearch('');
                    }}
                    testID={`trip-new-geo-${i}`}
                  />
                ))
              )
            ) : null}
          </>
        )}
      </View>

      <DateField
        label={t('trips.form.start')}
        value={startDate}
        min={today()}
        onChange={(d) => {
          setStartDate(d);
          if (endDate && endDate < d) setEndDate(d);
        }}
        testID="trip-new-start"
      />
      <DateField label={t('trips.form.end')} value={endDate} min={startDate ?? today()} onChange={setEndDate} testID="trip-new-end" />

      <View style={{ gap: space.sm }}>
        <Text variant="smallStrong">{t('trips.form.activities')}</Text>
        <Text variant="small" tone="muted">
          {t('trips.form.activitiesHint')}
        </Text>
        <ChipGroup
          options={options.occasions}
          value={activities}
          onChange={(v) => setActivities((v as string[]) ?? [])}
          multiple
          testIDPrefix="trip-new-activity"
          accessibilityLabel={t('trips.form.activities')}
        />
        {custom.length ? (
          <View style={styles.chips}>
            {custom.map((c) => (
              <Chip key={c} label={c} icon="x" selected onPress={() => setCustom((prev) => prev.filter((x) => x !== c))} accessibilityHint="Quitar" />
            ))}
          </View>
        ) : null}
        <View style={styles.inline}>
          <TextField
            containerStyle={{ flex: 1 }}
            placeholder={t('trips.form.customActivityPlaceholder')}
            accessibilityLabel={t('trips.form.customActivity')}
            value={customText}
            onChangeText={setCustomText}
            onSubmitEditing={addCustom}
            returnKeyType="done"
            testID="trip-new-custom-activity"
          />
          <Button size="sm" variant="secondary" label={t('trips.form.addActivity')} onPress={addCustom} disabled={!customText.trim()} />
        </View>
      </View>

      <View style={{ gap: space.sm }}>
        <Text variant="smallStrong">{t('trips.form.luggage')}</Text>
        <ChipGroup
          options={LUGGAGE.map((id) => ({ id, label: t(`trips.luggage.${id}`) }))}
          value={luggage}
          onChange={(v) => v && setLuggage(v as TripRequest['luggage'])}
          allowDeselect={false}
          testIDPrefix="trip-new-luggage"
          accessibilityLabel={t('trips.form.luggage')}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  inline: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
