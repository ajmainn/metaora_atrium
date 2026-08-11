import {
  AssistantActionDeps,
  AssistantActionError,
  assistantToolDescriptions,
  allowedAssistantToolNames,
  executeAnonymousAssistantAction
} from './actions';
import { AssistantCallerContext, AssistantQueryFn } from './context';
import { AssistantProvider } from './provider';
import { buildAssistantToolData, AssistantToolData } from './tools';

export type AssistantInput = {
  message: string;
  conversation?: Array<{ role: 'user' | 'assistant'; content: string }>;
};

export type AssistantResult = {
  role: AssistantCallerContext['role'];
  response: string;
};

const MAX_TOOL_ITERATIONS = 4;

function sanitizeConversation(input: unknown): Array<{ role: 'user' | 'assistant'; content: string }> {
  if (!Array.isArray(input)) return [];
  return input
    .filter((item) => item && typeof item === 'object')
    .map((item) => item as Record<string, unknown>)
    .filter((item) => (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string')
    .slice(-8)
    .map((item) => ({
      role: item.role as 'user' | 'assistant',
      content: (item.content as string).slice(0, 4000)
    }));
}

export function parseAssistantInput(body: unknown): AssistantInput {
  const value = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const message = typeof value.message === 'string' ? value.message.trim() : '';
  if (!message) throw new Error('message is required');
  if (message.length > 4000) throw new Error('message is too long');

  return {
    message,
    conversation: sanitizeConversation(value.conversation)
  };
}

export async function runAssistant(
  input: AssistantInput,
  caller: AssistantCallerContext,
  provider: AssistantProvider,
  queryFn: AssistantQueryFn,
  now: Date = new Date(),
  actionDeps: Omit<AssistantActionDeps, 'queryFn' | 'now'> = {}
): Promise<AssistantResult & { data: AssistantToolData }> {
  const data = await buildAssistantToolData(caller, queryFn, now);
  const availableTools = assistantToolDescriptions.filter((tool) =>
    allowedAssistantToolNames(caller).includes(tool.name)
  );
  const baseRequest = {
    message: input.message,
    conversation: input.conversation || [],
    caller: {
      role: caller.role,
      authenticated: caller.authenticated
    },
    data,
    availableTools
  };

  let result = await provider.complete(baseRequest);
  const toolResults = [];

  for (let iteration = 0; result.toolCall; iteration += 1) {
    if (iteration >= MAX_TOOL_ITERATIONS) {
      throw new AssistantActionError(409, 'assistant tool loop limit reached');
    }

    const actionResult = await executeAnonymousAssistantAction(caller, result.toolCall, {
      queryFn,
      now,
      ...actionDeps
    });
    toolResults.push(actionResult);
    result = await provider.complete({
      ...baseRequest,
      toolResults
    });
  }

  if (!result.content.trim()) {
    throw new AssistantActionError(502, 'assistant returned an empty response');
  }

  return {
    role: caller.role,
    response: result.content,
    data
  };
}

export { AssistantActionError };
