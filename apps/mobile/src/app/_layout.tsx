import '@/i18n';

import { InstrumentSans_400Regular } from '@expo-google-fonts/instrument-sans/400Regular';
import { InstrumentSans_500Medium } from '@expo-google-fonts/instrument-sans/500Medium';
import { InstrumentSans_600SemiBold } from '@expo-google-fonts/instrument-sans/600SemiBold';
import { InstrumentSans_700Bold } from '@expo-google-fonts/instrument-sans/700Bold';
import { InstrumentSerif_400Regular } from '@expo-google-fonts/instrument-serif/400Regular';
import { InstrumentSerif_400Regular_Italic } from '@expo-google-fonts/instrument-serif/400Regular_Italic';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider as NavThemeProvider } from 'expo-router';
import { ShareIntentProvider } from 'expo-share-intent';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useMemo } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useMe } from '@/api/hooks/me';
import { PERSIST_MAX_AGE, persister, queryClient, shouldPersistQuery, wireReactQueryToNative } from '@/api/queryClient';
import { ToastProvider } from '@/components/ui';
import { SessionProvider, useSession } from '@/state/session';
import { fonts, ThemeProvider, useTheme } from '@/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});
wireReactQueryToNative();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    InstrumentSans_400Regular,
    InstrumentSans_500Medium,
    InstrumentSans_600SemiBold,
    InstrumentSans_700Bold,
    InstrumentSerif_400Regular,
    InstrumentSerif_400Regular_Italic,
  });

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ShareIntentProvider options={{ resetOnBackground: false }}>
        <SafeAreaProvider>
          <ThemeProvider>
            <PersistQueryClientProvider
              client={queryClient}
              persistOptions={{
                persister,
                maxAge: PERSIST_MAX_AGE,
                buster: 'v1',
                dehydrateOptions: {
                  shouldDehydrateQuery: (q) => q.state.status === 'success' && shouldPersistQuery(q.queryKey),
                },
              }}
            >
              <SessionProvider>
                <ToastProvider>
                  <RootNavigator ready={fontsLoaded || !!fontError} />
                </ToastProvider>
              </SessionProvider>
            </PersistQueryClientProvider>
          </ThemeProvider>
        </SafeAreaProvider>
      </ShareIntentProvider>
    </GestureHandlerRootView>
  );
}

function RootNavigator({ ready }: { ready: boolean }) {
  const { colors, scheme } = useTheme();
  const { status } = useSession();
  const signedIn = status === 'signedIn';
  const me = useMe(signedIn);
  // Until /me answers we assume onboarding is done (offline-friendly); the guard flips if not.
  const needsOnboarding = signedIn && me.data?.onboardingCompleted === false;
  const booting = !ready || status === 'loading' || (signedIn && me.isPending && !me.isError);

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(colors.background).catch(() => {});
  }, [colors.background]);

  useEffect(() => {
    if (!booting) SplashScreen.hideAsync().catch(() => {});
  }, [booting]);

  const navTheme = useMemo(() => {
    const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: { ...base.colors, background: colors.background, card: colors.background, text: colors.ink, border: colors.line, primary: colors.accent },
    };
  }, [scheme, colors]);

  if (booting) return null;

  return (
    <NavThemeProvider value={navTheme}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
          headerTitleStyle: { fontFamily: fonts.sansSemiBold },
        }}
      >
        {/* Explicit redirects: the root navigator has no anchor, so a failing guard must say where to go. */}
        <Stack.Protected guard={!signedIn} redirectTo={needsOnboarding ? '/onboarding' : '/'}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && needsOnboarding} redirectTo={signedIn ? '/' : '/welcome'}>
          <Stack.Screen name="onboarding" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && !needsOnboarding} redirectTo={signedIn ? '/onboarding' : '/welcome'}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>
      </Stack>
    </NavThemeProvider>
  );
}
