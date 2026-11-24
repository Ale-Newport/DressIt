import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Divider, type IconName, ListRow, Sheet, useToast } from '@/components/ui';
import { pickFromLibrary } from '@/lib/media';
import { uploadQueue } from '@/state/uploadQueue';

export interface AddGarmentSheetProps {
  visible: boolean;
  onClose: () => void;
}

const SHEET_CLOSE_DELAY = 300;

type Option = { key: 'camera' | 'gallery' | 'link' | 'scan' | 'text' | 'manual'; icon: IconName };

const OPTIONS: Option[] = [
  { key: 'camera', icon: 'camera' },
  { key: 'gallery', icon: 'image' },
  { key: 'link', icon: 'link' },
  { key: 'scan', icon: 'maximize' },
  { key: 'text', icon: 'file-text' },
  { key: 'manual', icon: 'edit-3' },
];

/** Every way to add garments, as listed in the spec. Gallery picks start uploading immediately. */
export function AddGarmentSheet({ visible, onClose }: AddGarmentSheetProps) {
  const { t } = useTranslation('wardrobe');
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const go = async (key: Option['key']) => {
    if (key === 'gallery') {
      setBusy(true);
      try {
        const res = await pickFromLibrary({ multiple: true, limit: 60 });
        if (res.status === 'ok') {
          const sessionId = uploadQueue.createSession(res.uris.length > 1 ? 'batch' : 'gallery', 'single');
          uploadQueue.enqueue(sessionId, res.uris, 'garment_photo');
          onClose();
          setTimeout(() => router.push({ pathname: '/capture/session', params: { sessionId } }), SHEET_CLOSE_DELAY);
        }
      } catch {
        toast.show({ message: t('add.pickError'), tone: 'error' });
      } finally {
        setBusy(false);
      }
      return;
    }
    onClose();
    // Let the sheet (an RN Modal) finish closing before presenting a native modal screen.
    setTimeout(() => {
      switch (key) {
        case 'camera':
          router.push('/capture/camera');
          break;
        case 'link':
          router.push('/import/link');
          break;
        case 'scan':
          router.push('/capture/scan');
          break;
        case 'text':
          router.push('/capture/text');
          break;
        case 'manual':
          router.push('/garment/new');
          break;
      }
    }, SHEET_CLOSE_DELAY);
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={t('add.title')} subtitle={t('add.subtitle')} testID="add-sheet">
      {OPTIONS.map((o, i) => (
        <ListRowWrap key={o.key} last={i === OPTIONS.length - 1}>
          <ListRow
            icon={o.icon}
            title={t(`add.${o.key}`)}
            subtitle={t(`add.${o.key}Hint`)}
            onPress={busy ? undefined : () => go(o.key)}
            testID={`add-sheet-${o.key}`}
          />
        </ListRowWrap>
      ))}
    </Sheet>
  );
}

function ListRowWrap({ children, last }: { children: React.ReactNode; last: boolean }) {
  return (
    <>
      {children}
      {last ? null : <Divider inset={48} />}
    </>
  );
}
