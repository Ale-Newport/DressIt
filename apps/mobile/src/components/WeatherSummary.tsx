import type { DayWeatherDto } from '@dressit/shared';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { formatTemp, formatTime } from '@/lib/format';
import { hairline, radius, space, useTheme } from '@/theme';

import { Badge, Icon, type IconName, Text } from './ui';

/** WMO weather code → icon. */
export function weatherIcon(code: number): IconName {
  if (code === 0 || code === 1) return 'sun';
  if (code === 2 || code === 3) return 'cloud';
  if (code === 45 || code === 48) return 'cloud';
  if (code >= 51 && code <= 67) return 'cloud-drizzle';
  if (code >= 71 && code <= 77) return 'cloud-snow';
  if (code >= 80 && code <= 82) return 'cloud-rain';
  if (code >= 95) return 'cloud-lightning';
  return 'cloud';
}

/** CC BY 4.0 attribution: Open-Meteo requires credit wherever its data is shown. */
export function WeatherCredit({ provider }: { provider: string }) {
  const { t } = useTranslation();
  const isOpenMeteo = /open[-\s]?meteo/i.test(provider);
  return (
    <Text variant="caption" tone="subtle" testID="weather-credit">
      {isOpenMeteo ? t('weather.openMeteoCredit') : t('weather.credit', { provider })}
    </Text>
  );
}

export interface WeatherSummaryProps {
  weather: DayWeatherDto | null;
  weatherError?: string | null;
  compact?: boolean;
}

export function WeatherSummary({ weather, weatherError, compact }: WeatherSummaryProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  if (!weather) {
    if (!weatherError) return null;
    return (
      <View style={[styles.box, { borderColor: colors.line }]} accessibilityRole="summary" testID="weather-unavailable">
        <Icon name="cloud-off" size={18} color={colors.inkMuted} />
        <Text variant="small" tone="muted" style={{ flex: 1 }}>
          {weatherError}
        </Text>
      </View>
    );
  }
  const midHour = weather.hourly[Math.floor(weather.hourly.length / 2)];
  return (
    <View style={[styles.box, styles.column, { borderColor: colors.line }]} accessibilityRole="summary" testID="weather-summary">
      <View style={styles.headerRow}>
        <Icon name={weatherIcon(midHour?.weatherCode ?? 1)} size={26} color={colors.ink} />
        <View style={{ flex: 1 }}>
          <Text variant="overline" tone="muted">
            {weather.locationName}
          </Text>
          <Text variant="bodyStrong">{t('weather.range', { min: Math.round(weather.tempMin), max: Math.round(weather.tempMax) })}</Text>
        </View>
        {weather.stale ? <Badge label={t('weather.stale')} tone="warning" /> : null}
      </View>
      <Text variant={compact ? 'small' : 'body'}>{weather.summary}</Text>
      {!compact ? (
        <View style={styles.facts}>
          <Fact icon="log-out" label={`${weather.window.start} · ${formatTemp(weather.tempAtStart)}`} />
          <Fact icon="log-in" label={`${weather.window.end} · ${formatTemp(weather.tempAtEnd)}`} />
          {weather.precipitationProbabilityMax > 0 ? <Fact icon="umbrella" label={`${Math.round(weather.precipitationProbabilityMax)} %`} /> : null}
          <Fact icon="wind" label={`${Math.round(weather.windMax)} km/h`} />
          {weather.uvMax >= 3 ? <Fact icon="sun" label={`UV ${Math.round(weather.uvMax)}`} /> : null}
        </View>
      ) : null}
      {!compact && weather.rainPeriods.length > 0 ? (
        <Text variant="small" tone="muted">
          {weather.rainPeriods
            .map((r) => t('weather.rainAt', { from: safeTime(r.from), to: safeTime(r.to) }))
            .join(' · ')}
        </Text>
      ) : null}
      <WeatherCredit provider={weather.provider} />
    </View>
  );
}

function safeTime(s: string): string {
  if (/^\d{2}:\d{2}$/.test(s)) return s;
  try {
    return formatTime(s);
  } catch {
    return s;
  }
}

function Fact({ icon, label }: { icon: IconName; label: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.fact}>
      <Icon name={icon} size={14} color={colors.inkMuted} />
      <Text variant="caption" tone="muted">
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.lg, borderWidth: hairline },
  column: { flexDirection: 'column', alignItems: 'stretch' },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
