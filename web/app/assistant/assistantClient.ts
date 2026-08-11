export type AssistantRole = 'admin' | 'coach' | 'participant';

export type AssistantChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export function assistantExamplesForKind(kind: AssistantRole | null): string[] {
  if (kind === 'admin') {
    return [
      'List upcoming sessions with attendee details.',
      'Show people and credit balances.',
      'Which sessions need attention today?'
    ];
  }

  if (kind === 'coach') {
    return [
      'Show my upcoming sessions.',
      'Who has attended my sessions more than once?',
      'Show cancellations for my sessions.'
    ];
  }

  if (kind === 'participant') {
    return [
      'What is my remaining credit balance?',
      'Show my bookings.',
      'What sessions can I book?'
    ];
  }

  return [
    'What sessions are available?',
    'How much do sessions cost?',
    'How many places remain?'
  ];
}

export function buildAssistantRequest(message: string, conversation: AssistantChatMessage[]) {
  return {
    message: message.trim(),
    conversation: conversation
      .filter((item) => item.role === 'user' || item.role === 'assistant')
      .map((item) => ({
        role: item.role,
        content: item.content.slice(0, 4000)
      }))
      .slice(-8)
  };
}

export function cleanAssistantResponse(response: string): string {
  const text = response.trim();
  if (!text) return 'The assistant did not return a response.';

  if (!text.toLowerCase().startsWith('stub:')) return text;

  const publicSessions = /public_sessions=(\d+)/.exec(text);
  if (publicSessions) {
    const count = Number(publicSessions[1]);
    return `I found ${count} public session${count === 1 ? '' : 's'} in your authorized view.`;
  }

  if (/ok=false/.test(text)) return 'The request could not be completed.';

  return 'The request was completed.';
}
