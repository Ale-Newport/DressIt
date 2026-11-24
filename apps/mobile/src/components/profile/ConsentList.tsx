import type { ConsentKind } from '@dressit/shared';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { errorMessage } from '@/api/client';
import { useConsents, useSetConsent } from '@/api/hooks/me';
import { Divider, ErrorState, ListRow, SkeletonList, Text, useToast } from '@/components/ui';
import { formatShortDate } from '@/lib/format';
import { space } from '@/theme';

export const REQUIRED_CONSENTS: ConsentKind[] = ['terms', 'privacy'];
export const OPTIONAL_CONSENTS: ConsentKind[] = [
  'photo_processing',
  'location',
  'calendar',
  'email_import',
  'ai_assistant_external',
  'ai_image_generation',
  'avatar',
  'analytics',
  'marketing',
];

export interface ConsentListProps {
  kinds?: ConsentKind[];
  showRequired?: boolean;
}

/** Consent toggles with plain-language explanations (PUT /v1/me/consents/:kind). */
export function ConsentList({ kinds = OPTIONAL_CONSENTS, showRequired }: ConsentListProps) {
  const { t } = useTranslation('profile');
  const consents = useConsents();
  const setConsent = useSetConsent();
  const toast = useToast();

  if (consents.isPending) return <SkeletonList rows={4} />;
  if (consents.isError && !consents.data) return <ErrorState error={consents.error} onRetry={() => consents.refetch()} compact />;

  const byKind = new Map((consents.data ?? []).map((c) => [c.kind, c]));
  const list = showRequired ? [...REQUIRED_CONSENTS, ...kinds] : kinds;

  return (
    <View style={{ gap: space.xs }} testID="consent-list">
      {list.map((kind, i) => {
        const c = byKind.get(kind);
        const required = REQUIRED_CONSENTS.includes(kind);
        const pending = setConsent.isPending && setConsent.variables?.kind === kind;
        return (
          <View key={kind}>
            {i > 0 ? <Divider /> : null}
            <ListRow
              title={t(`consents.kinds.${kind}.title`)}
              subtitle={t(`consents.kinds.${kind}.body`)}
              switchValue={required ? true : pending ? !!setConsent.variables?.granted : !!c?.granted}
              switchDisabled={required || pending}
              accessibilityHint={required ? t('consents.requiredNote') : undefined}
              onSwitchChange={(granted) =>
                setConsent.mutate(
                  { kind, granted },
                  { onError: (e) => toast.show({ message: errorMessage(e), tone: 'error' }) },
                )
              }
              testID={`consent-${kind}`}
            />
            {c ? (
              <Text variant="caption" tone="subtle">
                {required ? `${t('consents.required')} · ` : ''}
                {c.updatedAt ? t('consents.version', { version: c.version, date: formatShortDate(c.updatedAt.slice(0, 10)) }) : t('consents.undecided')}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
