import type { OutfitDto } from '@dressit/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { errorMessage } from '@/api/client';
import { useAvatarJobs, useAvatarProfile, useCreateAvatarRender, useGenerationStatus } from '@/api/hooks';
import { Button, Card, ChipGroup, CutoutImage, Icon, OutfitCanvas, ProgressBar, Text, useToast } from '@/components/ui';
import { baseLabel, METHOD_LABEL, progressText, progressValue } from '@/lib/avatar';
import { radius, space, useTheme } from '@/theme';

const ACTIVE = new Set(['queued', 'running']);
type Method = 'sequential' | 'joint';

/**
 * "Verme con este conjunto": a photo of the user wearing exactly this outfit, made from a saved
 * avatar image (their own full-body photo on a studio background, or a generated view).
 *
 * - Probador (sequential): a dedicated try-on model dresses one garment at a time (bottom, top
 *   layers, jacket), then shoes and one accessory; each step is cached, so changing one garment
 *   only redoes what comes after it.
 * - Una sola pasada (joint): one generative pass with the outfit.
 *
 * The server checks every visible garment in the result (colour and appearance) and discards
 * renders that changed them; every render is labelled as AI-generated.
 */
export function AvatarRenderCard({ outfit }: { outfit: OutfitDto }) {
  const { colors } = useTheme();
  const toast = useToast();
  const router = useRouter();
  const status = useGenerationStatus();
  const profile = useAvatarProfile();
  const jobs = useAvatarJobs(outfit.id, !!status.data?.avatar);
  const create = useCreateAvatarRender(outfit.id);
  const [baseId, setBaseId] = useState<string | null>(null);
  const [method, setMethod] = useState<Method | null>(null);
  if (!status.data?.avatar) return null;
  const latest = jobs.data?.[0];
  const running = latest && ACTIVE.has(latest.status);
  const done = jobs.data?.find((j) => j.status === 'done' && j.result);
  const hasGarments = outfit.items.some((i) => i.garment?.image);
  const bases = (profile.data?.bases ?? []).filter((b) => b.status === 'ready');
  const methods: Method[] = [...(status.data.tryon ? (['sequential'] as const) : []), ...(profile.data?.face ? (['joint'] as const) : [])];
  const chosenMethod: Method = method ?? methods[0] ?? 'sequential';
  const bodyReady = !!(profile.data?.body && profile.data.attestedSelf && profile.data.attestedAdult);

  const start = () =>
    create.mutate(
      { method: chosenMethod, ...(chosenMethod === 'sequential' && baseId ? { baseId } : {}) },
      { onError: (e) => toast.show({ message: errorMessage(e), tone: 'error' }) },
    );

  return (
    <Card testID="avatar-render-card">
      <View style={styles.header}>
        <Icon name="user" size={16} color={colors.inkMuted} />
        <Text variant="overline" tone="muted">
          Tu avatar
        </Text>
      </View>
      {!bodyReady ? (
        <View style={{ gap: space.sm }}>
          <Text variant="small" tone="muted">
            Añade una foto tuya de cuerpo entero para verte con tus conjuntos.
          </Text>
          <Button label="Configurar tu avatar" size="sm" variant="secondary" icon="user" onPress={() => router.push('/profile/avatar')} testID="avatar-render-setup" />
        </View>
      ) : running ? (
        <View style={{ gap: space.sm }} testID="avatar-render-running">
          <Text variant="body" testID="avatar-render-progress">
            {progressText(latest!)}
          </Text>
          <ProgressBar value={progressValue(latest!)} testID="avatar-render-progress-bar" />
          <Text variant="caption" tone="muted">
            {latest!.method === 'sequential' ? 'Cada prenda tarda 1–2 minutos. Puedes salir: seguirá en el servidor.' : 'Suele tardar 2–5 minutos. Puedes salir: seguirá en el servidor.'}
          </Text>
        </View>
      ) : (
        <View style={{ gap: space.md }}>
          {done?.result ? (
            <View style={styles.compare}>
              <View style={[styles.render, { backgroundColor: colors.surfaceAlt }]}>
                <CutoutImage image={done.result} variant="full" testID="avatar-render-result" />
              </View>
              <View style={styles.outfitCol}>
                <OutfitCanvas items={outfit.items} aspectRatio={3 / 4} accessibilityLabel="Tu conjunto real, para comparar" testID="avatar-render-outfit" />
                <Text variant="caption" tone="muted">
                  Tu conjunto real
                </Text>
              </View>
            </View>
          ) : null}
          {latest && (latest.status === 'rejected' || latest.status === 'failed') ? (
            <Text variant="small" tone="warning" testID="avatar-render-error">
              {latest.status === 'rejected' ? `Descartada: ${latest.error ?? 'no reflejaba bien tus prendas.'}` : (latest.error ?? 'No se ha podido generar.')}
            </Text>
          ) : null}
          {done?.result ? (
            <Text variant="caption" tone="muted">
              Imagen generada con IA{done.method ? ` (${METHOD_LABEL[done.method].toLowerCase()})` : ''}: orientativa. Compárala con tu conjunto: tallas y caída pueden variar.
            </Text>
          ) : null}
          {methods.length > 1 ? (
            <View style={{ gap: space.xs }}>
              <Text variant="caption" tone="muted">
                Cómo generarla
              </Text>
              <ChipGroup
                options={methods.map((m) => ({ id: m, label: METHOD_LABEL[m] }))}
                value={chosenMethod}
                onChange={(v) => v && setMethod(v as Method)}
                allowDeselect={false}
                testIDPrefix="avatar-render-method"
                accessibilityLabel="Cómo generar la imagen"
              />
            </View>
          ) : null}
          {chosenMethod === 'sequential' && bases.length > 1 ? (
            <View style={{ gap: space.xs }}>
              <Text variant="caption" tone="muted">
                Imagen de tu avatar
              </Text>
              <ChipGroup
                options={bases.map((b) => ({ id: b.id, label: baseLabel(b) }))}
                value={baseId ?? bases[0]!.id}
                onChange={(v) => typeof v === 'string' && setBaseId(v)}
                allowDeselect={false}
                scroll
                testIDPrefix="avatar-render-base"
                accessibilityLabel="Imagen de tu avatar"
              />
            </View>
          ) : null}
          <Button
            label={done ? 'Generar otra' : 'Verme con este conjunto'}
            size="sm"
            variant={done ? 'ghost' : 'secondary'}
            icon="user"
            disabled={!hasGarments || methods.length === 0}
            onPress={start}
            loading={create.isPending}
            testID="avatar-render-create"
          />
          {methods.length === 0 ? (
            <Text variant="caption" tone="muted">
              El probador no está disponible ahora mismo.
            </Text>
          ) : null}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginBottom: space.sm },
  compare: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  render: { flex: 1.4, aspectRatio: 3 / 4, borderRadius: radius.md, overflow: 'hidden' },
  outfitCol: { flex: 1, gap: space.xs },
});
