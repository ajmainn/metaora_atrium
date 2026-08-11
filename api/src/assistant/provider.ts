import { AssistantCallerContext } from './context';
import { AssistantToolData } from './tools';

export type AssistantProviderRequest = {
  message: string;
  conversation: Array<{ role: 'user' | 'assistant'; content: string }>;
  caller: {
    role: AssistantCallerContext['role'];
    authenticated: boolean;
  };
  data: AssistantToolData;
};

export type AssistantProviderResponse = {
  content: string;
};

export interface AssistantProvider {
  complete(request: AssistantProviderRequest): Promise<AssistantProviderResponse>;
}

export class StubAssistantProvider implements AssistantProvider {
  async complete(request: AssistantProviderRequest): Promise<AssistantProviderResponse> {
    const parts = [
      `stub:${request.caller.role}`,
      `public_sessions=${request.data.public_sessions.length}`
    ];

    if (request.data.profile) parts.push(`profile=${request.data.profile.full_name}`);
    if (request.data.own_bookings) parts.push(`own_bookings=${request.data.own_bookings.length}`);
    if (request.data.own_sessions) parts.push(`own_sessions=${request.data.own_sessions.length}`);
    if (request.data.busy_periods) parts.push(`busy_periods=${request.data.busy_periods.length}`);
    if (request.data.admin_sessions) parts.push(`admin_sessions=${request.data.admin_sessions.length}`);

    return { content: parts.join('; ') };
  }
}

export class OllamaAssistantProvider implements AssistantProvider {
  constructor(
    private readonly config: {
      baseUrl: string;
      model: string;
      apiKey?: string;
    }
  ) {}

  async complete(request: AssistantProviderRequest): Promise<AssistantProviderResponse> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.apiKey) headers.Authorization = `Bearer ${this.config.apiKey}`;

    const response = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: this.config.model,
        stream: false,
        messages: [
          {
            role: 'system',
            content:
              'You are Atrium assistant. Answer only from the authorized JSON data supplied by the server.'
          },
          ...request.conversation,
          {
            role: 'user',
            content: request.message
          },
          {
            role: 'system',
            content: JSON.stringify({
              caller: request.caller,
              authorized_data: request.data
            })
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`assistant provider failed with ${response.status}`);
    }

    const body = await response.json() as { message?: { content?: string }; response?: string };
    return { content: body.message?.content || body.response || '' };
  }
}

export function assistantProviderFromEnv(): AssistantProvider {
  const useStub = process.env.ASSISTANT_USE_STUB === 'true' || process.env.ASSISTANT_PROVIDER === 'stub';
  if (useStub) return new StubAssistantProvider();

  return new OllamaAssistantProvider({
    baseUrl: process.env.ASSISTANT_BASE_URL || process.env.MODEL_BASE_URL || 'http://localhost:11434',
    model: process.env.ASSISTANT_MODEL || process.env.MODEL_NAME || 'llama3.2:3b',
    apiKey: process.env.ASSISTANT_API_KEY || process.env.MODEL_API_KEY || undefined
  });
}
