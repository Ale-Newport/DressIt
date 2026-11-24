import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';

import { errorMessage } from '@/api/client';
import { isConsentGranted, useCompleteOnboarding, useConsents, useMe, usePreferences, useUpdatePreferences } from '@/api/hooks/me';
import { uploadImage } from '@/api/upload';
import { CityPicker } from '@/components/profile/CityPicker';
import { ConsentList } from '@/components/profile/ConsentList';
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
import { Button, OfflineBanner, ProgressBar, Text, useToast } from '@/components/ui';
import { pickFromLibrary } from '@/lib/media';
import { radius, space, useTheme } from '@/theme';

type StepKey = 'styles' | 'colors' | 'fit' | 'shopping' | 'routine' | 'city' | 'consents' | 'inspiration';
const STEPS: StepKey[] = ['styles', 'colors', 'fit', 'shopping', 'routine', 'city', 'consents', 'inspiration'];
/** Steps whose answers live in PreferencesDto (saved with PUT /v1/me/preferences). */
const PREF_STEPS: StepKey[] = ['styles', 'colors', 'fit', 'shopping', 'routine'];

/**
 * Onboarding: only what improves the first recommendations. Every step can be
 * skipped; preference answers are saved step by step (partial PUT), so leaving
 * midway keeps progress.
 */
export default function OnboardingScreen() {
  const { t } = useTranslation('onboarding');
  const { colors } = useTheme();
  const toast = useToast();
  const me = useMe();
  const prefs = usePreferences();
  const consents = useConsents();
  const updatePrefs = useUpdatePreferences();
  const complete = useCompleteOnboarding();
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState<PrefsDraft>({});
  const [dirty, setDirty] = useState(false);
  const [inspiration, setInspiration] = useState<Array<{ uri: string; status: 'uploading' | 'done' | 'error' }>>([]);

  const step = STEPS[index]!;
  const value: PrefsDraft = { ...(prefs.data ?? {}), ...draft };
  const isLast = index === STEPS.length - 1;
  const invalid = (step === 'shopping' && budgetError(value)) || (step === 'routine' && dayWindowError(value));

  const change = (patch: PrefsDraft) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
  };

  const finish = () =>
    complete.mutate(undefined, {
      onError: (e) => toast.show({ message: errorMessage(e), tone: 'error' }),
      // On success `me.onboardingCompleted` flips and the root navigator shows the tabs.
    });

  const goNext = () => {
    if (isLast) finish();
    else setIndex((i) => i + 1);
  };

  const next = () => {
    if (PREF_STEPS.includes(step) && dirty) {
      updatePrefs.mutate(draft, {
        onSuccess: () => {
          setDraft({});
          setDirty(false);
          goNext();
        },
        onError: () => {
          toast.show({ message: t('saveError'), tone: 'error' });
          goNext();
        },
      });
      return;
    }
    goNext();
  };

  const skip = () => {
    setDraft({});
    setDirty(false);
    goNext();
  };

  const addInspiration = async () => {
    const res = await pickFromLibrary({ multiple: true, limit: 10 });
    if (res.status !== 'ok') return;
    const start = inspiration.length;
    setInspiration((list) => [...list, ...res.uris.map((uri) => ({ uri, status: 'uploading' as const }))]);
    res.uris.forEach((uri, i) => {
      uploadImage({ uri, kind: 'inspiration' })
        .then(() => setInspiration((list) => list.map((x, j) => (j === start + i ? { ...x, status: 'done' } : x))))
        .catch(() => setInspiration((list) => list.map((x, j) => (j === start + i ? { ...x, status: 'error' } : x))));
    });
  };

  const photoConsent = isConsentGranted(consents.data, 'photo_processing');
  const uploaded = inspiration.filter((x) => x.status === 'done').length;

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: colors.background }]} testID="onboarding-screen">
      <View style={styles.top}>
        <View style={styles.topRow}>
          <Text variant="overline" tone="muted">
            {t('progress', { current: index + 1, total: STEPS.length })}
          </Text>
          <Button label={t('skip')} variant="ghost" size="sm" onPress={skip} testID="onboarding-skip" />
        </View>
        <ProgressBar value={(index + 1) / STEPS.length} />
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <OfflineBanner />
        <View style={{ gap: space.sm }}>
          <Text variant="title" testID={`onboarding-step-${step}`}>
            {t(`steps.${step}.title`)}
          </Text>
          <Text variant="body" tone="muted">
            {t(`steps.${step}.body`)}
          </Text>
        </View>

        {step === 'styles' ? <StylesSection value={value} onChange={change} /> : null}
        {step === 'colors' ? <ColorsSection value={value} onChange={change} /> : null}
        {step === 'fit' ? <FitSizesSection value={value} onChange={change} /> : null}
        {step === 'shopping' ? <BrandsBudgetSection value={value} onChange={change} /> : null}
        {step === 'routine' ? <RoutineSection value={value} onChange={change} /> : null}
        {step === 'city' ? <CityPicker currentName={me.data?.location?.name ?? null} /> : null}
        {step === 'consents' ? <ConsentList kinds={['photo_processing', 'location', 'calendar']} /> : null}
        {step === 'inspiration' ? (
          <View style={{ gap: space.md }}>
            {!photoConsent ? (
              <Text variant="small" tone="warning">
                {t('steps.inspiration.needsConsent')}
              </Text>
            ) : null}
            <Button label={t('steps.inspiration.add')} icon="image" variant="secondary" onPress={addInspiration} disabled={!photoConsent} testID="onboarding-inspiration-add" />
            {inspiration.length ? (
              <>
                <Text variant="small" tone="muted">
                  {t('steps.inspiration.uploaded', { count: uploaded })}
                </Text>
                <View style={styles.thumbs}>
                  {inspiration.map((x, i) => (
                    <View key={`${x.uri}-${i}`} style={[styles.thumb, { backgroundColor: colors.surfaceAlt, opacity: x.status === 'uploading' ? 0.5 : 1, borderColor: x.status === 'error' ? colors.danger : 'transparent' }]}>
                      <Image source={{ uri: x.uri }} style={StyleSheet.absoluteFill} contentFit="cover" accessible={false} />
                    </View>
                  ))}
                </View>
              </>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
      <View style={[styles.footer, { borderTopColor: colors.line }]}>
        {index > 0 ? <Button label={t('back')} variant="ghost" onPress={() => setIndex((i) => i - 1)} testID="onboarding-back" /> : <View />}
        <Button
          label={isLast ? t('finish') : t('next')}
          onPress={next}
          disabled={!!invalid}
          loading={updatePrefs.isPending || complete.isPending}
          testID={isLast ? 'onboarding-finish' : 'onboarding-next'}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  top: { paddingHorizontal: space.xxl, paddingTop: space.md, gap: space.sm },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  content: { padding: space.xxl, gap: space.xl, paddingBottom: space.huge },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: space.xxl, paddingVertical: space.md, borderTopWidth: StyleSheet.hairlineWidth },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  thumb: { width: 72, height: 90, borderRadius: radius.sm, overflow: 'hidden', borderWidth: 2 },
});
