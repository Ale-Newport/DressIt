import { Tabs, type BottomTabBarProps } from 'expo-router/js-tabs';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName, Text } from '@/components/ui';
import { hairline, space, useTheme } from '@/theme';

const TAB_ICONS: Record<string, IconName> = {
  index: 'sun',
  armario: 'grid',
  outfits: 'layers',
  descubrir: 'compass',
  perfil: 'user',
};

/** Quiet editorial tab bar: thin top rule, line icons, small caps labels, ink indicator. */
/**
 * Uses the navigator's own BottomTabBarProps (Expo Router 58: `emitter` + `navigateToTab`,
 * there is no `navigation` object for custom tab bars anymore).
 */
function DressItTabBar({ state, descriptors, emitter, navigateToTab }: BottomTabBarProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      accessibilityRole="tablist"
      style={[styles.bar, { backgroundColor: colors.background, borderTopColor: colors.line, paddingBottom: Math.max(insets.bottom, space.sm) }]}
    >
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const options = descriptors[route.key]?.options ?? {};
        const label = options.title ?? route.name;
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
            testID={options.tabBarButtonTestID ?? `tab-${route.name}`}
            onPress={() => {
              const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) navigateToTab(route.key);
            }}
            style={styles.tab}
          >
            <View style={[styles.indicator, { backgroundColor: focused ? colors.ink : 'transparent' }]} />
            <Icon name={TAB_ICONS[route.name] ?? 'circle'} size={21} color={focused ? colors.ink : colors.inkSubtle} />
            <Text variant="caption" color={focused ? colors.ink : colors.inkMuted} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TabsLayout() {
  const { t } = useTranslation();
  return (
    <Tabs
      tabBar={(props) => <DressItTabBar {...props} />}
      screenOptions={{ headerShown: false, animation: Platform.OS === 'ios' ? 'fade' : 'none' }}
    >
      <Tabs.Screen name="index" options={{ title: t('tabs.home'), tabBarButtonTestID: 'tab-home' }} />
      <Tabs.Screen name="armario" options={{ title: t('tabs.wardrobe'), tabBarButtonTestID: 'tab-armario' }} />
      <Tabs.Screen name="outfits" options={{ title: t('tabs.outfits'), tabBarButtonTestID: 'tab-outfits' }} />
      <Tabs.Screen name="descubrir" options={{ title: t('tabs.discover'), tabBarButtonTestID: 'tab-descubrir' }} />
      <Tabs.Screen name="perfil" options={{ title: t('tabs.profile'), tabBarButtonTestID: 'tab-perfil' }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', borderTopWidth: hairline, paddingTop: 2 },
  tab: { flex: 1, alignItems: 'center', gap: 3, minHeight: 52, paddingTop: 6 },
  indicator: { position: 'absolute', top: -2, width: 22, height: 2, borderRadius: 1 },
});
