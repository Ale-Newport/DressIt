import type { AssistantMessageRequest, AssistantMessageResponse } from '@dressit/shared';
import { useMutation } from '@tanstack/react-query';

import { api } from '../client';

export function useSendAssistantMessage() {
  return useMutation({
    mutationFn: (body: AssistantMessageRequest) =>
      api.post<AssistantMessageResponse>('/v1/assistant/messages', body, { timeoutMs: 60_000 }),
  });
}
