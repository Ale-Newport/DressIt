import { Stack } from 'expo-router';

import { fonts, useTheme } from '@/theme';

export const unstable_settings = { anchor: '(tabs)' };

/**
 * Signed-in navigator. Tabs at the root; detail screens push over the tabs;
 * flows that are self-contained (capture, link import, builder…) are modals.
 */
export default function AppLayout() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerTransparent: false,
        headerStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
        headerTintColor: colors.ink,
        headerTitleStyle: { fontFamily: fonts.sansSemiBold, color: colors.ink },
        headerBackTitleStyle: { fontFamily: fonts.sans },
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      {/* Home & assistant */}
      <Stack.Screen name="assistant" options={{ title: 'Asistente' }} />
      <Stack.Screen name="events/new" options={{ title: 'Nuevo evento', presentation: 'modal' }} />
      {/* Wardrobe */}
      <Stack.Screen name="garment/[id]" options={{ title: '' }} />
      <Stack.Screen name="garment/new" options={{ title: 'Añadir prenda', presentation: 'modal' }} />
      <Stack.Screen name="wardrobe/stats" options={{ title: 'Estadísticas' }} />
      <Stack.Screen name="wardrobe/spaces" options={{ title: 'Espacios' }} />
      {/* Capture & imports */}
      <Stack.Screen name="capture/camera" options={{ headerShown: false, presentation: 'fullScreenModal' }} />
      <Stack.Screen name="capture/session" options={{ title: 'Subiendo fotos' }} />
      <Stack.Screen name="capture/job" options={{ title: 'Analizando' }} />
      <Stack.Screen name="capture/review/[jobId]" options={{ title: 'Revisar prendas' }} />
      <Stack.Screen name="capture/imports" options={{ title: 'Importaciones' }} />
      <Stack.Screen name="capture/scan" options={{ headerShown: false, presentation: 'fullScreenModal' }} />
      <Stack.Screen name="capture/text" options={{ title: 'Ticket, captura o correo', presentation: 'modal' }} />
      <Stack.Screen name="import/link" options={{ title: 'Importar enlace', presentation: 'modal' }} />
      <Stack.Screen name="import/browser" options={{ title: 'Navegador', presentation: 'fullScreenModal' }} />
      <Stack.Screen name="import/product/[id]" options={{ title: 'Producto importado' }} />
      <Stack.Screen name="share-intent" options={{ title: 'Compartido con DressIt', presentation: 'modal' }} />
      {/* Outfits */}
      <Stack.Screen name="outfit/[id]" options={{ title: '' }} />
      <Stack.Screen name="outfit/builder" options={{ title: 'Crear conjunto', presentation: 'modal' }} />
      <Stack.Screen name="outfit/compare" options={{ title: 'Comparar' }} />
      <Stack.Screen name="planner" options={{ title: 'Planificador' }} />
      <Stack.Screen name="history" options={{ title: 'Historial' }} />
      <Stack.Screen name="trips/index" options={{ title: 'Viajes' }} />
      <Stack.Screen name="trips/new" options={{ title: 'Nuevo viaje', presentation: 'modal' }} />
      <Stack.Screen name="trips/[id]" options={{ title: '' }} />
      {/* Shopping */}
      <Stack.Screen name="shop/search" options={{ title: 'Buscar en tiendas' }} />
      <Stack.Screen name="shop/product/[id]" options={{ title: '' }} />
      <Stack.Screen name="shop/simulate" options={{ title: 'Con tu ropa' }} />
      <Stack.Screen name="shop/wishlist" options={{ title: 'Lista de deseos' }} />
      <Stack.Screen name="shop/visual-search" options={{ title: 'Búsqueda visual', presentation: 'modal' }} />
      <Stack.Screen name="shop/retailers" options={{ title: 'Tiendas e integraciones' }} />
      {/* Profile */}
      <Stack.Screen name="profile/preferences" options={{ title: 'Estilo y preferencias' }} />
      <Stack.Screen name="profile/style-profile" options={{ title: 'Tu perfil de estilo' }} />
      <Stack.Screen name="profile/consents" options={{ title: 'Permisos y consentimientos' }} />
      <Stack.Screen name="profile/privacy" options={{ title: 'Privacidad y datos' }} />
      <Stack.Screen name="profile/location" options={{ title: 'Tu ciudad', presentation: 'modal' }} />
      <Stack.Screen name="profile/calendar" options={{ title: 'Calendario' }} />
      <Stack.Screen name="profile/about" options={{ title: 'Acerca de' }} />
    </Stack>
  );
}
