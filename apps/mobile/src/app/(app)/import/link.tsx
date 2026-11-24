import type { ImportedProductDto } from '@dressit/shared';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useLinkImport, useRetailers } from '@/api/hooks';
import { FetchStatusNotice } from '@/components/imports/FetchStatusNotice';
import { Button, Card, ErrorState, OfflineBanner, Screen, Text, TextField, useIsOnline, useToast } from '@/components/ui';
import { extractUrl, isHttpUrl, looksLikeStoreUrl } from '@/lib/urls';
import { space } from '@/theme';

export default function LinkImportScreen() {
  const { t } = useTranslation('imports');
  const router = useRouter();
  const toast = useToast();
  const online = useIsOnline();
  const params = useLocalSearchParams<{ url?: string }>();
  const [url, setUrl] = useState(() => (params.url ? (extractUrl(params.url) ?? params.url) : ''));
  const [touched, setTouched] = useState(false);
  const [clipboardOffer, setClipboardOffer] = useState(false);
  const [result, setResult] = useState<ImportedProductDto | null>(null);
  const retailers = useRetailers();
  const linkImport = useLinkImport();

  const domains = useMemo(() => (retailers.data ?? []).flatMap((r) => r.domains), [retailers.data]);
  const trimmed = url.trim();
  const valid = isHttpUrl(trimmed);
  const looksStore = valid && looksLikeStoreUrl(trimmed, domains);

  // Only check whether *something* is on the clipboard (no content is read).
  useEffect(() => {
    if (params.url) return;
    let cancelled = false;
    const check = Platform.OS === 'ios' ? Clipboard.hasUrlAsync() : Clipboard.hasStringAsync();
    check.then((has) => !cancelled && has && setClipboardOffer(true)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [params.url]);

  const pasteFromClipboard = async () => {
    setClipboardOffer(false);
    try {
      const text = await Clipboard.getStringAsync();
      const found = extractUrl(text);
      if (found) {
        setUrl(found);
        setResult(null);
      } else {
        toast.show({ message: t('link.clipboardNoUrl') });
      }
    } catch {
      toast.show({ message: t('link.clipboardNoUrl') });
    }
  };

  const submit = () => {
    setTouched(true);
    if (!valid) return;
    setResult(null);
    linkImport.mutate(
      { url: trimmed },
      {
        onSuccess: (product) => {
          if (product.fetchStatus === 'resolved' || product.fetchStatus === 'partial') {
            router.replace({ pathname: '/import/product/[id]', params: { id: product.id } });
          } else {
            setResult(product);
          }
        },
      },
    );
  };

  return (
    <Screen testID="link-import-screen" contentStyle={styles.content}>
      <OfflineBanner />
      <View style={{ gap: space.sm }}>
        <Text variant="title">{t('link.heading')}</Text>
        <Text variant="body" tone="muted">
          {t('link.intro')}
        </Text>
      </View>

      {clipboardOffer && !url ? (
        <Card tone="sunken" testID="clipboard-offer" style={{ gap: space.md }}>
          <Text variant="subheading">{t('link.clipboardTitle')}</Text>
          <Text variant="small" tone="muted">
            {t('link.clipboardBody')}
          </Text>
          <View style={styles.row}>
            <Button label={t('link.clipboardPaste')} icon="clipboard" size="sm" onPress={pasteFromClipboard} testID="clipboard-paste" />
            <Button label={t('link.clipboardDismiss')} size="sm" variant="ghost" onPress={() => setClipboardOffer(false)} />
          </View>
        </Card>
      ) : null}

      <TextField
        label={t('link.inputLabel')}
        placeholder={t('link.inputPlaceholder')}
        value={url}
        onChangeText={(v) => {
          setUrl(v);
          setResult(null);
        }}
        onClear={() => setUrl('')}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        inputMode="url"
        returnKeyType="go"
        onSubmitEditing={submit}
        icon="link"
        error={touched && trimmed && !valid ? t('link.invalid') : null}
        hint={valid && !looksStore ? t('link.notStore') : undefined}
        testID="link-input"
      />

      <Button
        label={linkImport.isPending ? t('link.submitting') : t('link.submit')}
        icon="download"
        onPress={submit}
        loading={linkImport.isPending}
        disabled={!valid || !online}
        fullWidth
        testID="link-submit"
      />
      {!online ? (
        <Text variant="small" tone="warning">
          {t('link.offline')}
        </Text>
      ) : null}

      {linkImport.isError ? (
        <View style={{ gap: space.md }}>
          <ErrorState error={linkImport.error} title={t('link.errorTitle')} onRetry={submit} compact />
          {valid ? (
            <Button
              label={t('link.openBrowser')}
              icon="globe"
              variant="secondary"
              onPress={() => router.push({ pathname: '/import/browser', params: { url: trimmed } })}
              fullWidth
              testID="link-error-open-browser"
            />
          ) : null}
        </View>
      ) : null}

      {result ? (
        <View style={{ gap: space.sm }}>
          <Text variant="overline" tone="muted">
            {t('link.resultTitle')}
          </Text>
          <FetchStatusNotice
            status={result.fetchStatus}
            message={result.fetchMessage}
            url={result.canonicalUrl ?? result.url}
            onViewProduct={() => router.push({ pathname: '/import/product/[id]', params: { id: result.id } })}
            testID="link-result"
          />
        </View>
      ) : null}

      <Button label={t('link.supportedStores')} variant="ghost" icon="list" onPress={() => router.push('/shop/retailers')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: space.lg },
  row: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
});
