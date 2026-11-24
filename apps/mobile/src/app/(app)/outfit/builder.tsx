import { ACCESSORY_SLOTS, type GarmentDto, type OutfitDto, type OutfitItemDto, type OutfitSlot } from '@dressit/shared';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { errorMessage } from '@/api/client';
import { useCreateOutfit } from '@/api/hooks';
import { OutfitCard } from '@/components/OutfitCard';
import { validateBuilder } from '@/components/outfits/builderValidation';
import { GarmentPickerSheet } from '@/components/outfits/GarmentPickerSheet';
import {
  Button,
  ChipGroup,
  Divider,
  GarmentSilhouette,
  garmentColor,
  Icon,
  OfflineBanner,
  OutfitCanvas,
  Screen,
  SectionHeader,
  Text,
  TextField,
  useToast,
} from '@/components/ui';
import { options, slotLabel, subcategoryLabel } from '@/lib/vocab';
import { hairline, radius, space, useTheme } from '@/theme';

const CORE_SLOTS: OutfitSlot[] = ['base', 'mid', 'outer', 'bottom', 'one_piece', 'footwear'];

export default function OutfitBuilderScreen() {
  const { t } = useTranslation('outfits');
  const router = useRouter();
  const toast = useToast();
  const create = useCreateOutfit();
  const [picks, setPicks] = useState<Partial<Record<string, GarmentDto>>>({});
  const [accessorySlots, setAccessorySlots] = useState<OutfitSlot[]>([]);
  const [pickerSlot, setPickerSlot] = useState<OutfitSlot | null>(null);
  const [name, setName] = useState('');
  const [occasion, setOccasion] = useState<string | null>(null);
  const [result, setResult] = useState<OutfitDto | null>(null);

  const items: OutfitItemDto[] = useMemo(
    () =>
      Object.entries(picks)
        .filter((e): e is [string, GarmentDto] => !!e[1])
        .map(([slot, garment]) => ({ slot: slot as OutfitSlot, garment, candidateProduct: null })),
    [picks],
  );
  const validation = validateBuilder(picks);
  const slots = [...CORE_SLOTS, ...accessorySlots];
  const unusedAccessories = ACCESSORY_SLOTS.filter((s) => !accessorySlots.includes(`accessory:${s}`));

  const setPick = (slot: OutfitSlot, g: GarmentDto | null) => {
    setResult(null);
    setPicks((prev) => {
      const next = { ...prev };
      if (g) next[slot] = g;
      else delete next[slot];
      return next;
    });
  };

  const save = () => {
    if (!validation.ok) return;
    create.mutate(
      {
        name: name.trim() || undefined,
        occasion: occasion ?? undefined,
        items: items.map((i) => ({ slot: i.slot, garmentId: i.garment!.id })),
      },
      {
        onSuccess: (o) => {
          setResult(o);
          toast.show({ message: t('builder.created'), tone: 'success' });
        },
        onError: (e) => toast.show({ message: errorMessage(e), tone: 'error' }),
      },
    );
  };

  if (result) {
    return (
      <Screen testID="outfit-builder-result">
        <SectionHeader title={t('builder.resultTitle')} />
        <OutfitCard outfit={result} maxExplanation={6} />
        <Button
          label={t('builder.open')}
          iconRight="arrow-right"
          fullWidth
          onPress={() => router.replace({ pathname: '/outfit/[id]', params: { id: result.id } })}
          testID="outfit-builder-open"
        />
        <Button
          label={t('builder.another')}
          variant="secondary"
          fullWidth
          onPress={() => {
            setResult(null);
            setPicks({});
            setAccessorySlots([]);
            setName('');
            setOccasion(null);
            create.reset();
          }}
        />
      </Screen>
    );
  }

  return (
    <Screen
      testID="outfit-builder-screen"
      footer={
        <View style={{ gap: space.sm }}>
          {validation.error ? (
            <Text variant="small" tone="warning" accessibilityLiveRegion="polite">
              {t(`builder.${validation.error}`)}
            </Text>
          ) : validation.warnFootwear ? (
            <Text variant="small" tone="muted">
              {t('builder.noFootwear')}
            </Text>
          ) : null}
          <Button
            label={t('builder.save')}
            fullWidth
            disabled={!validation.ok}
            loading={create.isPending}
            onPress={save}
            accessibilityHint={t('builder.scoreNote')}
            testID="outfit-builder-save"
          />
        </View>
      }
    >
      <OfflineBanner />
      <Text variant="body" tone="muted">
        {t('builder.intro')}
      </Text>

      <View style={{ gap: space.sm }}>
        <Text variant="overline" tone="muted">
          {t('builder.preview')}
        </Text>
        {items.length ? (
          <OutfitCanvas items={items} layout={null} testID="outfit-builder-preview" />
        ) : (
          <PreviewEmpty />
        )}
        <Text variant="caption" tone="muted">
          {t('builder.scoreNote')}
        </Text>
      </View>

      <View>
        <SectionHeader title={t('builder.slots')} />
        <View style={{ gap: space.xs }}>
          {slots.map((slot, i) => (
            <View key={slot}>
              {i > 0 ? <Divider /> : null}
              <SlotRow
                slot={slot}
                garment={picks[slot] ?? null}
                onChoose={() => setPickerSlot(slot)}
                onRemove={() => {
                  setPick(slot, null);
                  if (slot.startsWith('accessory:')) setAccessorySlots((prev) => prev.filter((s) => s !== slot));
                }}
              />
            </View>
          ))}
        </View>
      </View>

      {unusedAccessories.length ? (
        <View style={{ gap: space.sm }}>
          <Text variant="smallStrong">{t('builder.addAccessory')}</Text>
          <ChipGroup
            options={options.accessorySlots.filter((o) => unusedAccessories.includes(o.id))}
            value={null}
            onChange={(v) => {
              if (typeof v !== 'string') return;
              const slot = `accessory:${v}` as OutfitSlot;
              setAccessorySlots((prev) => [...prev, slot]);
              setPickerSlot(slot);
            }}
            scroll
            testIDPrefix="builder-accessory"
            accessibilityLabel={t('builder.addAccessory')}
          />
        </View>
      ) : null}

      <TextField label={t('builder.name')} placeholder={t('builder.namePlaceholder')} value={name} onChangeText={setName} maxLength={80} testID="outfit-builder-name" />
      <View style={{ gap: space.sm }}>
        <Text variant="smallStrong">{t('builder.occasion')}</Text>
        <ChipGroup options={options.occasions} value={occasion} onChange={(v) => setOccasion((v as string) ?? null)} testIDPrefix="builder-occasion" accessibilityLabel={t('builder.occasion')} />
      </View>

      <GarmentPickerSheet
        visible={!!pickerSlot}
        slot={pickerSlot}
        selectedId={pickerSlot ? picks[pickerSlot]?.id : null}
        onClose={() => setPickerSlot(null)}
        onPick={(g) => pickerSlot && setPick(pickerSlot, g)}
      />
    </Screen>
  );
}

function PreviewEmpty() {
  const { colors } = useTheme();
  const { t } = useTranslation('outfits');
  return (
    <View style={[styles.previewEmpty, { backgroundColor: colors.surfaceAlt }]}>
      <Icon name="layers" size={24} color={colors.inkSubtle} />
      <Text variant="small" tone="muted">
        {t('builder.previewEmpty')}
      </Text>
    </View>
  );
}

function SlotRow({ slot, garment, onChoose, onRemove }: { slot: OutfitSlot; garment: GarmentDto | null; onChoose: () => void; onRemove: () => void }) {
  const { colors } = useTheme();
  const { t } = useTranslation('outfits');
  const label = slotLabel(slot);
  return (
    <View style={styles.slotRow} testID={`builder-slot-${slot}`}>
      <Pressable
        onPress={onChoose}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${garment ? garment.name || subcategoryLabel(garment.subcategory) : t('builder.empty')}`}
        accessibilityHint={garment ? t('builder.change') : t('builder.choose')}
        style={({ pressed }) => [styles.slotMain, { opacity: pressed ? 0.7 : 1 }]}
      >
        <View style={[styles.slotThumb, { backgroundColor: colors.surfaceAlt, borderColor: colors.line }]}>
          {garment?.image ? (
            <Image
              source={{ uri: garment.image.thumbUrl || garment.image.url, cacheKey: `img-${garment.image.id}-thumb` }}
              style={StyleSheet.absoluteFill}
              contentFit={garment.image.isCutout ? 'contain' : 'cover'}
              accessible={false}
            />
          ) : garment ? (
            <GarmentSilhouette category={garment.category} subcategory={garment.subcategory} color={garmentColor(garment)} />
          ) : (
            <Icon name="plus" size={18} color={colors.inkSubtle} />
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="caption" tone="muted">
            {label}
          </Text>
          <Text variant="body" tone={garment ? 'default' : 'subtle'} numberOfLines={1}>
            {garment ? garment.name || subcategoryLabel(garment.subcategory) : t('builder.empty')}
          </Text>
        </View>
      </Pressable>
      {garment ? (
        <Button size="sm" variant="ghost" label={t('builder.remove')} onPress={onRemove} accessibilityHint={label} testID={`builder-slot-${slot}-remove`} />
      ) : (
        <Button size="sm" variant="secondary" label={t('builder.choose')} onPress={onChoose} accessibilityHint={label} testID={`builder-slot-${slot}-choose`} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  previewEmpty: { aspectRatio: 4 / 5, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', gap: space.sm },
  slotRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 64, paddingVertical: space.xs },
  slotMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md },
  slotThumb: { width: 48, height: 56, borderRadius: radius.sm, borderWidth: hairline, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
});
