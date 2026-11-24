import { Stack } from 'expo-router';

import { fonts, useTheme } from '@/theme';

export const unstable_settings = { anchor: 'welcome' };

export default function AuthLayout() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
        headerStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
        headerTintColor: colors.ink,
        headerTitleStyle: { fontFamily: fonts.sansSemiBold },
        headerBackTitleStyle: { fontFamily: fonts.sans },
        headerBackButtonDisplayMode: 'minimal',
      }}
    >
      <Stack.Screen name="welcome" options={{ title: 'Bienvenida' }} />
      <Stack.Screen name="login" options={{ headerShown: true, title: '' }} />
      <Stack.Screen name="register" options={{ headerShown: true, title: '' }} />
    </Stack>
  );
}
