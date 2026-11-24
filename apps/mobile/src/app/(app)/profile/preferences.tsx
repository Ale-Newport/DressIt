import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { errorMessage } from '@/api/client';
import { useMe, usePreferences, useUpdateMe, useUpdatePreferences } from '@/api/hooks/me';
import {
  BrandsBudgetSection,
  budgetError,
  ColorsSection,
  dayWindowError,
  FitSizesSection,
  type PrefsDraft,
  RoutineSection,
  StylesSection,
} from '@/components/profile/PreferenceSections';
import { Button, Divider, ErrorState, OfflineBanner, Screen, SkeletonList, TextField, useToast } from '@/components/ui';
import { space } from '@/theme';

export default function PreferencesScreen() {
  const { t } = useTranslation('profile');
  const toast = useToast();
  const me = useMe();
  const prefs = usePreferences();
  const updatePrefs = useUpdatePreferences();
  const updateMe = useUpdateMe();
  const [draft, setDraft] = useState<PrefsDraft>({});
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    if (me.data && name === null) setName(me.data.displayName);
  }, [me.data, name]);

  if (prefs.isPending) {
    return (
      <Screen>
        <SkeletonList rows={6} />
      </Screen>
    );
  }
  if (!prefs.data) {
    return (
      <Screen>
        <ErrorState error={prefs.error} onRetry={() => prefs.refetch()} />
      </Screen>
    );
  }

  const value: PrefsDraft = { ...prefs.data, ...draft };
  const change = (patch: PrefsDraft) => setDraft((d) => ({ ...d, ...patch }));
  const nameChanged = !!name && !!me.data && name.trim() !== me.data.displayName;
  const dirty = Object.keys(draft).length > 0 || nameChanged;
  const invalid = budgetError(value) || dayWindowError(value) || (name !== null && !name.trim());

  const save = async () => {
    try {
      if (nameChanged && name) await updateMe.mutateAsync({ displayName: name.trim() });
      if (Object.keys(draft).length) await updatePrefs.mutateAsync(draft);
      setDraft({});
      toast.show({ message: t('preferences.saved'), tone: 'success' });
    } catch (e) {
      toast.show({ message: errorMessage(e), tone: 'error' });
    }
  };

  return (
    <Screen
      testID="preferences-screen"
      footer={
        <Button
          label={t('preferences.save')}
          onPress={save}
          disabled={!dirty || invalid}
          loading={updatePrefs.isPending || updateMe.isPending}
          fullWidth
          testID="preferences-save"
        />
      }
    >
      <OfflineBanner />
      <TextField label={t('preferences.displayName')} value={name ?? ''} onChangeText={setName} autoComplete="name" />
      <Divider />
      <StylesSection value={value} onChange={change} />
      <Divider />
      <ColorsSection value={value} onChange={change} />
      <Divider />
      <FitSizesSection value={value} onChange={change} />
      <Divider />
      <BrandsBudgetSection value={value} onChange={change} />
      <Divider />
      <RoutineSection value={value} onChange={change} />
      <View style={{ height: space.lg }} />
    </Screen>
  );
}
