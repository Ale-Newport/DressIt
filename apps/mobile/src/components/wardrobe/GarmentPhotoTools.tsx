import type { GarmentDetailDto } from '@dressit/shared';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button, Card, Icon, Text } from '@/components/ui';
import { space, useTheme } from '@/theme';

/**
 * Photo tools on the garment detail: correct the cutout by hand (points on the original photo).
 * The official store photo and the AI packshot live in CatalogPhotoCard.
 */
export function GarmentPhotoTools({ garment }: { garment: GarmentDetailDto }) {
  const { colors } = useTheme();
  const router = useRouter();
  const hasOriginal = garment.images.some((i) => !i.isCutout && !i.generatedBy && i.license === 'user_owned');
  if (!hasOriginal) return null;
  return (
    <Card testID="garment-photo-tools">
      <View style={styles.header}>
        <Icon name="image" size={16} color={colors.inkMuted} />
        <Text variant="overline" tone="muted">
          Recorte de la prenda
        </Text>
      </View>
      <View style={{ gap: space.xs }}>
        <Text variant="small" tone="muted">
          ¿El recorte incluye una mano, la percha u otra prenda, o le falta un trozo? Corrígelo marcando puntos en tu foto.
        </Text>
        <Button label="Corregir recorte" size="sm" variant="secondary" icon="scissors" onPress={() => router.push({ pathname: '/garment/recut', params: { garmentId: garment.id } })} testID="garment-recut" />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginBottom: space.sm },
});
