import type { OutfitDto } from '@dressit/shared';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Badge, Button, IconButton } from '@/components/ui';
import { space } from '@/theme';

export interface OutfitActionsProps {
  outfit: OutfitDto;
  testID: string;
  busy?: 'accept' | 'reject' | 'save' | 'wear' | null;
  onAccept: () => void;
  onReject: () => void;
  onToggleSave: () => void;
  onSwap: () => void;
  onWear: () => void;
  onMore: () => void;
  onOpen: () => void;
}

/** Per-outfit action bar shown under each recommendation on Inicio. */
export function OutfitActions({ outfit, testID, busy, onAccept, onReject, onToggleSave, onSwap, onWear, onMore, onOpen }: OutfitActionsProps) {
  const { t } = useTranslation('home');
  const accepted = outfit.status === 'accepted';
  const worn = outfit.status === 'worn';
  return (
    <View style={styles.wrap}>
      {accepted || worn ? (
        <Badge label={worn ? t('actions.worn') : t('actions.accepted')} tone="success" icon="check" testID={`${testID}-status`} />
      ) : null}
      <View style={styles.row}>
        <Button
          label={accepted ? t('actions.accepted') : t('actions.accept')}
          size="sm"
          icon="check"
          onPress={onAccept}
          disabled={accepted || worn}
          loading={busy === 'accept'}
          accessibilityHint={t('actions.acceptHint')}
          testID={`${testID}-accept`}
        />
        <Button
          label={t('actions.reject')}
          size="sm"
          variant="secondary"
          icon="x"
          onPress={onReject}
          loading={busy === 'reject'}
          accessibilityHint={t('actions.rejectHint')}
          testID={`${testID}-reject`}
        />
        <View style={styles.spacer} />
        <IconButton
          icon="bookmark"
          label={outfit.isSaved ? t('actions.unsave') : t('actions.save')}
          accessibilityHint={t('actions.saveHint')}
          selected={outfit.isSaved}
          onPress={onToggleSave}
          disabled={busy === 'save'}
          testID={`${testID}-save`}
        />
        <IconButton icon="more-horizontal" label={t('actions.more')} accessibilityHint={t('actions.moreHint')} onPress={onMore} testID={`${testID}-more`} />
      </View>
      <View style={styles.row}>
        <Button label={t('actions.swap')} size="sm" variant="ghost" icon="shuffle" onPress={onSwap} testID={`${testID}-swap`} />
        <Button
          label={worn ? t('actions.worn') : t('actions.wear')}
          size="sm"
          variant="ghost"
          icon="check-circle"
          onPress={onWear}
          disabled={worn}
          loading={busy === 'wear'}
          accessibilityHint={t('actions.wearHint')}
          testID={`${testID}-wear`}
        />
        <Button label={t('actions.view')} size="sm" variant="ghost" iconRight="arrow-right" onPress={onOpen} testID={`${testID}-open`} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  spacer: { flex: 1 },
});
