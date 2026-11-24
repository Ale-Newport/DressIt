import type { GarmentDto, GarmentStatus, OutfitDto, RecommendationRequest } from '@dressit/shared';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button, Chip, Divider, GarmentTile, ListRow, Sheet, Text } from '@/components/ui';
import { subcategoryLabel } from '@/lib/vocab';
import { space } from '@/theme';

export type Adjustments = NonNullable<RecommendationRequest['adjustments']>;
export type AdjustmentKey = 'formalUp' | 'formalDown' | 'warmer' | 'elegant';

export const ADJUSTMENT_KEYS: AdjustmentKey[] = ['formalUp', 'formalDown', 'warmer', 'elegant'];

export function isAdjustmentActive(adj: Adjustments, key: AdjustmentKey): boolean {
  switch (key) {
    case 'formalUp':
      return adj.formality === 1;
    case 'formalDown':
      return adj.formality === -1;
    case 'warmer':
      return adj.warmth === 1;
    case 'elegant':
      return adj.elegance === 1;
  }
}

/** Toggles one adjustment; "más formal" and "más informal" are mutually exclusive. */
export function toggleAdjustment(adj: Adjustments, key: AdjustmentKey): Adjustments {
  const next: Adjustments = { ...adj };
  const active = isAdjustmentActive(adj, key);
  switch (key) {
    case 'formalUp':
      next.formality = active ? 0 : 1;
      break;
    case 'formalDown':
      next.formality = active ? 0 : -1;
      break;
    case 'warmer':
      next.warmth = active ? 0 : 1;
      break;
    case 'elegant':
      next.elegance = active ? 0 : 1;
      break;
  }
  return next;
}

/** Drops neutral values so the request (and the cache key) stay minimal. */
export function compactAdjustments(adj: Adjustments): Adjustments | undefined {
  const out: Adjustments = {};
  if (adj.formality) out.formality = adj.formality;
  if (adj.warmth) out.warmth = adj.warmth;
  if (adj.elegance) out.elegance = adj.elegance;
  return Object.keys(out).length ? out : undefined;
}

export interface MoreOptionsSheetProps {
  outfit: OutfitDto | null;
  visible: boolean;
  onClose: () => void;
  adjustments: Adjustments;
  onToggleAdjustment: (key: AdjustmentKey) => void;
  onRegenerate: () => void;
  onMarkUnavailable: (garment: GarmentDto, status: Extract<GarmentStatus, 'laundry' | 'stored'>) => void;
  markingGarmentId?: string | null;
}

/**
 * Secondary actions for one outfit: adjustments (más formal/informal/abrigado/elegante),
 * "esta prenda está sucia / no disponible" and regenerate. A single sheet with an
 * internal second step avoids stacking two native modals.
 */
export function MoreOptionsSheet({
  outfit,
  visible,
  onClose,
  adjustments,
  onToggleAdjustment,
  onRegenerate,
  onMarkUnavailable,
  markingGarmentId,
}: MoreOptionsSheetProps) {
  const { t } = useTranslation('home');
  const { t: tc } = useTranslation();
  const [picked, setPicked] = useState<GarmentDto | null>(null);
  useEffect(() => {
    if (!visible) setPicked(null);
  }, [visible]);

  const garments = (outfit?.items ?? []).map((i) => i.garment).filter((g): g is GarmentDto => !!g);

  if (picked) {
    const name = picked.name || subcategoryLabel(picked.subcategory);
    return (
      <Sheet visible={visible} onClose={onClose} title={t('unavailableSheet.title', { name })} subtitle={t('unavailableSheet.subtitle')} testID="home-unavailable-sheet">
        <ListRow
          icon="droplet"
          title={t('unavailableSheet.dirty')}
          accessibilityHint={t('unavailableSheet.dirtyHint')}
          onPress={() => onMarkUnavailable(picked, 'laundry')}
          testID="home-unavailable-laundry"
        />
        <Divider />
        <ListRow
          icon="archive"
          title={t('unavailableSheet.unavailable')}
          accessibilityHint={t('unavailableSheet.unavailableHint')}
          onPress={() => onMarkUnavailable(picked, 'stored')}
          testID="home-unavailable-stored"
        />
        {markingGarmentId === picked.id ? (
          <Text variant="small" tone="muted" accessibilityLiveRegion="polite">
            {t('toasts.regenerating')}
          </Text>
        ) : null}
        <Button label={tc('actions.back')} variant="ghost" icon="arrow-left" onPress={() => setPicked(null)} testID="home-unavailable-back" />
      </Sheet>
    );
  }

  return (
    <Sheet visible={visible} onClose={onClose} title={t('moreSheet.title')} subtitle={t('moreSheet.subtitle')} testID="home-more-sheet">
      <View style={styles.block}>
        <Text variant="smallStrong">{t('moreSheet.adjustTitle')}</Text>
        <View style={styles.chips}>
          {ADJUSTMENT_KEYS.map((key) => (
            <Chip
              key={key}
              label={t(`adjustments.${key}`)}
              selected={isAdjustmentActive(adjustments, key)}
              role="checkbox"
              onPress={() => onToggleAdjustment(key)}
              testID={`home-adjust-${key}`}
            />
          ))}
        </View>
      </View>
      {garments.length ? (
        <View style={styles.block}>
          <Text variant="smallStrong">{t('moreSheet.unavailableTitle')}</Text>
          <Text variant="small" tone="muted">
            {t('moreSheet.unavailableBody')}
          </Text>
          <View style={styles.grid}>
            {garments.map((g) => (
              <View key={g.id} style={styles.cell}>
                <GarmentTile garment={g} onPress={() => setPicked(g)} testID={`home-unavailable-pick-${g.id}`} />
              </View>
            ))}
          </View>
        </View>
      ) : null}
      <Button
        label={t('moreSheet.regenerate')}
        variant="secondary"
        icon="refresh-cw"
        onPress={() => {
          onRegenerate();
          onClose();
        }}
        testID="home-more-regenerate"
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  block: { gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  cell: { width: '30%' },
});
