'use client';

import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  AssistantChatMessage,
  AssistantRole,
  assistantExamplesForKind,
  buildAssistantRequest,
  cleanAssistantResponse
} from './assistantClient';

type DisplayMessage = AssistantChatMessage & {
  id: string;
};

type CurrentUser = {
  full_name: string;
  email: string;
  kind: AssistantRole;
};

const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:4000';

function messageId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function safeErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  return 'The assistant could not be reached. Please try again.';
}

export default function AssistantChat({ user }: { user: CurrentUser | null }) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestMessageRef = useRef<HTMLDivElement | null>(null);
  const examples = useMemo(() => assistantExamplesForKind(user?.kind || null), [user?.kind]);

  useEffect(() => {
    latestMessageRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [messages, sending]);

  async function sendMessage(rawMessage = draft) {
    const message = rawMessage.trim();
    if (!message || sending) return;

    const userMessage: DisplayMessage = { id: messageId(), role: 'user', content: message };
    const previousMessages = messages.map(({ role, content }) => ({ role, content }));

    setMessages((current) => [...current, userMessage]);
    setDraft('');
    setError(null);
    setSending(true);

    try {
      const response = await fetch(`${apiBaseUrl}/api/assistant`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(buildAssistantRequest(message, previousMessages))
      });
      const body = await response.json().catch(() => ({} as { error?: string; response?: string }));

      if (!response.ok) {
        throw new Error(typeof body.error === 'string' ? body.error : 'The assistant request failed.');
      }

      const assistantText = typeof body.response === 'string'
        ? cleanAssistantResponse(body.response)
        : 'The assistant did not return a response.';

      setMessages((current) => [
        ...current,
        { id: messageId(), role: 'assistant', content: assistantText }
      ]);
    } catch (err) {
      setError(safeErrorMessage(err));
    } finally {
      setSending(false);
    }
  }

  function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  return (
    <section className="assistant-shell" aria-label="Atrium assistant chat">
      <div className="assistant-heading">
        <div>
          <h1>Atrium Assistant</h1>
          <p>
            {user
              ? 'Ask about your Atrium sessions, bookings, credits, and role-specific tasks.'
              : 'Ask about public sessions, prices, availability, or booking with your email.'}
          </p>
        </div>
      </div>

      <div className="assistant-messages" aria-live="polite">
        {messages.length === 0 ? (
          <div className="assistant-empty">
            <h2>How can I help?</h2>
            <div className="assistant-examples" aria-label="Example prompts">
              {examples.map((example) => (
                <button
                  className="button-secondary"
                  disabled={sending}
                  key={example}
                  onClick={() => void sendMessage(example)}
                  type="button"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <div className={`assistant-message ${message.role}`} key={message.id}>
              <span>{message.role === 'user' ? 'You' : 'Assistant'}</span>
              <p>{message.content}</p>
            </div>
          ))
        )}

        {sending ? (
          <div className="assistant-message assistant">
            <span>Assistant</span>
            <p>Thinking...</p>
          </div>
        ) : null}
        <div ref={latestMessageRef} />
      </div>

      {error ? <div className="state error assistant-error">{error}</div> : null}

      <form className="assistant-compose" onSubmit={submitForm}>
        <textarea
          aria-label="Message Atrium Assistant"
          className="assistant-input"
          disabled={sending}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message the assistant"
          rows={2}
          value={draft}
        />
        <button disabled={sending || !draft.trim()} type="submit">
          {sending ? 'Sending...' : 'Send'}
        </button>
      </form>
    </section>
  );
}
