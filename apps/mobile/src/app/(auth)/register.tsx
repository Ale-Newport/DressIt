import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { errorMessage } from '@/api/client';
import { useRegister } from '@/api/hooks/auth';
import { Button, Icon, OfflineBanner, Sheet, Text, TextField } from '@/components/ui';
import { radius, space, useTheme } from '@/theme';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function RegisterScreen() {
  const { t } = useTranslation('auth');
  const { colors } = useTheme();
  const router = useRouter();
  const register = useRegister();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [touched, setTouched] = useState(false);

  const errors = {
    name: !name.trim() ? t('register.errors.name') : null,
    email: !EMAIL_RE.test(email.trim()) ? t('register.errors.email') : null,
    password: password.length < 10 ? t('register.errors.password') : null,
    terms: !accepted ? t('register.errors.terms') : null,
  };
  const valid = !errors.name && !errors.email && !errors.password && !errors.terms;

  const submit = () => {
    setTouched(true);
    if (!valid) return;
    register.mutate({ displayName: name.trim(), email: email.trim().toLowerCase(), password, acceptTerms: true });
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.fill, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID="register-screen">
        <View style={{ gap: space.sm }}>
          <Text variant="title">{t('register.title')}</Text>
          <Text variant="body" tone="muted">
            {t('register.subtitle')}
          </Text>
        </View>
        <OfflineBanner />
        <TextField
          label={t('register.name')}
          placeholder={t('register.namePlaceholder')}
          value={name}
          onChangeText={setName}
          autoComplete="name"
          textContentType="givenName"
          error={touched ? errors.name : null}
          testID="register-name"
        />
        <TextField
          label={t('register.email')}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          error={touched ? errors.email : null}
          testID="register-email"
        />
        <TextField
          label={t('register.password')}
          value={password}
          onChangeText={setPassword}
          secureToggle
          autoComplete="new-password"
          textContentType="newPassword"
          hint={t('register.passwordHint')}
          error={touched ? errors.password : null}
          testID="register-password"
        />

        <View style={styles.termsRow}>
          <Pressable
            onPress={() => setAccepted((a) => !a)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: accepted }}
            accessibilityLabel={t('register.terms')}
            testID="register-terms"
            hitSlop={8}
            style={styles.checkRow}
          >
            <View style={[styles.checkbox, { borderColor: colors.ink, backgroundColor: accepted ? colors.ink : 'transparent' }]}>
              {accepted ? <Icon name="check" size={14} color={colors.inkInverse} /> : null}
            </View>
            <Text variant="small" style={{ flex: 1 }}>
              {t('register.terms')}
            </Text>
          </Pressable>
          <Button label={t('register.termsLink')} size="sm" variant="ghost" onPress={() => setShowTerms(true)} testID="register-terms-read" />
        </View>
        {touched && errors.terms ? (
          <Text variant="small" tone="danger">
            {errors.terms}
          </Text>
        ) : null}

        {register.isError ? (
          <Text variant="small" tone="danger" accessibilityRole="alert" testID="register-error">
            {errorMessage(register.error)}
          </Text>
        ) : null}
        <Button label={t('register.submit')} onPress={submit} loading={register.isPending} fullWidth testID="register-submit" />
        <Button label={t('register.haveAccount')} variant="ghost" onPress={() => router.replace('/login')} />
      </ScrollView>

      <Sheet visible={showTerms} onClose={() => setShowTerms(false)} title={t('register.termsSheet.title')} testID="terms-sheet">
        <Text variant="body" tone="muted">
          {t('register.termsSheet.intro')}
        </Text>
        {(t('register.termsSheet.items', { returnObjects: true }) as string[]).map((item, i) => (
          <View key={i} style={styles.bullet}>
            <View style={[styles.dot, { backgroundColor: colors.accent }]} />
            <Text variant="body" style={{ flex: 1 }}>
              {item}
            </Text>
          </View>
        ))}
        <Button
          label={t('register.terms')}
          onPress={() => {
            setAccepted(true);
            setShowTerms(false);
          }}
          fullWidth
        />
      </Sheet>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: space.xxl, gap: space.lg },
  termsRow: { gap: space.xs },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 44 },
  checkbox: { width: 22, height: 22, borderRadius: radius.xs, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  bullet: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  dot: { width: 5, height: 5, borderRadius: 3, marginTop: 10 },
});
