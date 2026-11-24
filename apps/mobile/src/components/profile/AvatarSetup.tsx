import type { ImageRefDto, UploadKind } from '@dressit/shared';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { errorMessage } from '@/api/client';
import { useAvatarProfile, useConsents, useDeleteAvatarProfile, useSaveAvatarProfile, useSetConsent } from '@/api/hooks';
import { uploadImage } from '@/api/upload';
import { Button, Card, ConfirmDialog, Divider, Icon, ListRow, Text, useToast } from '@/components/ui';
import { AvatarBases } from './AvatarBases';
import { pickFromLibrary, takePhoto } from '@/lib/media';
import { radius, space, useTheme } from '@/theme';

type Slot = 'face' | 'body';
const KIND: Record<Slot, UploadKind> = { face: 'self_face', body: 'self_body' };

/**
 * The user's own photos for the avatar: a face photo and a full-body photo, with the `avatar`
 * consent and two confirmations (they are of me; I am an adult). Used in onboarding (optional)
 * and in Perfil → Tu avatar. Photos are uploaded only when saved.
 */
export function AvatarSetup({ onSaved, compact }: { onSaved?: () => void; compact?: boolean }) {
  const { colors } = useTheme();
  const toast = useToast();
  const consents = useConsents();
  const setConsent = useSetConsent();
  const profile = useAvatarProfile();
  const save = useSaveAvatarProfile();
  const remove = useDeleteAvatarProfile();
  const granted = consents.data?.find((c) => c.kind === 'avatar')?.granted ?? false;
  const [local, setLocal] = useState<Partial<Record<Slot, string>>>({});
  const [self, setSelf] = useState(false);
  const [adult, setAdult] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (profile.data) {
      setSelf(profile.data.attestedSelf);
      setAdult(profile.data.attestedAdult);
    }
  }, [profile.data]);

  const pick = async (slot: Slot, source: 'camera' | 'library') => {
    const res = source === 'camera' ? await takePhoto() : await pickFromLibrary();
    if (res.status === 'ok') setLocal((l) => ({ ...l, [slot]: res.uris[0] }));
    else if (res.status === 'denied') toast.show({ message: 'Permite el acceso a la cámara en Ajustes para hacer la foto.', tone: 'error' });
  };

  const current: Record<Slot, ImageRefDto | null> = { face: profile.data?.face ?? null, body: profile.data?.body ?? null };
  // The full-body photo is what the try-on dresses; the face photo is only for the one-pass method.
  const hasBody = !!(local.body || current.body);
  const dirty = !!local.face || !!local.body || self !== (profile.data?.attestedSelf ?? false) || adult !== (profile.data?.attestedAdult ?? false);

  const submit = async () => {
    setSaving(true);
    try {
      const ids: { faceImageId?: string; bodyImageId?: string } = {};
      for (const slot of ['face', 'body'] as const) {
        const uri = local[slot];
        if (uri) {
          const up = await uploadImage({ uri, kind: KIND[slot] });
          ids[slot === 'face' ? 'faceImageId' : 'bodyImageId'] = up.imageId;
        }
      }
      await save.mutateAsync({ ...ids, attestedSelf: self, attestedAdult: adult });
      setLocal({});
      toast.show({ message: 'Tu avatar está listo.', tone: 'success' });
      onSaved?.();
    } catch (e) {
      toast.show({ message: errorMessage(e), tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  if (!granted) {
    return (
      <Card testID="avatar-consent">
        <View style={{ gap: space.sm }}>
          <Text variant="body">Para verte con tus conjuntos necesitamos guardar una foto de tu cara y otra de cuerpo entero.</Text>
          <Text variant="small" tone="muted">
            Solo se usan para generar imágenes tuyas dentro de DressIt, nunca para identificarte, y se borran en cuanto lo desactivas o borras tu cuenta.
          </Text>
          <Button label="Activar mi avatar" icon="user" onPress={() => setConsent.mutate({ kind: 'avatar', granted: true })} loading={setConsent.isPending} testID="avatar-enable" />
        </View>
      </Card>
    );
  }

  return (
    <View style={{ gap: space.lg }} testID="avatar-setup">
      <View style={styles.slots}>
        {(['face', 'body'] as const).map((slot) => {
          const uri = local[slot] ?? current[slot]?.thumbUrl ?? null;
          return (
            <View key={slot} style={styles.slot}>
              <View style={[styles.frame, slot === 'body' && styles.frameBody, { backgroundColor: colors.surfaceAlt, borderColor: colors.line }]}>
                {uri ? (
                  <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" accessible={false} />
                ) : (
                  <Icon name={slot === 'face' ? 'smile' : 'user'} size={36} color={colors.inkSubtle} />
                )}
              </View>
              <Text variant="smallStrong">{slot === 'face' ? 'Tu cara (opcional)' : 'Cuerpo entero'}</Text>
              {!compact ? (
                <Text variant="caption" tone="muted">
                  {slot === 'face' ? 'Para el método de una sola pasada. De frente, buena luz.' : 'De pie y de frente, de la cabeza a los pies, brazos algo separados, ropa ajustada.'}
                </Text>
              ) : null}
              <View style={styles.actions}>
                <Pressable onPress={() => pick(slot, 'camera')} accessibilityRole="button" accessibilityLabel={`Hacer foto: ${slot === 'face' ? 'tu cara' : 'cuerpo entero'}`} hitSlop={8} testID={`avatar-${slot}-camera`}>
                  <Icon name="camera" size={20} />
                </Pressable>
                <Pressable onPress={() => pick(slot, 'library')} accessibilityRole="button" accessibilityLabel={`Elegir de la galería: ${slot === 'face' ? 'tu cara' : 'cuerpo entero'}`} hitSlop={8} testID={`avatar-${slot}-library`}>
                  <Icon name="image" size={20} />
                </Pressable>
              </View>
            </View>
          );
        })}
      </View>

      <View>
        <ListRow title="Estas fotos son mías" subtitle="No subas fotos de otras personas." switchValue={self} onSwitchChange={setSelf} testID="avatar-attest-self" />
        <ListRow title="Tengo 18 años o más" switchValue={adult} onSwitchChange={setAdult} testID="avatar-attest-adult" />
      </View>

      <Button label={profile.data?.ready && !local.face && !local.body ? 'Guardar' : 'Guardar mi avatar'} onPress={submit} loading={saving} disabled={!hasBody || !self || !adult || !dirty} testID="avatar-save" />
      {!compact && profile.data?.body && profile.data.attestedSelf && profile.data.attestedAdult && !local.body ? (
        <>
          <Divider />
          <AvatarBases profile={profile.data} />
        </>
      ) : null}
      {profile.data?.face || profile.data?.body ? (
        <Button label="Borrar mis fotos y avatares" variant="ghost" icon="trash-2" onPress={() => setConfirmDelete(true)} testID="avatar-delete" />
      ) : null}

      <ConfirmDialog
        visible={confirmDelete}
        title="¿Borrar tus fotos?"
        message="Se borrarán tu foto de cara, la de cuerpo entero y todas las imágenes tuyas generadas. No se puede deshacer."
        confirmLabel="Borrar"
        destructive
        loading={remove.isPending}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() =>
          remove.mutate(undefined, {
            onSuccess: () => {
              setConfirmDelete(false);
              setLocal({});
              toast.show({ message: 'Fotos borradas.', tone: 'success' });
            },
            onError: (e) => toast.show({ message: errorMessage(e), tone: 'error' }),
          })
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  slots: { flexDirection: 'row', gap: space.md },
  slot: { flex: 1, gap: space.xs },
  frame: { width: '100%', aspectRatio: 1, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  frameBody: { aspectRatio: 3 / 4 },
  actions: { flexDirection: 'row', gap: space.lg, paddingTop: space.xs },
});
