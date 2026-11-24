import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import WebView, { type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';

import { errorMessage } from '@/api/client';
import { usePageCapture } from '@/api/hooks';
import { Button, EmptyState, Icon, IconButton, OfflineBanner, ProgressBar, Text, useToast } from '@/components/ui';
import { CAPTURE_SCRIPT, parseCaptureMessage, toPageCaptureRequest } from '@/lib/pageCapture';
import { hostnameOf, isHttpUrl, parseUrl } from '@/lib/urls';
import { hairline, radius, space, useTheme } from '@/theme';

const CAPTURE_TIMEOUT_MS = 8000;

/**
 * In-app browser for stores that block server-side reads. The user browses
 * normally (including any verification the store shows — we never automate or
 * hide it) and taps "Capturar este producto" when the product page is visible.
 * Only then is a read-only script injected to collect public structured data.
 */
export default function InAppBrowserScreen() {
  const { t } = useTranslation('imports');
  const { colors } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const params = useLocalSearchParams<{ url?: string }>();
  const startUrl = params.url && isHttpUrl(params.url) ? params.url : null;

  // react-native-webview 14 types default the props generic to `undefined`, which makes
  // `WebViewProps & undefined` collapse to `never`; an explicit `{}` restores the props.
  const webRef = useRef<WebView<object>>(null);
  const [nav, setNav] = useState<{ url: string; title: string; canGoBack: boolean; canGoForward: boolean; loading: boolean }>({
    url: startUrl ?? '',
    title: '',
    canGoBack: false,
    canGoForward: false,
    loading: true,
  });
  const [progress, setProgress] = useState(0);
  const [showInfo, setShowInfo] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [httpStatus, setHttpStatus] = useState<number | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const capture = usePageCapture();

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const onNavigationStateChange = useCallback((e: WebViewNavigation) => {
    setNav({ url: e.url, title: e.title, canGoBack: e.canGoBack, canGoForward: e.canGoForward, loading: e.loading });
    if (e.loading) {
      setLoadError(null);
      setHttpStatus(null);
      setCaptureError(null);
    }
  }, []);

  const finishCapture = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const startCapture = () => {
    setCaptureError(null);
    setCapturing(true);
    finishCapture();
    timer.current = setTimeout(() => {
      setCapturing(false);
      setCaptureError(t('browser.captureTimeout'));
    }, CAPTURE_TIMEOUT_MS);
    webRef.current?.injectJavaScript(CAPTURE_SCRIPT);
  };

  const onMessage = (e: WebViewMessageEvent) => {
    const msg = parseCaptureMessage(e.nativeEvent.data);
    if (!msg || !capturing) return;
    finishCapture();
    if (msg.type === 'dressit:capture-error') {
      setCapturing(false);
      setCaptureError(t('browser.captureError', { message: msg.message }));
      return;
    }
    capture.mutate(toPageCaptureRequest(msg), {
      onSuccess: (product) => {
        setCapturing(false);
        if (product.fetchStatus === 'not_product') {
          setCaptureError(product.fetchMessage ?? t('browser.notProduct'));
          return;
        }
        router.replace({ pathname: '/import/product/[id]', params: { id: product.id } });
      },
      onError: (err) => {
        setCapturing(false);
        setCaptureError(errorMessage(err));
      },
    });
  };

  const close = () => (router.canGoBack() ? router.back() : router.replace('/descubrir'));
  const isSecure = parseUrl(nav.url)?.protocol === 'https';

  if (!startUrl) {
    return (
      <SafeAreaView style={[styles.fill, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <EmptyState icon="alert-triangle" title={t('browser.invalidUrl')} actionLabel={t('browser.close')} onAction={close} testID="browser-invalid" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: colors.background }]} edges={['top', 'bottom']} testID="browser-screen">
      <Stack.Screen options={{ headerShown: false }} />
      {/* Always-visible address bar: the user always knows where they are. */}
      <View style={[styles.topBar, { borderBottomColor: colors.line }]}>
        <IconButton icon="x" label={t('browser.close')} onPress={close} testID="browser-close" />
        <View
          style={[styles.address, { backgroundColor: colors.surfaceAlt }]}
          accessible
          accessibilityLabel={`${isSecure ? t('browser.secure') : t('browser.insecure')}: ${hostnameOf(nav.url)}`}
        >
          <Icon name={isSecure ? 'lock' : 'unlock'} size={13} color={isSecure ? colors.inkMuted : colors.warning} />
          <View style={{ flex: 1 }}>
            <Text variant="smallStrong" numberOfLines={1}>
              {hostnameOf(nav.url)}
            </Text>
            {nav.title ? (
              <Text variant="caption" tone="muted" numberOfLines={1}>
                {nav.title}
              </Text>
            ) : null}
          </View>
        </View>
        <IconButton icon="rotate-cw" label={t('browser.reload')} onPress={() => webRef.current?.reload()} testID="browser-reload" />
      </View>
      {nav.loading && progress < 1 ? <ProgressBar value={progress} label={t('browser.loading')} style={styles.progress} /> : <View style={styles.progress} />}
      <OfflineBanner style={{ margin: space.sm }} />

      {showInfo ? (
        <View style={[styles.info, { backgroundColor: colors.infoSoft }]} testID="browser-info">
          <Icon name="user-check" size={18} color={colors.info} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="smallStrong" color={colors.info}>
              {t('browser.controlTitle')}
            </Text>
            <Text variant="caption" color={colors.info}>
              {t('browser.controlBody')}
            </Text>
          </View>
          <IconButton icon="x" size={18} label={t('browser.dismissInfo')} onPress={() => setShowInfo(false)} />
        </View>
      ) : null}

      <View style={styles.fill}>
        {loadError ? (
          <View style={[styles.fill, { justifyContent: 'center' }]}>
            <EmptyState
              icon="wifi-off"
              title={t('browser.loadError')}
              body={loadError}
              actionLabel={t('browser.reload')}
              onAction={() => {
                setLoadError(null);
                webRef.current?.reload();
              }}
              secondaryLabel={t('browser.openExternal')}
              onSecondary={() => Linking.openURL(nav.url || startUrl).catch(() => {})}
              testID="browser-error"
            />
          </View>
        ) : null}
        <WebView<object>
          ref={webRef}
          source={{ uri: startUrl }}
          style={[styles.fill, loadError ? styles.hidden : null]}
          testID="browser-webview"
          originWhitelist={['http://*', 'https://*']}
          onShouldStartLoadWithRequest={(req) => {
            if (/^https?:\/\//i.test(req.url) || req.url === 'about:blank' || req.url.startsWith('about:srcdoc') || req.url.startsWith('blob:')) return true;
            if (req.isTopFrame) toast.show({ message: t('browser.blockedScheme') });
            return false;
          }}
          setSupportMultipleWindows={false}
          onNavigationStateChange={onNavigationStateChange}
          onLoadProgress={(e) => setProgress(e.nativeEvent.progress)}
          onLoadEnd={() => setProgress(1)}
          onError={(e) => setLoadError(e.nativeEvent.description || t('browser.loadError'))}
          onHttpError={(e) => setHttpStatus(e.nativeEvent.statusCode)}
          onMessage={onMessage}
          allowsBackForwardNavigationGestures
          pullToRefreshEnabled
          javaScriptEnabled
          domStorageEnabled
          mediaPlaybackRequiresUserAction
          allowsInlineMediaPlayback={false}
        />
      </View>

      {httpStatus && httpStatus >= 400 ? (
        <Text variant="caption" tone="warning" style={styles.notice} accessibilityLiveRegion="polite">
          {t('browser.httpError', { status: httpStatus })}
        </Text>
      ) : null}
      {captureError ? (
        <Text variant="small" tone="danger" style={styles.notice} accessibilityLiveRegion="assertive" testID="browser-capture-error">
          {captureError}
        </Text>
      ) : null}

      <View style={[styles.bottomBar, { borderTopColor: colors.line, backgroundColor: colors.background }]}>
        <IconButton icon="chevron-left" label={t('browser.back')} disabled={!nav.canGoBack} onPress={() => webRef.current?.goBack()} testID="browser-back" />
        <IconButton icon="chevron-right" label={t('browser.forward')} disabled={!nav.canGoForward} onPress={() => webRef.current?.goForward()} testID="browser-forward" />
        <Button
          label={capturing || capture.isPending ? t('browser.capturing') : t('browser.capture')}
          icon="download"
          variant="accent"
          onPress={startCapture}
          loading={capturing || capture.isPending}
          disabled={!!loadError}
          style={{ flex: 1 }}
          accessibilityHint={t('browser.captureHint')}
          testID="browser-capture"
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  hidden: { height: 0, flex: 0, opacity: 0 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.sm, paddingBottom: space.sm, borderBottomWidth: hairline },
  address: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, minHeight: 40, borderRadius: radius.md },
  progress: { height: 3, borderRadius: 0 },
  info: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, padding: space.md, marginHorizontal: space.sm, marginTop: space.sm, borderRadius: radius.md },
  notice: { paddingHorizontal: space.lg, paddingTop: space.sm },
  bottomBar: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingTop: space.sm, borderTopWidth: hairline },
});
