import type { OutfitDto } from '@dressit/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useOutfit } from '@/api/hooks';
import { OutfitPickerSheet } from '@/components/outfits/OutfitPickerSheet';
import { outfitTitle } from '@/components/outfits/OutfitThumb';
import { ScoreCompareTable } from '@/components/outfits/ScoreBreakdown';
import {
  Button,
  EmptyState,
  ErrorState,
  OfflineBanner,
  OutfitCanvas,
  Screen,
  SectionHeader,
  Skeleton,
  Text,
} from '@/components/ui';
import { normalizeScore } from '@/lib/format';
import { radius, space, useTheme } from '@/theme';

type Side = 'a' | 'b';

export default function CompareScreen() {
  const params = useLocalSearchParams<{ a?: string; b?: string }>();
  const router = useRouter();
  const { t } = useTranslation('outfits');
  const [picking, setPicking] = useState<Side | null>(null);
  const a = useOutfit(params.a || undefined);
  const b = useOutfit(params.b || undefined);

  const setSide = (side: Side, id: string) => router.setParams(side === 'a' ? { a: id } : { b: id });

  const outfitA = a.data;
  const outfitB = b.data;
  const labelA = outfitA ? `A · ${outfitTitle(outfitA, t('card.untitled'))}` : 'A';
  const labelB = outfitB ? `B · ${outfitTitle(outfitB, t('card.untitled'))}` : 'B';

  return (
    <Screen testID="outfit-compare-screen">
      <OfflineBanner />
      {!params.a && !params.b ? (
        <EmptyState icon="columns" title={t('compare.title')} body={t('compare.intro')} actionLabel={t('compare.pickA')} onAction={() => setPicking('a')} testID="compare-empty" />
      ) : null}

      {params.a || params.b ? (
        <View style={styles.columns}>
          <Column side="a" id={params.a} query={a} onPick={() => setPicking('a')} />
          <Column side="b" id={params.b} query={b} onPick={() => setPicking('b')} />
        </View>
      ) : null}

      {params.a && params.b ? (
        <Button
          label={t('compare.swapSides')}
          icon="repeat"
          variant="ghost"
          size="sm"
          onPress={() => router.setParams({ a: params.b, b: params.a })}
          testID="compare-swap"
        />
      ) : null}

      {outfitA && outfitB ? (
        <>
          <Verdict a={outfitA} b={outfitB} labelA={labelA} labelB={labelB} />
          <View>
            <SectionHeader title={t('detail.breakdown')} />
            <ScoreCompareTable a={outfitA.breakdown} b={outfitB.breakdown} labelA="A" labelB="B" />
          </View>
          <View style={{ gap: space.md }}>
            <SectionHeader title={t('compare.explanations')} />
            <Explanations label={labelA} outfit={outfitA} />
            <Explanations label={labelB} outfit={outfitB} />
          </View>
        </>
      ) : null}

      <OutfitPickerSheet
        visible={!!picking}
        onClose={() => setPicking(null)}
        title={picking === 'b' ? t('compare.pickB') : t('compare.pickA')}
        excludeId={picking === 'a' ? params.b : params.a}
        onPick={(o) => picking && setSide(picking, o.id)}
        testID="compare-picker"
      />
    </Screen>
  );
}

function Column({ side, id, query, onPick }: { side: Side; id?: string; query: ReturnType<typeof useOutfit>; onPick: () => void }) {
  const { t } = useTranslation('outfits');
  const router = useRouter();
  const { colors } = useTheme();
  const label = side.toUpperCase();
  if (!id) {
    return (
      <View style={[styles.column, styles.placeholder, { borderColor: colors.lineStrong }]}>
        <Text variant="heading">{label}</Text>
        <Button label={side === 'a' ? t('compare.pickA') : t('compare.pickB')} size="sm" onPress={onPick} testID={`compare-pick-${side}`} />
      </View>
    );
  }
  if (query.data === undefined) {
    return (
      <View style={styles.column}>
        {query.isError ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} compact />
        ) : (
          <View style={{ aspectRatio: 4 / 5 }}>
            <Skeleton height="100%" radius={radius.lg} />
          </View>
        )}
      </View>
    );
  }
  const o = query.data;
  const score = Math.round(normalizeScore(o.score) * 100);
  return (
    <View style={styles.column} testID={`compare-column-${side}`}>
      <Text variant="overline" tone="muted">
        {label}
      </Text>
      <OutfitCanvas items={o.items} testID={`compare-canvas-${side}`} />
      <Text variant="smallStrong" numberOfLines={2} onPress={() => router.push({ pathname: '/outfit/[id]', params: { id: o.id } })} accessibilityRole="link">
        {outfitTitle(o, t('card.untitled'))}
      </Text>
      <Text variant="title" accessibilityLabel={t('card.score', { score })}>
        {score}
      </Text>
      <Button label={side === 'a' ? t('compare.changeA') : t('compare.changeB')} size="sm" variant="secondary" onPress={onPick} testID={`compare-change-${side}`} />
    </View>
  );
}

function Verdict({ a, b, labelA, labelB }: { a: OutfitDto; b: OutfitDto; labelA: string; labelB: string }) {
  const { t } = useTranslation('outfits');
  const sa = normalizeScore(a.score);
  const sb = normalizeScore(b.score);
  const text = Math.round(sa * 100) === Math.round(sb * 100) ? t('compare.tie') : t('compare.winner', { name: sa > sb ? labelA : labelB });
  return (
    <Text variant="quote" accessibilityLiveRegion="polite">
      {text}
    </Text>
  );
}

function Explanations({ label, outfit }: { label: string; outfit: OutfitDto }) {
  return (
    <View style={{ gap: 4 }}>
      <Text variant="smallStrong">{label}</Text>
      {outfit.weatherNote ? (
        <Text variant="small" tone="muted">
          {outfit.weatherNote}
        </Text>
      ) : null}
      {outfit.explanation.map((line, i) => (
        <Text key={i} variant="small">
          — {line}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  columns: { flexDirection: 'row', gap: space.md },
  column: { flex: 1, gap: space.sm },
  placeholder: { aspectRatio: 4 / 5, borderWidth: 1, borderStyle: 'dashed', borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.md },
});
