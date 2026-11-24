import type { AssistantCard, AssistantMessageResponse } from '@dressit/shared';
import { Stack } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';

import { errorMessage } from '@/api/client';
import { useSendAssistantMessage } from '@/api/hooks';
import { AssistantCardView } from '@/components/home/AssistantCards';
import { Chip, Icon, IconButton, OfflineBanner, Text, useIsOnline } from '@/components/ui';
import { fonts, hairline, radius, space, touchTarget, useTheme } from '@/theme';

type Message =
  | { id: string; role: 'user'; text: string; status: 'sending' | 'sent' | 'error'; error?: string }
  | { id: string; role: 'assistant'; text: string; cards: AssistantCard[]; engine: AssistantMessageResponse['engine'] };

const SUGGESTION_KEYS = ['work', 'elegant', 'trip', 'sneakers'] as const;

let seq = 0;
const nextId = () => `m${Date.now().toString(36)}_${++seq}`;

export default function AssistantScreen() {
  const { t } = useTranslation('assistant');
  const { colors } = useTheme();
  const headerHeight = useHeaderHeight();
  const online = useIsOnline();
  const send = useSendAssistantMessage();
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<ScrollViewInstance>(null);

  const ask = (text: string, existingId?: string) => {
    const clean = text.trim();
    if (!clean || send.isPending) return;
    const userId = existingId ?? nextId();
    setMessages((prev) =>
      existingId
        ? prev.map((m) => (m.id === existingId && m.role === 'user' ? { ...m, status: 'sending', error: undefined } : m))
        : [...prev, { id: userId, role: 'user', text: clean, status: 'sending' }],
    );
    if (!existingId) setDraft('');
    send.mutate(
      { conversationId, text: clean },
      {
        onSuccess: (res) => {
          setConversationId(res.conversationId);
          setMessages((prev) => [
            ...prev.map((m) => (m.id === userId && m.role === 'user' ? { ...m, status: 'sent' as const } : m)),
            { id: nextId(), role: 'assistant', text: res.reply, cards: res.cards, engine: res.engine },
          ]);
          AccessibilityInfo.announceForAccessibility(res.reply);
        },
        onError: (e) => {
          setMessages((prev) => prev.map((m) => (m.id === userId && m.role === 'user' ? { ...m, status: 'error', error: errorMessage(e) } : m)));
        },
      },
    );
  };

  const reset = () => {
    setMessages([]);
    setConversationId(undefined);
    send.reset();
  };

  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id;

  return (
    <SafeAreaView edges={['bottom']} style={[styles.fill, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          title: t('title'),
          headerRight: messages.length
            ? () => <IconButton icon="edit" label={t('newConversation')} accessibilityHint={t('newConversationHint')} onPress={reset} testID="assistant-new" />
            : undefined,
        }}
      />
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={headerHeight}>
        <ScrollView
          ref={scrollRef}
          style={styles.fill}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
          testID="assistant-messages"
        >
          <OfflineBanner />
          {messages.length === 0 ? (
            <View style={styles.intro}>
              <Text variant="overline" tone="muted">
                {t('intro.overline')}
              </Text>
              <Text variant="title">{t('intro.title')}</Text>
              <Text variant="body" tone="muted">
                {t('intro.body')}
              </Text>
              <View style={styles.suggestions} accessibilityLabel={t('suggestions.label')}>
                {SUGGESTION_KEYS.map((key, i) => (
                  <Pressable
                    key={key}
                    onPress={() => ask(t(`suggestions.${key}`))}
                    disabled={send.isPending}
                    accessibilityRole="button"
                    accessibilityLabel={t(`suggestions.${key}`)}
                    testID={`assistant-suggestion-${i}`}
                    style={({ pressed }) => [styles.suggestion, { borderColor: colors.line, backgroundColor: colors.surface, opacity: pressed ? 0.7 : 1 }]}
                  >
                    <Icon name="message-square" size={16} color={colors.accent} />
                    <Text variant="body" style={{ flex: 1 }}>
                      {t(`suggestions.${key}`)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          {messages.map((m) =>
            m.role === 'user' ? (
              <View key={m.id} style={styles.userWrap}>
                <View style={[styles.userBubble, { backgroundColor: colors.surfaceInverse }]} accessible accessibilityLabel={`${t('you')}: ${m.text}`}>
                  <Text variant="body" color={colors.inkInverse}>
                    {m.text}
                  </Text>
                </View>
                {m.status === 'error' ? (
                  <View style={styles.errorRow} accessibilityLiveRegion="polite">
                    <Icon name="alert-circle" size={14} color={colors.danger} />
                    <Text variant="caption" tone="danger" style={{ flexShrink: 1 }}>
                      {t('error.failed')} {m.error}
                    </Text>
                    <Pressable
                      onPress={() => ask(m.text, m.id)}
                      accessibilityRole="button"
                      accessibilityLabel={t('error.retry')}
                      hitSlop={12}
                      testID={`assistant-retry-${m.id}`}
                    >
                      <Text variant="smallStrong" tone="accent">
                        {t('error.retry')}
                      </Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            ) : (
              <View
                key={m.id}
                style={styles.assistantWrap}
                accessibilityLiveRegion={m.id === lastAssistantId ? 'polite' : 'none'}
                testID={m.id === lastAssistantId ? 'assistant-last-reply' : undefined}
              >
                <Text variant="overline" tone="muted">
                  {t('stylist')}
                </Text>
                <Text variant="body">{m.text}</Text>
                {m.cards.map((card, i) => (
                  <AssistantCardView key={`${m.id}-${i}`} card={card} testID={`assistant-card-${card.type}-${i}`} />
                ))}
                <Text variant="caption" tone="subtle">
                  {t(`engine.${m.engine}`)}
                </Text>
              </View>
            ),
          )}

          {send.isPending ? (
            <View style={styles.thinking} accessibilityRole="progressbar" accessibilityLabel={t('thinking')}>
              <ActivityIndicator size="small" color={colors.inkMuted} />
              <Text variant="small" tone="muted">
                {t('thinking')}
              </Text>
            </View>
          ) : null}
        </ScrollView>

        {messages.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsBar} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
            {SUGGESTION_KEYS.map((key, i) => (
              <Chip key={key} size="sm" label={t(`suggestions.${key}`)} onPress={() => ask(t(`suggestions.${key}`))} disabled={send.isPending} testID={`assistant-chip-${i}`} />
            ))}
          </ScrollView>
        ) : null}

        <View style={[styles.composer, { borderTopColor: colors.line, backgroundColor: colors.background }]}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={t('input.placeholder')}
            placeholderTextColor={colors.inkSubtle}
            selectionColor={colors.accent}
            accessibilityLabel={t('input.label')}
            multiline
            maxLength={1000}
            style={[styles.input, { color: colors.ink, backgroundColor: colors.surface, borderColor: colors.line }]}
            testID="assistant-input"
            onSubmitEditing={() => ask(draft)}
            submitBehavior="submit"
            returnKeyType="send"
          />
          <Pressable
            onPress={() => ask(draft)}
            disabled={!draft.trim() || send.isPending || !online}
            accessibilityRole="button"
            accessibilityLabel={t('input.send')}
            accessibilityHint={t('input.sendHint')}
            accessibilityState={{ disabled: !draft.trim() || send.isPending || !online, busy: send.isPending }}
            testID="assistant-send"
            style={({ pressed }) => [
              styles.send,
              { backgroundColor: colors.ink, opacity: !draft.trim() || send.isPending || !online ? 0.35 : pressed ? 0.7 : 1 },
            ]}
          >
            <Icon name="arrow-up" size={20} color={colors.inkInverse} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: space.xl, gap: space.xl, paddingBottom: space.xxl },
  intro: { gap: space.md },
  suggestions: { gap: space.sm, marginTop: space.sm },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: touchTarget + 8,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: hairline * 2,
  },
  userWrap: { alignItems: 'flex-end', gap: space.xs },
  userBubble: { maxWidth: '85%', paddingHorizontal: space.lg, paddingVertical: space.md, borderRadius: radius.lg, borderBottomRightRadius: radius.xs },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, maxWidth: '90%' },
  assistantWrap: { gap: space.md },
  thinking: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  chipsBar: { flexGrow: 0 },
  chips: { gap: space.sm, paddingHorizontal: space.xl, paddingVertical: space.sm },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.sm, borderTopWidth: hairline },
  input: {
    flex: 1,
    minHeight: touchTarget,
    maxHeight: 140,
    borderWidth: hairline * 2,
    borderRadius: radius.lg,
    paddingHorizontal: space.md + 2,
    paddingTop: 12,
    paddingBottom: 12,
    fontFamily: fonts.sans,
    fontSize: 16,
  },
  send: { width: touchTarget, height: touchTarget, borderRadius: touchTarget / 2, alignItems: 'center', justifyContent: 'center' },
});
