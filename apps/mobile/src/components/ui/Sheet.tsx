import { type ReactNode, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { elevation, motion, radius, space, useTheme } from '@/theme';

import { IconButton } from './IconButton';
import { Text } from './Text';

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
  /** Sticky footer (actions). */
  footer?: ReactNode;
  /** Scroll the body (default true). */
  scroll?: boolean;
  /** Max height as a fraction of the screen. */
  maxHeight?: number;
  testID?: string;
}

/**
 * Bottom sheet built on RN Modal (no extra native deps). Slides up with a short
 * eased transition; instantaneous when Reduce Motion is on. Closes on backdrop
 * tap, the close button, Android back and the iOS accessibility escape gesture.
 */
export function Sheet({ visible, onClose, title, subtitle, children, footer, scroll = true, maxHeight = 0.88, testID }: SheetProps) {
  const { colors, reduceMotion } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      progress.value = reduceMotion ? 1 : withTiming(1, { duration: motion.base, easing: Easing.out(Easing.cubic) });
    } else if (mounted) {
      if (reduceMotion) {
        progress.value = 0;
        setMounted(false);
      } else {
        progress.value = withTiming(0, { duration: motion.fast, easing: Easing.in(Easing.cubic) }, (finished) => {
          if (finished) scheduleOnRN(setMounted, false);
        });
      }
    }
  }, [visible, mounted, progress, reduceMotion]);

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - progress.value) * 400 }], opacity: 0.4 + progress.value * 0.6 }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));

  if (!mounted) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fill}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }, backdropStyle]}>
          <Pressable style={styles.fill} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('a11y.closeSheet')} />
        </Animated.View>
        <Animated.View
          testID={testID}
          accessibilityViewIsModal
          onAccessibilityEscape={onClose}
          style={[
            styles.sheet,
            elevation.sheet,
            { backgroundColor: colors.background, paddingBottom: Math.max(insets.bottom, space.lg), maxHeight: `${maxHeight * 100}%` },
            sheetStyle,
          ]}
        >
          <View style={[styles.grabber, { backgroundColor: colors.lineStrong }]} />
          {title ? (
            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                <Text variant="heading">{title}</Text>
                {subtitle ? (
                  <Text variant="small" tone="muted">
                    {subtitle}
                  </Text>
                ) : null}
              </View>
              <IconButton icon="x" label={t('actions.close')} onPress={onClose} testID={testID ? `${testID}-close` : undefined} />
            </View>
          ) : null}
          {scroll ? (
            <ScrollView
              contentContainerStyle={styles.body}
              keyboardShouldPersistTaps="handled"
              // The sheet already pads for the safe area; iOS' automatic inset adjustment
              // shifts the content right after presenting and swallows the first tap.
              contentInsetAdjustmentBehavior="never"
              automaticallyAdjustContentInsets={false}
            >
              {children}
            </ScrollView>
          ) : (
            <View style={[styles.body, { flexShrink: 1 }]}>{children}</View>
          )}
          {footer ? <View style={[styles.footer, { borderTopColor: colors.line }]}>{footer}</View> : null}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: space.sm,
  },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginBottom: space.sm },
  header: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: space.xl, paddingBottom: space.sm, gap: space.sm },
  body: { paddingHorizontal: space.xl, paddingBottom: space.lg, gap: space.lg },
  footer: { paddingHorizontal: space.xl, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth, gap: space.sm },
});
