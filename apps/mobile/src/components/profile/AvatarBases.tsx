import type { AvatarBackground, AvatarProfileDto, AvatarView } from '@dressit/shared';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { errorMessage } from '@/api/client';
import { useCreateAvatarBase, useGenerationStatus } from '@/api/hooks';
import { Button, ChipGroup, CutoutImage, Text, useToast } from '@/components/ui';
import { BACKGROUND_LABEL, BACKGROUND_SWATCH, baseLabel, VIEW_LABEL } from '@/lib/avatar';
import { radius, space, useTheme } from '@/theme';

const BACKGROUNDS: AvatarBackground[] = ['estudio_gris', 'blanco', 'beige', 'original'];
const VIEWS: AvatarView[] = ['frontal', 'tres_cuartos', 'perfil'];

/**
 * The user's saved avatar images, reused by every try-on: "De frente" is their own photo cut out
 * on the chosen background (nothing generated); other views are generated once from it and
 * labelled as AI.
 */
export function AvatarBases({ profile }: { profile: AvatarProfileDto }) {
  const { colors } = useTheme();
  const toast = useToast();
  const status = useGenerationStatus();
  const create = useCreateAvatarBase();
  const [background, setBackground] = useState<AvatarBackground>('estudio_gris');
  const [view, setView] = useState<AvatarView>('frontal');
  const views = status.data?.available ? VIEWS : (['frontal'] as AvatarView[]);
  // `bases` may be missing in a profile cached from an older server version.
  const bases = profile.bases ?? [];
  const exists = bases.find((b) => b.view === view && b.background === background && b.status !== 'failed');

  return (
    <View style={{ gap: space.md }} testID="avatar-bases">
      <View style={{ gap: space.xs }}>
        <Text variant="smallStrong">Imágenes de tu avatar</Text>
        <Text variant="caption" tone="muted">
          Se guardan y se reutilizan en cada prueba: no tendrás que volver a subir fotos. «De frente» es tu propia foto sobre el fondo elegido; las otras vistas se generan con IA.
        </Text>
      </View>
      {bases.length ? (
        <View style={styles.grid}>
          {bases.map((b) => (
            <View key={b.id} style={styles.cell} testID={`avatar-base-${b.view}-${b.background}`}>
              <View style={[styles.frame, { backgroundColor: colors.surfaceAlt, borderColor: colors.line }]}>
                {b.status === 'ready' && b.image ? (
                  <CutoutImage image={b.image} variant="full" />
                ) : b.status === 'generating' ? (
                  <ActivityIndicator color={colors.inkMuted} accessibilityLabel="Generando" />
                ) : (
                  <Text variant="caption" tone="warning" style={{ padding: space.xs, textAlign: 'center' }}>
                    {b.error ?? 'No se ha podido generar'}
                  </Text>
                )}
              </View>
              <Text variant="caption" numberOfLines={2}>
                {baseLabel(b)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      <View style={{ gap: space.xs }}>
        <Text variant="caption" tone="muted">
          Fondo
        </Text>
        <ChipGroup
          options={BACKGROUNDS.map((id) => ({ id, label: BACKGROUND_LABEL[id], hex: BACKGROUND_SWATCH[id] }))}
          value={background}
          onChange={(v) => v && setBackground(v as AvatarBackground)}
          allowDeselect={false}
          scroll
          testIDPrefix="avatar-base-bg"
          accessibilityLabel="Fondo"
        />
        {views.length > 1 ? (
          <>
            <Text variant="caption" tone="muted">
              Vista
            </Text>
            <ChipGroup
              options={views.map((id) => ({ id, label: VIEW_LABEL[id] }))}
              value={view}
              onChange={(v) => v && setView(v as AvatarView)}
              allowDeselect={false}
              testIDPrefix="avatar-base-view"
              accessibilityLabel="Vista"
            />
          </>
        ) : null}
      </View>
      <Button
        label={exists ? 'Ya la tienes guardada' : view === 'frontal' ? 'Guardar esta imagen' : 'Generar esta vista'}
        size="sm"
        variant="secondary"
        icon={view === 'frontal' ? 'image' : 'aperture'}
        disabled={!!exists}
        loading={create.isPending}
        onPress={() =>
          create.mutate(
            { view, background },
            {
              onSuccess: (r) => toast.show({ message: r.job ? 'Generando la vista: tarda 1–3 minutos.' : 'Imagen guardada.', tone: 'success' }),
              onError: (e) => toast.show({ message: errorMessage(e), tone: 'error' }),
            },
          )
        }
        testID="avatar-base-create"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  cell: { width: '31%', gap: space.xxs },
  frame: { width: '100%', aspectRatio: 3 / 4, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
});
