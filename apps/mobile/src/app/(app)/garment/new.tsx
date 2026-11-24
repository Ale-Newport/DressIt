import { type Category, colorFamilyFromText, type GarmentWriteDto, getSubcategory } from '@dressit/shared';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { errorMessage } from '@/api/client';
import { useCreateGarment } from '@/api/hooks';
import { uploadImage } from '@/api/upload';
import { Button, GarmentSilhouette, OfflineBanner, ProgressBar, Screen, Text, useToast } from '@/components/ui';
import { colorsFromFamilies, type FieldKey, FormSection, GarmentFieldEditor } from '@/components/wardrobe/GarmentFields';
import { pickFromLibrary, type PickResult, takePhoto } from '@/lib/media';
import { radius, space, useTheme } from '@/theme';

type Params = {
  name?: string;
  brand?: string;
  size?: string;
  colorName?: string;
  priceCents?: string;
  purchaseDate?: string;
  category?: string;
  subcategory?: string;
};

function initialDraft(p: Params): GarmentWriteDto {
  const draft: GarmentWriteDto = { tags: [], materials: [], styles: [], seasons: [], occasions: [] };
  if (p.name) draft.name = p.name;
  if (p.brand) draft.brand = p.brand;
  if (p.size) draft.size = p.size;
  const sub = p.subcategory ? getSubcategory(p.subcategory) : undefined;
  if (sub) {
    draft.category = sub.category;
    draft.subcategory = sub.id;
  } else if (p.category) {
    draft.category = p.category as Category;
  }
  const family = colorFamilyFromText(p.colorName) ?? colorFamilyFromText(p.name);
  if (family) draft.colors = colorsFromFamilies([family]);
  if (p.priceCents && /^\d+$/.test(p.priceCents)) draft.purchasePriceCents = Number(p.priceCents);
  if (p.purchaseDate && /^\d{4}-\d{2}-\d{2}/.test(p.purchaseDate)) draft.purchaseDate = p.purchaseDate.slice(0, 10);
  return draft;
}

const BASICS: FieldKey[] = ['category', 'subcategory', 'name', 'brand', 'colors'];
const DETAILS: FieldKey[] = ['pattern', 'materials', 'styles', 'seasons', 'occasions', 'fit', 'size', 'condition', 'waterproof'];
const ORGANISATION: FieldKey[] = ['spaceId', 'tags', 'notes'];
const PURCHASE: FieldKey[] = ['purchaseDate', 'purchasePrice'];

interface PhotoState {
  uri: string;
  imageId: string | null;
  progress: number;
  error: string | null;
  duplicate: boolean;
}

export default function NewGarmentScreen() {
  const { t } = useTranslation('wardrobe');
  const { t: tc } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const params = useLocalSearchParams<Params>();
  const [draft, setDraft] = useState<GarmentWriteDto>(() => initialDraft(params));
  const [photo, setPhoto] = useState<PhotoState | null>(null);
  const [showError, setShowError] = useState(false);
  const create = useCreateGarment();

  const patch = (p: Partial<GarmentWriteDto>) => setDraft((d) => ({ ...d, ...p }));
  const uploading = !!photo && !photo.imageId && !photo.error;
  const missingRequired = !draft.category || !draft.subcategory;

  const startUpload = (uri: string) => {
    setPhoto({ uri, imageId: null, progress: 0, error: null, duplicate: false });
    uploadImage({
      uri,
      kind: 'garment_photo',
      onProgress: (p) => setPhoto((cur) => (cur && cur.uri === uri ? { ...cur, progress: p.fraction } : cur)),
    })
      .then((res) => setPhoto((cur) => (cur && cur.uri === uri ? { ...cur, imageId: res.imageId, progress: 1, duplicate: !!res.duplicateOfImageId } : cur)))
      .catch((e) => setPhoto((cur) => (cur && cur.uri === uri ? { ...cur, error: errorMessage(e) } : cur)));
  };

  const handlePick = (res: PickResult) => {
    if (res.status === 'ok' && res.uris[0]) startUpload(res.uris[0]);
    else if (res.status === 'denied') toast.show({ message: t('new.cameraDenied'), tone: 'error' });
  };

  const save = () => {
    if (missingRequired) {
      setShowError(true);
      return;
    }
    const body: GarmentWriteDto = { ...draft, imageId: photo?.imageId ?? undefined };
    if (body.name !== undefined && !body.name.trim()) delete body.name;
    create.mutate(body, {
      onSuccess: (g) => {
        toast.show({ message: t('new.saved'), tone: 'success' });
        router.replace({ pathname: '/garment/[id]', params: { id: g.id } });
      },
    });
  };

  const renderFields = (fields: FieldKey[]) =>
    fields.map((f) => <GarmentFieldEditor key={f} field={f} draft={draft} onChange={patch} testIDPrefix="garment-new" />);

  return (
    <Screen
      testID="garment-new-screen"
      footer={
        <>
          {showError && missingRequired ? (
            <Text variant="small" tone="danger" accessibilityLiveRegion="polite">
              {t('new.required')}
            </Text>
          ) : null}
          {create.isError ? (
            <Text variant="small" tone="danger" accessibilityLiveRegion="polite">
              {errorMessage(create.error)}
            </Text>
          ) : null}
          <Button label={t('new.save')} onPress={save} loading={create.isPending} disabled={uploading} fullWidth testID="garment-new-save" />
        </>
      }
    >
      <OfflineBanner />
      <FormSection title={t('new.photoTitle')}>
        <View style={styles.photoRow}>
          <View style={[styles.preview, { backgroundColor: colors.surfaceAlt }]}>
            {photo ? (
              <Image source={{ uri: photo.uri }} style={StyleSheet.absoluteFill} contentFit="cover" accessible={false} />
            ) : (
              <GarmentSilhouette category={draft.category} subcategory={draft.subcategory} color={draft.colors?.[0]?.hex ?? null} />
            )}
          </View>
          <View style={{ flex: 1, gap: space.sm }}>
            <Text variant="small" tone="muted">
              {t('new.photoBody')}
            </Text>
            <Button label={t('new.takePhoto')} icon="camera" size="sm" variant="secondary" onPress={() => takePhoto().then(handlePick)} testID="garment-new-take-photo" />
            <Button label={t('new.pickPhoto')} icon="image" size="sm" variant="secondary" onPress={() => pickFromLibrary().then(handlePick)} testID="garment-new-pick-photo" />
            {photo ? <Button label={t('new.removePhoto')} size="sm" variant="ghost" onPress={() => setPhoto(null)} /> : null}
          </View>
        </View>
        {photo && uploading ? (
          <View style={{ gap: space.xs }}>
            <Text variant="caption" tone="muted">
              {t('new.uploading', { percent: Math.round(photo.progress * 100) })}
            </Text>
            <ProgressBar value={photo.progress} />
          </View>
        ) : null}
        {photo?.imageId ? (
          <Text variant="caption" tone="success">
            {photo.duplicate ? t('new.duplicatePhoto') : t('new.uploaded')}
          </Text>
        ) : null}
        {photo?.error ? (
          <View style={{ gap: space.xs }}>
            <Text variant="small" tone="danger">
              {t('new.uploadError')}: {photo.error}
            </Text>
            <Button label={tc('actions.retry')} size="sm" variant="secondary" onPress={() => startUpload(photo.uri)} />
          </View>
        ) : null}
      </FormSection>
      <FormSection title={t('new.basics')}>{renderFields(BASICS)}</FormSection>
      <FormSection title={t('new.details')}>{renderFields(DETAILS)}</FormSection>
      <FormSection title={t('new.organisation')}>{renderFields(ORGANISATION)}</FormSection>
      <FormSection title={t('new.purchase')}>{renderFields(PURCHASE)}</FormSection>
    </Screen>
  );
}

const styles = StyleSheet.create({
  photoRow: { flexDirection: 'row', gap: space.lg, alignItems: 'flex-start' },
  preview: { width: 112, aspectRatio: 4 / 5, borderRadius: radius.md, overflow: 'hidden' },
});
