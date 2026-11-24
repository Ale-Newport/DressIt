import type { OutfitDto } from '@dressit/shared';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { type OutfitFilter, useOutfits } from '@/api/hooks';
import { space } from '@/theme';

import { EmptyState, ErrorState, SegmentedControl, Sheet, SkeletonGrid } from '../ui';
import { OutfitThumb } from './OutfitThumb';

export interface OutfitPickerSheetProps {
  visible: boolean;
  onClose: () => void;
  onPick: (outfit: OutfitDto) => void;
  title?: string;
  subtitle?: string;
  /** Hide this outfit (e.g. when comparing with itself). */
  excludeId?: string | null;
  testID?: string;
}

/** Choose one of the user's saved / favourite outfits. */
export function OutfitPickerSheet({ visible, onClose, onPick, title, subtitle, excludeId, testID = 'outfit-picker' }: OutfitPickerSheetProps) {
  const { t } = useTranslation('outfits');
  const [filter, setFilter] = useState<OutfitFilter>('saved');
  const query = useOutfits(filter);
  const outfits = (query.data ?? []).filter((o) => o.id !== excludeId);

  return (
    <Sheet visible={visible} onClose={onClose} title={title ?? t('picker.outfitTitle')} subtitle={subtitle} testID={testID}>
      <SegmentedControl<OutfitFilter>
        value={filter}
        onChange={setFilter}
        segments={[
          { id: 'saved', label: t('segments.saved'), testID: `${testID}-saved` },
          { id: 'favorites', label: t('segments.favorites'), testID: `${testID}-favorites` },
          { id: 'all', label: t('segments.all'), testID: `${testID}-all` },
        ]}
      />
      {query.data === undefined && query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} compact />
      ) : query.data === undefined ? (
        <SkeletonGrid columns={2} items={4} />
      ) : outfits.length === 0 ? (
        <EmptyState compact icon="layers" title={t('picker.noOutfits')} body={t('picker.noOutfitsBody')} />
      ) : (
        <View style={styles.grid}>
          {outfits.map((o) => (
            <View key={o.id} style={styles.cell}>
              <OutfitThumb
                outfit={o}
                testID={`${testID}-item-${o.id}`}
                onPress={() => {
                  onPick(o);
                  onClose();
                }}
              />
            </View>
          ))}
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  cell: { width: '47%' },
});
