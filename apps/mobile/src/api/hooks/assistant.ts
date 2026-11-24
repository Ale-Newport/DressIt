import type { AssistantMessageRequest, AssistantMessageResponse } from '@dressit/shared';
import { useMutation } from '@tanstack/react-query';

import { readAssistantRequest } from '@/lib/intelligence';

import { api } from '../client';

export function useSendAssistantMessage() {
  return useMutation({
    // On compatible iPhones the request is first read by Apple's on-device model; the server
    // only uses that reading where its own rules found nothing and the text supports it.
    mutationFn: async (body: AssistantMessageRequest) => {
      const deviceIntent = body.deviceIntent ?? (await readAssistantRequest(body.text));
      return api.post<AssistantMessageResponse>('/v1/assistant/messages', deviceIntent ? { ...body, deviceIntent } : body, { timeoutMs: 60_000 });
    },
  });
}
