import type { DetectionDto, GarmentWriteDto, PredictedField } from '@dressit/shared';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Badge, Button, Card, Chip, ConfidenceBadge, GarmentSilhouette, Icon, Text } from '@/components/ui';
import { CutoutImage } from '@/components/ui/CutoutImage';
import { categoryLabel, colorHex, fitLabel, materialLabel, patternLabel, seasonLabel, styleLabel, subcategoryLabel } from '@/lib/vocab';
import { radius, space, useTheme } from '@/theme';

import { familiesFromColors } from '../wardrobe/GarmentFields';

type PredKey = 'category' | 'subcategory' | 'pattern' | 'materials' | 'styles' | 'seasons' | 'fit' | 'brand' | 'formality' | 'warmth';
const PRED_ORDER: PredKey[] = ['category', 'subcategory', 'brand', 'pattern', 'materials', 'styles', 'seasons', 'fit', 'formality', 'warmth'];

function label(key: PredKey, value: unknown): string {
  const list = (xs: unknown, fn: (x: string) => string) => (Array.isArray(xs) ? (xs as string[]).map(fn).join(', ') : '');
  switch (key) {
    case 'category':
      return categoryLabel(String(value));
    case 'subcategory':
      return subcategoryLabel(String(value));
    case 'pattern':
      return patternLabel(String(value));
    case 'materials':
      return list(value, materialLabel);
    case 'styles':
      return list(value, styleLabel);
    case 'seasons':
      return list(value, seasonLabel);
    case 'fit':
      return fitLabel(String(value));
    case 'formality':
    case 'warmth': {
      const n = Number(value);
      return n <= 1 ? `${Math.round(n * 100)} %` : String(Math.round(n));
    }
    default:
      return String(value ?? '');
  }
}

/** Draft garment from a detection's predictions, with the user's overrides on top. */
export function draftFromDetection(d: DetectionDto, overrides?: GarmentWriteDto): GarmentWriteDto {
  const p = d.predicted;
  const base: GarmentWriteDto = {
    category: p.category?.value,
    subcategory: p.subcategory?.value,
    colors: p.colors?.map((c) => ({ hex: c.hex, share: c.share })),
    pattern: p.pattern?.value ?? null,
    materials: p.materials?.value ?? [],
    styles: p.styles?.value ?? [],
    seasons: p.seasons?.value ?? [],
    fit: p.fit?.value ?? null,
    brand: p.brand?.value ?? null,
    formality: p.formality?.value,
    warmth: p.warmth?.value,
  };
  return { ...base, ...overrides };
}

export interface DetectionCardProps {
  detection: DetectionDto;
  index: number;
  overrides?: GarmentWriteDto;
  onOverride: (patch: Partial<GarmentWriteDto>) => void;
  onAccept: () => void;
  onReject: () => void;
  onEdit: () => void;
  accepting?: boolean;
  rejecting?: boolean;
}

export function DetectionCard({ detection: d, index, overrides, onOverride, onAccept, onReject, onEdit, accepting, rejecting }: DetectionCardProps) {
  const { t } = useTranslation('capture');
  const { colors } = useTheme();
  const router = useRouter();
  const draft = draftFromDetection(d, overrides);
  const families = familiesFromColors(draft.colors);
  const edited = !!overrides && Object.keys(overrides).length > 0;
  const fields = PRED_ORDER.filter((k) => d.predicted[k] !== undefined);
  const title = draft.name || (draft.subcategory ? subcategoryLabel(draft.subcategory) : t('review.detection', { index: index + 1 }));

  return (
    <Card padded={false} testID={`detection-${d.id}`}>
      <View style={styles.top}>
        <View style={[styles.media, { backgroundColor: colors.surfaceAlt }]}>
          {d.cutout ? (
            <CutoutImage image={{ ...d.cutout, thumbUrl: d.cutout.url, isCutout: true }} variant="full" inset={0.08} />
          ) : (
            <GarmentSilhouette category={draft.category} subcategory={draft.subcategory} color={draft.colors?.[0]?.hex ?? colorHex(families[0])} />
          )}
        </View>
        <View style={{ flex: 1, gap: space.xs }}>
          <Text variant="subheading">{title}</Text>
          {edited ? <Badge label={t('review.edited')} tone="accent" icon="edit-2" /> : null}
          {families.length ? (
            <View style={styles.swatches} accessible accessibilityLabel={`${t('review.fields.colors')}: ${families.join(', ')}`}>
              {families.map((f) => (
                <View key={f} style={[styles.swatch, { backgroundColor: colorHex(f) ?? '#ccc', borderColor: colors.lineStrong }]} />
              ))}
            </View>
          ) : null}
        </View>
      </View>

      <View style={styles.body}>
        {d.duplicate ? (
          <View style={[styles.dup, { backgroundColor: colors.warningSoft }]} testID={`detection-${d.id}-duplicate`}>
            <Icon name="copy" size={16} color={colors.warning} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="smallStrong" color={colors.warning}>
                {t('review.duplicateTitle')} · {t('review.duplicateScore', { percent: Math.round((d.duplicate.score <= 1 ? d.duplicate.score : d.duplicate.score / 100) * 100) })}
              </Text>
              <Text variant="small" color={colors.warning}>
                {t(`review.duplicateKind.${d.duplicate.kind}`)}
              </Text>
              <Button
                label={t('review.viewExisting')}
                size="sm"
                variant="ghost"
                onPress={() => router.push({ pathname: '/garment/[id]', params: { id: d.duplicate!.garmentId } })}
              />
            </View>
          </View>
        ) : null}

        <Text variant="overline" tone="muted">
          {t('review.predicted')}
        </Text>
        {fields.length === 0 ? (
          <Text variant="small" tone="muted">
            {t('review.noPrediction')}
          </Text>
        ) : (
          fields.map((key) => {
            const pf = d.predicted[key] as PredictedField<unknown>;
            const overridden = overrides && (overrides as Record<string, unknown>)[key] !== undefined;
            const value = overridden ? (overrides as Record<string, unknown>)[key] : pf.value;
            return (
              <View key={key} style={styles.field}>
                <View style={styles.fieldHead}>
                  <Text variant="caption" tone="muted" style={{ width: 92 }}>
                    {t(`review.fields.${key}`)}
                  </Text>
                  <Text variant="small" style={{ flex: 1 }}>
                    {label(key, value)}
                  </Text>
                  {overridden ? <Badge label={t('review.edited')} tone="accent" /> : <ConfidenceBadge confidence={pf.confidence} />}
                </View>
                {pf.alternatives?.length && !overridden ? (
                  <View style={styles.alts}>
                    {pf.alternatives.slice(0, 3).map((a, i) => (
                      <Chip
                        key={i}
                        size="sm"
                        label={`${label(key, a.value)} · ${Math.round(a.confidence * 100)} %`}
                        onPress={() => onOverride(key === 'category' ? { category: a.value as never, subcategory: undefined } : { [key]: a.value } as Partial<GarmentWriteDto>)}
                        accessibilityHint={t('review.pickAlternative', { value: label(key, a.value) })}
                      />
                    ))}
                  </View>
                ) : null}
              </View>
            );
          })
        )}

        {d.warnings.length ? (
          <View style={{ gap: 4 }}>
            {d.warnings.map((w, i) => (
              <View key={i} style={styles.warning}>
                <Icon name="alert-triangle" size={14} color={colors.warning} />
                <Text variant="small" tone="warning" style={{ flex: 1 }}>
                  {w}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.actions}>
          <Button
            label={t('review.accept')}
            icon="check"
            accessibilityHint={t('review.acceptHint')}
            onPress={onAccept}
            loading={accepting}
            disabled={rejecting}
            testID={`detection-${d.id}-accept`}
          />
          <Button label={t('review.edit')} variant="secondary" icon="edit-2" onPress={onEdit} testID={`detection-${d.id}-edit`} />
          <Button label={t('review.reject')} variant="ghost" onPress={onReject} loading={rejecting} disabled={accepting} testID={`detection-${d.id}-reject`} />
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', gap: space.lg, padding: space.lg, paddingBottom: 0 },
  media: { width: 112, aspectRatio: 4 / 5, borderRadius: radius.md, overflow: 'hidden' },
  swatches: { flexDirection: 'row', gap: 6 },
  swatch: { width: 18, height: 18, borderRadius: 9, borderWidth: StyleSheet.hairlineWidth },
  body: { padding: space.lg, gap: space.sm },
  dup: { flexDirection: 'row', gap: space.sm, padding: space.md, borderRadius: radius.md },
  field: { gap: 6, paddingVertical: 2 },
  fieldHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  alts: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, paddingLeft: 100 },
  warning: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
});
