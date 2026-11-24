import type { BulkGarmentUpdate, Category, GarmentListQuery, GarmentStatus, Season, StyleId } from '@dressit/shared';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { errorMessage } from '@/api/client';
import { useBulkUpdateGarments, useSpaces, useTags } from '@/api/hooks';
import { Button, ChipGroup, ListRow, Sheet, Text, TextField, useToast } from '@/components/ui';
import { categoryLabel, colorLabel, materialLabel, occasionLabel, options, seasonLabel, statusLabel, styleLabel } from '@/lib/vocab';
import { space } from '@/theme';

export type WardrobeFilters = Pick<
  GarmentListQuery,
  'category' | 'color' | 'brand' | 'style' | 'season' | 'material' | 'occasion' | 'status' | 'favorite' | 'tag' | 'spaceId' | 'usage'
>;
export type WardrobeSort = NonNullable<GarmentListQuery['sort']>;

export const SORTS: WardrobeSort[] = ['recent', 'oldest', 'least_worn', 'most_worn', 'cost_per_wear', 'name'];

export function countFilters(f: WardrobeFilters): number {
  return Object.values(f).filter((v) => v !== undefined && v !== null && v !== '' && v !== false).length;
}

const USAGE_KEYS = { new: 'filters.usageNew', unused: 'filters.usageUnused', rarely_used: 'filters.usageRarely', most_used: 'filters.usageMost' } as const;

/** Human chips for the active filters (each removable). */
export function useActiveFilterChips(f: WardrobeFilters): Array<{ key: keyof WardrobeFilters; label: string }> {
  const { t } = useTranslation('wardrobe');
  const spaces = useSpaces();
  const out: Array<{ key: keyof WardrobeFilters; label: string }> = [];
  if (f.category) out.push({ key: 'category', label: categoryLabel(f.category) });
  if (f.color) out.push({ key: 'color', label: colorLabel(f.color) });
  if (f.brand) out.push({ key: 'brand', label: f.brand });
  if (f.style) out.push({ key: 'style', label: styleLabel(f.style) });
  if (f.season) out.push({ key: 'season', label: seasonLabel(f.season) });
  if (f.material) out.push({ key: 'material', label: materialLabel(f.material) });
  if (f.occasion) out.push({ key: 'occasion', label: occasionLabel(f.occasion) });
  if (f.status) out.push({ key: 'status', label: f.status === 'all' ? t('filters.statusAll') : statusLabel(f.status) });
  if (f.favorite) out.push({ key: 'favorite', label: t('filters.favorites') });
  if (f.tag) out.push({ key: 'tag', label: `#${f.tag}` });
  if (f.spaceId) out.push({ key: 'spaceId', label: spaces.data?.find((s) => s.id === f.spaceId)?.name ?? t('filters.space') });
  if (f.usage) out.push({ key: 'usage', label: t(USAGE_KEYS[f.usage]) });
  return out;
}

export function FiltersSheet({
  visible,
  onClose,
  value,
  onApply,
}: {
  visible: boolean;
  onClose: () => void;
  value: WardrobeFilters;
  onApply: (f: WardrobeFilters) => void;
}) {
  const { t } = useTranslation('wardrobe');
  const tags = useTags();
  const spaces = useSpaces();
  const [draft, setDraft] = useState<WardrobeFilters>(value);
  useEffect(() => {
    if (visible) setDraft(value);
  }, [visible, value]);
  const set = (patch: Partial<WardrobeFilters>) => setDraft((d) => ({ ...d, ...patch }));
  const statusOptions = [...options.statuses, { id: 'all' as const, label: t('filters.statusAll') }];
  const usageOptions = (Object.keys(USAGE_KEYS) as Array<keyof typeof USAGE_KEYS>).map((id) => ({ id, label: t(USAGE_KEYS[id]) }));

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={t('filters.title')}
      testID="filters-sheet"
      footer={
        <View style={styles.footer}>
          <Button label={t('filters.clear')} variant="ghost" onPress={() => setDraft({})} />
          <Button
            label={t('filters.apply')}
            onPress={() => {
              onApply(draft);
              onClose();
            }}
            testID="filters-apply"
          />
        </View>
      }
    >
      <Group title={t('filters.category')}>
        <ChipGroup options={options.categories} value={draft.category ?? null} onChange={(v) => set({ category: (v as Category) ?? undefined })} testIDPrefix="filter-category" />
      </Group>
      <Group title={t('filters.color')}>
        <ChipGroup options={options.colors} value={draft.color ?? null} onChange={(v) => set({ color: (v as string) ?? undefined })} testIDPrefix="filter-color" />
      </Group>
      <TextField
        label={t('filters.brand')}
        placeholder={t('filters.brandPlaceholder')}
        value={draft.brand ?? ''}
        onChangeText={(brand) => set({ brand: brand || undefined })}
        onClear={() => set({ brand: undefined })}
        autoCapitalize="words"
      />
      <Group title={t('filters.style')}>
        <ChipGroup options={options.styles} value={draft.style ?? null} onChange={(v) => set({ style: (v as StyleId) ?? undefined })} />
      </Group>
      <Group title={t('filters.season')}>
        <ChipGroup options={options.seasons} value={draft.season ?? null} onChange={(v) => set({ season: (v as Season) ?? undefined })} />
      </Group>
      <Group title={t('filters.material')}>
        <ChipGroup options={options.materials} value={draft.material ?? null} onChange={(v) => set({ material: (v as string) ?? undefined })} />
      </Group>
      <Group title={t('filters.occasion')}>
        <ChipGroup options={options.occasions} value={draft.occasion ?? null} onChange={(v) => set({ occasion: (v as string) ?? undefined })} />
      </Group>
      <Group title={t('filters.status')}>
        <ChipGroup
          options={statusOptions}
          value={draft.status ?? null}
          onChange={(v) => set({ status: (v as GarmentStatus | 'all') ?? undefined })}
          testIDPrefix="filter-status"
        />
      </Group>
      <Group title={t('filters.usage')}>
        <ChipGroup options={usageOptions} value={draft.usage ?? null} onChange={(v) => set({ usage: (v as WardrobeFilters['usage']) ?? undefined })} />
      </Group>
      <ListRow title={t('filters.favorites')} switchValue={!!draft.favorite} onSwitchChange={(favorite) => set({ favorite: favorite || undefined })} testID="filter-favorites" />
      <Group title={t('filters.tags')}>
        {tags.data?.length ? (
          <ChipGroup
            options={tags.data.map((x) => ({ id: x.name, label: `#${x.name} · ${x.count}` }))}
            value={draft.tag ?? null}
            onChange={(v) => set({ tag: (v as string) ?? undefined })}
          />
        ) : (
          <Text variant="small" tone="muted">
            {t('filters.noTags')}
          </Text>
        )}
      </Group>
      <Group title={t('filters.space')}>
        {spaces.data?.length ? (
          <ChipGroup
            options={spaces.data.map((s) => ({ id: s.id, label: s.name }))}
            value={draft.spaceId ?? null}
            onChange={(v) => set({ spaceId: (v as string) ?? undefined })}
          />
        ) : (
          <Text variant="small" tone="muted">
            {t('filters.noSpaces')}
          </Text>
        )}
      </Group>
    </Sheet>
  );
}

export function SortSheet({ visible, onClose, value, onChange }: { visible: boolean; onClose: () => void; value: WardrobeSort; onChange: (s: WardrobeSort) => void }) {
  const { t } = useTranslation('wardrobe');
  return (
    <Sheet visible={visible} onClose={onClose} title={t('sort.title')} testID="sort-sheet">
      <ChipGroup
        options={SORTS.map((id) => ({ id, label: t(`sort.${id}`) }))}
        value={value}
        allowDeselect={false}
        accessibilityLabel={t('sort.title')}
        testIDPrefix="sort"
        onChange={(v) => {
          if (v) onChange(v as WardrobeSort);
          onClose();
        }}
      />
    </Sheet>
  );
}

type Tri = 'keep' | 'yes' | 'no';

export function BulkEditSheet({ visible, onClose, ids, onDone }: { visible: boolean; onClose: () => void; ids: string[]; onDone: () => void }) {
  const { t } = useTranslation('wardrobe');
  const toast = useToast();
  const spaces = useSpaces();
  const tags = useTags();
  const bulk = useBulkUpdateGarments();
  const [status, setStatus] = useState<GarmentStatus | null>(null);
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [fav, setFav] = useState<Tri>('keep');
  const [addTags, setAddTags] = useState<string[]>([]);
  const [removeTags, setRemoveTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setStatus(null);
      setSpaceId(null);
      setFav('keep');
      setAddTags([]);
      setRemoveTags([]);
      setNewTag('');
      setError(null);
    }
  }, [visible]);

  const apply = () => {
    const patch: BulkGarmentUpdate['patch'] = {};
    if (status) patch.status = status;
    if (spaceId) patch.spaceId = spaceId === '__none__' ? null : spaceId;
    if (fav !== 'keep') patch.favorite = fav === 'yes';
    if (addTags.length) patch.addTags = addTags;
    if (removeTags.length) patch.removeTags = removeTags;
    if (Object.keys(patch).length === 0) {
      setError(t('bulk.nothing'));
      return;
    }
    bulk.mutate(
      { ids, patch },
      {
        onSuccess: (r) => {
          toast.show({ message: t('bulk.done', { count: r.updated }), tone: 'success' });
          onDone();
          onClose();
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  };

  const existingTags = (tags.data ?? []).map((x) => ({ id: x.name, label: `#${x.name}` }));
  const addTagOptions = [...existingTags, ...addTags.filter((a) => !existingTags.some((e) => e.id === a)).map((a) => ({ id: a, label: `#${a}` }))];

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={t('bulk.title', { count: ids.length })}
      testID="bulk-sheet"
      footer={<Button label={t('bulk.apply')} onPress={apply} loading={bulk.isPending} fullWidth testID="bulk-apply" />}
    >
      <Group title={t('bulk.status')}>
        <ChipGroup options={options.statuses} value={status} onChange={(v) => setStatus((v as GarmentStatus) ?? null)} testIDPrefix="bulk-status" />
      </Group>
      <Group title={t('bulk.space')}>
        <ChipGroup
          options={[{ id: '__none__', label: t('bulk.noSpace') }, ...(spaces.data ?? []).map((s) => ({ id: s.id, label: s.name }))]}
          value={spaceId}
          onChange={(v) => setSpaceId((v as string) ?? null)}
        />
      </Group>
      <Group title={t('bulk.favorite')}>
        <ChipGroup
          options={[
            { id: 'keep', label: t('bulk.keep') },
            { id: 'yes', label: t('bulk.markFavorite') },
            { id: 'no', label: t('bulk.unmarkFavorite') },
          ]}
          value={fav}
          allowDeselect={false}
          onChange={(v) => setFav((v as Tri) ?? 'keep')}
        />
      </Group>
      <Group title={t('bulk.addTags')}>
        <View style={styles.row}>
          <TextField
            containerStyle={{ flex: 1 }}
            placeholder={t('fields.tagsPlaceholder')}
            accessibilityLabel={t('fields.tagsPlaceholder')}
            value={newTag}
            onChangeText={setNewTag}
            autoCapitalize="none"
            onSubmitEditing={() => {
              const tag = newTag.trim();
              if (tag && !addTags.includes(tag)) setAddTags([...addTags, tag]);
              setNewTag('');
            }}
          />
          <Button
            label={t('fields.addTag')}
            size="sm"
            variant="secondary"
            disabled={!newTag.trim()}
            onPress={() => {
              const tag = newTag.trim();
              if (tag && !addTags.includes(tag)) setAddTags([...addTags, tag]);
              setNewTag('');
            }}
          />
        </View>
        {addTagOptions.length ? <ChipGroup options={addTagOptions} value={addTags} multiple onChange={(v) => setAddTags((v as string[]) ?? [])} /> : null}
      </Group>
      {existingTags.length ? (
        <Group title={t('bulk.removeTags')}>
          <ChipGroup options={existingTags} value={removeTags} multiple onChange={(v) => setRemoveTags((v as string[]) ?? [])} />
        </Group>
      ) : null}
      {error ? (
        <Text variant="small" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </Sheet>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.group}>
      <Text variant="smallStrong">{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: space.sm },
  footer: { flexDirection: 'row', justifyContent: 'space-between', gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
