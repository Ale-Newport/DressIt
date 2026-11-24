import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Badge, Button, Divider, Icon, type IconName, Text } from '@/components/ui';
import { useSession } from '@/state/session';
import { space, useTheme } from '@/theme';

const POINTS: Array<{ key: 'wardrobe' | 'stylist' | 'shopping'; icon: IconName }> = [
  { key: 'wardrobe', icon: 'grid' },
  { key: 'stylist', icon: 'layers' },
  { key: 'shopping', icon: 'shopping-bag' },
];

export default function WelcomeScreen() {
  const { t } = useTranslation('auth');
  const { colors } = useTheme();
  const router = useRouter();
  const { expiredNotice, dismissExpiredNotice } = useSession();

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: colors.background }]} testID="welcome-screen">
      <View style={styles.content}>
        <View style={styles.brandRow}>
          <Text variant="title" accessibilityRole="header">
            DressIt
          </Text>
          <View style={[styles.rule, { backgroundColor: colors.accent }]} />
        </View>

        <View style={styles.hero}>
          <Text variant="overline" tone="muted">
            {t('welcome.overline')}
          </Text>
          <Text variant="display">{t('welcome.title')}</Text>
          <Text variant="body" tone="muted">
            {t('welcome.body')}
          </Text>
        </View>

        <View style={styles.points}>
          {POINTS.map((p, i) => (
            <View key={p.key}>
              {i > 0 ? <Divider /> : null}
              <View style={styles.point}>
                <Icon name={p.icon} size={18} color={colors.accent} />
                <Text variant="body" style={{ flex: 1 }}>
                  {t(`welcome.points.${p.key}`)}
                </Text>
              </View>
            </View>
          ))}
        </View>

        {expiredNotice ? (
          <View accessibilityLiveRegion="polite">
            <Badge label={t('sessionExpired')} tone="warning" icon="clock" />
          </View>
        ) : null}

        <View style={styles.actions}>
          <Button
            label={t('welcome.register')}
            fullWidth
            onPress={() => {
              dismissExpiredNotice();
              router.push('/register');
            }}
            testID="welcome-register"
          />
          <Button
            label={t('welcome.login')}
            variant="secondary"
            fullWidth
            onPress={() => {
              dismissExpiredNotice();
              router.push('/login');
            }}
            testID="welcome-login"
          />
          <Text variant="caption" tone="muted" align="center">
            {t('welcome.privacy')}
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { flex: 1, paddingHorizontal: space.xxl, paddingTop: space.xl, paddingBottom: space.lg, justifyContent: 'space-between', gap: space.xl },
  brandRow: { gap: space.sm },
  rule: { width: 28, height: 2 },
  hero: { gap: space.md },
  points: { gap: 0 },
  point: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  actions: { gap: space.md },
});
