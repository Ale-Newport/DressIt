import type { OutboundLinkResponse } from '@dressit/shared';
import { useState } from 'react';
import { Linking } from 'react-native';
import { useTranslation } from 'react-i18next';

import { errorMessage } from '@/api/client';
import { type ProductRef, useOutboundLink } from '@/api/hooks';
import { Button, type ButtonVariant, ConfirmDialog, useToast } from '@/components/ui';

export interface OutboundButtonProps {
  product: ProductRef;
  storeName: string;
  label?: string;
  variant?: ButtonVariant;
  /** Analytics context sent to `/v1/shopping/outbound` (e.g. "product_detail"). */
  context?: string;
  testID?: string;
}

/**
 * "Comprar en <tienda>": resolves the outbound link server-side (so affiliate
 * links are disclosed), always confirms before leaving the app and shows the
 * affiliate disclosure verbatim when present.
 */
export function OutboundButton({ product, storeName, label, variant = 'primary', context, testID = 'outbound-button' }: OutboundButtonProps) {
  const { t } = useTranslation('shop');
  const toast = useToast();
  const outbound = useOutboundLink();
  const [pending, setPending] = useState<OutboundLinkResponse | null>(null);

  const open = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      toast.show({ message: t('product.openFailed'), tone: 'error' });
    }
  };

  return (
    <>
      <Button
        label={label ?? t('product.buyAt', { store: storeName })}
        icon="external-link"
        variant={variant}
        loading={outbound.isPending}
        fullWidth
        testID={testID}
        accessibilityHint={t('product.buyHint')}
        onPress={() =>
          outbound.mutate(
            { product, context },
            {
              onSuccess: (res) => setPending(res),
              onError: (e) => toast.show({ message: errorMessage(e), tone: 'error' }),
            },
          )
        }
      />
      <ConfirmDialog
        visible={!!pending}
        title={t('product.outboundTitle', { store: storeName })}
        message={[pending?.disclosure, t('product.outboundBody')].filter(Boolean).join('\n\n')}
        confirmLabel={t('product.outboundContinue')}
        testID={`${testID}-dialog`}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const url = pending?.url;
          setPending(null);
          if (url) open(url);
        }}
      />
    </>
  );
}
