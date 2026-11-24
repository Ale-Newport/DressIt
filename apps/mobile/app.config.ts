import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * DressIt app config.
 *
 * - Bundle id / package `com.dressit.app` is a placeholder: override with
 *   DRESSIT_BUNDLE_ID when signing with your own Apple team (free Apple ID
 *   teams cannot use an identifier already registered by someone else).
 * - Location is approximate only (coarse on Android, reduced accuracy by default
 *   on iOS) and never in background.
 * - Calendar is read-only. On Android the app requests READ_CALENDAR only.
 */
const BUNDLE_ID = process.env.DRESSIT_BUNDLE_ID ?? 'com.dressit.app';
/** Set DRESSIT_ALLOW_HTTP=1 for a dev build that talks to the API over plain HTTP on a LAN IP. */
const ALLOW_HTTP = process.env.DRESSIT_ALLOW_HTTP === '1';

/** Injected into the iOS share extension preprocessor (runs in Safari's page context). */
const SHARE_PREPROCESSOR_JS = [
  'try {',
  '  var dressitLd = document.querySelectorAll(\'script[type="application/ld+json"]\');',
  '  var dressitBlocks = [];',
  '  for (var i = 0; i < dressitLd.length && dressitBlocks.length < 20; i++) {',
  "    var t = dressitLd[i].textContent || '';",
  '    if (t.length > 0 && t.length <= 200000) dressitBlocks.push(t);',
  '  }',
  "  metas['dressit:jsonld'] = JSON.stringify(dressitBlocks);",
  "  metas['dressit:url'] = document.location.href;",
  // schema.org microdata (e.g. Mango): first [itemprop] per name → content | src | href | text.
  '  var dressitMicro = {};',
  "  var dressitProps = ['name','brand','price','priceCurrency','availability','color','sku','gtin13','image','size'];",
  '  for (var k = 0; k < dressitProps.length; k++) {',
  '    var el = document.querySelector(\'[itemprop="\' + dressitProps[k] + \'"]\');',
  '    if (!el) continue;',
  "    var v = el.getAttribute('content') || el.getAttribute('src') || el.getAttribute('href') || (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 300);",
  '    if (v) dressitMicro[dressitProps[k]] = v;',
  '  }',
  "  metas['dressit:microdata'] = JSON.stringify(dressitMicro);",
  '} catch (e) {}',
].join('\n');

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'DressIt',
  slug: 'dressit',
  version: '0.1.0',
  scheme: 'dressit',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  userInterfaceStyle: 'automatic',
  platforms: ['ios', 'android'],
  backgroundColor: '#F6F2EC',
  ios: {
    bundleIdentifier: BUNDLE_ID,
    supportsTablet: false,
    config: { usesNonExemptEncryption: false },
    infoPlist: {
      CFBundleDevelopmentRegion: 'es',
      CFBundleLocalizations: ['es', 'en'],
      NSPhotoLibraryUsageDescription:
        'DressIt usa tus fotos solo cuando tú las eliges, para digitalizar tus prendas, inspiración o buscar productos parecidos.',
      NSCameraUsageDescription:
        'DressIt usa la cámara para fotografiar tus prendas y escanear códigos de barras de etiquetas.',
      NSLocationWhenInUseUsageDescription:
        'DressIt usa tu ubicación aproximada (unos 1 km) para conocer el tiempo de tu ciudad. Nunca la usa en segundo plano.',
      NSCalendarsUsageDescription:
        'DressIt lee tus eventos (solo título, hora y lugar) para sugerirte qué ponerte. Nunca modifica tu calendario.',
      NSCalendarsFullAccessUsageDescription:
        'DressIt lee tus eventos (solo título, hora y lugar) para sugerirte qué ponerte. Nunca modifica tu calendario.',
      NSLocationDefaultAccuracyReduced: true,
      NSLocalNetworkUsageDescription:
        'En desarrollo, DressIt usa la red local para conectarse a tu ordenador (servidor de desarrollo y API).',
      NSAppTransportSecurity: ALLOW_HTTP
        ? { NSAllowsArbitraryLoads: true }
        : {
            NSAllowsLocalNetworking: true,
            NSExceptionDomains: {
              localhost: { NSExceptionAllowsInsecureHTTPLoads: true },
            },
          },
    },
  },
  android: {
    package: BUNDLE_ID,
    adaptiveIcon: {
      backgroundColor: '#F6F2EC',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    permissions: [
      'android.permission.CAMERA',
      'android.permission.READ_MEDIA_IMAGES',
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.READ_CALENDAR',
    ],
    blockedPermissions: [
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACCESS_BACKGROUND_LOCATION',
      'android.permission.WRITE_CALENDAR',
      'android.permission.RECORD_AUDIO',
      'android.permission.READ_MEDIA_VIDEO',
      'android.permission.READ_MEDIA_AUDIO',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_LOCATION',
      'android.permission.SYSTEM_ALERT_WINDOW',
    ],
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#F6F2EC',
        image: './assets/images/splash-icon.png',
        imageWidth: 120,
        dark: { backgroundColor: '#121110', image: './assets/images/splash-icon.png' },
      },
    ],
    'expo-font',
    'expo-localization',
    // No biometrics: drop the default (English) Face ID string.
    ['expo-secure-store', { faceIDPermission: false }],
    'expo-web-browser',
    [
      'expo-camera',
      {
        cameraPermission:
          'DressIt usa la cámara para fotografiar tus prendas y escanear códigos de barras de etiquetas.',
        microphonePermission: false,
        recordAudioAndroid: false,
        barcodeScannerEnabled: true,
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission:
          'DressIt usa tus fotos solo cuando tú las eliges, para digitalizar tus prendas, inspiración o buscar productos parecidos.',
        cameraPermission:
          'DressIt usa la cámara para fotografiar tus prendas y escanear códigos de barras de etiquetas.',
        microphonePermission: false,
      },
    ],
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'DressIt usa tu ubicación aproximada (unos 1 km) para conocer el tiempo de tu ciudad. Nunca la usa en segundo plano.',
        locationAlwaysAndWhenInUsePermission: false,
        locationAlwaysPermission: false,
        isIosReducedAccuracyByDefault: true,
        // Never request precise location or motion activity.
        locationFullAccuracyPermission: false,
        motionUsagePermission: false,
        isIosBackgroundLocationEnabled: false,
        isAndroidBackgroundLocationEnabled: false,
        isAndroidForegroundServiceEnabled: false,
      },
    ],
    [
      'expo-calendar',
      {
        calendarPermission:
          'DressIt lee tus eventos (solo título, hora y lugar) para sugerirte qué ponerte. Nunca modifica tu calendario.',
        remindersPermission: false,
      },
    ],
    [
      'expo-share-intent',
      {
        iosActivationRules: {
          NSExtensionActivationSupportsWebURLWithMaxCount: 1,
          NSExtensionActivationSupportsWebPageWithMaxCount: 1,
          NSExtensionActivationSupportsText: true,
        },
        iosShareExtensionName: 'DressIt Share',
        androidIntentFilters: ['text/*'],
        // Safari only: the share extension's JS preprocessor already collects <meta> tags;
        // we add the page's JSON-LD blocks (max 20, ≤ 200 KB each) so the app can call
        // POST /v1/imports/link/capture with structured data the user is looking at.
        preprocessorInjectJS: SHARE_PREPROCESSOR_JS,
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? null,
  },
});
