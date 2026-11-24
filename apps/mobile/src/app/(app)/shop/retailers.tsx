import type { IntegrationStatus, RetailerIntegrationDto } from '@dressit/shared';
import { FlatList, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useRetailers } from '@/api/hooks';
import { Badge, type BadgeTone, Card, EmptyState, ErrorState, Icon, OfflineBanner, SkeletonList, Text } from '@/components/ui';
import { timeAgo } from '@/lib/format';
import { imagePolicyLabel, integrationStatusLabel } from '@/lib/vocab';
import { space, useTheme } from '@/theme';

const STATUS_TONE: Record<IntegrationStatus, BadgeTone> = {
  operational: 'success',
  partial: 'info',
  link_only: 'neutral',
  pending_authorization: 'warning',
  disabled: 'danger',
};

const STATUS_ORDER: IntegrationStatus[] = ['operational', 'partial', 'link_only', 'pending_authorization', 'disabled'];

type Capability = keyof RetailerIntegrationDto['capabilities'];
const CAPABILITIES: Capability[] = ['linkImport', 'pageCapture', 'catalogSearch', 'prices', 'availability', 'images', 'affiliateLinks', 'visualSearch'];

/** Honest integration matrix: what actually works per retailer today. */
export default function RetailersScreen() {
  const { t } = useTranslation('shop');
  const { colors } = useTheme();
  const retailers = useRetailers();
  const sorted = [...(retailers.data ?? [])].sort(
    (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.retailer.name.localeCompare(b.retailer.name, 'es'),
  );

  const header = (
    <View style={{ gap: space.md, paddingBottom: space.lg }}>
      <OfflineBanner />
      <Text variant="body" tone="muted">
        {t('retailers.intro')}
      </Text>
    </View>
  );

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]} testID="retailers-screen">
      {retailers.data ? (
        <FlatList
          data={sorted}
          keyExtractor={(r) => r.retailer.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={header}
          ItemSeparatorComponent={() => <View style={{ height: space.md }} />}
          refreshing={retailers.isRefetching}
          onRefresh={() => retailers.refetch()}
          ListEmptyComponent={<EmptyState icon="shopping-bag" title={t('retailers.emptyTitle')} body={t('retailers.emptyBody')} />}
          renderItem={({ item }) => <RetailerCard item={item} />}
        />
      ) : retailers.isError ? (
        <View style={styles.list}>
          {header}
          <ErrorState error={retailers.error} onRetry={() => retailers.refetch()} />
        </View>
      ) : (
        <View style={styles.list}>
          {header}
          <SkeletonList rows={6} testID="retailers-loading" />
        </View>
      )}
    </View>
  );
}

function RetailerCard({ item }: { item: RetailerIntegrationDto }) {
  const { t } = useTranslation('shop');
  const { colors } = useTheme();
  const checked = timeAgo(item.lastCheckedAt);
  return (
    <Card style={{ gap: space.md }} testID={`retailer-${item.retailer.id}`}>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text variant="subheading">{item.retailer.name}</Text>
          {item.retailer.group ? (
            <Text variant="caption" tone="muted">
              {item.retailer.group}
            </Text>
          ) : null}
        </View>
        <Badge label={integrationStatusLabel(item.status)} tone={STATUS_TONE[item.status]} testID={`retailer-${item.retailer.id}-status`} />
      </View>
      <View style={styles.caps}>
        {CAPABILITIES.map((c) => {
          const on = item.capabilities[c];
          return (
            <View
              key={c}
              style={styles.cap}
              accessible
              accessibilityLabel={`${t(`retailers.capabilities.${c}`)}: ${on ? t('retailers.yes') : t('retailers.no')}`}
            >
              <Icon name={on ? 'check' : 'x'} size={14} color={on ? colors.success : colors.inkSubtle} />
              <Text variant="caption" tone={on ? 'default' : 'subtle'}>
                {t(`retailers.capabilities.${c}`)}
              </Text>
            </View>
          );
        })}
      </View>
      <View style={{ gap: 2 }}>
        <Text variant="caption" tone="muted">
          {t('retailers.images', { policy: imagePolicyLabel(item.imagePolicy) })}
        </Text>
        <Text variant="caption" tone="muted">
          {t('retailers.provider', { provider: item.provider })}
        </Text>
        {item.domains.length ? (
          <Text variant="caption" tone="muted" numberOfLines={2}>
            {t('retailers.domains', { domains: item.domains.join(', ') })}
          </Text>
        ) : null}
        {item.requires ? (
          <Text variant="caption" tone="warning">
            {t('retailers.requires', { requires: item.requires })}
          </Text>
        ) : null}
      </View>
      {item.notes ? <Text variant="small">{item.notes}</Text> : null}
      <Text variant="caption" tone="subtle">
        {checked ? t('retailers.lastChecked', { ago: checked }) : t('retailers.neverChecked')}
        {item.lastCheckResult ? ` · ${item.lastCheckResult}` : ''}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  list: { paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.huge },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  caps: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.md, rowGap: space.xs },
  cap: { flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: '45%' },
});
