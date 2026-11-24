import type { GarmentDetailDto, GarmentStatus, GarmentWriteDto } from '@dressit/shared';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { errorMessage } from '@/api/client';
import { useChangeGarmentStatus, useDeleteGarment, useGarment, useSimilarGarments, useSpaces, useUpdateGarment, useWearGarment } from '@/api/hooks';
import {
  Badge,
  Button,
  Card,
  ChipGroup,
  ConfidenceBadge,
  ConfirmDialog,
  Divider,
  ErrorState,
  GarmentSilhouette,
  garmentColor,
  GarmentTile,
  Icon,
  OfflineBanner,
  Screen,
  SectionHeader,
  Sheet,
  Skeleton,
  SkeletonGroup,
  Text,
  TextField,
  useToast,
} from '@/components/ui';
import {
  currentAttribute,
  DETAIL_FIELDS,
  displayValue,
  editorFieldsFor,
  FIELD_LABEL_KEYS,
  garmentToDraft,
  patchFor,
} from '@/components/wardrobe/garmentDraft';
import { type FieldKey, GarmentFieldEditor } from '@/components/wardrobe/GarmentFields';
import { today } from '@/lib/dates';
import { capitalize, formatLongDate, formatMoney, formatShortDate } from '@/lib/format';
import { options, statusLabel, subcategoryLabel } from '@/lib/vocab';
import { hairline, radius, space, useTheme } from '@/theme';

export default function GarmentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation('wardrobe');
  const query = useGarment(id);
  const g = query.data;

  return (
    <>
      <Stack.Screen options={{ title: g?.name || (g ? subcategoryLabel(g.subcategory) : '') }} />
      {g ? (
        <GarmentDetail garment={g} refreshing={query.isRefetching} onRefresh={() => query.refetch()} />
      ) : query.isError ? (
        <Screen>
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        </Screen>
      ) : (
        <Screen>
          <SkeletonGroup label={t('detail.loadingLabel')} style={{ gap: space.lg, paddingTop: space.lg }} testID="garment-detail-loading">
            <Skeleton height={360} radius={radius.lg} />
            <Skeleton width="60%" height={28} />
            <Skeleton width="40%" height={16} />
            <Skeleton height={120} radius={radius.md} />
          </SkeletonGroup>
        </Screen>
      )}
    </>
  );
}

function GarmentDetail({ garment: g, refreshing, onRefresh }: { garment: GarmentDetailDto; refreshing: boolean; onRefresh: () => void }) {
  const { t } = useTranslation('wardrobe');
  const { colors } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const spaces = useSpaces();
  const update = useUpdateGarment(g.id);
  const wear = useWearGarment();
  const del = useDeleteGarment();
  const similar = useSimilarGarments(g.id);
  const sourceLabel = useSourceLabel();

  const [editField, setEditField] = useState<FieldKey | null>(null);
  const [statusOpen, setStatusOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const ctx = {
    yes: t('fields.yes'),
    no: t('fields.no'),
    none: t('fields.none'),
    spaceName: (sid: string | null) => (sid ? spaces.data?.find((s) => s.id === sid)?.name ?? null : null),
  };
  const lent = g.status === 'lent' ? g.availabilityHistory.find((h) => h.status === 'lent' && !h.endedAt) : null;

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh} testID="garment-detail">
      <OfflineBanner />
      <Gallery garment={g} />

      <View style={{ gap: space.sm }}>
        <View style={styles.badges}>
          {g.status !== 'available' ? <Badge label={statusLabel(g.status)} tone="warning" /> : null}
          {g.favorite ? <Badge label={t('detail.favorite')} tone="accent" icon="heart" /> : null}
          {g.isDemo ? <Badge label="Demo" tone="inverse" /> : null}
        </View>
        <Text variant="title">{g.name || subcategoryLabel(g.subcategory)}</Text>
        <Text variant="body" tone="muted">
          {[g.brand, subcategoryLabel(g.subcategory), g.size ? `${t('fields.size')} ${g.size}` : null].filter(Boolean).join(' · ')}
        </Text>
        {lent?.note ? (
          <Text variant="small" tone="warning">
            {lent.note}
          </Text>
        ) : null}
      </View>

      {g.isDemo ? (
        <Card tone="sunken">
          <Text variant="small">{t('detail.demoNotice')}</Text>
        </Card>
      ) : null}

      <View style={styles.actions}>
        <Button
          label={g.favorite ? t('detail.removeFavorite') : t('detail.addFavorite')}
          icon="heart"
          variant={g.favorite ? 'accent' : 'secondary'}
          size="sm"
          loading={update.isPending && editField === null}
          onPress={() =>
            update.mutate({ favorite: !g.favorite }, { onError: (e) => toast.show({ message: errorMessage(e), tone: 'error' }) })
          }
          testID="garment-favorite"
        />
        <Button
          label={t('detail.wornToday')}
          icon="check"
          variant="secondary"
          size="sm"
          loading={wear.isPending}
          onPress={() =>
            wear.mutate(
              { id: g.id, date: today() },
              {
                onSuccess: () => toast.show({ message: t('detail.wornSaved'), tone: 'success' }),
                onError: (e) => toast.show({ message: errorMessage(e), tone: 'error' }),
              },
            )
          }
          testID="garment-wear"
        />
        <Button label={t('detail.changeStatus')} icon="refresh-cw" variant="secondary" size="sm" onPress={() => setStatusOpen(true)} testID="garment-status" />
      </View>

      {/* Usage & cost per wear */}
      <Card>
        <SectionHeader overline={t('detail.usage')} title={g.wearCount ? t('detail.wearCount', { count: g.wearCount }) : t('detail.neverWorn')} />
        <View style={styles.stats}>
          <Stat label={t('detail.costPerWear')} value={g.costPerWear ? formatMoney(g.costPerWear) : '—'} />
          <Stat label={t('detail.purchasePrice')} value={g.purchasePrice ? formatMoney(g.purchasePrice) : '—'} />
        </View>
        {g.lastWornOn ? (
          <Text variant="small" tone="muted">
            {t('detail.lastWorn', { date: formatLongDate(g.lastWornOn) })}
          </Text>
        ) : null}
        {g.compatibleCount != null ? (
          <Text variant="small" tone="accent">
            {t('detail.compatible', { count: g.compatibleCount })}
          </Text>
        ) : null}
      </Card>

      {/* Attributes with provenance + inline correction */}
      <View>
        <SectionHeader title={t('detail.attributes')} />
        <Text variant="small" tone="muted" style={{ marginBottom: space.sm }}>
          {t('detail.attributesHint')}
        </Text>
        {DETAIL_FIELDS.map((field, i) => {
          const attr = currentAttribute(g.attributes, field);
          const label = t(FIELD_LABEL_KEYS[field]);
          const value = displayValue(g, field, ctx);
          return (
            <View key={field}>
              {i > 0 ? <Divider /> : null}
              <Pressable
                onPress={() => setEditField(field)}
                accessibilityRole="button"
                accessibilityLabel={`${label}: ${value}`}
                accessibilityHint={t('detail.edit', { field: label.toLowerCase() })}
                testID={`garment-attr-${field}`}
                style={({ pressed }) => [styles.attr, { opacity: pressed ? 0.6 : 1 }]}
              >
                <View style={{ flex: 1, gap: 4 }}>
                  <Text variant="caption" tone="muted">
                    {label}
                  </Text>
                  <Text variant="body">{value}</Text>
                  {attr && attr.source !== 'user' && attr.source !== 'manual' ? (
                    <ConfidenceBadge confidence={attr.confidence} source={sourceLabel(attr.source)} />
                  ) : null}
                </View>
                <Icon name="edit-2" size={16} color={colors.inkSubtle} />
              </Pressable>
            </View>
          );
        })}
      </View>

      {/* Wear history */}
      <View>
        <SectionHeader title={t('detail.wearHistory')} />
        {g.wearHistory.length === 0 ? (
          <Text variant="small" tone="muted">
            {t('detail.noWears')}
          </Text>
        ) : (
          [...g.wearHistory]
            .sort((a, b) => b.wornOn.localeCompare(a.wornOn))
            .slice(0, 30)
            .map((w, i) => (
              <View key={`${w.wornOn}-${i}`} style={styles.row}>
                <Icon name="calendar" size={16} color={colors.inkMuted} />
                <Text variant="body" style={{ flex: 1 }}>
                  {capitalize(formatLongDate(w.wornOn))}
                </Text>
                {w.outfitId ? (
                  <Button
                    label={t('detail.viewOutfit')}
                    size="sm"
                    variant="ghost"
                    onPress={() => router.push({ pathname: '/outfit/[id]', params: { id: w.outfitId! } })}
                  />
                ) : null}
              </View>
            ))
        )}
      </View>

      {/* Availability history */}
      {g.availabilityHistory.length ? (
        <View>
          <SectionHeader title={t('detail.availability')} />
          {[...g.availabilityHistory]
            .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
            .map((h, i) => (
              <View key={`${h.startedAt}-${i}`} style={styles.histRow}>
                <Badge label={statusLabel(h.status)} tone={h.status === 'available' ? 'success' : 'neutral'} />
                <Text variant="small" tone="muted" style={{ flex: 1 }}>
                  {t('detail.since', { date: formatShortDate(h.startedAt.slice(0, 10)) })}
                  {h.endedAt ? ` · ${t('detail.until', { date: formatShortDate(h.endedAt.slice(0, 10)) })}` : ''}
                  {h.note ? ` · ${h.note}` : ''}
                </Text>
              </View>
            ))}
        </View>
      ) : null}

      {/* Similar / duplicates */}
      <View>
        <SectionHeader title={t('detail.similar')} />
        {similar.isPending ? (
          <SkeletonGroup style={styles.similarRow}>
            {[0, 1, 2].map((k) => (
              <Skeleton key={k} width={120} height={150} radius={radius.md} />
            ))}
          </SkeletonGroup>
        ) : similar.isError ? (
          <ErrorState error={similar.error} onRetry={() => similar.refetch()} compact />
        ) : similar.data && similar.data.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.similarRow}>
            {similar.data.map((s) => (
              <View key={s.garment.id} style={{ width: 128 }}>
                <GarmentTile
                  garment={s.garment}
                  caption={`${t('detail.similarity', { percent: Math.round((s.score <= 1 ? s.score : s.score / 100) * 100) })} · ${s.reason}`}
                  onPress={() => router.push({ pathname: '/garment/[id]', params: { id: s.garment.id } })}
                />
              </View>
            ))}
          </ScrollView>
        ) : (
          <Text variant="small" tone="muted">
            {t('detail.similarEmpty')}
          </Text>
        )}
      </View>

      {/* Provenance */}
      <View style={{ gap: space.sm }}>
        <SectionHeader title={t('detail.source')} />
        <Text variant="body">{t(`sources.${g.source}`)}</Text>
        <Text variant="small" tone="muted">
          {t('detail.addedOn', { date: formatShortDate(g.createdAt.slice(0, 10)) })}
        </Text>
        {g.sourceUrl ? (
          <Button label={t('detail.sourceLink')} variant="ghost" icon="external-link" onPress={() => Linking.openURL(g.sourceUrl!)} />
        ) : null}
      </View>

      <Button label={t('detail.delete')} variant="danger" icon="trash-2" onPress={() => setConfirmDelete(true)} testID="garment-delete" />

      <AttributeEditSheet garment={g} field={editField} onClose={() => setEditField(null)} />
      <StatusSheet garment={g} visible={statusOpen} onClose={() => setStatusOpen(false)} />
      <ConfirmDialog
        visible={confirmDelete}
        title={t('detail.deleteTitle')}
        message={t('detail.deleteMessage')}
        destructive
        confirmLabel={t('detail.delete')}
        loading={del.isPending}
        error={del.isError ? errorMessage(del.error) : null}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() =>
          del.mutate(g.id, {
            onSuccess: () => {
              setConfirmDelete(false);
              toast.show({ message: t('detail.deleted'), tone: 'success' });
              router.back();
            },
          })
        }
        testID="garment-delete-dialog"
      />
    </Screen>
  );
}

const KNOWN_ATTR_SOURCES = ['user', 'manual', 'vision', 'model', 'link', 'retailer', 'receipt', 'inferred', 'default'];

function useSourceLabel() {
  const { t } = useTranslation('wardrobe');
  return (source: string) => (KNOWN_ATTR_SOURCES.includes(source) ? t(`attrSources.${source}` as 'attrSources.user') : source);
}

function Gallery({ garment: g }: { garment: GarmentDetailDto }) {
  const { t } = useTranslation('wardrobe');
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const images = g.images.length ? g.images : g.image ? [g.image] : [];
  const w = width - space.xl * 2;
  if (images.length === 0) {
    return (
      <View style={[styles.media, { backgroundColor: colors.surfaceAlt }]} accessible accessibilityRole="image" accessibilityLabel={g.name}>
        <GarmentSilhouette category={g.category} subcategory={g.subcategory} color={garmentColor(g)} />
      </View>
    );
  }
  return (
    <View accessibilityLabel={t('detail.images')}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / w))}
        style={{ borderRadius: radius.lg }}
      >
        {images.map((img, i) => (
          <View
            key={img.id}
            style={[styles.media, { width: w, backgroundColor: colors.surfaceAlt }]}
            accessible
            accessibilityRole="image"
            accessibilityLabel={`${g.name}. ${t('detail.imageOf', { index: i + 1, total: images.length })}${img.attribution ? `. ${img.attribution}` : ''}`}
          >
            <Image
              source={{ uri: img.url, cacheKey: `img-${img.id}-${img.isCutout ? 'cutout' : 'full'}` }}
              style={StyleSheet.absoluteFill}
              contentFit={img.isCutout ? 'contain' : 'cover'}
              cachePolicy="memory-disk"
              transition={160}
              accessible={false}
            />
            {img.attribution ? (
              <View style={[styles.attribution, { backgroundColor: colors.scrim }]}>
                <Text variant="caption" color="#fff">
                  {img.attribution}
                </Text>
              </View>
            ) : null}
          </View>
        ))}
      </ScrollView>
      {images.length > 1 ? (
        <View style={styles.dots} importantForAccessibility="no-hide-descendants">
          {images.map((img, i) => (
            <View key={img.id} style={[styles.dot, { backgroundColor: i === index ? colors.ink : colors.lineStrong }]} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, gap: 2 }} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <Text variant="heading">{value}</Text>
    </View>
  );
}

function AttributeEditSheet({ garment, field, onClose }: { garment: GarmentDetailDto; field: FieldKey | null; onClose: () => void }) {
  const { t } = useTranslation('wardrobe');
  const toast = useToast();
  const update = useUpdateGarment(garment.id);
  const [draft, setDraft] = useState<GarmentWriteDto>(() => garmentToDraft(garment));
  useEffect(() => {
    if (field) setDraft(garmentToDraft(garment));
    // Reset the draft each time a field editor opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field]);
  const label = field ? t(FIELD_LABEL_KEYS[field]) : '';
  const fields = field ? editorFieldsFor(field) : [];
  const invalid = fields.includes('subcategory') && (!draft.category || !draft.subcategory);
  const save = () => {
    if (!field) return;
    update.mutate(patchFor(field, draft), {
      onSuccess: () => {
        toast.show({ message: t('detail.edited'), tone: 'success' });
        onClose();
      },
    });
  };
  return (
    <Sheet
      visible={!!field}
      onClose={onClose}
      title={t('detail.editTitle', { field: label.toLowerCase() })}
      testID="attribute-edit-sheet"
      footer={
        <>
          {update.isError ? (
            <Text variant="small" tone="danger" accessibilityLiveRegion="polite">
              {errorMessage(update.error)}
            </Text>
          ) : null}
          <Button label={t('spaces.save')} onPress={save} loading={update.isPending} disabled={invalid} fullWidth testID="attribute-edit-save" />
        </>
      }
    >
      {fields.map((f) => (
        <GarmentFieldEditor key={f} field={f} draft={draft} onChange={(p) => setDraft((d) => ({ ...d, ...p }))} testIDPrefix="attr-edit" />
      ))}
    </Sheet>
  );
}

function StatusSheet({ garment, visible, onClose }: { garment: GarmentDetailDto; visible: boolean; onClose: () => void }) {
  const { t } = useTranslation('wardrobe');
  const toast = useToast();
  const change = useChangeGarmentStatus();
  const [status, setStatus] = useState<GarmentStatus>(garment.status);
  const [note, setNote] = useState('');
  const [askLent, setAskLent] = useState(false);
  useEffect(() => {
    if (visible) {
      setStatus(garment.status);
      setNote('');
    }
  }, [visible, garment.status]);

  const submit = (lentTo?: string) =>
    change.mutate(
      { id: garment.id, status, note: note.trim() || undefined, lentTo: lentTo?.trim() || undefined },
      {
        onSuccess: () => {
          setAskLent(false);
          toast.show({ message: lentTo ? t('detail.lentTo', { name: lentTo.trim() }) : t('detail.statusSaved'), tone: 'success' });
          onClose();
        },
        onError: (e) => toast.show({ message: errorMessage(e), tone: 'error' }),
      },
    );

  return (
    <>
      <Sheet
        visible={visible && !askLent}
        onClose={onClose}
        title={t('detail.statusTitle')}
        testID="status-sheet"
        footer={
          <Button
            label={t('spaces.save')}
            fullWidth
            loading={change.isPending}
            onPress={() => (status === 'lent' ? setAskLent(true) : submit())}
            testID="status-save"
          />
        }
      >
        <ChipGroup
          options={options.statuses}
          value={status}
          allowDeselect={false}
          onChange={(v) => v && setStatus(v as GarmentStatus)}
          testIDPrefix="status"
          accessibilityLabel={t('detail.statusTitle')}
        />
        <TextField label={t('detail.noteLabel')} value={note} onChangeText={setNote} />
      </Sheet>
      <ConfirmDialog
        visible={askLent}
        title={t('detail.lentTitle')}
        message={t('detail.lentMessage')}
        input={{ label: t('detail.lentLabel'), placeholder: t('detail.lentPlaceholder'), required: true }}
        loading={change.isPending}
        error={change.isError ? errorMessage(change.error) : null}
        onCancel={() => setAskLent(false)}
        onConfirm={(name) => submit(name)}
        testID="lent-dialog"
      />
    </>
  );
}

const styles = StyleSheet.create({
  media: { width: '100%', aspectRatio: 4 / 5, borderRadius: radius.lg, overflow: 'hidden' },
  attribution: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: space.sm },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: space.sm },
  dot: { width: 6, height: 6, borderRadius: 3 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  stats: { flexDirection: 'row', gap: space.lg, marginBottom: space.sm },
  attr: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, minHeight: 56 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44, borderBottomWidth: hairline, borderColor: 'transparent' },
  histRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.xs },
  similarRow: { flexDirection: 'row', gap: space.md },
});

