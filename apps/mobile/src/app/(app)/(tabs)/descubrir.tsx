import type { ShoppingSection, ShoppingSectionDto } from '@dressit/shared';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useShoppingSections, useWardrobeGaps } from '@/api/hooks';
import { GapCard } from '@/components/shop/GapCard';
import { ProductRail } from '@/components/shop/ProductRail';
import {
  Card,
  Chip,
  ErrorState,
  Icon,
  IconButton,
  OfflineBanner,
  Screen,
  ScreenHeader,
  SectionHeader,
  Skeleton,
  SkeletonGroup,
  Text,
} from '@/components/ui';
import { radius, space, useTheme } from '@/theme';

const SECTION_ORDER: ShoppingSection[] = ['para_ti', 'completa_armario', 'combina_favoritos', 'novedades', 'versatiles', 'ofertas_marcas', 'bajo_presupuesto'];

export default function DiscoverScreen() {
  const { t } = useTranslation('shop');
  const router = useRouter();
  const sections = useShoppingSections();
  const gaps = useWardrobeGaps();

  const ordered = useMemo(
    () => [...(sections.data ?? [])].sort((a, b) => SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section)),
    [sections.data],
  );
  // The API returns the same `emptyReason` for every section when no licensed catalog exists.
  const noCatalog =
    !!sections.data &&
    sections.data.length > 0 &&
    sections.data.every((s) => s.items.length === 0) &&
    new Set(sections.data.map((s) => s.emptyReason)).size === 1;
  const catalogReason = noCatalog ? (ordered.find((s) => s.section === 'para_ti')?.emptyReason ?? ordered[0]?.emptyReason ?? null) : null;

  const refresh = () => {
    sections.refetch();
    gaps.refetch();
  };

  const tools: Array<{ key: string; label: string; icon: 'search' | 'camera' | 'link' | 'heart' | 'shopping-bag'; onPress: () => void }> = [
    { key: 'search', label: t('discover.search'), icon: 'search', onPress: () => router.push('/shop/search') },
    { key: 'visual', label: t('discover.visualSearch'), icon: 'camera', onPress: () => router.push('/shop/visual-search') },
    { key: 'link', label: t('discover.importLink'), icon: 'link', onPress: () => router.push('/import/link') },
    { key: 'wishlist', label: t('discover.wishlist'), icon: 'heart', onPress: () => router.push('/shop/wishlist') },
    { key: 'retailers', label: t('discover.retailers'), icon: 'shopping-bag', onPress: () => router.push('/shop/retailers') },
  ];

  return (
    <Screen edges={['top']} testID="descubrir-screen" onRefresh={refresh} refreshing={sections.isRefetching || gaps.isRefetching}>
      <ScreenHeader
        overline={t('discover.overline')}
        title={t('discover.title')}
        subtitle={t('discover.subtitle')}
        right={
          <>
            <IconButton icon="search" label={t('discover.searchA11y')} onPress={() => router.push('/shop/search')} testID="descubrir-search" />
            <IconButton icon="heart" label={t('discover.wishlistA11y')} onPress={() => router.push('/shop/wishlist')} testID="descubrir-wishlist" />
          </>
        }
      />
      <OfflineBanner />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tools}>
        {tools.map((tool) => (
          <Chip key={tool.key} label={tool.label} icon={tool.icon} onPress={tool.onPress} testID={`descubrir-tool-${tool.key}`} />
        ))}
      </ScrollView>

      {noCatalog ? <NoCatalogNotice reason={catalogReason} /> : null}

      {/* Wardrobe gaps come from the user's own wardrobe: useful even without a catalog. */}
      <View>
        <SectionHeader overline={t('discover.gapsOverline')} title={t('discover.gapsTitle')} />
        {gaps.data ? (
          gaps.data.length ? (
            <View style={{ gap: space.md }}>
              {gaps.data.slice(0, 4).map((g) => (
                <GapCard key={g.key} gap={g} />
              ))}
            </View>
          ) : (
            <Card tone="sunken">
              <Text variant="small" tone="muted">
                {t('discover.gapsEmpty')}
              </Text>
            </Card>
          )
        ) : gaps.isError ? (
          <ErrorState error={gaps.error} onRetry={() => gaps.refetch()} compact />
        ) : (
          <RailSkeleton />
        )}
      </View>

      {sections.data ? (
        ordered.map((s) => (noCatalog ? null : <SectionRail key={s.section} section={s} />))
      ) : sections.isError ? (
        <ErrorState error={sections.error} onRetry={() => sections.refetch()} />
      ) : (
        <>
          <RailSkeleton />
          <RailSkeleton />
        </>
      )}
    </Screen>
  );
}

function SectionRail({ section }: { section: ShoppingSectionDto }) {
  const { t } = useTranslation('shop');
  return (
    <View testID={`section-${section.section}`}>
      <SectionHeader overline={t('discover.sectionsOverline')} title={section.title || t(`sectionFallback.${section.section}`)} />
      {section.items.length ? (
        <ProductRail
          items={section.items.map((r) => ({
            product: r.product,
            highlight: r.newOutfits > 0 ? t('discover.newOutfits', { count: r.newOutfits }) : (r.reasons[0] ?? null),
          }))}
          testID={`section-${section.section}-rail`}
        />
      ) : (
        <Card tone="sunken" testID={`section-${section.section}-empty`}>
          <Text variant="small" tone="muted">
            {section.emptyReason ?? t('discover.sectionEmpty')}
          </Text>
        </Card>
      )}
    </View>
  );
}

function NoCatalogNotice({ reason }: { reason: string | null }) {
  const { t } = useTranslation('shop');
  const { colors } = useTheme();
  return (
    <Card tone="accent" testID="descubrir-no-catalog" style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
        <Icon name="info" size={18} color={colors.accent} />
        <Text variant="subheading" style={{ flex: 1 }}>
          {t('discover.noCatalogTitle')}
        </Text>
      </View>
      {reason ? <Text variant="small">{reason}</Text> : null}
      <Text variant="small" tone="muted">
        {t('discover.noCatalogBody')}
      </Text>
    </Card>
  );
}

function RailSkeleton() {
  return (
    <SkeletonGroup style={{ gap: space.md }}>
      <Skeleton width="45%" height={22} />
      <View style={{ flexDirection: 'row', gap: space.md }}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={{ width: 150, gap: 6 }}>
            <Skeleton height={190} radius={radius.md} />
            <Skeleton width="70%" height={12} />
          </View>
        ))}
      </View>
    </SkeletonGroup>
  );
}

const styles = StyleSheet.create({
  tools: { gap: space.sm, paddingRight: space.lg },
});
