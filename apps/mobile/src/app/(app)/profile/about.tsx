import Constants from 'expo-constants';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { api } from '@/api/client';
import { Card, Divider, Screen, SectionHeader, Text } from '@/components/ui';
import { space, useTheme } from '@/theme';

export default function AboutScreen() {
  const { t } = useTranslation('profile');
  const { colors } = useTheme();
  const version = Constants.expoConfig?.version ?? '0.0.0';
  const licenses = t('about.licenseItems', { returnObjects: true }) as string[];
  return (
    <Screen testID="about-screen">
      <View style={{ gap: space.xs }}>
        <Text variant="title">DressIt</Text>
        <View style={{ width: 28, height: 2, backgroundColor: colors.accent }} />
        <Text variant="body" tone="muted">
          {t('about.tagline')}
        </Text>
        <Text variant="small" tone="muted">
          {t('about.version', { version })}
        </Text>
      </View>
      <Card tone="sunken">
        <Text variant="subheading">{t('about.demoTitle')}</Text>
        <Text variant="small" tone="muted">
          {t('about.demoBody')}
        </Text>
      </Card>
      <Card>
        <Text variant="subheading">{t('about.honestyTitle')}</Text>
        <Text variant="small" tone="muted">
          {t('about.honestyBody')}
        </Text>
      </Card>
      <View>
        <SectionHeader title={t('about.licenses')} />
        {licenses.map((l, i) => (
          <View key={l}>
            {i > 0 ? <Divider /> : null}
            <Text variant="small" style={{ paddingVertical: space.sm }}>
              {l}
            </Text>
          </View>
        ))}
      </View>
      <Text variant="caption" tone="subtle" selectable>
        {t('about.server')}: {api.baseUrl()}
      </Text>
    </Screen>
  );
}
