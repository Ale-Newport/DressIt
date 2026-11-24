import type { ImportedProductDto } from '@dressit/shared';
import { useRouter } from 'expo-router';
import { useShareIntentContext } from 'expo-share-intent';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useLinkImport, usePageCapture } from '@/api/hooks';
import { Button, Card, EmptyState, ErrorState, OfflineBanner, Screen, SkeletonCard, Text } from '@/components/ui';
import { captureFromShareMeta } from '@/lib/pageCapture';
import { extractUrl, hostnameOf } from '@/lib/urls';
import { space } from '@/theme';

/**
 * Entry point for content shared from a store app or browser
 * (iOS share extension / Android share intent, routed by `+native-intent`).
 * - Safari on iOS: the share extension preprocessor gives us the page's JSON-LD,
 *   microdata and meta → `POST /v1/imports/link/capture` (works even for stores
 *   that block server-side reads).
 * - Everything else (Android, store apps): only the URL → `POST /v1/imports/link`.
 * Then the imported product screen lets the user save it to "Mi armario" or
 * "Lista de deseos".
 */
export default function ShareIntentScreen() {
  const { t } = useTranslation('imports');
  const router = useRouter();
  const { isReady, hasShareIntent, shareIntent, resetShareIntent, error: shareError } = useShareIntentContext();
  const linkImport = useLinkImport();
  const pageCapture = usePageCapture();
  const handledKey = useRef<string | null>(null);
  const [failed, setFailed] = useState<unknown>(null);

  const url = useMemo(() => shareIntent.webUrl ?? extractUrl(shareIntent.text) ?? null, [shareIntent.webUrl, shareIntent.text]);
  const captureRequest = useMemo(
    () => (url ? captureFromShareMeta(url, shareIntent.meta as Record<string, unknown> | null | undefined) : null),
    [url, shareIntent.meta],
  );
  const textOnly = !url && !!shareIntent.text?.trim();
  const filesOnly = !url && !textOnly && !!shareIntent.files?.length;

  const onImported = useCallback(
    (product: ImportedProductDto) => {
      resetShareIntent();
      router.replace({ pathname: '/import/product/[id]', params: { id: product.id } });
    },
    [resetShareIntent, router],
  );

  const run = useCallback(() => {
    if (!url) return;
    setFailed(null);
    if (captureRequest) {
      pageCapture.mutate(captureRequest, {
        onSuccess: onImported,
        // If the structured payload is rejected, fall back to a plain link import.
        onError: () => linkImport.mutate({ url }, { onSuccess: onImported, onError: setFailed }),
      });
    } else {
      linkImport.mutate({ url }, { onSuccess: onImported, onError: setFailed });
    }
  }, [url, captureRequest, pageCapture, linkImport, onImported]);

  useEffect(() => {
    if (!isReady || !hasShareIntent || !url) return;
    if (handledKey.current === url) return;
    handledKey.current = url;
    run();
  }, [isReady, hasShareIntent, url, run]);

  const busy = linkImport.isPending || pageCapture.isPending;

  return (
    <Screen testID="share-intent-screen" contentStyle={{ paddingTop: space.lg }}>
      <OfflineBanner />
      {!isReady ? (
        <SkeletonCard height={160} />
      ) : shareError ? (
        <EmptyState icon="alert-triangle" title={t('share.errorTitle')} body={shareError} actionLabel={t('share.pasteLink')} onAction={() => router.replace('/import/link')} testID="share-error" />
      ) : url ? (
        <View style={{ gap: space.lg }}>
          <Card tone="sunken" style={{ gap: space.xs }}>
            <Text variant="overline" tone="muted">
              {hostnameOf(url)}
            </Text>
            <Text variant="small" numberOfLines={2}>
              {shareIntent.meta?.title ?? url}
            </Text>
          </Card>
          {busy ? (
            <View style={{ gap: space.md }} accessibilityLiveRegion="polite">
              <Text variant="body" tone="muted">
                {captureRequest ? t('share.readingCapture') : t('share.reading', { host: hostnameOf(url) })}
              </Text>
              <SkeletonCard height={200} testID="share-loading" />
            </View>
          ) : failed ? (
            <View style={{ gap: space.md }}>
              <ErrorState error={failed} title={t('share.errorTitle')} onRetry={run} compact />
              <Button
                label={t('link.openBrowser')}
                icon="globe"
                variant="accent"
                fullWidth
                onPress={() => {
                  resetShareIntent();
                  router.replace({ pathname: '/import/browser', params: { url } });
                }}
                testID="share-open-browser"
              />
              <Text variant="caption" tone="muted">
                {t('link.openBrowserHint')}
              </Text>
            </View>
          ) : null}
        </View>
      ) : textOnly ? (
        <Card style={styles.card} testID="share-text-only">
          <Text variant="heading">{t('share.textTitle')}</Text>
          <Text variant="body" tone="muted">
            {t('share.textBody')}
          </Text>
          <Text variant="small" numberOfLines={6} style={styles.quote}>
            {shareIntent.text}
          </Text>
          <Button
            label={t('share.importAsText')}
            icon="file-text"
            fullWidth
            onPress={() => {
              const text = shareIntent.text ?? '';
              resetShareIntent();
              router.replace({ pathname: '/capture/text', params: { text } });
            }}
            testID="share-import-text"
          />
        </Card>
      ) : filesOnly ? (
        <EmptyState
          icon="image"
          title={t('share.filesTitle')}
          body={t('share.filesBody')}
          actionLabel={t('share.goWardrobe')}
          onAction={() => {
            resetShareIntent();
            router.replace('/armario');
          }}
        />
      ) : (
        <EmptyState
          icon="share"
          title={t('share.nothingTitle')}
          body={t('share.nothingBody')}
          actionLabel={t('share.pasteLink')}
          onAction={() => router.replace('/import/link')}
          testID="share-nothing"
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  quote: { fontStyle: 'italic' },
});
