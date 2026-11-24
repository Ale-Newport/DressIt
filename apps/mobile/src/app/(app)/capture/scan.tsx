import { type BarcodeScanningResult, CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { errorMessage } from '@/api/client';
import { useTextImport } from '@/api/hooks';
import { ReceiptResultView } from '@/components/capture/ReceiptResultView';
import { Button, IconButton, PermissionPrompt, Sheet, SkeletonList, Text, TextField } from '@/components/ui';
import { extractUrl, isHttpUrl } from '@/lib/urls';
import { radius, space, useTheme } from '@/theme';

const EAN_RE = /^(\d{8}|\d{12,14})$/;

/** Label scanner: EAN/UPC → `POST /v1/imports/text` (source `label`); QR with a URL → link import. */
export default function ScanScreen() {
  const { t } = useTranslation('capture');
  const { t: tc } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const textImport = useTextImport();
  const [torch, setTorch] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [qrText, setQrText] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manual, setManual] = useState('');
  const handling = useRef(false);

  const lookup = (ean: string) => {
    setCode(ean);
    setQrText(null);
    textImport.reset();
    textImport.mutate({ text: `EAN ${ean}`, source: 'label' });
  };

  const onScanned = (r: BarcodeScanningResult) => {
    if (handling.current) return;
    handling.current = true;
    Haptics.selectionAsync().catch(() => {});
    const data = r.data.trim();
    const isQr = /qr/i.test(r.type);
    if (isQr || !EAN_RE.test(data)) {
      const url = isHttpUrl(data) ? data : extractUrl(data);
      if (url) {
        router.replace({ pathname: '/import/link', params: { url } });
        return;
      }
      setQrText(data);
      setCode(null);
      return;
    }
    lookup(data);
  };

  const reset = () => {
    setCode(null);
    setQrText(null);
    textImport.reset();
    handling.current = false;
  };

  const manualValid = EAN_RE.test(manual.trim());
  const panelOpen = !!code || !!qrText;

  const manualSheet = (
    <Sheet visible={manualOpen} onClose={() => setManualOpen(false)} title={t('scan.manualTitle')} testID="scan-manual-sheet">
      <TextField
        label={t('scan.manualLabel')}
        placeholder={t('scan.manualPlaceholder')}
        keyboardType="number-pad"
        value={manual}
        onChangeText={(s) => setManual(s.replace(/\D/g, ''))}
        error={manual && !manualValid ? t('scan.invalidEan') : null}
        maxLength={14}
        testID="scan-manual-input"
      />
      <Button
        label={t('scan.manualSearch')}
        disabled={!manualValid}
        onPress={() => {
          setManualOpen(false);
          handling.current = true;
          lookup(manual.trim());
        }}
        testID="scan-manual-search"
      />
    </Sheet>
  );

  const resultSheet = (
    <Sheet
      visible={panelOpen}
      onClose={reset}
      title={code ? t('scan.scanned', { code }) : t('scan.title')}
      testID="scan-result-sheet"
      footer={<Button label={t('scan.scanAgain')} variant="secondary" onPress={reset} fullWidth testID="scan-again" />}
    >
      {qrText ? (
        <View style={{ gap: space.md }}>
          <Text variant="body">{t('scan.qrNoUrl')}</Text>
          <Text variant="small" tone="muted" numberOfLines={4}>
            {qrText}
          </Text>
          <Button label={t('scan.qrUseText')} variant="secondary" onPress={() => router.replace({ pathname: '/capture/text', params: { text: qrText } })} />
        </View>
      ) : textImport.isPending ? (
        <View style={{ gap: space.md }}>
          <Text variant="small" tone="muted">
            {t('scan.searching', { code: code ?? '' })}
          </Text>
          <SkeletonList rows={2} />
        </View>
      ) : textImport.isError ? (
        <View style={{ gap: space.md }}>
          <Text variant="body" tone="danger">
            {errorMessage(textImport.error)}
          </Text>
          <Button label={tc('actions.retry')} onPress={() => code && lookup(code)} />
        </View>
      ) : textImport.data ? (
        <ReceiptResultView result={textImport.data} testID="scan-result" />
      ) : null}
    </Sheet>
  );

  if (!permission) return <View style={[styles.fill, { backgroundColor: '#000' }]} />;

  if (!permission.granted) {
    return (
      <View style={[styles.fill, { backgroundColor: colors.background, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.topBarStatic}>
          <IconButton icon="x" label={t('scan.close')} onPress={() => router.back()} testID="scan-close" />
        </View>
        <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.lg }}>
          <PermissionPrompt kind="camera" status={permission.status} canAskAgain={permission.canAskAgain} onRequest={() => requestPermission()} />
          <Button label={t('scan.manualTitle')} variant="secondary" icon="hash" onPress={() => setManualOpen(true)} testID="scan-manual" />
        </ScrollView>
        {manualSheet}
        {resultSheet}
      </View>
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: '#000' }]} testID="scan-screen">
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={torch}
        barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'qr'] }}
        onBarcodeScanned={panelOpen || manualOpen ? undefined : onScanned}
        accessibilityLabel={t('scan.hint')}
      />
      <View style={[styles.topBar, { top: insets.top + space.sm }]}>
        <IconButton icon="x" label={t('scan.close')} onPress={() => router.back()} color="#fff" style={styles.glass} testID="scan-close" />
        <View style={{ flex: 1 }} />
        <IconButton
          icon={torch ? 'zap-off' : 'zap'}
          label={torch ? t('scan.torchOff') : t('scan.torchOn')}
          onPress={() => setTorch((v) => !v)}
          color="#fff"
          style={styles.glass}
        />
      </View>
      <View style={styles.frameWrap} pointerEvents="none">
        <View style={[styles.frame, { borderColor: '#fff' }]} />
      </View>
      <View style={[styles.bottom, { paddingBottom: insets.bottom + space.lg }]}>
        <Text variant="body" color="#fff" align="center">
          {t('scan.hint')}
        </Text>
        <Button label={t('scan.manualTitle')} variant="secondary" icon="hash" onPress={() => setManualOpen(true)} style={styles.manualBtn} testID="scan-manual" />
      </View>
      {manualSheet}
      {resultSheet}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  topBar: { position: 'absolute', left: space.lg, right: space.lg, flexDirection: 'row', alignItems: 'center', zIndex: 2 },
  topBarStatic: { paddingHorizontal: space.lg, paddingTop: space.sm },
  glass: { backgroundColor: 'rgba(0,0,0,0.45)' },
  frameWrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  frame: { width: '78%', aspectRatio: 1.8, borderWidth: 2, borderRadius: radius.md },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: space.xl, gap: space.md, backgroundColor: 'rgba(0,0,0,0.55)' },
  manualBtn: { backgroundColor: 'rgba(255,255,255,0.92)' },
});
