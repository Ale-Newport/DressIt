import type { TripDto } from '@dressit/shared';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { errorMessage } from '@/api/client';
import { useDeleteTrip, useTogglePacked, useTrip } from '@/api/hooks';
import { OutfitThumb } from '@/components/outfits/OutfitThumb';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Divider,
  ErrorState,
  GarmentTile,
  Icon,
  OfflineBanner,
  ProgressBar,
  Screen,
  SectionHeader,
  SkeletonCard,
  Text,
  useToast,
} from '@/components/ui';
import { capitalize, formatLongDate, formatShortDate } from '@/lib/format';
import { occasionLabel, subcategoryLabel } from '@/lib/vocab';
import { radius, space, touchTarget, useTheme } from '@/theme';

export default function TripDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useTrip(id);
  if (query.data === undefined) {
    return (
      <Screen testID="trip-detail-screen">
        {query.isError ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : <SkeletonCard height={200} />}
      </Screen>
    );
  }
  return <TripDetail trip={query.data} refreshing={query.isRefetching} onRefresh={() => query.refetch()} />;
}

function TripDetail({ trip, refreshing, onRefresh }: { trip: TripDto; refreshing: boolean; onRefresh: () => void }) {
  const { t } = useTranslation('planner');
  const router = useRouter();
  const toast = useToast();
  const toggle = useTogglePacked(trip.id);
  const del = useDeleteTrip();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const packed = trip.packingList.filter((p) => p.packed).length;
  const total = trip.packingList.length;

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh} testID="trip-detail-screen">
      <Stack.Screen options={{ title: trip.destinationName }} />
      <OfflineBanner />
      <View style={{ gap: space.xs }}>
        <Text variant="overline" tone="muted">
          {t('trips.dates', { from: formatShortDate(trip.startDate), to: formatShortDate(trip.endDate) })}
        </Text>
        <Text variant="title">{trip.destinationName}</Text>
        <View style={styles.badges}>
          <Badge label={t(`trips.luggage.${trip.luggage}`)} icon="briefcase" />
          <Badge label={t('trips.detail.maxItems', { count: trip.maxItems })} />
          {trip.activities.map((a) => (
            <Badge key={a} label={occasionLabel(a)} tone="info" />
          ))}
        </View>
      </View>

      <Card tone="sunken">
        <View style={{ gap: space.sm }}>
          <View style={styles.inline}>
            <Icon name={trip.weatherAvailable ? 'cloud' : 'cloud-off'} size={18} />
            <Text variant="subheading">{t('trips.detail.weather')}</Text>
          </View>
          <Text variant="body" tone={trip.weatherAvailable ? 'default' : 'muted'}>
            {trip.weatherAvailable && trip.weatherSummary ? trip.weatherSummary : t('trips.detail.noWeather')}
          </Text>
        </View>
      </Card>

      {trip.warnings.length ? (
        <View style={{ gap: space.xs }}>
          <Text variant="smallStrong">{t('trips.detail.warnings')}</Text>
          {trip.warnings.map((w, i) => (
            <Badge key={i} tone="warning" icon="alert-triangle" label={w} />
          ))}
        </View>
      ) : null}

      <View>
        <SectionHeader overline={`${trip.capsule.length}`} title={t('trips.detail.capsule')} />
        <View style={styles.grid}>
          {trip.capsule.map((g) => (
            <View key={g.id} style={styles.cell}>
              <GarmentTile garment={g} onPress={() => router.push({ pathname: '/garment/[id]', params: { id: g.id } })} />
            </View>
          ))}
        </View>
      </View>

      <View style={{ gap: space.sm }}>
        <SectionHeader title={t('trips.detail.packing')} />
        <Text variant="small" tone="muted">
          {t('trips.detail.packed', { packed, total })}
        </Text>
        <ProgressBar value={total ? packed / total : 0} label={t('trips.detail.packed', { packed, total })} testID="trip-packing-progress" />
        {trip.packingList.map((item, i) => (
          <View key={item.garment.id}>
            {i > 0 ? <Divider /> : null}
            <PackingRow
              name={item.garment.name || subcategoryLabel(item.garment.subcategory)}
              quantity={item.quantity}
              packed={item.packed}
              onToggle={() =>
                toggle.mutate(
                  { garmentId: item.garment.id, packed: !item.packed },
                  { onError: (e) => toast.show({ message: errorMessage(e), tone: 'error' }) },
                )
              }
              testID={`trip-pack-${item.garment.id}`}
            />
          </View>
        ))}
      </View>

      {trip.extras.length ? (
        <View style={{ gap: space.xs }}>
          <SectionHeader title={t('trips.detail.extras')} />
          {trip.extras.map((e, i) => (
            <Text key={i} variant="body">
              — {e}
            </Text>
          ))}
        </View>
      ) : null}

      <View style={{ gap: space.lg }}>
        <SectionHeader title={t('trips.detail.days')} />
        {trip.days.map((day) => (
          <View key={day.date} style={styles.day} testID={`trip-day-${day.date}`}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="subheading">{capitalize(formatLongDate(day.date))}</Text>
              <Text variant="small" tone="muted">
                {occasionLabel(day.occasion)}
              </Text>
              {day.weather ? (
                <Text variant="small" tone="muted">
                  {day.weather}
                </Text>
              ) : null}
            </View>
            <View style={styles.dayOutfit}>
              {day.outfit ? (
                <OutfitThumb outfit={day.outfit} showScore={false} onPress={() => router.push({ pathname: '/outfit/[id]', params: { id: day.outfit!.id } })} />
              ) : (
                <Text variant="small" tone="subtle">
                  {t('trips.detail.noOutfit')}
                </Text>
              )}
            </View>
          </View>
        ))}
      </View>

      <Button label={t('trips.delete')} icon="trash-2" variant="danger" onPress={() => setConfirmDelete(true)} testID="trip-delete" />
      <ConfirmDialog
        visible={confirmDelete}
        title={t('trips.deleteTitle')}
        message={t('trips.deleteBody')}
        destructive
        confirmLabel={t('trips.delete')}
        loading={del.isPending}
        error={del.isError ? errorMessage(del.error) : null}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() =>
          del.mutate(trip.id, {
            onSuccess: () => {
              setConfirmDelete(false);
              toast.show({ message: t('trips.deleted'), tone: 'success' });
              if (router.canGoBack()) router.back();
              else router.replace('/trips');
            },
          })
        }
        testID="trip-delete-dialog"
      />
    </Screen>
  );
}

function PackingRow({ name, quantity, packed, onToggle, testID }: { name: string; quantity: number; packed: boolean; onToggle: () => void; testID: string }) {
  const { colors } = useTheme();
  const { t } = useTranslation('planner');
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: packed }}
      accessibilityLabel={`${name}${quantity > 1 ? `, ${t('trips.detail.quantity', { count: quantity })}` : ''}`}
      accessibilityHint={packed ? t('trips.detail.markUnpacked') : t('trips.detail.markPacked')}
      testID={testID}
      style={({ pressed }) => [styles.packRow, { opacity: pressed ? 0.6 : 1 }]}
    >
      <View style={[styles.checkbox, { borderColor: packed ? colors.accent : colors.lineStrong, backgroundColor: packed ? colors.accent : 'transparent' }]}>
        {packed ? <Icon name="check" size={14} color={colors.accentInk} /> : null}
      </View>
      <Text variant="body" tone={packed ? 'muted' : 'default'} style={[{ flex: 1 }, packed && styles.strike]}>
        {name}
      </Text>
      {quantity > 1 ? (
        <Text variant="smallStrong" tone="muted">
          {t('trips.detail.quantity', { count: quantity })}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.xs },
  inline: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  cell: { width: '30%' },
  packRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: touchTarget + 4 },
  checkbox: { width: 22, height: 22, borderRadius: radius.xs, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  strike: { textDecorationLine: 'line-through' },
  day: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  dayOutfit: { width: '42%' },
});
