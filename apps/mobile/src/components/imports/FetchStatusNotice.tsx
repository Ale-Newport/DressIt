import type { ImportedProductDto } from '@dressit/shared';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Badge, type BadgeTone, Button, Card, Icon, Text } from '@/components/ui';
import { space, useTheme } from '@/theme';

type FetchStatus = ImportedProductDto['fetchStatus'];

const TONES: Record<FetchStatus, BadgeTone> = {
  resolved: 'success',
  partial: 'warning',
  blocked: 'danger',
  unsupported_domain: 'neutral',
  not_product: 'warning',
  error: 'danger',
};

/** Statuses for which capturing the page in the in-app browser is the way forward. */
export function needsBrowserCapture(status: FetchStatus): boolean {
  return status === 'blocked' || status === 'partial' || status === 'unsupported_domain' || status === 'error';
}

export function FetchStatusBadge({ status }: { status: FetchStatus }) {
  const { t } = useTranslation('imports');
  return <Badge label={t(`status.${status}`)} tone={TONES[status]} testID={`fetch-status-${status}`} />;
}

export interface FetchStatusNoticeProps {
  status: FetchStatus;
  message: string | null;
  url: string;
  /** Show the "view what we read" link (link import screen). */
  onViewProduct?: () => void;
  testID?: string;
}

/**
 * Explains the outcome of a link import honestly. When the store blocks
 * server-side reads (most large Spanish retailers), the in-app browser capture is
 * the primary call to action.
 */
export function FetchStatusNotice({ status, message, url, onViewProduct, testID = 'fetch-status-notice' }: FetchStatusNoticeProps) {
  const { t } = useTranslation('imports');
  const { colors } = useTheme();
  const router = useRouter();
  const openBrowser = () => router.push({ pathname: '/import/browser', params: { url } });

  const heading =
    status === 'blocked'
      ? t('link.blockedTitle')
      : status === 'partial'
        ? t('link.partialTitle')
        : status === 'unsupported_domain'
          ? t('link.unsupportedTitle')
          : status === 'not_product'
            ? t('link.notProductTitle')
            : status === 'error'
              ? t('link.errorTitle')
              : t('status.resolved');
  const body =
    status === 'blocked'
      ? t('link.blockedBody')
      : status === 'partial'
        ? t('link.partialBody')
        : status === 'not_product'
          ? t('link.notProductBody')
          : null;
  const prominent = status === 'blocked';
  const icon = status === 'resolved' ? 'check-circle' : status === 'blocked' ? 'shield' : 'alert-circle';

  return (
    <Card tone={prominent ? 'accent' : 'surface'} testID={testID} style={styles.card}>
      <View style={styles.head}>
        <Icon name={icon} size={20} color={status === 'resolved' ? colors.success : prominent ? colors.accent : colors.inkMuted} />
        <View style={{ flex: 1, gap: 4 }}>
          <FetchStatusBadge status={status} />
          <Text variant="subheading">{heading}</Text>
        </View>
      </View>
      {body ? (
        <Text variant="small" tone="muted">
          {body}
        </Text>
      ) : null}
      {message ? <Text variant="small">{message}</Text> : null}
      {needsBrowserCapture(status) || status === 'not_product' ? (
        <View style={{ gap: space.xs }}>
          <Button
            label={t('link.openBrowser')}
            icon="globe"
            variant={prominent ? 'accent' : 'secondary'}
            onPress={openBrowser}
            fullWidth
            testID={`${testID}-open-browser`}
            accessibilityHint={t('link.openBrowserHint')}
          />
          <Text variant="caption" tone="muted">
            {t('link.openBrowserHint')}
          </Text>
        </View>
      ) : null}
      {onViewProduct && status !== 'not_product' ? (
        <Button label={t('link.viewProduct')} variant={status === 'resolved' ? 'primary' : 'ghost'} onPress={onViewProduct} fullWidth testID={`${testID}-view`} />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  head: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
});
