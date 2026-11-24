import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useMe } from '@/api/hooks/me';
import {
  Badge,
  Card,
  ConfirmDialog,
  Divider,
  ErrorState,
  ListRow,
  OfflineBanner,
  Screen,
  ScreenHeader,
  SegmentedControl,
  Skeleton,
  SkeletonGroup,
  Text,
} from '@/components/ui';
import { useSession } from '@/state/session';
import { space, type ThemePreference, useTheme } from '@/theme';

export default function PerfilScreen() {
  const { t } = useTranslation('profile');
  const { t: tc } = useTranslation();
  const router = useRouter();
  const me = useMe();
  const { signOut } = useSession();
  const { preference, setPreference } = useTheme();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  return (
    <Screen edges={['top']} testID="perfil-screen" refreshing={me.isRefetching} onRefresh={() => me.refetch()}>
      <ScreenHeader title={t('title')} />
      <OfflineBanner />
      {me.data ? (
        <Card tone="sunken" testID="perfil-user">
          <Text variant="heading">{me.data.displayName}</Text>
          <Text variant="small" tone="muted">
            {me.data.email}
          </Text>
          <View style={styles.badges}>
            <Badge label={t(`plan.${me.data.plan}`)} tone={me.data.plan === 'premium' ? 'accent' : 'neutral'} />
            {me.data.location ? <Badge label={me.data.location.name} icon="map-pin" /> : null}
          </View>
        </Card>
      ) : me.isError ? (
        <ErrorState error={me.error} onRetry={() => me.refetch()} compact />
      ) : (
        <SkeletonGroup>
          <Skeleton height={88} radius={18} />
        </SkeletonGroup>
      )}

      <View>
        <Text variant="overline" tone="muted">
          {t('sections.style')}
        </Text>
        <ListRow icon="sliders" title={t('rows.preferences')} subtitle={t('rows.preferencesSub')} onPress={() => router.push('/profile/preferences')} testID="perfil-preferences" />
        <Divider inset={48} />
        <ListRow icon="activity" title={t('rows.styleProfile')} subtitle={t('rows.styleProfileSub')} onPress={() => router.push('/profile/style-profile')} />
        <Divider inset={48} />
        <ListRow icon="user" title="Tu avatar" subtitle="Tus fotos para verte con tus conjuntos" onPress={() => router.push('/profile/avatar')} testID="perfil-avatar" />
        <Divider inset={48} />
        <ListRow icon="map-pin" title={t('rows.city')} value={me.data?.location?.name ?? t('rows.cityEmpty')} onPress={() => router.push('/profile/location')} testID="perfil-city" />
        <Divider inset={48} />
        <ListRow icon="calendar" title={t('rows.calendar')} subtitle={t('rows.calendarSub')} onPress={() => router.push('/profile/calendar')} />
        <Divider inset={48} />
        <ListRow icon="shopping-bag" title={t('rows.integrations')} subtitle={t('rows.integrationsSub')} onPress={() => router.push('/shop/retailers')} />
      </View>

      <View>
        <Text variant="overline" tone="muted">
          {t('sections.account')}
        </Text>
        <ListRow icon="check-square" title={t('rows.consents')} onPress={() => router.push('/profile/consents')} testID="perfil-consents" />
        <Divider inset={48} />
        <ListRow icon="shield" title={t('rows.privacy')} subtitle={t('rows.privacySub')} onPress={() => router.push('/profile/privacy')} testID="perfil-privacy" />
      </View>

      <View style={{ gap: space.sm }}>
        <Text variant="overline" tone="muted">
          {t('sections.app')}
        </Text>
        <Text variant="body">{t('rows.appearance')}</Text>
        <SegmentedControl<ThemePreference>
          accessibilityLabel={t('rows.appearance')}
          value={preference}
          onChange={setPreference}
          segments={[
            { id: 'system', label: t('appearance.system') },
            { id: 'light', label: t('appearance.light') },
            { id: 'dark', label: t('appearance.dark') },
          ]}
        />
        <ListRow icon="info" title={t('rows.about')} onPress={() => router.push('/profile/about')} />
        <Divider inset={48} />
        <ListRow icon="log-out" title={t('rows.logout')} destructive onPress={() => setConfirmLogout(true)} testID="perfil-logout" />
      </View>

      <Text variant="caption" tone="subtle">
        {tc('demoNotice')}
      </Text>

      <ConfirmDialog
        visible={confirmLogout}
        title={t('logoutConfirm.title')}
        message={t('logoutConfirm.message')}
        confirmLabel={t('logoutConfirm.confirm')}
        destructive
        loading={loggingOut}
        onCancel={() => setConfirmLogout(false)}
        onConfirm={async () => {
          setLoggingOut(true);
          try {
            await signOut();
          } finally {
            setLoggingOut(false);
            setConfirmLogout(false);
          }
        }}
        testID="logout-dialog"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
});
