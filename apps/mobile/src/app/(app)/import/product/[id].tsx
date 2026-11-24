import type { ImportedProductDto, MoneyDto } from '@dressit/shared';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { errorMessage } from '@/api/client';
import { useImportedProduct, useLinkToWardrobe, useLinkToWishlist } from '@/api/hooks';
import { uploadImage } from '@/api/upload';
import { DateField } from '@/components/DateField';
import { FetchStatusNotice } from '@/components/imports/FetchStatusNotice';
import { ProvenanceRow } from '@/components/imports/ProvenanceRow';
import { parseEurosToCents } from '@/components/shop/money';
import { OutboundButton } from '@/components/shop/OutboundButton';
import {
  Badge,
  Button,
  Card,
  ChipGroup,
  Divider,
  ErrorState,
  IconButton,
  OfflineBanner,
  ProgressBar,
  Screen,
  SectionHeader,
  SkeletonCard,
  Text,
  TextField,
  useToast,
} from '@/components/ui';
import { today } from '@/lib/dates';
import { formatMoney, timeAgo } from '@/lib/format';
import { takePhoto, pickFromLibrary } from '@/lib/media';
import { hostnameOf } from '@/lib/urls';
import { AVAILABILITY_LABELS, categoryLabel, colorLabel, imagePolicyLabel, subcategoryLabel } from '@/lib/vocab';
import { radius, space, useTheme } from '@/theme';

export default function ImportedProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation('imports');
  const product = useImportedProduct(id);

  return (
    <Screen testID="imported-product-screen" contentStyle={{ paddingTop: space.md }} onRefresh={() => product.refetch()} refreshing={product.isRefetching}>
      <Stack.Screen options={{ title: t('product.title') }} />
      <OfflineBanner />
      {product.data ? (
        <ImportedProductView product={product.data} />
      ) : product.isError ? (
        <ErrorState error={product.error} onRetry={() => product.refetch()} />
      ) : (
        <SkeletonCard height={260} testID="imported-product-loading" />
      )}
    </Screen>
  );
}

function ImportedProductView({ product }: { product: ImportedProductDto }) {
  const { t } = useTranslation('imports');
  const { t: tc } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const toWardrobe = useLinkToWardrobe(product.id);
  const toWishlist = useLinkToWishlist(product.id);

  const sizeOptions = useMemo(() => {
    const labels = new Set<string>([...(product.sizes?.value ?? []), ...product.variants.map((v) => v.size).filter((s): s is string => !!s)]);
    return [...labels].map((label) => {
      const vs = product.variants.filter((v) => v.size === label);
      const soldOut = vs.length > 0 && vs.every((v) => v.available === false);
      return { id: label, label: soldOut ? t('product.soldOut', { label }) : label };
    });
  }, [product, t]);
  const colorOptions = useMemo(() => {
    const labels = new Set<string>([...product.variants.map((v) => v.color).filter((c): c is string => !!c), ...(product.colorName ? [product.colorName.value] : [])]);
    return [...labels].map((label) => ({ id: label, label }));
  }, [product]);

  const [size, setSize] = useState<string | null>(null);
  const [color, setColor] = useState<string | null>(product.colorName?.value ?? null);
  const [photo, setPhoto] = useState<{ uri: string; imageId: string | null; progress: number; error: string | null } | null>(null);
  const [purchaseDate, setPurchaseDate] = useState<string | null>(null);
  const [priceText, setPriceText] = useState('');
  const priceCents = parseEurosToCents(priceText);
  const priceInvalid = priceCents !== null && Number.isNaN(priceCents);
  const uploading = !!photo && !photo.imageId && !photo.error;

  const addPhoto = async (source: 'camera' | 'library') => {
    const res = source === 'camera' ? await takePhoto() : await pickFromLibrary();
    if (res.status === 'denied') {
      toast.show({ message: t('product.cameraDenied'), tone: 'error' });
      return;
    }
    if (res.status !== 'ok') return;
    const uri = res.uris[0]!;
    setPhoto({ uri, imageId: null, progress: 0, error: null });
    try {
      const up = await uploadImage({ uri, kind: 'garment_photo', onProgress: (p) => setPhoto((cur) => (cur && cur.uri === uri ? { ...cur, progress: p.fraction } : cur)) });
      setPhoto((cur) => (cur && cur.uri === uri ? { ...cur, imageId: up.imageId, progress: 1 } : cur));
    } catch (e) {
      setPhoto((cur) => (cur && cur.uri === uri ? { ...cur, error: errorMessage(e) } : cur));
    }
  };

  const saveToWardrobe = () => {
    if (priceInvalid) return;
    toWardrobe.mutate(
      {
        size,
        colorName: color,
        imageId: photo?.imageId ?? null,
        purchaseDate,
        purchasePriceCents: priceCents ?? null,
      },
      {
        onSuccess: (g) => {
          toast.show({ message: t('product.savedWardrobe'), tone: 'success' });
          router.replace({ pathname: '/garment/[id]', params: { id: g.id } });
        },
        onError: (e) => toast.show({ message: errorMessage(e), tone: 'error' }),
      },
    );
  };

  const saveToWishlist = () =>
    toWishlist.mutate(undefined, {
      onSuccess: () => {
        toast.show({ message: t('product.savedWishlist'), tone: 'success' });
        router.replace('/shop/wishlist');
      },
      onError: (e) => toast.show({ message: errorMessage(e), tone: 'error' }),
    });

  const store = product.retailer?.name ?? hostnameOf(product.url);
  const money = (m: MoneyDto) => formatMoney(m);
  const verifiedAgo = timeAgo(product.verifiedAt);
  const showStatus = product.fetchStatus !== 'resolved' || !!product.fetchMessage;

  return (
    <View style={{ gap: space.xl }}>
      <View style={{ gap: space.xs }}>
        <Text variant="overline" tone="muted">
          {store}
        </Text>
        <Text variant="title" testID="imported-title">
          {product.title?.value ?? t('product.untitled')}
        </Text>
        <Text variant="caption" tone={verifiedAgo ? 'muted' : 'warning'}>
          {verifiedAgo ? t('product.verifiedAt', { ago: verifiedAgo }) : t('product.neverVerified')}
        </Text>
      </View>

      {showStatus ? (
        <FetchStatusNotice status={product.fetchStatus} message={product.fetchMessage} url={product.canonicalUrl ?? product.url} testID="imported-status" />
      ) : null}

      {product.images.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
            {product.images.map((img) => (
              <View key={img.id} style={[styles.image, { backgroundColor: colors.surfaceAlt }]}>
                <Image
                  source={{ uri: img.url, cacheKey: `img-${img.id}-full` }}
                  style={StyleSheet.absoluteFill}
                  contentFit={img.isCutout ? 'contain' : 'cover'}
                  cachePolicy="memory-disk"
                  accessibilityLabel={product.title?.value ?? t('product.untitled')}
                />
              </View>
            ))}
          </ScrollView>
          <Text variant="caption" tone="muted">
            {product.images[0]?.attribution
              ? t('product.imagesAttribution', { attribution: product.images[0].attribution })
              : product.imagePolicy === 'link_preview'
                ? t('product.imagesPreviewOnly')
                : imagePolicyLabel(product.imagePolicy)}
          </Text>
        </View>
      ) : (
        <Card tone="sunken">
          <Text variant="small" tone="muted">
            {t('product.noImages')}
          </Text>
        </Card>
      )}

      <View>
        <SectionHeader title={t('product.fields')} />
        <ProvenanceRow label={t('product.field.title')} field={product.title} testID="field-title" />
        <ProvenanceRow label={t('product.field.brand')} field={product.brand} testID="field-brand" />
        <ProvenanceRow label={t('product.field.category')} field={product.category} format={(c) => categoryLabel(c)} />
        <ProvenanceRow label={t('product.field.subcategory')} field={product.subcategory} format={(s) => subcategoryLabel(s)} />
        <ProvenanceRow label={t('product.field.colorName')} field={product.colorName} />
        <ProvenanceRow label={t('product.field.colorFamily')} field={product.colorFamily} format={(c) => colorLabel(c)} />
        <ProvenanceRow label={t('product.field.sizes')} field={product.sizes} format={(s) => s.join(', ')} />
        <ProvenanceRow label={t('product.field.description')} field={product.description} numberOfLines={6} />
      </View>

      <Card style={{ gap: space.md }} testID="imported-for-sale">
        <View style={styles.rowBetween}>
          <Text variant="subheading">{t('product.forSaleTitle')}</Text>
          <Badge label={tc('badges.forSale')} tone="info" icon="shopping-bag" />
        </View>
        <Text variant="small" tone="muted">
          {t('product.forSaleBody')}
        </Text>
        <ProvenanceRow label={t('product.field.price')} field={product.price} format={money} testID="field-price" />
        <ProvenanceRow label={t('product.field.originalPrice')} field={product.originalPrice} format={money} />
        <ProvenanceRow label={t('product.field.availability')} field={product.availability} format={(a) => AVAILABILITY_LABELS[a] ?? a} />
        <OutboundButton product={{ kind: 'imported', id: product.id }} storeName={store} label={t('product.buyAt', { store })} variant="secondary" context="imported_product" testID="imported-outbound" />
      </Card>

      <Divider />

      <View style={{ gap: space.lg }}>
        <SectionHeader overline={t('product.saveTitle')} title={t('product.variantTitle')} />
        {sizeOptions.length ? (
          <View style={{ gap: space.sm }}>
            <Text variant="smallStrong">{t('product.size')}</Text>
            <ChipGroup options={sizeOptions} value={size} onChange={(v) => setSize((v as string) ?? null)} testIDPrefix="imported-size" accessibilityLabel={t('product.size')} />
          </View>
        ) : null}
        {colorOptions.length ? (
          <View style={{ gap: space.sm }}>
            <Text variant="smallStrong">{t('product.color')}</Text>
            <ChipGroup options={colorOptions} value={color} onChange={(v) => setColor((v as string) ?? null)} testIDPrefix="imported-color" accessibilityLabel={t('product.color')} />
          </View>
        ) : null}

        <View style={{ gap: space.sm }}>
          <Text variant="smallStrong">{t('product.photoTitle')}</Text>
          <Text variant="small" tone="muted">
            {t('product.photoBody')}
          </Text>
          {photo ? (
            <View style={styles.photoRow}>
              <View style={[styles.thumb, { backgroundColor: colors.surfaceAlt }]}>
                <Image source={{ uri: photo.uri }} style={StyleSheet.absoluteFill} contentFit="cover" accessible={false} />
              </View>
              <View style={{ flex: 1, gap: space.xs }}>
                {photo.error ? (
                  <Text variant="small" tone="danger">
                    {photo.error}
                  </Text>
                ) : photo.imageId ? (
                  <Badge label={t('product.photoUploaded')} tone="success" icon="check" />
                ) : (
                  <>
                    <Text variant="caption" tone="muted">
                      {t('product.uploading', { percent: Math.round(photo.progress * 100) })}
                    </Text>
                    <ProgressBar value={photo.progress} />
                  </>
                )}
              </View>
              <IconButton icon="trash-2" label={t('product.removePhoto')} onPress={() => setPhoto(null)} />
            </View>
          ) : (
            <View style={styles.row}>
              <Button label={t('product.takePhoto')} icon="camera" variant="secondary" size="sm" onPress={() => addPhoto('camera')} testID="imported-take-photo" />
              <Button label={t('product.pickPhoto')} icon="image" variant="secondary" size="sm" onPress={() => addPhoto('library')} testID="imported-pick-photo" />
            </View>
          )}
        </View>

        <View style={{ gap: space.md }}>
          <Text variant="smallStrong">{t('product.purchaseTitle')}</Text>
          <DateField label={t('product.purchaseDate')} value={purchaseDate} onChange={setPurchaseDate} max={today()} testID="imported-purchase-date" />
          <TextField
            label={t('product.purchasePrice')}
            value={priceText}
            onChangeText={setPriceText}
            keyboardType="decimal-pad"
            placeholder={product.price ? formatMoney(product.price.value) : '0,00'}
            hint={t('product.purchasePriceHint')}
            error={priceInvalid ? t('product.invalidPrice') : null}
            testID="imported-purchase-price"
          />
        </View>
      </View>

      <View style={{ gap: space.md }}>
        <View style={{ gap: space.xs }}>
          <Button
            label={t('product.toWardrobe')}
            icon="plus-square"
            onPress={saveToWardrobe}
            loading={toWardrobe.isPending}
            disabled={uploading || priceInvalid || toWishlist.isPending}
            fullWidth
            testID="imported-to-wardrobe"
            accessibilityHint={t('product.toWardrobeHint')}
          />
          <Text variant="caption" tone="muted" align="center">
            {t('product.toWardrobeHint')}
          </Text>
        </View>
        <View style={{ gap: space.xs }}>
          <Button
            label={t('product.toWishlist')}
            icon="heart"
            variant="secondary"
            onPress={saveToWishlist}
            loading={toWishlist.isPending}
            disabled={toWardrobe.isPending}
            fullWidth
            testID="imported-to-wishlist"
            accessibilityHint={t('product.toWishlistHint')}
          />
          <Text variant="caption" tone="muted" align="center">
            {t('product.toWishlistHint')}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  image: { width: 200, aspectRatio: 4 / 5, borderRadius: radius.md, overflow: 'hidden' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  row: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  thumb: { width: 64, height: 80, borderRadius: radius.sm, overflow: 'hidden' },
});
