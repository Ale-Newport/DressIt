import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import enCommon from './en/common';
import assistant from './es/assistant';
import auth from './es/auth';
import capture from './es/capture';
import common from './es/common';
import home from './es/home';
import imports from './es/imports';
import onboarding from './es/onboarding';
import outfits from './es/outfits';
import planner from './es/planner';
import profile from './es/profile';
import shop from './es/shop';
import wardrobe from './es/wardrobe';

/**
 * i18n: Spanish (es-ES) is the complete, primary language. English is a stub
 * (common strings only); every missing key falls back to Spanish.
 */
export const resources = {
  es: { common, auth, onboarding, home, wardrobe, capture, imports, outfits, planner, shop, assistant, profile },
  en: { common: enCommon },
} as const;

export const namespaces = Object.keys(resources.es) as Array<keyof (typeof resources)['es']>;

/**
 * Spanish by default (market: Spain). The English stub is opt-in with
 * `EXPO_PUBLIC_ENABLE_EN=1` so English-language phones do not get a half-translated UI.
 */
export function detectLanguage(): 'es' | 'en' {
  if (process.env.EXPO_PUBLIC_ENABLE_EN !== '1') return 'es';
  try {
    const code = getLocales()[0]?.languageCode;
    return code === 'en' ? 'en' : 'es';
  } catch {
    return 'es';
  }
}

if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    resources: resources as unknown as Record<string, Record<string, object>>,
    lng: detectLanguage(),
    fallbackLng: 'es',
    ns: namespaces,
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    returnNull: false,
    initAsync: false,
  });
}

export default i18n;
