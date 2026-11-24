import { Image } from 'expo-image';
import { useState } from 'react';
import { type LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';

import { errorMessage } from '@/api/client';
import { type RecutTarget, useRecut, useRecutSource } from '@/api/hooks';
import { Button, ChipGroup, CutoutImage, ErrorState, SkeletonCard, Text, useToast } from '@/components/ui';
import { addPoint, canRecut, MAX_RECUT_POINTS, type RecutPoint, tapToPoint } from '@/lib/recut';
import { radius, space, useTheme } from '@/theme';

/**
 * Manual cutout correction: the user taps on the original photo to mark what is the garment and
 * what is not (a hand, the hanger, another garment); the server re-segments it (SAM 2.1 with
 * point prompts). The new cutout is kept next to the previous ones.
 */
export function RecutEditor({ target, onDone }: { target: RecutTarget; onDone: () => void }) {
  const { colors } = useTheme();
  const toast = useToast();
  const source = useRecutSource(target);
  const recut = useRecut(target);
  const [points, setPoints] = useState<RecutPoint[]>([]);
  const [label, setLabel] = useState<0 | 1>(1);
  const [size, setSize] = useState({ width: 0, height: 0 });

  if (source.isError) return <ErrorState error={source.error} onRetry={() => source.refetch()} />;
  if (!source.data) return <SkeletonCard height={360} testID="recut-loading" />;
  const img = source.data;
  const aspect = img.width && img.height ? img.width / img.height : 3 / 4;

  return (
    <View style={{ gap: space.md }} testID="recut-editor">
      <Text variant="small" tone="muted">
        Toca la prenda para marcarla y toca lo que no lo es (manos, percha, otra ropa) para quitarlo. Con 2–4 puntos suele bastar.
      </Text>
      <ChipGroup
        options={[
          { id: '1', label: 'Es prenda' },
          { id: '0', label: 'No es prenda' },
        ]}
        value={String(label)}
        onChange={(v) => v && setLabel(v === '1' ? 1 : 0)}
        allowDeselect={false}
        testIDPrefix="recut-mode"
        accessibilityLabel="Qué marca el toque"
      />
      <Pressable
        onLayout={(e: LayoutChangeEvent) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
        onPress={(e) => setPoints((ps) => addPoint(ps, tapToPoint(e.nativeEvent.locationX, e.nativeEvent.locationY, size.width, size.height, label)))}
        accessibilityRole="button"
        accessibilityLabel={label === 1 ? 'Marcar un punto de la prenda' : 'Marcar un punto que no es la prenda'}
        style={[styles.photo, { aspectRatio: aspect, backgroundColor: colors.surfaceAlt }]}
        testID="recut-photo"
      >
        <Image source={{ uri: img.url }} style={StyleSheet.absoluteFill} contentFit="fill" accessible={false} />
        {points.map(([x, y, l], i) => (
          <View
            key={i}
            pointerEvents="none"
            style={[styles.dot, { left: x * size.width - 11, top: y * size.height - 11, backgroundColor: l === 1 ? colors.success : colors.danger, borderColor: colors.surface }]}
            testID={`recut-point-${i}`}
          >
            <Text variant="caption" color={colors.inkInverse}>
              {l === 1 ? '+' : '−'}
            </Text>
          </View>
        ))}
      </Pressable>
      <View style={styles.row}>
        <Button label="Deshacer" size="sm" variant="ghost" icon="corner-up-left" disabled={!points.length} onPress={() => setPoints((ps) => ps.slice(0, -1))} testID="recut-undo" />
        <Button label="Borrar puntos" size="sm" variant="ghost" disabled={!points.length} onPress={() => setPoints([])} testID="recut-clear" />
        <Text variant="caption" tone="muted" style={{ marginLeft: 'auto' }}>
          {points.length}/{MAX_RECUT_POINTS}
        </Text>
      </View>
      {recut.data ? (
        <View style={{ gap: space.sm }} testID="recut-result">
          <Text variant="smallStrong">Nuevo recorte</Text>
          <View style={[styles.result, { backgroundColor: colors.surfaceAlt }]}>
            <CutoutImage image={recut.data} variant="full" />
          </View>
          <Text variant="caption" tone="muted">
            El recorte anterior se conserva: puedes volver a él desde la galería de la prenda.
          </Text>
        </View>
      ) : null}
      <Button
        label={recut.data ? 'Volver a recortar' : 'Recortar'}
        icon="scissors"
        variant={recut.data ? 'secondary' : 'primary'}
        disabled={!canRecut(points)}
        loading={recut.isPending}
        onPress={() => recut.mutate(points, { onError: (e) => toast.show({ message: errorMessage(e), tone: 'error' }) })}
        testID="recut-submit"
      />
      {recut.data ? <Button label="Listo" onPress={onDone} testID="recut-done" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  photo: { width: '100%', borderRadius: radius.md, overflow: 'hidden' },
  dot: { position: 'absolute', width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  result: { width: '60%', aspectRatio: 3 / 4, borderRadius: radius.md, overflow: 'hidden', alignSelf: 'center' },
});
