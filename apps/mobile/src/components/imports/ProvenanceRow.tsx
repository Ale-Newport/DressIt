import type { FieldSource, ProvenancedField } from '@dressit/shared';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { ProvenanceBadge, Text } from '@/components/ui';
import { space } from '@/theme';

export interface ProvenanceRowProps<T> {
  label: string;
  field: ProvenancedField<T> | null | undefined;
  /** Formats the value for display. */
  format?: (value: T) => string;
  testID?: string;
  numberOfLines?: number;
}

export function useSourceLabel() {
  const { t } = useTranslation('imports');
  return (source: FieldSource) => t(`source.${source}`);
}

/** One imported field: label, value and a verified/unverified badge with its source. */
export function ProvenanceRow<T>({ label, field, format, testID, numberOfLines }: ProvenanceRowProps<T>) {
  const sourceLabel = useSourceLabel();
  if (!field) return null;
  const display = format ? format(field.value) : String(field.value ?? '');
  if (!display) return null;
  return (
    <View style={styles.row} testID={testID} accessible accessibilityLabel={`${label}: ${display}. ${field.verified ? 'Verificado' : 'No verificado'}, ${sourceLabel(field.source)}`}>
      <View style={styles.top}>
        <Text variant="caption" tone="muted" style={{ flex: 1 }}>
          {label}
        </Text>
        <ProvenanceBadge verified={field.verified} source={sourceLabel(field.source)} />
      </View>
      <Text variant="body" numberOfLines={numberOfLines}>
        {display}
      </Text>
      <Text variant="caption" tone="subtle">
        {sourceLabel(field.source)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: 2, paddingVertical: space.sm },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
