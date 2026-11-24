import type { CatalogMatchDto, CatalogPhotoDto, GarmentDetailDto } from '@dressit/shared';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';

import { errorMessage } from '@/api/client';
import { useChooseCatalogPhoto, useConsents, useGarmentCatalogPhoto, useSetConsent, useStartCatalogPhoto } from '@/api/hooks';
import { Badge, Button, Card, CutoutImage, Icon, Text, useToast } from '@/components/ui';
import { radius, space, useTheme } from '@/theme';

const ACTIVE = new Set(['queued', 'searching', 'generating']);
type Choice = 'original' | 'official' | 'generated';

const PROVIDER_STATUS: Record<string, string> = {
  ok: 'consultado',
  cached: 'consultado (guardado)',
  no_results: 'sin resultados',
  skipped: 'omitido',
  error: 'error',
  not_configured: 'sin configurar en el servidor',
  limit: 'límite alcanzado',
  no_consent: 'sin tu permiso',
};

/**
 * "Foto de catálogo": the professional product photo of the garment. First the very same product is
 * searched online and in authorised catalogues (official photo, verified against the user's
 * garment); otherwise an AI packshot is made from the user's photo (garment re-arranged: sleeves and
 * legs extended, front view, white background) and checked for fidelity. The user compares and
 * chooses; their own photo is always kept.
 */
export function CatalogPhotoCard({ garment }: { garment: GarmentDetailDto }) {
  const { colors } = useTheme();
  const toast = useToast();
  const router = useRouter();
  const consents = useConsents();
  const setConsent = useSetConsent();
  const job = useGarmentCatalogPhoto(garment.id, !garment.isDemo);
  const start = useStartCatalogPhoto(garment.id);
  const choose = useChooseCatalogPhoto({ garmentId: garment.id });
  const [showSources, setShowSources] = useState(false);
  if (garment.isDemo) return null;
  const granted = (k: string) => consents.data?.find((c) => c.kind === k)?.granted ?? false;
  const j = job.data ?? null;
  const running = !!j && ACTIVE.has(j.status);
  const onError = (e: unknown) => toast.show({ message: errorMessage(e), tone: 'error' });
  const run = (body: { mode?: 'auto' | 'search' | 'generate'; force?: boolean } = {}) => start.mutate(body, { onError });
  const pick = (choice: Choice, extra: { matchId?: string; acceptWarnings?: boolean } = {}) =>
    j &&
    choose.mutate(
      { id: j.id, choice, ...extra },
      { onSuccess: () => toast.show({ message: choice === 'original' ? 'Vuelves a usar tu foto.' : 'Foto de catálogo actualizada. Tu foto original se conserva.', tone: 'success' }), onError },
    );
  const current: Choice | null = j?.choice ?? null;
  const generatedOk = !!j?.generatedCheck?.passed;
  const insufficient = j?.status === 'needs_user' && !j.attempts.length && !j.generated && /foto/.test(j.message ?? '') && /(cortada|pequeña)/.test(j.message ?? '');

  return (
    <Card testID="catalog-photo-card">
      <View style={styles.header}>
        <Icon name="aperture" size={16} color={colors.inkMuted} />
        <Text variant="overline" tone="muted">
          Foto de catálogo
        </Text>
      </View>

      {!j && !running ? (
        <View style={{ gap: space.sm }}>
          <Text variant="small" tone="muted">
            Convierte tu foto en una foto profesional de producto: primero buscamos la foto oficial de la tienda y, si no aparece, creamos una con IA con la prenda extendida y bien colocada.
          </Text>
          {!granted('visual_search_external') ? (
            <Button
              label="Permitir buscar mis prendas en Internet"
              size="sm"
              variant="ghost"
              icon="search"
              onPress={() => setConsent.mutate({ kind: 'visual_search_external', granted: true })}
              testID="catalog-consent-search"
            />
          ) : null}
          {!granted('ai_image_generation') ? (
            <Button
              label="Permitir imágenes con IA"
              size="sm"
              variant="ghost"
              icon="aperture"
              onPress={() => setConsent.mutate({ kind: 'ai_image_generation', granted: true })}
              testID="catalog-consent-ai"
            />
          ) : null}
          <Button label="Crear foto de catálogo" size="sm" icon="aperture" onPress={() => run()} loading={start.isPending} testID="catalog-start" />
        </View>
      ) : running ? (
        <View style={{ gap: space.sm }} testID="catalog-running">
          <View style={styles.row}>
            <ActivityIndicator color={colors.inkMuted} />
            <Text variant="body" style={{ flex: 1 }}>
              {j?.stage?.label ?? 'En cola…'}
            </Text>
          </View>
          {j?.stage ? (
            <Text variant="caption" tone="muted">
              Paso {j.stage.step} de {j.stage.total}. Puedes salir: seguirá en el servidor.
            </Text>
          ) : null}
        </View>
      ) : j ? (
        <View style={{ gap: space.md }}>
          <View style={styles.compare} testID="catalog-compare">
            <Tile
              label="Tu foto"
              selected={current === 'original'}
              onPress={(current && current !== 'original') || (j.original && garment.image?.id !== j.original.id) ? () => pick('original') : undefined}
              testID="catalog-original"
            >
              {j.original ? <CutoutImage image={j.original} variant="full" inset={0.06} /> : null}
            </Tile>
            {j.official ? (
              <Tile
                label={j.official.retailer ? `Oficial · ${j.official.retailer}` : 'Foto oficial'}
                selected={current === 'official'}
                badge={j.official.verdict === 'exact' ? 'Verificada' : 'Confirmada por ti'}
                onPress={() => pick('official')}
                testID="catalog-official"
              >
                <Image source={{ uri: j.official.imageUrl }} style={StyleSheet.absoluteFill} contentFit="contain" accessibilityLabel={j.official.title ?? 'Foto oficial'} />
              </Tile>
            ) : null}
            {j.generated ? (
              <Tile
                label="Creada con IA"
                selected={current === 'generated'}
                badge={generatedOk ? 'Comprobada' : 'Con avisos'}
                badgeTone={generatedOk ? 'success' : 'warning'}
                onPress={() => (generatedOk ? pick('generated') : undefined)}
                testID="catalog-generated"
              >
                <CutoutImage image={j.generated} variant="full" inset={0.06} />
              </Tile>
            ) : null}
          </View>

          {j.message ? (
            <Text variant="small" tone={j.status === 'needs_user' || j.status === 'failed' ? 'warning' : 'muted'} testID="catalog-message">
              {j.message}
            </Text>
          ) : null}

          {j.official ? <MatchDetails m={j.official} /> : null}

          {j.generated && !generatedOk && j.generatedCheck ? (
            <View style={{ gap: 4 }} testID="catalog-warnings">
              {j.generatedCheck.reasons.map((r, i) => (
                <View key={i} style={styles.row}>
                  <Icon name="alert-triangle" size={14} color={colors.warning} />
                  <Text variant="small" tone="warning" style={{ flex: 1 }}>
                    {r}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          <View style={styles.actions}>
            {j.official && current !== 'official' ? <Button label="Usar la foto oficial" size="sm" onPress={() => pick('official')} loading={choose.isPending} testID="catalog-use-official" /> : null}
            {j.generated && generatedOk && current !== 'generated' ? (
              <Button label="Usar la foto de IA" size="sm" variant={j.official ? 'secondary' : 'primary'} onPress={() => pick('generated')} loading={choose.isPending} testID="catalog-use-generated" />
            ) : null}
            {j.generated && !generatedOk && current !== 'generated' ? (
              <Button label="Usarla igualmente" size="sm" variant="secondary" onPress={() => pick('generated', { acceptWarnings: true })} testID="catalog-accept-warnings" />
            ) : null}
            {insufficient ? <Button label="Generar de todos modos" size="sm" variant="secondary" onPress={() => run({ mode: 'generate', force: true })} testID="catalog-force" /> : null}
            {j.status === 'needs_user' || insufficient ? <Button label="Hacer otra foto" size="sm" variant="ghost" icon="camera" onPress={() => router.push('/capture/camera')} /> : null}
            <Button
              label={j.generated ? 'Volver a generar' : 'Crear con IA'}
              size="sm"
              variant="ghost"
              icon="refresh-cw"
              onPress={() => run({ mode: 'generate' })}
              loading={start.isPending}
              testID="catalog-regenerate"
            />
            <Button label="Buscar de nuevo" size="sm" variant="ghost" icon="search" onPress={() => run({ mode: 'search' })} disabled={start.isPending} testID="catalog-search-again" />
          </View>

          {j.alternatives.length ? (
            <View style={{ gap: space.sm }} testID="catalog-alternatives">
              <Text variant="smallStrong">Posibles coincidencias</Text>
              <Text variant="caption" tone="muted">
                Se parecen, pero no hemos podido confirmar que sean tu prenda. Elige una solo si es exactamente la tuya.
              </Text>
              {j.alternatives.map((m) => (
                <Alternative key={m.id} m={m} onPick={() => pick('official', { matchId: m.id })} />
              ))}
            </View>
          ) : null}

          {j.providers.length ? (
            <View style={{ gap: 4 }}>
              <Pressable onPress={() => setShowSources((v) => !v)} accessibilityRole="button" testID="catalog-sources-toggle">
                <Text variant="caption" tone="muted">
                  {showSources ? 'Ocultar dónde hemos buscado' : 'Dónde hemos buscado'}
                  {j.recognised.brand || j.recognised.text ? ` · leído en la prenda: «${j.recognised.brand ?? j.recognised.text}»` : ''}
                </Text>
              </Pressable>
              {showSources
                ? j.providers.map((p) => (
                    <Text key={p.id} variant="caption" tone="muted" testID={`catalog-source-${p.id}`}>
                      {p.label}: {PROVIDER_STATUS[p.status] ?? p.status}
                      {p.message ? ` — ${p.message}` : ''}
                    </Text>
                  ))
                : null}
            </View>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

function Tile({
  label,
  selected,
  onPress,
  badge,
  badgeTone = 'success',
  children,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress?: () => void;
  badge?: string;
  badgeTone?: 'success' | 'warning';
  children: React.ReactNode;
  testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      style={styles.side}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label}${selected ? ', en uso' : ''}`}
      testID={testID}
    >
      <View style={[styles.frame, { backgroundColor: colors.surfaceAlt, borderColor: selected ? colors.accent : 'transparent' }]}>{children}</View>
      <Text variant="caption" tone="muted" numberOfLines={1}>
        {label}
      </Text>
      {selected ? <Badge label="En uso" tone="accent" /> : badge ? <Badge label={badge} tone={badgeTone} /> : null}
    </Pressable>
  );
}

function MatchDetails({ m }: { m: CatalogMatchDto }) {
  return (
    <View style={{ gap: 2 }} testID="catalog-official-details">
      <Text variant="smallStrong" numberOfLines={2}>
        {[m.brand, m.title].filter(Boolean).join(' · ') || 'Producto encontrado'}
      </Text>
      {m.evidence.map((e, i) => (
        <Text key={i} variant="caption" tone="muted">
          ✓ {e}
        </Text>
      ))}
      <Text variant="caption" tone="muted">
        {m.usage === 'link_preview'
          ? 'La foto se muestra desde la web de la tienda (no se copia).'
          : m.usage === 'licensed'
            ? 'Foto con licencia del catálogo de la tienda.'
            : 'La tienda no permite usar su foto.'}
      </Text>
      {m.pageUrl ? <Button label="Ver en la tienda" size="sm" variant="ghost" icon="external-link" onPress={() => Linking.openURL(m.pageUrl!)} /> : null}
    </View>
  );
}

function Alternative({ m, onPick }: { m: CatalogMatchDto; onPick: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.alt} testID={`catalog-alt-${m.id}`}>
      <Image source={{ uri: m.imageUrl }} style={[styles.thumb, { backgroundColor: colors.surfaceAlt }]} contentFit="contain" accessible={false} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="small" numberOfLines={2}>
          {[m.brand, m.title].filter(Boolean).join(' · ') || m.domain || 'Producto'}
        </Text>
        <Text variant="caption" tone="muted">
          {m.retailer ?? m.domain} · parecido {Math.round(m.similarity * 100)} %
        </Text>
        {m.doubts.slice(0, 1).map((d, i) => (
          <Text key={i} variant="caption" tone="warning">
            {d}
          </Text>
        ))}
        <View style={styles.actions}>
          {m.usage !== 'reference_only' ? <Button label="Es mi prenda" size="sm" variant="ghost" icon="check" onPress={onPick} testID={`catalog-alt-${m.id}-pick`} /> : null}
          {m.pageUrl ? <Button label="Ver" size="sm" variant="ghost" onPress={() => Linking.openURL(m.pageUrl!)} /> : null}
        </View>
      </View>
    </View>
  );
}

/** Compact preview for the review queue (DetectionCard). */
export function catalogPhotoLabel(j: Pick<CatalogPhotoDto, 'status' | 'stage'> | { status: string; stage: { label: string } | null }): string {
  if (ACTIVE.has(j.status)) return j.stage?.label ?? 'Preparando la foto de catálogo…';
  if (j.status === 'ready') return 'Foto de catálogo lista';
  if (j.status === 'needs_user') return 'La foto de catálogo necesita tu ayuda';
  if (j.status === 'confirmed') return 'Foto de catálogo elegida';
  if (j.status === 'failed') return 'No se ha podido preparar la foto de catálogo';
  return '';
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginBottom: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  compare: { flexDirection: 'row', gap: space.sm },
  side: { flex: 1, gap: space.xs, alignItems: 'center' },
  frame: { width: '100%', aspectRatio: 4 / 5, borderRadius: radius.md, overflow: 'hidden', borderWidth: 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  alt: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  thumb: { width: 64, height: 80, borderRadius: radius.sm },
});
