import type { SpaceDto, SpaceKind } from '@dressit/shared';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { errorMessage } from '@/api/client';
import { useCreateSpace, useDeleteSpace, useSpaces, useUpdateSpace } from '@/api/hooks';
import {
  Button,
  ChipGroup,
  ConfirmDialog,
  Divider,
  EmptyState,
  Icon,
  IconButton,
  OfflineBanner,
  QueryView,
  Screen,
  Sheet,
  SkeletonList,
  Text,
  TextField,
  useToast,
} from '@/components/ui';
import { options, spaceKindLabel } from '@/lib/vocab';
import { space, useTheme } from '@/theme';

const KIND_ICONS: Record<SpaceKind, 'archive' | 'inbox' | 'box' | 'package' | 'briefcase' | 'folder'> = {
  armario: 'archive',
  cajon: 'inbox',
  zapatero: 'box',
  almacenaje: 'package',
  maleta: 'briefcase',
  otro: 'folder',
};

export default function SpacesScreen() {
  const { t } = useTranslation('wardrobe');
  const { t: tc } = useTranslation();
  const spaces = useSpaces();
  const [editing, setEditing] = useState<SpaceDto | 'new' | null>(null);
  const [deleting, setDeleting] = useState<SpaceDto | null>(null);
  const toast = useToast();
  const update = useUpdateSpace();
  const del = useDeleteSpace();

  const sorted = [...(spaces.data ?? [])].sort((a, b) => a.position - b.position);

  const move = (index: number, dir: -1 | 1) => {
    const a = sorted[index];
    const b = sorted[index + dir];
    if (!a || !b) return;
    const onError = (e: unknown) => toast.show({ message: errorMessage(e), tone: 'error' });
    // Swap positions (two PATCH calls; the list refetches after each).
    update.mutate({ id: a.id, position: b.position === a.position ? a.position + dir : b.position }, { onError });
    update.mutate({ id: b.id, position: a.position }, { onError });
  };

  return (
    <Screen
      refreshing={spaces.isRefetching}
      onRefresh={() => spaces.refetch()}
      testID="spaces-screen"
      footer={<Button label={t('spaces.new')} icon="plus" onPress={() => setEditing('new')} fullWidth testID="spaces-new" />}
    >
      <OfflineBanner />
      <Text variant="body" tone="muted" style={{ paddingTop: space.md }}>
        {t('spaces.intro')}
      </Text>
      <QueryView
        query={spaces}
        loading={<SkeletonList rows={4} />}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState icon="archive" title={t('spaces.emptyTitle')} body={t('spaces.emptyBody')} actionLabel={t('spaces.new')} onAction={() => setEditing('new')} />}
      >
        {() => (
          <View>
            {sorted.map((s, i) => (
              <View key={s.id}>
                {i > 0 ? <Divider /> : null}
                <SpaceRow
                  space={s}
                  first={i === 0}
                  last={i === sorted.length - 1}
                  onEdit={() => setEditing(s)}
                  onDelete={() => setDeleting(s)}
                  onUp={() => move(i, -1)}
                  onDown={() => move(i, 1)}
                />
              </View>
            ))}
          </View>
        )}
      </QueryView>

      <SpaceSheet editing={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        visible={!!deleting}
        title={t('spaces.deleteTitle', { name: deleting?.name ?? '' })}
        message={t('spaces.deleteMessage')}
        destructive
        confirmLabel={tc('actions.delete')}
        loading={del.isPending}
        error={del.isError ? errorMessage(del.error) : null}
        onCancel={() => setDeleting(null)}
        onConfirm={() =>
          deleting &&
          del.mutate(deleting.id, {
            onSuccess: () => {
              setDeleting(null);
              toast.show({ message: t('spaces.deleted'), tone: 'success' });
            },
          })
        }
      />
    </Screen>
  );
}

function SpaceRow({
  space: s,
  first,
  last,
  onEdit,
  onDelete,
  onUp,
  onDown,
}: {
  space: SpaceDto;
  first: boolean;
  last: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onUp: () => void;
  onDown: () => void;
}) {
  const { t } = useTranslation('wardrobe');
  const { t: tc } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  return (
    <View style={styles.row} testID={`space-row-${s.id}`}>
      <Pressable
        style={styles.main}
        onPress={() => router.navigate({ pathname: '/armario', params: { spaceId: s.id } })}
        accessibilityRole="button"
        accessibilityLabel={`${s.name}, ${spaceKindLabel(s.kind)}, ${t('spaces.garments', { count: s.garmentCount })}`}
        accessibilityHint={t('spaces.viewGarments', { name: s.name })}
      >
        <View style={[styles.icon, { backgroundColor: colors.surfaceAlt }]}>
          <Icon name={KIND_ICONS[s.kind] ?? 'folder'} size={18} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="bodyStrong">{s.name}</Text>
          <Text variant="small" tone="muted">
            {spaceKindLabel(s.kind)} · {t('spaces.garments', { count: s.garmentCount })}
          </Text>
        </View>
      </Pressable>
      <IconButton icon="chevron-up" label={t('spaces.moveUp', { name: s.name })} onPress={onUp} disabled={first} />
      <IconButton icon="chevron-down" label={t('spaces.moveDown', { name: s.name })} onPress={onDown} disabled={last} />
      <IconButton icon="edit-2" label={`${t('spaces.edit')}: ${s.name}`} onPress={onEdit} />
      <IconButton icon="trash-2" label={`${tc('actions.delete')}: ${s.name}`} onPress={onDelete} color={colors.danger} />
    </View>
  );
}

function SpaceSheet({ editing, onClose }: { editing: SpaceDto | 'new' | null; onClose: () => void }) {
  const { t } = useTranslation('wardrobe');
  const toast = useToast();
  const create = useCreateSpace();
  const update = useUpdateSpace();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<SpaceKind>('armario');
  useEffect(() => {
    if (editing && editing !== 'new') {
      setName(editing.name);
      setKind(editing.kind);
    } else if (editing === 'new') {
      setName('');
      setKind('armario');
    }
  }, [editing]);
  const isNew = editing === 'new';
  const mutation = isNew ? create : update;
  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const onSuccess = () => {
      toast.show({ message: isNew ? t('spaces.created') : t('spaces.updated'), tone: 'success' });
      onClose();
    };
    if (isNew) create.mutate({ name: trimmed, kind }, { onSuccess });
    else if (editing) update.mutate({ id: editing.id, name: trimmed, kind }, { onSuccess });
  };
  return (
    <Sheet
      visible={!!editing}
      onClose={onClose}
      title={isNew ? t('spaces.new') : t('spaces.edit')}
      testID="space-sheet"
      footer={
        <>
          {mutation.isError ? (
            <Text variant="small" tone="danger">
              {errorMessage(mutation.error)}
            </Text>
          ) : null}
          <Button
            label={isNew ? t('spaces.create') : t('spaces.save')}
            onPress={submit}
            disabled={!name.trim()}
            loading={mutation.isPending}
            fullWidth
            testID="space-save"
          />
        </>
      }
    >
      <TextField label={t('spaces.name')} placeholder={t('spaces.namePlaceholder')} value={name} onChangeText={setName} autoFocus testID="space-name" />
      <Text variant="smallStrong">{t('spaces.kind')}</Text>
      <ChipGroup options={options.spaceKinds} value={kind} allowDeselect={false} onChange={(v) => v && setKind(v as SpaceKind)} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingVertical: space.sm },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52 },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
