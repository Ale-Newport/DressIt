import type { GarmentDetailDto } from '@dressit/shared';
import { File, Paths } from 'expo-file-system';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useUpdateGarment } from '@/api/hooks';
import { errorMessage } from '@/api/client';
import { Button, Card, Icon, Text, useToast } from '@/components/ui';
import { describeGarmentPhoto, intelligenceStatus } from '@/lib/intelligence';
import { subcategoryLabel } from '@/lib/vocab';
import { space, useTheme } from '@/theme';

/**
 * "Describe with Apple Intelligence": the on-device model looks at the garment's own photo and
 * suggests a natural name and a one-line description. Nothing is saved until the user chooses
 * to; the photo never leaves the phone for this. Only shown where the model accepts images
 * (iOS 27+ with Apple Intelligence).
 */
export function OnDeviceDescription({ garment }: { garment: GarmentDetailDto }) {
  const { colors } = useTheme();
  const toast = useToast();
  const update = useUpdateGarment(garment.id);
  const [busy, setBusy] = useState(false);
  const [suggestion, setSuggestion] = useState<{ name: string; summary: string } | null>(null);
  const image = garment.image;
  if (!image || !intelligenceStatus().vision) return null;

  const describe = async () => {
    setBusy(true);
    try {
      const local = await File.downloadFileAsync(image.url, new File(Paths.cache, `describe-${image.id}.${image.isCutout ? 'png' : 'jpg'}`), { idempotent: true });
      const out = await describeGarmentPhoto(local.uri, subcategoryLabel(garment.subcategory));
      if (out) setSuggestion(out);
      else toast.show({ message: 'Apple Intelligence no ha podido describir esta foto.', tone: 'error' });
    } catch (e) {
      toast.show({ message: errorMessage(e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const save = (patch: { name?: string; notes?: string }) =>
    update.mutate(patch, {
      onSuccess: () => toast.show({ message: 'Guardado.', tone: 'success' }),
      onError: (e) => toast.show({ message: errorMessage(e), tone: 'error' }),
    });

  return (
    <Card testID="garment-ondevice-description">
      <View style={styles.header}>
        <Icon name="cpu" size={14} color={colors.inkMuted} />
        <Text variant="overline" tone="muted">
          Apple Intelligence
        </Text>
      </View>
      {suggestion ? (
        <View style={{ gap: space.sm }}>
          <Text variant="subheading">{suggestion.name}</Text>
          <Text variant="body">{suggestion.summary}</Text>
          <Text variant="caption" tone="subtle">
            Sugerencia generada en tu iPhone a partir de la foto. Revísala antes de guardarla.
          </Text>
          <View style={styles.actions}>
            <Button label="Usar como nombre" size="sm" variant="secondary" onPress={() => save({ name: suggestion.name.slice(0, 120) })} loading={update.isPending} testID="ondevice-use-name" />
            <Button
              label="Guardar en notas"
              size="sm"
              variant="secondary"
              onPress={() => save({ notes: [garment.notes, suggestion.summary].filter(Boolean).join('\n').slice(0, 2000) })}
              loading={update.isPending}
              testID="ondevice-save-notes"
            />
          </View>
        </View>
      ) : (
        <View style={{ gap: space.sm }}>
          <Text variant="small" tone="muted">
            Pide a la IA de tu iPhone un nombre y una descripción a partir de la foto. Se procesa en el dispositivo.
          </Text>
          <Button label="Describir con Apple Intelligence" icon="cpu" size="sm" variant="secondary" onPress={describe} loading={busy} testID="ondevice-describe" />
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginBottom: space.xs },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
