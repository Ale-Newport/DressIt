import type { CatalogPhotoSummaryDto } from '@dressit/shared';
import { Image } from 'expo-image';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { errorMessage } from '@/api/client';
import { useChooseCatalogPhoto } from '@/api/hooks';
import { Badge, CutoutImage, Icon, Text, useToast } from '@/components/ui';
import { catalogPhotoLabel } from '@/components/wardrobe/CatalogPhotoCard';
import { radius, space, useTheme } from '@/theme';

const ACTIVE = new Set(['queued', 'searching', 'generating']);

/**
 * The catalogue photo of a detection in the review queue: progress while it is being prepared, then
 * the official photo and/or the AI packshot to choose from (applied when the garment is added).
 */
export function CatalogPhotoPreview({ summary: c, importJobId, detectionId }: { summary: CatalogPhotoSummaryDto; importJobId: string; detectionId: string }) {
  const { colors } = useTheme();
  const toast = useToast();
  const choose = useChooseCatalogPhoto({ importJobId });
  const running = ACTIVE.has(c.status);
  const pick = (choice: 'official' | 'generated' | 'original') =>
    choose.mutate(
      { id: c.id, choice },
      {
        onError: (e) => toast.show({ message: errorMessage(e), tone: 'error' }),
      },
    );
  const options = running
    ? []
    : [
        c.official
          ? {
              key: 'official' as const,
              label: c.official.retailer ? `Oficial · ${c.official.retailer}` : 'Oficial',
              node: <Image source={{ uri: c.official.imageUrl }} style={StyleSheet.absoluteFill} contentFit="contain" accessible={false} />,
            }
          : null,
        c.generated && c.generatedPassed
          ? {
              key: 'generated' as const,
              label: 'Creada con IA',
              node: <CutoutImage image={c.generated} variant="thumb" inset={0.06} compactLabel />,
            }
          : null,
      ].filter((o): o is NonNullable<typeof o> => !!o);

  return (
    <View style={[styles.box, { backgroundColor: colors.surfaceAlt }]} testID={`detection-${detectionId}-catalog`}>
      <View style={styles.row}>
        {running ? <ActivityIndicator size="small" color={colors.inkMuted} /> : <Icon name="aperture" size={14} color={colors.inkMuted} />}
        <Text variant="smallStrong" style={{ flex: 1 }}>
          {catalogPhotoLabel(c)}
        </Text>
      </View>
      {c.message && !running ? (
        <Text variant="caption" tone={c.status === 'needs_user' ? 'warning' : 'muted'}>
          {c.message}
        </Text>
      ) : null}
      {options.length ? (
        <View style={styles.row}>
          {options.map((o) => {
            const selected = c.choice === o.key;
            return (
              <Pressable
                key={o.key}
                onPress={() => pick(selected ? 'original' : o.key)}
                style={styles.option}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`${o.label}${selected ? ', elegida' : ''}`}
                testID={`detection-${detectionId}-catalog-${o.key}`}
              >
                <View
                  style={[
                    styles.thumb,
                    {
                      borderColor: selected ? colors.accent : colors.line,
                      backgroundColor: colors.surface,
                    },
                  ]}
                >
                  {o.node}
                </View>
                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {o.label}
                </Text>
                {selected ? <Badge label="Elegida" tone="accent" /> : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {options.length && !c.choice ? (
        <Text variant="caption" tone="muted">
          Toca una para usarla al añadir la prenda. Tu foto se conserva siempre.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.md, padding: space.md, gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  option: { width: 88, gap: 4, alignItems: 'center' },
  thumb: {
    width: 88,
    aspectRatio: 4 / 5,
    borderRadius: radius.sm,
    overflow: 'hidden',
    borderWidth: 2,
  },
});
