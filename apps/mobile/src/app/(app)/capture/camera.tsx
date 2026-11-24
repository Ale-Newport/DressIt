import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { QueueThumb } from '@/components/capture/QueueThumb';
import { Button, IconButton, PermissionPrompt, Sheet, Text, useToast } from '@/components/ui';
import { pickFromLibrary } from '@/lib/media';
import { uploadQueue, useImportSession } from '@/state/uploadQueue';
import { radius, space, useTheme } from '@/theme';

/**
 * Multi-shot capture: every photo is enqueued and starts uploading immediately,
 * so the user can keep shooting dozens of garments without waiting.
 */
export default function CaptureCameraScreen() {
  const { t } = useTranslation('capture');
  const { colors } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [sessionId] = useState(() => uploadQueue.createSession('camera', 'single'));
  const { session, items } = useImportSession(sessionId);
  const cameraRef = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [askClose, setAskClose] = useState(false);
  const multi = session?.mode === 'multi';

  // Drop the session if the user leaves without taking any photo.
  useEffect(
    () => () => {
      const s = uploadQueue.getState();
      const hasItems = s.items.some((i) => i.sessionId === sessionId);
      const sess = s.sessions.find((x) => x.id === sessionId);
      if (!hasItems && sess?.status === 'collecting') uploadQueue.clearSession(sessionId);
    },
    [sessionId],
  );

  const shoot = async () => {
    if (!cameraRef.current || busy) return;
    setBusy(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      const pic = await cameraRef.current.takePictureAsync({ quality: 0.85, exif: false });
      if (pic?.uri) uploadQueue.enqueue(sessionId, [pic.uri], 'garment_photo');
    } catch {
      toast.show({ message: t('camera.captureError'), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const fromGallery = async () => {
    const res = await pickFromLibrary({ multiple: true, limit: 60 });
    if (res.status === 'ok') uploadQueue.enqueue(sessionId, res.uris, 'garment_photo');
  };

  const finish = () => {
    uploadQueue.submit(sessionId).catch(() => {});
    router.replace({ pathname: '/capture/session', params: { sessionId } });
  };

  const close = () => {
    if (items.length > 0) setAskClose(true);
    else router.back();
  };

  if (!permission) {
    return <View style={[styles.fill, { backgroundColor: '#000' }]} accessibilityLabel={t('camera.notReady')} />;
  }

  if (!permission.granted) {
    return (
      <View style={[styles.fill, styles.center, { backgroundColor: colors.background, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={[styles.topBar, { top: insets.top }]}>
          <IconButton icon="x" label={t('camera.close')} onPress={() => router.back()} testID="camera-close" />
        </View>
        <View style={{ padding: space.xl, gap: space.lg, width: '100%' }}>
          <PermissionPrompt
            kind="camera"
            status={permission.status}
            canAskAgain={permission.canAskAgain}
            onRequest={() => requestPermission()}
          />
          <Button label={t('camera.gallery')} icon="image" variant="secondary" onPress={fromGallery} />
          {items.length > 0 ? <Button label={t('camera.finish', { count: items.length })} onPress={finish} /> : null}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: '#000' }]} testID="camera-screen">
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing={facing}
        mode="picture"
        animateShutter
        onCameraReady={() => setReady(true)}
        accessibilityLabel={t('camera.tip')}
      />
      <View style={[styles.topBar, { top: insets.top + space.sm }]}>
        <IconButton icon="x" label={t('camera.close')} onPress={close} color="#fff" style={styles.glass} testID="camera-close" />
        <View style={[styles.tip, styles.glass]}>
          <Text variant="caption" color="#fff">
            {t('camera.tip')}
          </Text>
        </View>
        <IconButton icon="refresh-ccw" label={t('camera.flipCamera')} onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))} color="#fff" style={styles.glass} />
      </View>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + space.md }]}>
        {items.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
            {items.map((item, i) => (
              <QueueThumb key={item.localId} item={item} index={i} size={56} onDark />
            ))}
          </ScrollView>
        ) : (
          <Text variant="small" color="#fff" align="center">
            {t('camera.noPhotos')}
          </Text>
        )}

        <View style={styles.multiRow}>
          <View style={{ flex: 1 }}>
            <Text variant="smallStrong" color="#fff">
              {t('camera.multi')}
            </Text>
            <Text variant="caption" color="rgba(255,255,255,0.75)">
              {t('camera.multiHint')}
            </Text>
          </View>
          <Switch
            value={multi}
            onValueChange={(v) => uploadQueue.setMode(sessionId, v ? 'multi' : 'single')}
            trackColor={{ true: colors.accent, false: 'rgba(255,255,255,0.3)' }}
            accessibilityLabel={t('camera.multi')}
            accessibilityHint={t('camera.multiHint')}
            testID="camera-multi"
          />
        </View>

        <View style={styles.controls}>
          <IconButton icon="image" label={t('camera.gallery')} onPress={fromGallery} color="#fff" style={styles.glass} testID="camera-gallery" />
          <Pressable
            onPress={shoot}
            disabled={!ready || busy}
            accessibilityRole="button"
            accessibilityLabel={t('camera.shutter')}
            accessibilityHint={t('camera.shutterHint')}
            accessibilityState={{ disabled: !ready || busy, busy }}
            testID="camera-shutter"
            style={({ pressed }) => [styles.shutter, { opacity: !ready || busy ? 0.5 : pressed ? 0.8 : 1 }]}
          >
            <View style={styles.shutterInner} />
          </Pressable>
          <Button
            label={t('camera.finish', { count: items.length })}
            size="sm"
            variant="accent"
            disabled={items.length === 0}
            accessibilityHint={t('camera.finishHint')}
            onPress={finish}
            testID="camera-finish"
          />
        </View>
      </View>

      <Sheet visible={askClose} onClose={() => setAskClose(false)} title={t('camera.discardTitle')} subtitle={t('camera.discardMessage', { count: items.length })}>
        <Button
          label={t('camera.process')}
          onPress={() => {
            setAskClose(false);
            setTimeout(finish, 300);
          }}
          fullWidth
        />
        <Button
          label={t('camera.discard')}
          variant="danger"
          onPress={() => {
            setAskClose(false);
            uploadQueue.clearSession(sessionId);
            setTimeout(() => router.back(), 300);
          }}
          fullWidth
        />
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  topBar: { position: 'absolute', left: space.lg, right: space.lg, flexDirection: 'row', alignItems: 'center', gap: space.sm, zIndex: 2 },
  glass: { backgroundColor: 'rgba(0,0,0,0.45)' },
  tip: { flex: 1, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: space.md, gap: space.md, backgroundColor: 'rgba(0,0,0,0.55)' },
  strip: { gap: space.sm, paddingHorizontal: space.lg },
  multiRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg },
  shutter: { width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#fff' },
});
