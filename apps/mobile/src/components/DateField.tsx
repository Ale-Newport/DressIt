import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { addMonths, hhmmToMinutes, isSameMonth, minutesToHHMM, monthGrid, today } from '@/lib/dates';
import { capitalize, formatLongDate, formatMonthYear } from '@/lib/format';
import { hairline, radius, space, useTheme } from '@/theme';

import { Button, Icon, IconButton, Sheet, Text } from './ui';

const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const WEEKDAYS_A11Y = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

export interface MonthCalendarProps {
  value: string | null;
  onChange: (date: string) => void;
  min?: string;
  max?: string;
  /** Optional marker per date (e.g. planned outfits). */
  marked?: (date: string) => boolean;
  month?: string;
  onMonthChange?: (month: string) => void;
  testID?: string;
}

/** Accessible month grid (Monday first). Dates are local `YYYY-MM-DD`. */
export function MonthCalendar({ value, onChange, min, max, marked, month: controlledMonth, onMonthChange, testID = 'month-calendar' }: MonthCalendarProps) {
  const { colors } = useTheme();
  const [innerMonth, setInnerMonth] = useState(value ?? today());
  const month = controlledMonth ?? innerMonth;
  const setMonth = (m: string) => (onMonthChange ? onMonthChange(m) : setInnerMonth(m));
  const days = monthGrid(month);
  const t = today();
  return (
    <View style={{ gap: space.sm }} testID={testID}>
      <View style={styles.head}>
        <IconButton icon="chevron-left" label="Mes anterior" onPress={() => setMonth(addMonths(month, -1))} />
        <Text variant="subheading" accessibilityRole="header">
          {capitalize(formatMonthYear(month))}
        </Text>
        <IconButton icon="chevron-right" label="Mes siguiente" onPress={() => setMonth(addMonths(month, 1))} />
      </View>
      <View style={styles.row}>
        {WEEKDAYS.map((d, i) => (
          <Text key={d + i} variant="caption" tone="muted" style={styles.cellText} accessibilityLabel={WEEKDAYS_A11Y[i]}>
            {d}
          </Text>
        ))}
      </View>
      <View style={styles.grid}>
        {days.map((d) => {
          const disabled = (min && d < min) || (max && d > max);
          const selected = d === value;
          const inMonth = isSameMonth(d, month);
          return (
            <Pressable
              key={d}
              onPress={() => onChange(d)}
              disabled={!!disabled}
              accessibilityRole="button"
              accessibilityLabel={`${formatLongDate(d)}${marked?.(d) ? ', con planes' : ''}`}
              accessibilityState={{ selected, disabled: !!disabled }}
              testID={`${testID}-${d}`}
              style={[
                styles.cell,
                selected && { backgroundColor: colors.ink },
                d === t && !selected && { borderColor: colors.ink, borderWidth: 1 },
              ]}
            >
              <Text variant="small" color={selected ? colors.inkInverse : disabled ? colors.inkSubtle : inMonth ? colors.ink : colors.inkSubtle}>
                {Number(d.slice(8, 10))}
              </Text>
              {marked?.(d) ? <View style={[styles.dot, { backgroundColor: selected ? colors.inkInverse : colors.accent }]} /> : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export interface DateFieldProps {
  label: string;
  value: string | null;
  onChange: (date: string) => void;
  min?: string;
  max?: string;
  placeholder?: string;
  testID?: string;
}

/** Field that opens a month calendar in a sheet. */
export function DateField({ label, value, onChange, min, max, placeholder = 'Elegir fecha', testID = 'date-field' }: DateFieldProps) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: space.xs + 2 }}>
      <Text variant="smallStrong">{label}</Text>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value ? formatLongDate(value) : placeholder}`}
        testID={testID}
        style={[styles.field, { borderColor: colors.line, backgroundColor: colors.surface }]}
      >
        <Icon name="calendar" size={18} color={colors.inkMuted} />
        <Text variant="body" tone={value ? 'default' : 'subtle'} style={{ flex: 1 }}>
          {value ? capitalize(formatLongDate(value)) : placeholder}
        </Text>
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} title={label} testID={`${testID}-sheet`}>
        <MonthCalendar
          value={value}
          min={min}
          max={max}
          testID={`${testID}-calendar`}
          onChange={(d) => {
            onChange(d);
            setOpen(false);
          }}
        />
      </Sheet>
    </View>
  );
}

export interface TimeFieldProps {
  label: string;
  /** `HH:MM` */
  value: string;
  onChange: (hhmm: string) => void;
  stepMinutes?: number;
  testID?: string;
}

/** Compact time stepper (no native picker dependency). */
export function TimeField({ label, value, onChange, stepMinutes = 15, testID = 'time-field' }: TimeFieldProps) {
  const { colors } = useTheme();
  const minutes = hhmmToMinutes(value);
  const set = (m: number) => onChange(minutesToHHMM(((m % 1440) + 1440) % 1440));
  return (
    <View style={{ gap: space.xs + 2 }}>
      <Text variant="smallStrong">{label}</Text>
      <View
        style={[styles.field, { borderColor: colors.line, backgroundColor: colors.surface, justifyContent: 'space-between' }]}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ text: value }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => set(minutes + (e.nativeEvent.actionName === 'increment' ? stepMinutes : -stepMinutes))}
        testID={testID}
      >
        <IconButton icon="minus" label={`Restar ${stepMinutes} minutos`} onPress={() => set(minutes - stepMinutes)} testID={`${testID}-minus`} />
        <Text variant="bodyStrong">{value}</Text>
        <IconButton icon="plus" label={`Sumar ${stepMinutes} minutos`} onPress={() => set(minutes + stepMinutes)} testID={`${testID}-plus`} />
      </View>
    </View>
  );
}

/** Small helper button row for quick dates. */
export function QuickDates({ onPick, dates }: { onPick: (d: string) => void; dates: Array<{ label: string; date: string }> }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
      {dates.map((d) => (
        <Button key={d.date} label={d.label} size="sm" variant="secondary" onPress={() => onPick(d.date)} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: { flexDirection: 'row' },
  cellText: { flex: 1, textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, borderColor: 'transparent' },
  dot: { width: 4, height: 4, borderRadius: 2, marginTop: 2 },
  field: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 50, borderRadius: radius.md, borderWidth: hairline * 2, paddingHorizontal: space.md },
});
