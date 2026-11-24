import type { TripDto } from '@dressit/shared';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { errorMessage } from '@/api/client';
import { useDeleteTrip, useTrips } from '@/api/hooks';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  IconButton,
  OfflineBanner,
  Screen,
  SkeletonList,
  Text,
  useToast,
} from '@/components/ui';
import { formatShortDate } from '@/lib/format';
import { space } from '@/theme';

export default function TripsScreen() {
  const { t } = useTranslation('planner');
  const router = useRouter();
  const toast = useToast();
  const query = useTrips();
  const del = useDeleteTrip();
  const [toDelete, setToDelete] = useState<TripDto | null>(null);

  return (
    <Screen
      refreshing={query.isRefetching}
      onRefresh={() => query.refetch()}
      testID="trips-screen"
      footer={<Button label={t('trips.new')} icon="plus" fullWidth onPress={() => router.push('/trips/new')} testID="trips-new" />}
    >
      <Stack.Screen options={{ title: t('trips.title') }} />
      <OfflineBanner />
      {query.data === undefined ? (
        query.isError ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : (
          <SkeletonList rows={4} />
        )
      ) : query.data.length === 0 ? (
        <EmptyState
          icon="briefcase"
          title={t('trips.emptyTitle')}
          body={t('trips.emptyBody')}
          actionLabel={t('trips.new')}
          onAction={() => router.push('/trips/new')}
          testID="trips-empty"
        />
      ) : (
        [...query.data]
          .sort((a, b) => a.startDate.localeCompare(b.startDate))
          .map((trip) => (
            <Card
              key={trip.id}
              onPress={() => router.push({ pathname: '/trips/[id]', params: { id: trip.id } })}
              accessibilityLabel={`${trip.destinationName}, ${t('trips.dates', { from: formatShortDate(trip.startDate), to: formatShortDate(trip.endDate) })}`}
              testID={`trip-${trip.id}`}
            >
              <View style={styles.row}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text variant="heading">{trip.destinationName}</Text>
                  <Text variant="small" tone="muted">
                    {t('trips.dates', { from: formatShortDate(trip.startDate), to: formatShortDate(trip.endDate) })}
                  </Text>
                  <View style={styles.badges}>
                    <Badge label={t(`trips.luggage.${trip.luggage}`)} icon="briefcase" />
                    <Badge label={t('trips.capsuleCount', { count: trip.capsule.length })} />
                  </View>
                </View>
                <IconButton icon="trash-2" label={`${t('trips.delete')}: ${trip.destinationName}`} onPress={() => setToDelete(trip)} testID={`trip-${trip.id}-delete`} />
              </View>
            </Card>
          ))
      )}
      <ConfirmDialog
        visible={!!toDelete}
        title={t('trips.deleteTitle')}
        message={t('trips.deleteBody')}
        destructive
        confirmLabel={t('trips.delete')}
        loading={del.isPending}
        error={del.isError ? errorMessage(del.error) : null}
        onCancel={() => setToDelete(null)}
        onConfirm={() =>
          toDelete &&
          del.mutate(toDelete.id, {
            onSuccess: () => {
              setToDelete(null);
              toast.show({ message: t('trips.deleted'), tone: 'success' });
            },
          })
        }
        testID="trip-delete-dialog"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.xs },
});
