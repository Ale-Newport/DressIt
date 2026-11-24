import { useTranslation } from 'react-i18next';

import { ConsentList } from '@/components/profile/ConsentList';
import { OfflineBanner, Screen, Text } from '@/components/ui';

export default function ConsentsScreen() {
  const { t } = useTranslation('profile');
  return (
    <Screen testID="consents-screen">
      <OfflineBanner />
      <Text variant="body" tone="muted">
        {t('consents.intro')}
      </Text>
      <ConsentList showRequired />
    </Screen>
  );
}
