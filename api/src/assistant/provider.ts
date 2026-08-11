import { AssistantActionResult, AssistantToolCall } from './actions';
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
  availableTools: readonly { name: string; description: string; roles: readonly string[] }[];
  toolResults?: AssistantActionResult[];
};

export type AssistantProviderResponse = {
  content: string;
  toolCall?: AssistantToolCall;
};

export interface AssistantProvider {
  complete(request: AssistantProviderRequest): Promise<AssistantProviderResponse>;
}

export class StubAssistantProvider implements AssistantProvider {
  async complete(request: AssistantProviderRequest): Promise<AssistantProviderResponse> {
    if (request.toolResults && request.toolResults.length > 0) {
      const result = request.toolResults[request.toolResults.length - 1];
      return {
        content: `stub:${request.caller.role}; tool=${result.tool}; ok=${result.ok}; data=${JSON.stringify(result.data)}`
      };
    }

    const toolCall = stubToolCall(request.message);
    if (toolCall) {
      return { content: '', toolCall };
    }

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

function stubToolCall(message: string): AssistantToolCall | null {
  const text = message.toLowerCase();

  if (/unknown_tool|bad_tool|drop table/.test(text)) {
    return { name: 'unknown_tool', arguments: {} };
  }

  if (/balance|credits?/.test(text) && /my|remaining/.test(text)) {
    return { name: 'get_my_balance', arguments: {} };
  }

  if (/my bookings?|my sessions?|bookings?/.test(text) && !/book session|book a session|cancel/.test(text)) {
    return { name: 'get_my_bookings', arguments: {} };
  }

  const cancelMatch = /\bcancel\b.*?(?:booking|enrolment)\s+(\d+).*?(?:session)\s+(\d+)/.exec(text)
    || /\bcancel\b.*?(?:session)\s+(\d+).*?(?:booking|enrolment)\s+(\d+)/.exec(text);
  if (cancelMatch) {
    return {
      name: 'cancel_booking',
      arguments: {
        enrolment_id: Number(cancelMatch[1]),
        session_id: Number(cancelMatch[2])
      }
    };
  }

  const anonymousBookMatch = /\bbook\b.*?(?:session)\s+(\d+).*?([^\s@]+@[^\s@]+\.[^\s@]+)/.exec(text);
  if (anonymousBookMatch) {
    return {
      name: 'anonymous_book_session',
      arguments: {
        session_id: Number(anonymousBookMatch[1]),
        email: anonymousBookMatch[2]
      }
    };
  }

  const bookMatch = /\bbook\b.*?(?:session)\s+(\d+)/.exec(text);
  if (bookMatch) {
    return {
      name: 'book_session',
      arguments: {
        session_id: Number(bookMatch[1])
      }
    };
  }

  if (/search|list|available|sessions?|cost|price|places|when/.test(text)) {
    return { name: 'search_sessions', arguments: {} };
  }

  return null;
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
          {
            role: 'system',
            content: JSON.stringify({
              available_tools: request.availableTools,
              tool_results: request.toolResults || []
            })
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
    const content = body.message?.content || body.response || '';

    try {
      const parsed = JSON.parse(content) as { tool_call?: AssistantToolCall; response?: string };
      if (parsed.tool_call) return { content: parsed.response || '', toolCall: parsed.tool_call };
      if (parsed.response) return { content: parsed.response };
    } catch {
      // Plain text model replies are fine.
    }

    return { content };
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
