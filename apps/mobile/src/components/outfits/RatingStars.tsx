import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { touchTarget, useTheme } from '@/theme';

import { Icon } from '../ui';

export interface RatingStarsProps {
  value: number | null;
  onChange: (rating: number) => void;
  disabled?: boolean;
  testID?: string;
}

/** 1–5 rating, adjustable for screen readers. */
export function RatingStars({ value, onChange, disabled, testID = 'rating' }: RatingStarsProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('outfits');
  const current = value ?? 0;
  return (
    <View
      style={styles.row}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={t('detail.rating')}
      accessibilityHint={t('detail.ratingHint')}
      accessibilityValue={{ min: 0, max: 5, now: current, text: current ? t('detail.star', { count: current }) : undefined }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        if (disabled) return;
        const next = e.nativeEvent.actionName === 'increment' ? Math.min(5, current + 1) : Math.max(1, current - 1);
        if (next !== current) onChange(next);
      }}
      testID={testID}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable
          key={n}
          disabled={disabled}
          onPress={() => onChange(n)}
          importantForAccessibility="no"
          accessibilityElementsHidden
          testID={`${testID}-${n}`}
          style={({ pressed }) => [styles.star, { opacity: disabled ? 0.4 : pressed ? 0.6 : 1 }]}
        >
          <Icon name="star" size={24} color={n <= current ? colors.accent : colors.lineStrong} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  star: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
});
