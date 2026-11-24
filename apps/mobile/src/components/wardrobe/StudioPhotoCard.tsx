import type { GarmentDetailDto, GenerationJobDto } from '@dressit/shared';
import { useRouter } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { errorMessage } from '@/api/client';
import { useConsents, useCreateStudio, useGenerationStatus, useSetConsent, useSetPrimaryImage, useStudioJobs } from '@/api/hooks';
import { Button, Card, CutoutImage, Icon, Text, useToast } from '@/components/ui';
import { radius, space, useTheme } from '@/theme';

const ACTIVE = new Set(['queued', 'running']);

/**
 * "Foto de estudio con IA": the server generates a studio-quality, background-free photo from the
 * garment's own cutout (Qwen-Image-Edit / FLUX.2 klein via ComfyUI) and keeps it only if it still
 * looks like the real garment (same type, colour and appearance). The user compares it with the
 * real photo and decides whether to use it. Hidden when the generator isn't available.
 */
export function StudioPhotoCard({ garment }: { garment: GarmentDetailDto }) {
  const { colors } = useTheme();
  const toast = useToast();
  const router = useRouter();
  const status = useGenerationStatus();
  const consents = useConsents();
  const setConsent = useSetConsent();
  const jobs = useStudioJobs(garment.id);
  const create = useCreateStudio(garment.id);
  const setPrimary = useSetPrimaryImage(garment.id);
  if (!status.data?.studio) return null;
  const granted = consents.data?.find((c) => c.kind === 'ai_image_generation')?.granted ?? false;
  const latest: GenerationJobDto | undefined = jobs.data?.[0];
  const running = latest && ACTIVE.has(latest.status);
  const done = latest?.status === 'done' && latest.result ? latest : jobs.data?.find((j) => j.status === 'done' && j.result);
  const inUse = done?.result && garment.image?.id === done.result.id;

  const start = () =>
    create.mutate(undefined, {
      onError: (e) => toast.show({ message: errorMessage(e), tone: 'error' }),
    });

  return (
    <Card testID="studio-card">
      <View style={styles.header}>
        <Icon name="aperture" size={16} color={colors.inkMuted} />
        <Text variant="overline" tone="muted">
          Foto de estudio con IA
        </Text>
      </View>

      {!granted ? (
        <View style={{ gap: space.sm }}>
          <Text variant="small" tone="muted">
            Convierte la foto de esta prenda en una foto de estudio sin fondo. Se genera en nuestros servidores con un modelo de imagen y se marca como generada con IA.
          </Text>
          <Button label="Permitir imágenes con IA" size="sm" variant="secondary" onPress={() => setConsent.mutate({ kind: 'ai_image_generation', granted: true })} loading={setConsent.isPending} testID="studio-consent" />
          <Button label="Más información" size="sm" variant="ghost" onPress={() => router.push('/profile/consents')} />
        </View>
      ) : running ? (
        <View style={{ gap: space.sm }} testID="studio-running">
          <Text variant="body">{latest!.status === 'queued' ? 'En cola…' : 'Generando la foto de estudio…'}</Text>
          <ActivityIndicator color={colors.inkMuted} style={{ alignSelf: 'flex-start' }} />
          <Text variant="caption" tone="muted">
            Suele tardar 1–3 minutos. Puedes salir: seguirá en el servidor.
          </Text>
        </View>
      ) : (
        <View style={{ gap: space.md }}>
          {done?.result && garment.image ? (
            <View style={styles.compare}>
              <View style={styles.side}>
                <View style={[styles.frame, { backgroundColor: colors.surfaceAlt }]}>
                  <CutoutImage image={{ ...garment.images.find((i) => i.isCutout && !i.generatedBy) ?? garment.image, generatedBy: null }} variant="full" inset={0.06} />
                </View>
                <Text variant="caption" tone="muted">
                  Tu foto
                </Text>
              </View>
              <View style={styles.side}>
                <View style={[styles.frame, { backgroundColor: colors.surfaceAlt }]}>
                  <CutoutImage image={done.result} variant="full" inset={0.06} testID="studio-result" />
                </View>
                <Text variant="caption" tone="muted">
                  Estudio
                </Text>
              </View>
            </View>
          ) : (
            <Text variant="small" tone="muted">
              Crea una versión de estudio, sin fondo y con luz uniforme, de esta prenda. Solo se guarda si sigue pareciéndose a tu prenda real.
            </Text>
          )}
          {latest && (latest.status === 'rejected' || latest.status === 'failed') ? (
            <Text variant="small" tone="warning" testID="studio-error">
              {latest.status === 'rejected' ? `Descartada: ${latest.error ?? 'no se parecía a tu prenda.'}` : (latest.error ?? 'No se ha podido generar.')}
            </Text>
          ) : null}
          <View style={styles.actions}>
            {done?.result && !inUse ? (
              <Button
                label="Usar como foto principal"
                size="sm"
                onPress={() => setPrimary.mutate(done.result!.id, { onError: (e) => toast.show({ message: errorMessage(e), tone: 'error' }) })}
                loading={setPrimary.isPending}
                testID="studio-use"
              />
            ) : null}
            {inUse ? (
              <Button
                label="Volver a mi foto"
                size="sm"
                variant="secondary"
                onPress={() => {
                  const real = garment.images.find((i) => i.isCutout && !i.generatedBy);
                  if (real) setPrimary.mutate(real.id);
                }}
                testID="studio-revert"
              />
            ) : null}
            <Button label={done ? 'Generar otra' : 'Crear foto de estudio'} size="sm" variant={done ? 'ghost' : 'secondary'} icon="aperture" onPress={start} loading={create.isPending} testID="studio-create" />
          </View>
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginBottom: space.sm },
  compare: { flexDirection: 'row', gap: space.md },
  side: { flex: 1, gap: space.xs, alignItems: 'center' },
  frame: { width: '100%', aspectRatio: 4 / 5, borderRadius: radius.md, overflow: 'hidden' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
