import type { OutfitDto, OutfitSlot } from '@dressit/shared';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { errorMessage } from '@/api/client';
import { useAlternatives, useSwapOutfitItem } from '@/api/hooks';
import { slotLabel } from '@/lib/vocab';
import { space } from '@/theme';

import { Button, ChipGroup, EmptyState, ErrorState, GarmentTile, Sheet, SkeletonGrid, Text, useToast } from '../ui';

/** Slots that can be removed (optional layers) per the API contract. */
const OPTIONAL_SLOTS = (slot: string) => slot === 'outer' || slot === 'mid' || slot.startsWith('accessory:');

export interface AlternativesSheetProps {
  outfit: OutfitDto | null;
  /** Preselect a slot (otherwise the user picks one). */
  initialSlot?: OutfitSlot | null;
  visible: boolean;
  onClose: () => void;
  onSwapped?: (outfit: OutfitDto) => void;
}

/** "Cambiar una prenda": pick slot → GET alternatives → POST swap. */
export function AlternativesSheet({ outfit, initialSlot, visible, onClose, onSwapped }: AlternativesSheetProps) {
  const toast = useToast();
  const [slot, setSlot] = useState<OutfitSlot | null>(initialSlot ?? null);
  const activeSlot = slot ?? initialSlot ?? outfit?.items[0]?.slot ?? null;
  const alternatives = useAlternatives(visible ? outfit?.id : undefined, visible ? activeSlot ?? undefined : undefined);
  const swap = useSwapOutfitItem(outfit?.id ?? '');

  const doSwap = (garmentId: string | null) => {
    if (!outfit || !activeSlot) return;
    swap.mutate(
      { slot: activeSlot, garmentId },
      {
        onSuccess: (o) => {
          toast.show({ message: garmentId ? 'Prenda cambiada' : 'Prenda quitada', tone: 'success' });
          onSwapped?.(o);
          onClose();
        },
        onError: (e) => toast.show({ message: errorMessage(e), tone: 'error' }),
      },
    );
  };

  const slotOptions = (outfit?.items ?? []).filter((i) => i.garment).map((i) => ({ id: i.slot, label: slotLabel(i.slot) }));

  return (
    <Sheet visible={visible} onClose={onClose} title="Cambiar una prenda" subtitle="Elige qué parte quieres cambiar" testID="alternatives-sheet">
      <ChipGroup
        options={slotOptions}
        value={activeSlot}
        onChange={(v) => setSlot((v as OutfitSlot) ?? activeSlot)}
        allowDeselect={false}
        scroll
        accessibilityLabel="Parte del conjunto"
        testIDPrefix="alt-slot"
      />
      {alternatives.isPending ? (
        <SkeletonGrid columns={3} items={6} />
      ) : alternatives.isError ? (
        <ErrorState error={alternatives.error} onRetry={() => alternatives.refetch()} compact />
      ) : alternatives.data && alternatives.data.alternatives.length === 0 ? (
        <EmptyState compact icon="shuffle" title="Sin alternativas" body="No hay otras prendas disponibles que encajen en esta parte del conjunto." />
      ) : (
        <View style={styles.grid}>
          {alternatives.data?.alternatives.map((a) => (
            <View key={a.garment.id} style={styles.cell}>
              <GarmentTile garment={a.garment} onPress={() => doSwap(a.garment.id)} caption={a.reason} testID={`alt-${a.garment.id}`} />
              <Text variant="caption" tone={a.delta >= 0 ? 'success' : 'muted'}>
                {a.delta >= 0 ? `+${Math.round(a.delta * (Math.abs(a.delta) <= 1 ? 100 : 1))}` : Math.round(a.delta * (Math.abs(a.delta) <= 1 ? 100 : 1))} puntos
              </Text>
            </View>
          ))}
        </View>
      )}
      {activeSlot && OPTIONAL_SLOTS(activeSlot) ? (
        <Button label={`Quitar ${slotLabel(activeSlot).toLowerCase()}`} variant="secondary" icon="minus-circle" onPress={() => doSwap(null)} loading={swap.isPending} />
      ) : null}
      {swap.isError ? (
        <Text variant="small" tone="danger">
          {errorMessage(swap.error)}
        </Text>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  cell: { width: '30%', gap: 2 },
});
