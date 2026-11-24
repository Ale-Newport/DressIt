import type { ReceiptTextImportRequest, UploadKind } from '@dressit/shared';
import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { errorMessage } from '@/api/client';
import { useTextImport } from '@/api/hooks';
import { uploadImage } from '@/api/upload';
import { ReceiptResultView } from '@/components/capture/ReceiptResultView';
import { Button, Card, ChipGroup, Icon, OfflineBanner, ProgressBar, Screen, SegmentedControl, Text, TextField, useToast } from '@/components/ui';
import { pickFromLibrary, type PickResult, takePhoto } from '@/lib/media';
import { radius, space, useTheme } from '@/theme';

type Source = ReceiptTextImportRequest['source'];
const SOURCES: Source[] = ['receipt', 'screenshot', 'email', 'label', 'retailer_export'];

function uploadKindFor(source: Source): UploadKind {
  if (source === 'screenshot' || source === 'email' || source === 'retailer_export') return 'screenshot';
  if (source === 'label') return 'label';
  return 'receipt';
}

interface ImageState {
  uri: string;
  imageId: string | null;
  progress: number;
  error: string | null;
}

/** Receipt / screenshot / e-mail import → `POST /v1/imports/text`. */
export default function TextImportScreen() {
  const { t } = useTranslation('capture');
  const { t: tc } = useTranslation();
  const { colors } = useTheme();
  const toast = useToast();
  const params = useLocalSearchParams<{ text?: string; source?: string }>();
  const [mode, setMode] = useState<'text' | 'image'>('text');
  const [source, setSource] = useState<Source>(SOURCES.includes(params.source as Source) ? (params.source as Source) : params.text ? 'email' : 'receipt');
  const [text, setText] = useState(params.text ?? '');
  const [image, setImage] = useState<ImageState | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const importText = useTextImport();

  const startUpload = (uri: string, kind: UploadKind) => {
    setImage({ uri, imageId: null, progress: 0, error: null });
    uploadImage({ uri, kind, onProgress: (p) => setImage((cur) => (cur?.uri === uri ? { ...cur, progress: p.fraction } : cur)) })
      .then((res) => setImage((cur) => (cur?.uri === uri ? { ...cur, imageId: res.imageId, progress: 1 } : cur)))
      .catch((e) => setImage((cur) => (cur?.uri === uri ? { ...cur, error: errorMessage(e) } : cur)));
  };

  const handlePick = (res: PickResult) => {
    if (res.status === 'ok' && res.uris[0]) startUpload(res.uris[0], uploadKindFor(source));
    else if (res.status === 'denied') toast.show({ message: tc('permission.deniedBody'), tone: 'error' });
  };

  const uploading = !!image && !image.imageId && !image.error;
  const analyze = () => {
    const body: ReceiptTextImportRequest = { text: text.trim(), source };
    if (mode === 'image') {
      if (!image?.imageId) {
        setInputError(t('text.needInput'));
        return;
      }
      body.imageId = image.imageId;
    } else if (!body.text) {
      setInputError(t('text.needInput'));
      return;
    }
    setInputError(null);
    importText.mutate(body);
  };

  return (
    <Screen
      testID="text-import-screen"
      footer={
        <>
          {inputError ? (
            <Text variant="small" tone="danger" accessibilityLiveRegion="polite">
              {inputError}
            </Text>
          ) : null}
          <Button label={t('text.analyze')} onPress={analyze} loading={importText.isPending} disabled={uploading} fullWidth testID="text-import-analyze" />
        </>
      }
    >
      <OfflineBanner />
      <Text variant="body" tone="muted" style={{ paddingTop: space.md }}>
        {t('text.intro')}
      </Text>
      <SegmentedControl
        segments={[
          { id: 'text', label: t('text.modeText'), testID: 'text-mode-text' },
          { id: 'image', label: t('text.modeImage'), testID: 'text-mode-image' },
        ]}
        value={mode}
        onChange={setMode}
      />
      <View style={{ gap: space.sm }}>
        <Text variant="smallStrong">{t('text.source')}</Text>
        <ChipGroup
          options={SOURCES.map((id) => ({ id, label: t(`text.sources.${id}`) }))}
          value={source}
          allowDeselect={false}
          onChange={(v) => v && setSource(v as Source)}
          testIDPrefix="text-source"
          accessibilityLabel={t('text.source')}
        />
      </View>

      {mode === 'text' ? (
        <TextField
          label={t('text.textLabel')}
          placeholder={t('text.textPlaceholder')}
          value={text}
          onChangeText={setText}
          multiline
          style={{ minHeight: 180 }}
          testID="text-import-input"
        />
      ) : (
        <View style={{ gap: space.md }}>
          {image ? (
            <View style={[styles.preview, { backgroundColor: colors.surfaceAlt }]}>
              <Image source={{ uri: image.uri }} style={StyleSheet.absoluteFill} contentFit="contain" accessible={false} />
            </View>
          ) : null}
          {image && uploading ? (
            <View style={{ gap: space.xs }}>
              <Text variant="caption" tone="muted">
                {t('text.uploading', { percent: Math.round(image.progress * 100) })}
              </Text>
              <ProgressBar value={image.progress} />
            </View>
          ) : null}
          {image?.error ? (
            <View style={{ gap: space.xs }}>
              <Text variant="small" tone="danger">
                {image.error}
              </Text>
              <Button label={tc('actions.retry')} size="sm" variant="secondary" onPress={() => startUpload(image.uri, uploadKindFor(source))} />
            </View>
          ) : null}
          <View style={styles.row}>
            <Button
              label={image ? t('text.changeImage') : t('text.pickImage')}
              icon="image"
              variant="secondary"
              size="sm"
              onPress={() => pickFromLibrary().then(handlePick)}
              testID="text-import-pick"
            />
            <Button label={t('text.takePhoto')} icon="camera" variant="secondary" size="sm" onPress={() => takePhoto().then(handlePick)} />
          </View>
          <Card tone="sunken">
            <View style={styles.note}>
              <Icon name="info" size={16} color={colors.inkMuted} />
              <Text variant="small" tone="muted" style={{ flex: 1 }}>
                {t('text.noOcr')}
              </Text>
            </View>
          </Card>
          <TextField label={t('text.optionalTextLabel')} placeholder={t('text.textPlaceholder')} value={text} onChangeText={setText} multiline />
        </View>
      )}

      <Text variant="caption" tone="subtle">
        {t('text.privacy')}
      </Text>

      {importText.isError ? (
        <Card tone="sunken">
          <Text variant="small" tone="danger" accessibilityLiveRegion="polite">
            {errorMessage(importText.error)}
          </Text>
        </Card>
      ) : null}
      {importText.data ? <ReceiptResultView result={importText.data} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  preview: { width: '100%', aspectRatio: 3 / 4, borderRadius: radius.md, overflow: 'hidden' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  note: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
});
