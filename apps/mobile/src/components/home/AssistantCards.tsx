import type { AssistantCard, TripDto, WardrobeGapDto } from '@dressit/shared';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { OutfitCard } from '@/components/OutfitCard';
import { Badge, Button, Card, GarmentTile, Icon, ProductCard, Text } from '@/components/ui';
import { WeatherSummary } from '@/components/WeatherSummary';
import { capitalize, formatShortDate } from '@/lib/format';
import { space, useTheme } from '@/theme';

/** Renders one structured card returned by `/v1/assistant/messages`. */
export function AssistantCardView({ card, testID }: { card: AssistantCard; testID: string }) {
  const { t } = useTranslation('assistant');
  const router = useRouter();

  switch (card.type) {
    case 'outfits':
      return (
        <CardBlock title={t('cards.outfits')} testID={testID}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
            {card.outfits.map((o) => (
              <View key={o.id} style={styles.outfit}>
                <OutfitCard
                  outfit={o}
                  maxExplanation={2}
                  testID={`${testID}-outfit-${o.id}`}
                  onPress={() => router.push({ pathname: '/outfit/[id]', params: { id: o.id } })}
                  footer={
                    <Button
                      label={t('cards.viewOutfit')}
                      size="sm"
                      variant="secondary"
                      iconRight="arrow-right"
                      onPress={() => router.push({ pathname: '/outfit/[id]', params: { id: o.id } })}
                    />
                  }
                />
              </View>
            ))}
          </ScrollView>
        </CardBlock>
      );
    case 'garments':
      return (
        <CardBlock title={t('cards.garments')} testID={testID}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
            {card.garments.map((g) => (
              <View key={g.id} style={styles.garment}>
                <GarmentTile garment={g} onPress={() => router.push({ pathname: '/garment/[id]', params: { id: g.id } })} />
              </View>
            ))}
          </ScrollView>
        </CardBlock>
      );
    case 'products':
      return (
        <CardBlock title={t('cards.products')} testID={testID}>
          {card.products.length === 0 ? (
            <Text variant="small" tone="muted">
              {card.emptyReason ?? t('cards.productsEmpty')}
            </Text>
          ) : (
            <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
                {card.products.map((p) => (
                  <View key={`${p.kind}-${p.id}`} style={styles.product}>
                    <ProductCard
                      product={p}
                      testID={`${testID}-product-${p.id}`}
                      onPress={() => router.push({ pathname: '/shop/product/[id]', params: { id: p.id, kind: p.kind } })}
                    />
                  </View>
                ))}
              </ScrollView>
              {card.emptyReason ? (
                <Text variant="caption" tone="muted">
                  {card.emptyReason}
                </Text>
              ) : null}
            </>
          )}
        </CardBlock>
      );
    case 'weather':
      return (
        <CardBlock title={t('cards.weather')} testID={testID}>
          <WeatherSummary weather={card.weather} compact />
        </CardBlock>
      );
    case 'trip':
      return <TripCard trip={card.trip} testID={testID} />;
    case 'gaps':
      return (
        <CardBlock title={t('cards.gaps')} testID={testID}>
          <View style={{ gap: space.sm }}>
            {card.gaps.map((g) => (
              <GapCard key={g.key} gap={g} />
            ))}
          </View>
        </CardBlock>
      );
    default:
      return null;
  }
}

function CardBlock({ title, children, testID }: { title: string; children: ReactNode; testID: string }) {
  return (
    <View style={styles.block} testID={testID}>
      <Text variant="overline" tone="muted">
        {title}
      </Text>
      {children}
    </View>
  );
}

function TripCard({ trip, testID }: { trip: TripDto; testID: string }) {
  const { t } = useTranslation('assistant');
  const router = useRouter();
  const { colors } = useTheme();
  const open = () => router.push({ pathname: '/trips/[id]', params: { id: trip.id } });
  return (
    <CardBlock title={t('cards.trip')} testID={testID}>
      <Card onPress={open} accessibilityLabel={`${t('cards.trip')}: ${trip.destinationName}`} accessibilityHint={t('cards.openTrip')}>
        <View style={styles.tripRow}>
          <Icon name="briefcase" size={20} color={colors.accent} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="subheading">{trip.destinationName}</Text>
            <Text variant="small" tone="muted">
              {t('cards.tripDates', { from: formatShortDate(trip.startDate), to: formatShortDate(trip.endDate) })}
            </Text>
            {trip.weatherSummary ? <Text variant="small">{trip.weatherSummary}</Text> : null}
            <Text variant="caption" tone="muted">
              {t('cards.tripCapsule', { count: trip.capsule.length })}
            </Text>
          </View>
          <Icon name="chevron-right" size={18} />
        </View>
      </Card>
    </CardBlock>
  );
}

function GapCard({ gap }: { gap: WardrobeGapDto }) {
  const { t } = useTranslation('assistant');
  const router = useRouter();
  return (
    <Card tone="sunken">
      <View style={{ gap: space.xs }}>
        <View style={styles.gapHead}>
          <Text variant="subheading" style={{ flex: 1 }}>
            {capitalize(gap.label)}
          </Text>
          {gap.newOutfits > 0 ? <Badge label={t('cards.gapOutfits', { count: gap.newOutfits })} tone="accent" /> : null}
        </View>
        <Text variant="small" tone="muted">
          {gap.reason}
        </Text>
        <Button
          label={t('cards.searchGap')}
          size="sm"
          variant="secondary"
          icon="search"
          style={{ alignSelf: 'flex-start' }}
          onPress={() => router.push({ pathname: '/shop/search', params: { q: gap.label, subcategory: gap.subcategory, color: gap.colorFamily } })}
          testID={`assistant-gap-${gap.key}`}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  block: { gap: space.sm },
  rail: { gap: space.md, paddingRight: space.lg },
  outfit: { width: 280 },
  garment: { width: 120 },
  product: { width: 168 },
  tripRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  gapHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
