import type { UserDto } from '@dressit/shared';
import * as Location from 'expo-location';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { errorMessage } from '@/api/client';
import { roundCoord, useGeoSearch, useSetConsent, useSetLocation } from '@/api/hooks/me';
import { useDebounced } from '@/components/outfits/useDebounced';
import { Button, Divider, ErrorState, ListRow, PermissionPrompt, Text, TextField, useToast } from '@/components/ui';
import { space, useTheme } from '@/theme';

export interface CityPickerProps {
  currentName?: string | null;
  onSaved?: (user: UserDto) => void;
}

type PermState = { status: 'undetermined' | 'denied' | 'granted'; canAskAgain: boolean } | null;

/**
 * City selection: search via `/v1/geo/search`, or approximate device location.
 * The coordinates are rounded to 2 decimals and reverse-geocoded on the device
 * BEFORE anything is sent; only the rounded values reach the API.
 */
export function CityPicker({ currentName, onSaved }: CityPickerProps) {
  const { t } = useTranslation('profile');
  const { colors } = useTheme();
  const toast = useToast();
  const [q, setQ] = useState('');
  const debounced = useDebounced(q, 350);
  const search = useGeoSearch(debounced);
  const setLocation = useSetLocation();
  const setConsent = useSetConsent();
  const [perm, setPerm] = useState<PermState>(null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);

  const save = (name: string, lat: number, lon: number, countryCode: string) =>
    setLocation.mutate(
      { name, lat, lon, countryCode },
      {
        onSuccess: (user) => {
          toast.show({ message: t('city.saved', { name }), tone: 'success' });
          setQ('');
          onSaved?.(user);
        },
        onError: (e) => toast.show({ message: errorMessage(e), tone: 'error' }),
      },
    );

  const locateApprox = async () => {
    setLocError(null);
    const current = await Location.getForegroundPermissionsAsync();
    let granted = current.granted;
    if (!granted) {
      if (!current.canAskAgain && current.status === 'denied') {
        setPerm({ status: 'denied', canAskAgain: false });
        return;
      }
      const res = await Location.requestForegroundPermissionsAsync();
      granted = res.granted;
      if (!granted) {
        setPerm({ status: 'denied', canAskAgain: res.canAskAgain });
        return;
      }
    }
    setPerm({ status: 'granted', canAskAgain: true });
    setLocating(true);
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Lowest });
      const lat = roundCoord(pos.coords.latitude);
      const lon = roundCoord(pos.coords.longitude);
      // Reverse geocoding uses the platform geocoder with the already-rounded coordinates.
      const [place] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon });
      const name = place?.city ?? place?.subregion ?? place?.region ?? `${lat}, ${lon}`;
      const countryCode = place?.isoCountryCode ?? 'ES';
      setConsent.mutate({ kind: 'location', granted: true });
      save(name, lat, lon, countryCode);
    } catch {
      setLocError(t('city.locationError'));
    } finally {
      setLocating(false);
    }
  };

  return (
    <View style={styles.wrap} testID="city-picker">
      {currentName ? (
        <ListRow icon="map-pin" title={t('city.current')} value={currentName} />
      ) : null}
      <TextField
        label={t('city.search')}
        placeholder={t('city.searchPlaceholder')}
        value={q}
        onChangeText={setQ}
        icon="search"
        autoCorrect={false}
        onClear={() => setQ('')}
        testID="city-search"
      />
      {debounced.trim().length >= 2 ? (
        search.isPending ? (
          <ActivityIndicator color={colors.inkMuted} accessibilityLabel="Buscando" />
        ) : search.isError ? (
          <ErrorState error={search.error} onRetry={() => search.refetch()} compact />
        ) : search.data && search.data.length === 0 ? (
          <Text variant="small" tone="muted">
            {t('city.noResults')}
          </Text>
        ) : (
          <View>
            {search.data?.map((r, i) => (
              <View key={`${r.name}-${r.lat}-${r.lon}`}>
                {i > 0 ? <Divider /> : null}
                <ListRow
                  title={r.name}
                  subtitle={[r.admin1, r.country].filter(Boolean).join(', ')}
                  onPress={() => save(r.name, r.lat, r.lon, r.countryCode ?? 'ES')}
                  testID={`city-result-${i}`}
                />
              </View>
            ))}
          </View>
        )
      ) : null}

      <Divider />
      <Text variant="small" tone="muted">
        {t('city.approxExplain')}
      </Text>
      {perm && perm.status === 'denied' ? (
        <PermissionPrompt kind="location" status="denied" canAskAgain={perm.canAskAgain} onRequest={locateApprox} compact />
      ) : (
        <Button
          label={locating ? t('city.locating') : t('city.useApprox')}
          icon="navigation"
          variant="secondary"
          onPress={locateApprox}
          loading={locating || setLocation.isPending}
          testID="city-use-approx"
        />
      )}
      {locError ? (
        <Text variant="small" tone="danger" accessibilityRole="alert">
          {locError}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
});
