import type { Fit, PreferencesDto, Priority, StyleId } from '@dressit/shared';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { TimeField } from '@/components/DateField';
import { Button, Chip, ChipGroup, ListRow, SegmentedControl, Text, TextField } from '@/components/ui';
import { hhmmToMinutes } from '@/lib/dates';
import { options } from '@/lib/vocab';
import { space } from '@/theme';

export type PrefsDraft = Partial<PreferencesDto>;

export interface SectionProps {
  value: PrefsDraft;
  onChange: (patch: PrefsDraft) => void;
}

export const DEFAULT_DAY_WINDOW = { start: '08:00', end: '20:00' };
export const DEFAULT_PRIORITIES: Record<Priority, number> = { comfort: 1 / 3, elegance: 1 / 3, practicality: 1 / 3 };
const PRIORITIES: Priority[] = ['comfort', 'elegance', 'practicality'];

function Label({ children }: { children: string }) {
  return <Text variant="subheading">{children}</Text>;
}

export function StylesSection({ value, onChange }: SectionProps) {
  const { t } = useTranslation('profile');
  return (
    <View style={styles.section}>
      <Label>{t('preferences.styles')}</Label>
      <ChipGroup
        options={options.styles}
        value={value.preferredStyles ?? []}
        onChange={(v) => onChange({ preferredStyles: (v as StyleId[]) ?? [] })}
        multiple
        testIDPrefix="pref-style"
        accessibilityLabel={t('preferences.styles')}
      />
    </View>
  );
}

export function ColorsSection({ value, onChange }: SectionProps) {
  const { t } = useTranslation('profile');
  const fav = value.favoriteColors ?? [];
  const avoid = value.avoidedColors ?? [];
  return (
    <View style={styles.section}>
      <Label>{t('preferences.favoriteColors')}</Label>
      <ChipGroup
        options={options.colors}
        value={fav}
        multiple
        testIDPrefix="pref-fav-color"
        accessibilityLabel={t('preferences.favoriteColors')}
        onChange={(v) => {
          const next = (v as string[]) ?? [];
          onChange({ favoriteColors: next, avoidedColors: avoid.filter((c) => !next.includes(c)) });
        }}
      />
      <Label>{t('preferences.avoidedColors')}</Label>
      <ChipGroup
        options={options.colors}
        value={avoid}
        multiple
        testIDPrefix="pref-avoid-color"
        accessibilityLabel={t('preferences.avoidedColors')}
        onChange={(v) => {
          const next = (v as string[]) ?? [];
          onChange({ avoidedColors: next, favoriteColors: fav.filter((c) => !next.includes(c)) });
        }}
      />
    </View>
  );
}

export function FitSizesSection({ value, onChange }: SectionProps) {
  const { t } = useTranslation('profile');
  const fit = value.fitPreferences ?? {};
  const sizes = value.sizes ?? {};
  const setSize = (k: keyof NonNullable<PreferencesDto['sizes']>, v: string) => onChange({ sizes: { ...sizes, [k]: v.trim() ? v : undefined } });
  return (
    <View style={styles.section}>
      <Label>{t('preferences.fitTop')}</Label>
      <ChipGroup options={options.fits} value={fit.top ?? null} onChange={(v) => onChange({ fitPreferences: { ...fit, top: (v as Fit) ?? undefined } })} testIDPrefix="pref-fit-top" />
      <Label>{t('preferences.fitBottom')}</Label>
      <ChipGroup
        options={options.fits}
        value={fit.bottom ?? null}
        onChange={(v) => onChange({ fitPreferences: { ...fit, bottom: (v as Fit) ?? undefined } })}
        testIDPrefix="pref-fit-bottom"
      />
      <Label>{t('preferences.sizes')}</Label>
      <View style={styles.grid2}>
        <TextField containerStyle={styles.half} label={t('preferences.sizeTop')} value={sizes.top ?? ''} onChangeText={(v) => setSize('top', v)} placeholder="M" autoCapitalize="characters" />
        <TextField containerStyle={styles.half} label={t('preferences.sizeBottom')} value={sizes.bottom ?? ''} onChangeText={(v) => setSize('bottom', v)} placeholder="40" />
        <TextField containerStyle={styles.half} label={t('preferences.sizeShoes')} value={sizes.shoes ?? ''} onChangeText={(v) => setSize('shoes', v)} placeholder="41" keyboardType="numbers-and-punctuation" />
        <TextField containerStyle={styles.half} label={t('preferences.sizeDress')} value={sizes.dress ?? ''} onChangeText={(v) => setSize('dress', v)} placeholder="38" />
      </View>
    </View>
  );
}

function parseEuros(s: string): number | null {
  const n = Number(s.replace(',', '.').replace(/[^\d.]/g, ''));
  return s.trim() === '' || !Number.isFinite(n) ? null : Math.round(n);
}

export function budgetError(value: PrefsDraft): boolean {
  const b = value.budget;
  return !!b && b.minEur != null && b.maxEur != null && b.minEur > b.maxEur;
}

export function BrandsBudgetSection({ value, onChange }: SectionProps) {
  const { t } = useTranslation('profile');
  const { t: tc } = useTranslation();
  const [brand, setBrand] = useState('');
  const brands = value.favoriteBrands ?? [];
  const budget = value.budget ?? { minEur: null, maxEur: null };
  const sus = value.sustainability ?? { secondHand: false, prioritizeSustainable: false };
  const addBrand = () => {
    const b = brand.trim();
    if (!b || brands.some((x) => x.toLowerCase() === b.toLowerCase())) return;
    onChange({ favoriteBrands: [...brands, b] });
    setBrand('');
  };
  return (
    <View style={styles.section}>
      <Label>{t('preferences.brands')}</Label>
      <View style={styles.row}>
        <TextField
          containerStyle={{ flex: 1 }}
          value={brand}
          onChangeText={setBrand}
          placeholder={t('preferences.brandsPlaceholder')}
          accessibilityLabel={t('preferences.brands')}
          onSubmitEditing={addBrand}
          returnKeyType="done"
          testID="pref-brand-input"
        />
        <Button label={tc('actions.add')} variant="secondary" size="sm" onPress={addBrand} disabled={!brand.trim()} />
      </View>
      {brands.length ? (
        <View style={styles.wrap}>
          {brands.map((b) => (
            <Chip
              key={b}
              label={b}
              icon="x"
              selected
              onPress={() => onChange({ favoriteBrands: brands.filter((x) => x !== b) })}
              accessibilityHint="Quitar marca"
            />
          ))}
        </View>
      ) : null}
      <Label>{t('preferences.budget')}</Label>
      <View style={styles.grid2}>
        <TextField
          containerStyle={styles.half}
          label={t('preferences.budgetMin')}
          keyboardType="number-pad"
          value={budget.minEur != null ? String(budget.minEur) : ''}
          onChangeText={(v) => onChange({ budget: { ...budget, minEur: parseEuros(v) } })}
          placeholder="20"
        />
        <TextField
          containerStyle={styles.half}
          label={t('preferences.budgetMax')}
          keyboardType="number-pad"
          value={budget.maxEur != null ? String(budget.maxEur) : ''}
          onChangeText={(v) => onChange({ budget: { ...budget, maxEur: parseEuros(v) } })}
          placeholder="120"
        />
      </View>
      {budgetError(value) ? (
        <Text variant="small" tone="danger">
          {t('preferences.budgetError')}
        </Text>
      ) : null}
      <Label>{t('preferences.sustainability')}</Label>
      <ListRow title={t('preferences.secondHand')} switchValue={sus.secondHand} onSwitchChange={(v) => onChange({ sustainability: { ...sus, secondHand: v } })} testID="pref-second-hand" />
      <ListRow
        title={t('preferences.prioritizeSustainable')}
        switchValue={sus.prioritizeSustainable}
        onSwitchChange={(v) => onChange({ sustainability: { ...sus, prioritizeSustainable: v } })}
      />
    </View>
  );
}

/** 1–3 importance levels → weights that sum to 1. Exported for tests. */
export function levelsToWeights(levels: Record<Priority, number>): Record<Priority, number> {
  const total = PRIORITIES.reduce((a, p) => a + levels[p], 0) || 1;
  const out = {} as Record<Priority, number>;
  for (const p of PRIORITIES) out[p] = Math.round((levels[p] / total) * 1000) / 1000;
  return out;
}

export function weightsToLevels(weights: Record<Priority, number> | undefined): Record<Priority, number> {
  const w = weights ?? DEFAULT_PRIORITIES;
  const max = Math.max(...PRIORITIES.map((p) => w[p] ?? 0), 0.0001);
  const out = {} as Record<Priority, number>;
  for (const p of PRIORITIES) out[p] = Math.max(1, Math.min(3, Math.round(((w[p] ?? 0) / max) * 3)));
  return out;
}

export function dayWindowError(value: PrefsDraft): boolean {
  const d = value.dayWindow;
  return !!d && hhmmToMinutes(d.end) <= hhmmToMinutes(d.start);
}

export function RoutineSection({ value, onChange }: SectionProps) {
  const { t } = useTranslation('profile');
  const levels = weightsToLevels(value.priorities);
  const temp = value.temperatureSensitivity ?? 0;
  const day = value.dayWindow ?? DEFAULT_DAY_WINDOW;
  const LEVEL_LABELS = ['Poca', 'Media', 'Mucha'];
  const tempOptions = [
    { id: '-2', label: t('preferences.temperatureLevels.m2') },
    { id: '-1', label: t('preferences.temperatureLevels.m1') },
    { id: '0', label: t('preferences.temperatureLevels.z') },
    { id: '1', label: t('preferences.temperatureLevels.p1') },
    { id: '2', label: t('preferences.temperatureLevels.p2') },
  ];
  return (
    <View style={styles.section}>
      <Label>{t('preferences.contexts')}</Label>
      <ChipGroup
        options={options.occasions}
        value={value.usualContexts ?? []}
        onChange={(v) => onChange({ usualContexts: (v as string[]) ?? [] })}
        multiple
        testIDPrefix="pref-context"
      />
      <Label>{t('preferences.priorities')}</Label>
      <Text variant="small" tone="muted">
        {t('preferences.prioritiesHint')}
      </Text>
      {PRIORITIES.map((p) => (
        <View key={p} style={{ gap: space.xs }}>
          <Text variant="smallStrong">{t(`preferences.priority.${p}`)}</Text>
          <SegmentedControl
            accessibilityLabel={t(`preferences.priority.${p}`)}
            segments={LEVEL_LABELS.map((l, i) => ({ id: String(i + 1), label: l, testID: `pref-priority-${p}-${i + 1}` }))}
            value={String(levels[p])}
            onChange={(v) => onChange({ priorities: levelsToWeights({ ...levels, [p]: Number(v) }) })}
          />
        </View>
      ))}
      <Label>{t('preferences.temperature')}</Label>
      <ChipGroup
        options={tempOptions}
        value={String(temp)}
        allowDeselect={false}
        onChange={(v) => onChange({ temperatureSensitivity: Number(v ?? 0) })}
        testIDPrefix="pref-temp"
      />
      <Label>{t('preferences.dayWindow')}</Label>
      <View style={styles.grid2}>
        <View style={styles.half}>
          <TimeField label={t('preferences.dayStart')} value={day.start} onChange={(v) => onChange({ dayWindow: { ...day, start: v } })} testID="pref-day-start" />
        </View>
        <View style={styles.half}>
          <TimeField label={t('preferences.dayEnd')} value={day.end} onChange={(v) => onChange({ dayWindow: { ...day, end: v } })} testID="pref-day-end" />
        </View>
      </View>
      {dayWindowError({ dayWindow: day }) ? (
        <Text variant="small" tone="danger">
          {t('preferences.dayWindowError')}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  grid2: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  half: { flexGrow: 1, flexBasis: '45%' },
});
