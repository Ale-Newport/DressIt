import type { Category, GarmentDetailDto, LinkToWardrobeRequest, ProductSummaryDto } from '@dressit/shared';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { errorMessage } from '@/api/client';
import { findWishlistItem, useAddToWishlist, useLinkToWardrobe, useWishlist, useWishlistOwned } from '@/api/hooks';
import { Button, ChipGroup, Sheet, Text, TextField } from '@/components/ui';
import { options } from '@/lib/vocab';
import { space } from '@/theme';

export interface OwnItSheetProps {
  visible: boolean;
  product: ProductSummaryDto;
  onClose: () => void;
  onOwned: (garment: GarmentDetailDto) => void;
  /** Wishlist item id when already known (wishlist screen). */
  wishlistItemId?: string | null;
}

/**
 * "Ya lo tengo": adds a product to the wardrobe ONLY after explicit confirmation.
 * - imported product → `POST /v1/imports/link/:id/to-wardrobe`
 * - catalog product → wishlist item (created if needed) → `POST /v1/wishlist/:id/owned`
 */
export function OwnItSheet({ visible, product, onClose, onOwned, wishlistItemId }: OwnItSheetProps) {
  const { t } = useTranslation('shop');
  const wishlist = useWishlist();
  const addToWishlist = useAddToWishlist();
  const owned = useWishlistOwned();
  const linkToWardrobe = useLinkToWardrobe(product.kind === 'imported' ? product.id : '');
  const [size, setSize] = useState('');
  const [category, setCategory] = useState<Category | null>(product.category);
  const [subcategory, setSubcategory] = useState<string | null>(product.subcategory);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setError(null);
      setCategory(product.category);
      setSubcategory(product.subcategory);
    }
  }, [visible, product.category, product.subcategory]);

  const needsSubcategory = !product.subcategory;
  const busy = addToWishlist.isPending || owned.isPending || linkToWardrobe.isPending;

  const confirm = async () => {
    setError(null);
    if (needsSubcategory && !subcategory) {
      setError(t('product.ownSubcategoryRequired'));
      return;
    }
    const body: LinkToWardrobeRequest = {
      size: size.trim() || null,
      ...(subcategory && needsSubcategory ? { overrides: { category: category ?? undefined, subcategory } } : {}),
    };
    try {
      let garment: GarmentDetailDto;
      if (product.kind === 'imported') {
        garment = await linkToWardrobe.mutateAsync(body);
      } else {
        let itemId = wishlistItemId ?? findWishlistItem(wishlist.data, { kind: product.kind, id: product.id })?.id ?? null;
        if (!itemId) itemId = (await addToWishlist.mutateAsync({ product: { kind: product.kind, id: product.id } })).id;
        garment = await owned.mutateAsync({ id: itemId, ...body });
      }
      onOwned(garment);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const sizeOptions = product.sizes.map((s) => ({ id: s.label, label: s.label }));

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={t('product.ownConfirmTitle')}
      subtitle={t('product.ownConfirmBody')}
      testID="own-it-sheet"
      footer={<Button label={t('product.ownConfirm')} onPress={confirm} loading={busy} fullWidth testID="own-it-confirm" />}
    >
      <Text variant="bodyStrong">{product.title}</Text>
      {sizeOptions.length ? (
        <View style={{ gap: space.sm }}>
          <Text variant="smallStrong">{t('product.ownSize')}</Text>
          <ChipGroup options={sizeOptions} value={size || null} onChange={(v) => setSize((v as string) ?? '')} testIDPrefix="own-size" />
        </View>
      ) : (
        <TextField label={t('product.ownSize')} value={size} onChangeText={setSize} autoCapitalize="characters" testID="own-size-input" />
      )}
      {needsSubcategory ? (
        <View style={{ gap: space.sm }}>
          <Text variant="smallStrong">{t('product.ownSubcategory')}</Text>
          <ChipGroup
            options={options.categories}
            value={category}
            onChange={(v) => {
              setCategory((v as Category) ?? null);
              setSubcategory(null);
            }}
            scroll
            testIDPrefix="own-category"
          />
          {category ? (
            <ChipGroup options={options.subcategories(category)} value={subcategory} onChange={(v) => setSubcategory((v as string) ?? null)} testIDPrefix="own-subcategory" />
          ) : null}
        </View>
      ) : null}
      {error ? (
        <Text variant="small" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </Sheet>
  );
}
