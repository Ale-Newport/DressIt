import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, type TextInputInstance, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { errorMessage } from '@/api/client';
import { useLogin } from '@/api/hooks/auth';
import { Button, OfflineBanner, Text, TextField } from '@/components/ui';
import { space, useTheme } from '@/theme';

export default function LoginScreen() {
  const { t } = useTranslation('auth');
  const { colors } = useTheme();
  const router = useRouter();
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const passwordRef = useRef<TextInputInstance>(null);

  const submit = () => {
    if (!email.trim() || !password) {
      setLocalError(t('login.invalid'));
      return;
    }
    setLocalError(null);
    // On success the session flips and the root navigator shows the app (or onboarding).
    login.mutate({ email: email.trim().toLowerCase(), password });
  };

  const error = localError ?? (login.isError ? errorMessage(login.error) : null);

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.fill, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID="login-screen">
        <View style={{ gap: space.sm }}>
          <Text variant="title">{t('login.title')}</Text>
          <Text variant="body" tone="muted">
            {t('login.subtitle')}
          </Text>
        </View>
        <OfflineBanner />
        <TextField
          label={t('login.email')}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="username"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
          testID="login-email"
        />
        <TextField
          ref={passwordRef}
          label={t('login.password')}
          value={password}
          onChangeText={setPassword}
          secureToggle
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={submit}
          testID="login-password"
        />
        {error ? (
          <Text variant="small" tone="danger" accessibilityRole="alert" testID="login-error">
            {error}
          </Text>
        ) : null}
        <Button label={t('login.submit')} onPress={submit} loading={login.isPending} fullWidth testID="login-submit" />
        <Button label={t('login.noAccount')} variant="ghost" onPress={() => router.replace('/register')} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: space.xxl, gap: space.lg },
});
