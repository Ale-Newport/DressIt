import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { darkPalette, elevation, lightPalette, radius, space, useTheme } from '@/theme';

import { Icon } from './Icon';
import { Text } from './Text';

export type ToastTone = 'neutral' | 'success' | 'error';

export interface ToastOptions {
  message: string;
  tone?: ToastTone;
  action?: { label: string; onPress: () => void };
  durationMs?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
}

const ToastContext = createContext<{ show: (o: ToastOptions | string) => void }>({ show: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastItem | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  const show = useCallback((o: ToastOptions | string) => {
    const opts = typeof o === 'string' ? { message: o } : o;
    seq.current += 1;
    setToast({ ...opts, id: seq.current });
    AccessibilityInfo.announceForAccessibility(opts.message);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), opts.durationMs ?? (opts.action ? 6000 : 3500));
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const value = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast ? <ToastView key={toast.id} toast={toast} onDismiss={() => setToast(null)} /> : null}
    </ToastContext.Provider>
  );
}

function ToastView({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const { colors, reduceMotion, scheme } = useTheme();
  // The toast uses the inverse surface, so its accent comes from the opposite palette.
  const inverseAccent = scheme === 'dark' ? lightPalette.accent : darkPalette.accent;
  const insets = useSafeAreaInsets();
  const icon = toast.tone === 'success' ? 'check-circle' : toast.tone === 'error' ? 'alert-circle' : 'info';
  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeInDown.duration(180)}
      exiting={reduceMotion ? undefined : FadeOutDown.duration(140)}
      style={[styles.wrap, { bottom: insets.bottom + 72 }]}
      pointerEvents="box-none"
    >
      <View
        style={[styles.toast, elevation.sheet, { backgroundColor: colors.surfaceInverse }]}
        accessibilityLiveRegion="polite"
        testID="toast"
      >
        <Icon name={icon} size={18} color={toast.tone === 'error' ? inverseAccent : colors.inkInverse} />
        <Text variant="small" color={colors.inkInverse} style={{ flex: 1 }}>
          {toast.message}
        </Text>
        {toast.action ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={toast.action.label}
            hitSlop={12}
            onPress={() => {
              toast.action?.onPress();
              onDismiss();
            }}
          >
            <Text variant="smallStrong" color={inverseAccent}>
              {toast.action.label}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </Animated.View>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space.lg, right: space.lg },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md + 2,
    borderRadius: radius.md,
  },
});
