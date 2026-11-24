import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useStyleProfile } from '@/api/hooks/me';
import { BarChart, Button, Card, EmptyState, OfflineBanner, QueryView, Screen, SectionHeader, SkeletonList, Text } from '@/components/ui';
import { timeAgo } from '@/lib/format';
import { colorHex, colorLabel, humanize, styleLabel } from '@/lib/vocab';
import { space } from '@/theme';

const pct = (w: number) => Math.round((w <= 1 ? w * 100 : w) * 10) / 10;

export default function StyleProfileScreen() {
  const { t } = useTranslation('profile');
  const router = useRouter();
  const profile = useStyleProfile();

  return (
    <Screen refreshing={profile.isRefetching} onRefresh={() => profile.refetch()} testID="style-profile-screen">
      <OfflineBanner />
      <Text variant="body" tone="muted">
        {t('styleProfile.intro')}
      </Text>
      <QueryView query={profile} loading={<SkeletonList rows={6} />}>
        {(p) => (
          <View style={{ gap: space.xl }}>
            <Card tone="sunken">
              <Text variant="bodyStrong">{t('styleProfile.feedback', { count: p.feedbackCount })}</Text>
              {p.updatedAt ? (
                <Text variant="caption" tone="muted">
                  {t('styleProfile.updated', { ago: timeAgo(p.updatedAt) ?? '' })}
                </Text>
              ) : null}
            </Card>
            {p.feedbackCount === 0 && p.topStyles.length === 0 ? (
              <EmptyState compact icon="activity" title={t('title')} body={t('styleProfile.noFeedback')} />
            ) : null}
            {p.topStyles.length ? (
              <View>
                <SectionHeader title={t('styleProfile.topStyles')} />
                <BarChart unit=" %" data={p.topStyles.map((s) => ({ key: s.style, label: styleLabel(s.style), value: pct(s.weight) }))} testID="style-profile-styles" />
              </View>
            ) : null}
            {p.topColors.length ? (
              <View>
                <SectionHeader title={t('styleProfile.topColors')} />
                <BarChart
                  unit=" %"
                  data={p.topColors.map((c) => ({ key: c.family, label: colorLabel(c.family), value: pct(c.weight), color: colorHex(c.family) }))}
                />
              </View>
            ) : null}
            {Object.keys(p.rankingWeights).length ? (
              <View>
                <SectionHeader title={t('styleProfile.weights')} />
                <Text variant="small" tone="muted" style={{ marginBottom: space.md }}>
                  {t('styleProfile.weightsHint')}
                </Text>
                <BarChart
                  unit=" %"
                  data={Object.entries(p.rankingWeights)
                    .sort((a, b) => b[1] - a[1])
                    .map(([k, v]) => ({ key: k, label: humanize(k), value: pct(v) }))}
                  testID="style-profile-weights"
                />
              </View>
            ) : null}
            <Button label={t('styleProfile.edit')} variant="secondary" icon="sliders" onPress={() => router.push('/profile/preferences')} />
          </View>
        )}
      </QueryView>
    </Screen>
  );
}
