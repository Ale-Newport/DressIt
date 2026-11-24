import type { GarmentDetailDto } from '@dressit/shared';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Linking, StyleSheet, View } from 'react-native';

import { errorMessage } from '@/api/client';
import { useAddOfficialPhoto, useOfficialPhotos } from '@/api/hooks';
import { Button, Card, Icon, Text, useToast } from '@/components/ui';
import { radius, space, useTheme } from '@/theme';

/**
 * Photo tools on the garment detail: correct the cutout by hand, and — when a connected store
 * sells this very garment (visual similarity ≥ 0.9) — add its official photo to the gallery
 * (kept next to the user's own photos, never replacing them).
 */
export function GarmentPhotoTools({ garment }: { garment: GarmentDetailDto }) {
  const { colors } = useTheme();
  const toast = useToast();
  const router = useRouter();
  const hasOriginal = garment.images.some((i) => !i.isCutout && !i.generatedBy && i.license === 'user_owned');
  const official = useOfficialPhotos(garment.id, !garment.isDemo);
  const add = useAddOfficialPhoto(garment.id);
  const added = new Set(garment.images.filter((i) => i.license === 'retailer_licensed').map((i) => i.attribution));
  const matches = official.data?.matches ?? [];

  return (
    <Card testID="garment-photo-tools">
      <View style={styles.header}>
        <Icon name="image" size={16} color={colors.inkMuted} />
        <Text variant="overline" tone="muted">
          Fotos de la prenda
        </Text>
      </View>
      <View style={{ gap: space.md }}>
        {hasOriginal ? (
          <View style={{ gap: space.xs }}>
            <Text variant="small" tone="muted">
              ¿El recorte incluye una mano, la percha u otra prenda, o le falta un trozo? Corrígelo marcando puntos en tu foto.
            </Text>
            <Button label="Corregir recorte" size="sm" variant="secondary" icon="scissors" onPress={() => router.push({ pathname: '/garment/recut', params: { garmentId: garment.id } })} testID="garment-recut" />
          </View>
        ) : null}
        {matches.length ? (
          <View style={{ gap: space.sm }} testID="official-photos">
            <Text variant="smallStrong">Foto oficial de la tienda</Text>
            {matches.slice(0, 3).map((m) => {
              const attribution = `Foto oficial de ${m.retailer}`;
              const isAdded = added.has(attribution);
              return (
                <View key={m.productId} style={styles.match} testID={`official-${m.productId}`}>
                  <Image source={{ uri: m.imageUrl }} style={[styles.thumb, { backgroundColor: colors.surfaceAlt }]} contentFit="contain" accessible={false} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="small" numberOfLines={2}>
                      {m.title}
                    </Text>
                    <Text variant="caption" tone="muted">
                      {m.retailer} · parecido {Math.round(m.similarity * 100)} %
                    </Text>
                    <View style={styles.row}>
                      <Button
                        label={isAdded ? 'Añadida' : 'Añadir a la galería'}
                        size="sm"
                        variant="ghost"
                        icon={isAdded ? 'check' : 'plus'}
                        disabled={isAdded}
                        loading={add.isPending && add.variables === m.productId}
                        onPress={() =>
                          add.mutate(m.productId, {
                            onSuccess: () => toast.show({ message: 'Foto oficial añadida. Tus fotos se conservan.', tone: 'success' }),
                            onError: (e) => toast.show({ message: errorMessage(e), tone: 'error' }),
                          })
                        }
                        testID={`official-add-${m.productId}`}
                      />
                      {m.url ? <Button label="Ver en la tienda" size="sm" variant="ghost" onPress={() => Linking.openURL(m.url!)} /> : null}
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        ) : official.data?.message ? (
          <Text variant="caption" tone="muted" testID="official-message">
            {official.data.message}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginBottom: space.sm },
  match: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  thumb: { width: 64, height: 80, borderRadius: radius.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
});
