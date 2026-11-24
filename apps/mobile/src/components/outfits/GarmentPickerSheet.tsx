import { type Category, type GarmentDto, getSubcategory, type OutfitSlot } from '@dressit/shared';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useGarments } from '@/api/hooks';
import { slotLabel } from '@/lib/vocab';
import { space } from '@/theme';

import { Button, EmptyState, ErrorState, GarmentTile, Sheet, SkeletonGrid, TextField } from '../ui';
import { useDebounced } from './useDebounced';

/** Wardrobe category that can fill each outfit slot. */
export function categoryForSlot(slot: OutfitSlot): Category {
  if (slot === 'base' || slot === 'mid') return 'top';
  if (slot === 'outer') return 'outerwear';
  if (slot === 'bottom') return 'bottom';
  if (slot === 'one_piece') return 'one_piece';
  if (slot === 'footwear') return 'footwear';
  return 'accessory';
}

/** Does a garment naturally belong to the slot (layer / accessory sub-slot)? */
export function fitsSlot(g: GarmentDto, slot: OutfitSlot): boolean {
  const sub = getSubcategory(g.subcategory);
  if (!sub) return true;
  if (slot === 'base' || slot === 'mid') return sub.layer === slot;
  if (slot.startsWith('accessory:')) return sub.accessorySlot === slot.slice('accessory:'.length);
  return true;
}

export interface GarmentPickerSheetProps {
  visible: boolean;
  slot: OutfitSlot | null;
  onClose: () => void;
  onPick: (garment: GarmentDto) => void;
  selectedId?: string | null;
  testID?: string;
}

/** Pick a garment from the wardrobe for an outfit slot (search + category filter). */
export function GarmentPickerSheet({ visible, slot, onClose, onPick, selectedId, testID = 'garment-picker' }: GarmentPickerSheetProps) {
  const { t } = useTranslation('outfits');
  const [q, setQ] = useState('');
  const [showAll, setShowAll] = useState(false);
  const debouncedQ = useDebounced(q.trim());
  const category = slot ? categoryForSlot(slot) : undefined;
  const query = useGarments({ q: debouncedQ || undefined, category, status: 'all', sort: 'recent', limit: 60 }, visible && !!slot);

  const garments = useMemo(() => {
    const all = query.data?.pages.flatMap((p) => p.items) ?? [];
    if (!slot || showAll) return all;
    const matching = all.filter((g) => fitsSlot(g, slot));
    return matching.length > 0 ? matching : all;
  }, [query.data, slot, showAll]);

  const narrowed = !!slot && (slot === 'base' || slot === 'mid' || slot.startsWith('accessory:'));

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={t('picker.garmentTitle')}
      subtitle={slot ? t('picker.garmentSubtitle', { slot: slotLabel(slot) }) : undefined}
      testID={testID}
    >
      <TextField
        icon="search"
        placeholder={t('picker.search')}
        accessibilityLabel={t('picker.search')}
        value={q}
        onChangeText={setQ}
        onClear={() => setQ('')}
        autoCorrect={false}
        returnKeyType="search"
        testID={`${testID}-search`}
      />
      {query.data === undefined && query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} compact />
      ) : query.data === undefined ? (
        <SkeletonGrid columns={3} items={6} />
      ) : garments.length === 0 ? (
        <EmptyState compact icon="grid" title={t('picker.noGarments')} body={t('picker.noGarmentsBody')} />
      ) : (
        <>
          <View style={styles.grid}>
            {garments.map((g) => (
              <View key={g.id} style={styles.cell}>
                <GarmentTile
                  garment={g}
                  selected={g.id === selectedId}
                  selectionMode={g.id === selectedId}
                  testID={`${testID}-item-${g.id}`}
                  onPress={() => {
                    onPick(g);
                    onClose();
                  }}
                />
              </View>
            ))}
          </View>
          {query.hasNextPage ? (
            <Button
              label="Cargar más"
              variant="secondary"
              onPress={() => query.fetchNextPage()}
              loading={query.isFetchingNextPage}
              testID={`${testID}-more`}
            />
          ) : null}
          {narrowed && !showAll ? <Button label={t('picker.showAll')} variant="ghost" onPress={() => setShowAll(true)} /> : null}
        </>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  cell: { width: '30%' },
});
