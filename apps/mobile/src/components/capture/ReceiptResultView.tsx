import type { ReceiptImportResult } from '@dressit/shared';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Badge, Button, Card, Divider, EmptyState, Icon, Text } from '@/components/ui';
import { capitalize, formatCents, formatLongDate } from '@/lib/format';
import { hostnameOf } from '@/lib/urls';
import { space, useTheme } from '@/theme';

/** Result of `POST /v1/imports/text`: lines with a next step each (product, link import or manual garment). */
export function ReceiptResultView({ result, testID = 'receipt-result' }: { result: ReceiptImportResult; testID?: string }) {
  const { t } = useTranslation('capture');
  const { colors } = useTheme();
  const router = useRouter();
  const lineUrls = new Set(result.lines.map((l) => l.productUrl).filter(Boolean));
  const otherUrls = result.productUrls.filter((u) => !lineUrls.has(u));

  return (
    <View style={{ gap: space.lg }} testID={testID}>
      <Card tone="sunken">
        <View style={{ gap: space.xs }}>
          <Text variant="overline" tone="muted">
            {t('result.title')}
          </Text>
          <Text variant="heading">{result.retailer?.name ?? t('result.unknownRetailer')}</Text>
          {result.orderRef ? (
            <Text variant="small" tone="muted">
              {t('result.order')}: {result.orderRef}
            </Text>
          ) : null}
          {result.purchaseDate ? (
            <Text variant="small" tone="muted">
              {t('result.date')}: {capitalize(formatLongDate(result.purchaseDate))}
            </Text>
          ) : null}
          <Text variant="small">{t('result.lines', { count: result.lines.length })}</Text>
        </View>
      </Card>

      {result.lines.length === 0 ? (
        <EmptyState compact icon="search" title={t('result.noLines')} body={t('result.noLinesBody')} />
      ) : (
        result.lines.map((line, i) => (
          <View key={`${line.description}-${i}`} style={{ gap: space.sm }} testID={`${testID}-line-${i}`}>
            {i > 0 ? <Divider /> : null}
            <Text variant="bodyStrong">{line.description}</Text>
            <View style={styles.meta}>
              {line.reference ? <Badge label={t('result.reference', { ref: line.reference })} /> : null}
              {line.ean ? <Badge label={t('result.ean', { ean: line.ean })} /> : null}
              {line.size ? <Badge label={t('result.size', { size: line.size })} /> : null}
              {line.colorName ? <Badge label={line.colorName} /> : null}
              {line.priceCents != null ? <Badge label={formatCents(line.priceCents)} tone="info" /> : null}
            </View>
            <View style={styles.actions}>
              {line.catalogProductId ? (
                <Button
                  label={t('result.viewProduct')}
                  size="sm"
                  variant="secondary"
                  icon="shopping-bag"
                  onPress={() => router.push({ pathname: '/shop/product/[id]', params: { id: line.catalogProductId!, kind: 'catalog' } })}
                />
              ) : null}
              {line.productUrl ? (
                <Button
                  label={t('result.importLink')}
                  size="sm"
                  variant="secondary"
                  icon="link"
                  onPress={() => router.push({ pathname: '/import/link', params: { url: line.productUrl! } })}
                />
              ) : null}
              <Button
                label={t('result.createGarment')}
                size="sm"
                variant={line.catalogProductId || line.productUrl ? 'ghost' : 'primary'}
                icon="plus"
                onPress={() =>
                  router.push({
                    pathname: '/garment/new',
                    params: {
                      name: line.description,
                      ...(line.size ? { size: line.size } : {}),
                      ...(line.colorName ? { colorName: line.colorName } : {}),
                      ...(line.priceCents != null ? { priceCents: String(line.priceCents) } : {}),
                      ...(result.purchaseDate ? { purchaseDate: result.purchaseDate } : {}),
                      ...(result.retailer ? { brand: result.retailer.name } : {}),
                    },
                  })
                }
                testID={`${testID}-line-${i}-create`}
              />
            </View>
          </View>
        ))
      )}

      {otherUrls.length ? (
        <View style={{ gap: space.sm }}>
          <Text variant="smallStrong">{t('result.otherLinks')}</Text>
          {otherUrls.map((u) => (
            <Button key={u} label={hostnameOf(u)} size="sm" variant="secondary" icon="link" onPress={() => router.push({ pathname: '/import/link', params: { url: u } })} />
          ))}
        </View>
      ) : null}

      {result.warnings.length ? (
        <View style={{ gap: space.xs }}>
          <Text variant="smallStrong">{t('result.warnings')}</Text>
          {result.warnings.map((w, i) => (
            <View key={i} style={styles.warning}>
              <Icon name="alert-triangle" size={14} color={colors.warning} />
              <Text variant="small" tone="warning" style={{ flex: 1 }}>
                {w}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  warning: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
});
