import { File, Paths } from 'expo-file-system';
import { useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { errorMessage } from '@/api/client';
import { useDeleteAccount, useExportData } from '@/api/hooks/me';
import { Button, Card, ConfirmDialog, ListRow, OfflineBanner, Screen, Text, useIsOnline, useToast } from '@/components/ui';
import { today } from '@/lib/dates';
import { useSession } from '@/state/session';
import { space } from '@/theme';

/** Writes the export to the cache directory and opens the share sheet. Exported for reuse. */
export async function shareJsonExport(json: string, dialogTitle: string): Promise<boolean> {
  if (!(await Sharing.isAvailableAsync())) return false;
  const file = new File(Paths.cache, `dressit-export-${today()}.json`);
  file.create({ overwrite: true });
  file.write(json);
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle });
  return true;
}

export default function PrivacyScreen() {
  const { t } = useTranslation('profile');
  const router = useRouter();
  const toast = useToast();
  const online = useIsOnline();
  const exportData = useExportData();
  const deleteAccount = useDeleteAccount();
  const { forgetDevice } = useSession();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const doExport = () =>
    exportData.mutate(undefined, {
      onSuccess: async (json) => {
        try {
          const shared = await shareJsonExport(json, t('privacy.exportTitle'));
          toast.show(shared ? { message: t('privacy.exportDone'), tone: 'success' } : { message: t('privacy.shareUnavailable'), tone: 'error' });
        } catch (e) {
          toast.show({ message: errorMessage(e), tone: 'error' });
        }
      },
      onError: (e) => toast.show({ message: errorMessage(e), tone: 'error' }),
    });

  return (
    <Screen testID="privacy-screen">
      <OfflineBanner />
      <Text variant="body" tone="muted">
        {t('privacy.intro')}
      </Text>

      <Card>
        <View style={{ gap: space.sm }}>
          <Text variant="heading">{t('privacy.exportTitle')}</Text>
          <Text variant="body" tone="muted">
            {t('privacy.exportBody')}
          </Text>
          <Button
            label={exportData.isPending ? t('privacy.exporting') : t('privacy.exportAction')}
            icon="download"
            variant="secondary"
            onPress={doExport}
            loading={exportData.isPending}
            disabled={!online}
            testID="privacy-export"
          />
        </View>
      </Card>

      <ListRow icon="check-square" title={t('privacy.consents')} onPress={() => router.push('/profile/consents')} />

      <Card tone="sunken">
        <View style={{ gap: space.sm }}>
          <Text variant="heading" tone="danger">
            {t('privacy.deleteTitle')}
          </Text>
          <Text variant="body" tone="muted">
            {t('privacy.deleteBody')}
          </Text>
          <Button label={t('privacy.deleteAction')} variant="danger" icon="trash-2" onPress={() => setConfirmDelete(true)} disabled={!online} testID="privacy-delete" />
        </View>
      </Card>

      <ConfirmDialog
        visible={confirmDelete}
        title={t('privacy.deleteConfirmTitle')}
        message={t('privacy.deleteConfirmMessage')}
        confirmLabel={t('privacy.deleteConfirm')}
        destructive
        input={{ label: t('privacy.deleteConfirmLabel'), secure: true, required: true }}
        loading={deleteAccount.isPending}
        error={deleteAccount.isError ? errorMessage(deleteAccount.error) : null}
        onCancel={() => {
          deleteAccount.reset();
          setConfirmDelete(false);
        }}
        onConfirm={(password) =>
          deleteAccount.mutate(password ?? '', {
            onSuccess: async () => {
              setConfirmDelete(false);
              toast.show({ message: t('privacy.deleted'), tone: 'success' });
              await forgetDevice();
            },
          })
        }
        testID="delete-account-dialog"
      />
    </Screen>
  );
}
