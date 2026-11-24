import {
  type Category,
  COLOR_FAMILIES,
  type Condition,
  type Fit,
  getColorFamily,
  nearestColorFamily,
  type GarmentWriteDto,
  type Season,
  type StyleId,
} from '@dressit/shared';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useSpaces, useTags } from '@/api/hooks';
import { DateField } from '@/components/DateField';
import { Button, Chip, ChipGroup, IconButton, ListRow, Text, TextField } from '@/components/ui';
import { options } from '@/lib/vocab';
import { space } from '@/theme';

export type FieldKey =
  | 'name'
  | 'category'
  | 'subcategory'
  | 'brand'
  | 'colors'
  | 'pattern'
  | 'materials'
  | 'styles'
  | 'seasons'
  | 'occasions'
  | 'fit'
  | 'size'
  | 'condition'
  | 'waterproof'
  | 'spaceId'
  | 'tags'
  | 'notes'
  | 'purchaseDate'
  | 'purchasePrice'
  | 'formality'
  | 'warmth';

/** Colour families selected in a draft (from hexes; arbitrary photo colours map to the nearest family). */
export function familiesFromColors(colors: GarmentWriteDto['colors']): string[] {
  const out: string[] = [];
  for (const c of colors ?? []) {
    try {
      const exact = COLOR_FAMILIES.find((f) => f.hex.toLowerCase() === c.hex.toLowerCase());
      const fam = exact?.id ?? nearestColorFamily(c.hex).family;
      if (!out.includes(fam)) out.push(fam);
    } catch {
      // invalid hex: ignore
    }
  }
  return out;
}

export function colorsFromFamilies(families: string[]): NonNullable<GarmentWriteDto['colors']> {
  return families
    .map((id) => getColorFamily(id))
    .filter((f): f is NonNullable<typeof f> => !!f)
    .map((f, i, arr) => ({ hex: f.hex, share: arr.length === 1 ? 1 : i === 0 ? 0.6 : 0.4 / (arr.length - 1) }));
}

/** "39,95" → 3995 cents; null when empty; NaN when invalid. */
export function parseEuroToCents(input: string): number | null {
  const s = input.trim().replace(/\s|€/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return Number.NaN;
  return Math.round(n * 100);
}

export function centsToEuroInput(cents: number | null | undefined): string {
  if (cents == null) return '';
  return (cents / 100).toFixed(2).replace('.', ',');
}

/** Step for a numeric attribute whose scale is unknown (0–1 or 0–100). */
function stepFor(value: number): { step: number; max: number } {
  return value <= 1 ? { step: 0.05, max: 1 } : { step: 5, max: 100 };
}

export interface GarmentFieldEditorProps {
  field: FieldKey;
  draft: GarmentWriteDto;
  onChange: (patch: Partial<GarmentWriteDto>) => void;
  /** Hide the field label (when the container already shows it). */
  hideLabel?: boolean;
  testIDPrefix?: string;
}

/**
 * One editor per garment attribute. Shared by the manual form, inline
 * corrections in the garment detail and the review queue's edit sheet.
 * All option lists come from `@dressit/shared` vocabulary.
 */
export function GarmentFieldEditor({ field, draft, onChange, hideLabel, testIDPrefix = 'garment-field' }: GarmentFieldEditorProps) {
  const { t } = useTranslation('wardrobe');
  const label = (text: string) => (hideLabel ? null : <Text variant="smallStrong">{text}</Text>);

  switch (field) {
    case 'name':
      return (
        <TextField
          label={hideLabel ? undefined : t('fields.name')}
          accessibilityLabel={t('fields.name')}
          placeholder={t('fields.namePlaceholder')}
          value={draft.name ?? ''}
          onChangeText={(name) => onChange({ name })}
          testID={`${testIDPrefix}-name`}
          returnKeyType="done"
        />
      );
    case 'brand':
      return (
        <TextField
          label={hideLabel ? undefined : t('fields.brand')}
          accessibilityLabel={t('fields.brand')}
          placeholder={t('fields.brandPlaceholder')}
          value={draft.brand ?? ''}
          onChangeText={(brand) => onChange({ brand: brand || null })}
          autoCapitalize="words"
          testID={`${testIDPrefix}-brand`}
        />
      );
    case 'size':
      return (
        <TextField
          label={hideLabel ? undefined : t('fields.size')}
          accessibilityLabel={t('fields.size')}
          placeholder={t('fields.sizePlaceholder')}
          value={draft.size ?? ''}
          onChangeText={(size) => onChange({ size: size || null })}
          autoCapitalize="characters"
          testID={`${testIDPrefix}-size`}
        />
      );
    case 'notes':
      return (
        <TextField
          label={hideLabel ? undefined : t('fields.notes')}
          accessibilityLabel={t('fields.notes')}
          placeholder={t('fields.notesPlaceholder')}
          value={draft.notes ?? ''}
          onChangeText={(notes) => onChange({ notes: notes || null })}
          multiline
          testID={`${testIDPrefix}-notes`}
        />
      );
    case 'category':
      return (
        <View style={styles.group}>
          {label(t('fields.category'))}
          <ChipGroup
            options={options.categories}
            value={draft.category ?? null}
            allowDeselect={false}
            accessibilityLabel={t('fields.category')}
            testIDPrefix={`${testIDPrefix}-category`}
            onChange={(v) => {
              const category = v as Category;
              const subs = options.subcategories(category);
              onChange({ category, subcategory: subs.some((s) => s.id === draft.subcategory) ? draft.subcategory : undefined });
            }}
          />
        </View>
      );
    case 'subcategory':
      return (
        <View style={styles.group}>
          {label(t('fields.subcategory'))}
          {draft.category ? (
            <ChipGroup
              options={options.subcategories(draft.category)}
              value={draft.subcategory ?? null}
              allowDeselect={false}
              accessibilityLabel={t('fields.subcategory')}
              testIDPrefix={`${testIDPrefix}-subcategory`}
              onChange={(v) => onChange({ subcategory: (v as string) ?? undefined })}
            />
          ) : (
            <Text variant="small" tone="muted">
              {t('fields.subcategoryFirst')}
            </Text>
          )}
        </View>
      );
    case 'colors':
      return (
        <View style={styles.group}>
          {label(t('fields.colors'))}
          <Text variant="caption" tone="muted">
            {t('fields.colorsHint')}
          </Text>
          <ChipGroup
            options={options.colors}
            value={familiesFromColors(draft.colors)}
            multiple
            max={4}
            accessibilityLabel={t('fields.colors')}
            testIDPrefix={`${testIDPrefix}-color`}
            onChange={(v) => onChange({ colors: colorsFromFamilies((v as string[]) ?? []) })}
          />
        </View>
      );
    case 'pattern':
      return (
        <View style={styles.group}>
          {label(t('fields.pattern'))}
          <ChipGroup
            options={options.patterns}
            value={draft.pattern ?? null}
            accessibilityLabel={t('fields.pattern')}
            testIDPrefix={`${testIDPrefix}-pattern`}
            onChange={(v) => onChange({ pattern: (v as string) ?? null })}
          />
        </View>
      );
    case 'materials':
      return (
        <View style={styles.group}>
          {label(t('fields.materials'))}
          <ChipGroup
            options={options.materials}
            value={draft.materials ?? []}
            multiple
            accessibilityLabel={t('fields.materials')}
            testIDPrefix={`${testIDPrefix}-material`}
            onChange={(v) => onChange({ materials: (v as string[]) ?? [] })}
          />
        </View>
      );
    case 'styles':
      return (
        <View style={styles.group}>
          {label(t('fields.styles'))}
          <ChipGroup
            options={options.styles}
            value={draft.styles ?? []}
            multiple
            accessibilityLabel={t('fields.styles')}
            testIDPrefix={`${testIDPrefix}-style`}
            onChange={(v) => onChange({ styles: ((v as string[]) ?? []) as StyleId[] })}
          />
        </View>
      );
    case 'seasons':
      return (
        <View style={styles.group}>
          {label(t('fields.seasons'))}
          <ChipGroup
            options={options.seasons}
            value={draft.seasons ?? []}
            multiple
            accessibilityLabel={t('fields.seasons')}
            testIDPrefix={`${testIDPrefix}-season`}
            onChange={(v) => onChange({ seasons: ((v as string[]) ?? []) as Season[] })}
          />
        </View>
      );
    case 'occasions':
      return (
        <View style={styles.group}>
          {label(t('fields.occasions'))}
          <ChipGroup
            options={options.occasions}
            value={draft.occasions ?? []}
            multiple
            accessibilityLabel={t('fields.occasions')}
            testIDPrefix={`${testIDPrefix}-occasion`}
            onChange={(v) => onChange({ occasions: (v as string[]) ?? [] })}
          />
        </View>
      );
    case 'fit':
      return (
        <View style={styles.group}>
          {label(t('fields.fit'))}
          <ChipGroup
            options={options.fits}
            value={draft.fit ?? null}
            accessibilityLabel={t('fields.fit')}
            testIDPrefix={`${testIDPrefix}-fit`}
            onChange={(v) => onChange({ fit: (v as Fit) ?? null })}
          />
        </View>
      );
    case 'condition':
      return (
        <View style={styles.group}>
          {label(t('fields.condition'))}
          <ChipGroup
            options={options.conditions}
            value={draft.condition ?? null}
            accessibilityLabel={t('fields.condition')}
            testIDPrefix={`${testIDPrefix}-condition`}
            onChange={(v) => onChange({ condition: (v as Condition) ?? null })}
          />
        </View>
      );
    case 'waterproof':
      return (
        <ListRow
          title={t('fields.waterproof')}
          switchValue={!!draft.waterproof}
          onSwitchChange={(waterproof) => onChange({ waterproof })}
          testID={`${testIDPrefix}-waterproof`}
        />
      );
    case 'spaceId':
      return <SpaceEditor value={draft.spaceId ?? null} onChange={(spaceId) => onChange({ spaceId })} hideLabel={hideLabel} testIDPrefix={testIDPrefix} />;
    case 'tags':
      return <TagsEditor value={draft.tags ?? []} onChange={(tags) => onChange({ tags })} hideLabel={hideLabel} testIDPrefix={testIDPrefix} />;
    case 'purchaseDate':
      return (
        <DateField
          label={t('fields.purchaseDate')}
          value={draft.purchaseDate ?? null}
          onChange={(purchaseDate) => onChange({ purchaseDate })}
          testID={`${testIDPrefix}-purchase-date`}
        />
      );
    case 'purchasePrice':
      return <PriceEditor cents={draft.purchasePriceCents ?? null} onChange={(purchasePriceCents) => onChange({ purchasePriceCents })} testIDPrefix={testIDPrefix} />;
    case 'formality':
    case 'warmth':
      return (
        <NumberStepper
          label={t(field === 'formality' ? 'fields.formality' : 'fields.warmth')}
          value={(field === 'formality' ? draft.formality : draft.warmth) ?? 50}
          onChange={(n) => onChange(field === 'formality' ? { formality: n } : { warmth: n })}
          testID={`${testIDPrefix}-${field}`}
        />
      );
    default:
      return null;
  }
}

function SpaceEditor({ value, onChange, hideLabel, testIDPrefix }: { value: string | null; onChange: (v: string | null) => void; hideLabel?: boolean; testIDPrefix: string }) {
  const { t } = useTranslation('wardrobe');
  const spaces = useSpaces();
  const opts = [{ id: '__none__', label: t('fields.noSpace') }, ...(spaces.data ?? []).map((s) => ({ id: s.id, label: s.name }))];
  return (
    <View style={styles.group}>
      {hideLabel ? null : <Text variant="smallStrong">{t('fields.space')}</Text>}
      <ChipGroup
        options={opts}
        value={value ?? '__none__'}
        allowDeselect={false}
        accessibilityLabel={t('fields.space')}
        testIDPrefix={`${testIDPrefix}-space`}
        onChange={(v) => onChange(!v || v === '__none__' ? null : (v as string))}
      />
    </View>
  );
}

function TagsEditor({ value, onChange, hideLabel, testIDPrefix }: { value: string[]; onChange: (v: string[]) => void; hideLabel?: boolean; testIDPrefix: string }) {
  const { t } = useTranslation('wardrobe');
  const tags = useTags();
  const [text, setText] = useState('');
  const add = (name: string) => {
    const tag = name.trim();
    if (!tag || value.includes(tag)) return;
    onChange([...value, tag]);
    setText('');
  };
  const suggestions = (tags.data ?? []).map((x) => x.name).filter((n) => !value.includes(n)).slice(0, 12);
  return (
    <View style={styles.group}>
      {hideLabel ? null : <Text variant="smallStrong">{t('fields.tags')}</Text>}
      {value.length ? (
        <View style={styles.wrap}>
          {value.map((tag) => (
            <Chip key={tag} label={tag} icon="x" selected onPress={() => onChange(value.filter((x) => x !== tag))} accessibilityHint={t('fields.removeTag', { tag })} />
          ))}
        </View>
      ) : null}
      <View style={styles.row}>
        <TextField
          containerStyle={{ flex: 1 }}
          placeholder={t('fields.tagsPlaceholder')}
          accessibilityLabel={t('fields.tagsPlaceholder')}
          value={text}
          onChangeText={setText}
          onSubmitEditing={() => add(text)}
          returnKeyType="done"
          autoCapitalize="none"
          testID={`${testIDPrefix}-tag-input`}
        />
        <IconButton icon="plus" label={t('fields.addTag')} onPress={() => add(text)} variant="outline" disabled={!text.trim()} />
      </View>
      {suggestions.length ? (
        <View style={styles.wrap}>
          {suggestions.map((s) => (
            <Chip key={s} label={s} size="sm" icon="plus" onPress={() => add(s)} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function PriceEditor({ cents, onChange, testIDPrefix }: { cents: number | null; onChange: (v: number | null) => void; testIDPrefix: string }) {
  const { t } = useTranslation('wardrobe');
  const [text, setText] = useState(centsToEuroInput(cents));
  const parsed = parseEuroToCents(text);
  const invalid = Number.isNaN(parsed);
  return (
    <TextField
      label={t('fields.purchasePrice')}
      placeholder={t('fields.pricePlaceholder')}
      keyboardType="decimal-pad"
      value={text}
      error={invalid ? t('fields.priceInvalid') : null}
      onChangeText={(s) => {
        setText(s);
        const c = parseEuroToCents(s);
        if (!Number.isNaN(c)) onChange(c);
      }}
      testID={`${testIDPrefix}-price`}
    />
  );
}

function NumberStepper({ label, value, onChange, testID }: { label: string; value: number; onChange: (n: number) => void; testID: string }) {
  const { step, max } = stepFor(value);
  const clamp = (n: number) => Math.max(0, Math.min(max, Math.round(n * 100) / 100));
  const display = max === 1 ? `${Math.round(value * 100)} %` : String(Math.round(value));
  return (
    <View style={styles.group}>
      <Text variant="smallStrong">{label}</Text>
      <View
        style={styles.stepper}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ text: display }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => onChange(clamp(value + (e.nativeEvent.actionName === 'increment' ? step : -step)))}
        testID={testID}
      >
        <IconButton icon="minus" label={`${label}: menos`} variant="outline" onPress={() => onChange(clamp(value - step))} />
        <Text variant="bodyStrong" style={styles.stepValue}>
          {display}
        </Text>
        <IconButton icon="plus" label={`${label}: más`} variant="outline" onPress={() => onChange(clamp(value + step))} />
      </View>
    </View>
  );
}

/** Convenience: a small labelled section wrapper used by forms. */
export function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text variant="overline" tone="muted">
        {title}
      </Text>
      {children}
    </View>
  );
}

export function SaveBar({ label, onPress, loading, disabled, testID }: { label: string; onPress: () => void; loading?: boolean; disabled?: boolean; testID?: string }) {
  return <Button label={label} onPress={onPress} loading={loading} disabled={disabled} fullWidth testID={testID} />;
}

const styles = StyleSheet.create({
  group: { gap: space.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  stepValue: { minWidth: 56, textAlign: 'center' },
  section: { gap: space.lg },
});
