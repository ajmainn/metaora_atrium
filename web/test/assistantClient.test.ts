import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assistantExamplesForKind,
  buildAssistantRequest,
  cleanAssistantResponse
} from '../app/assistant/assistantClient';

test('assistant request body sends only message and conversation', () => {
  const body = buildAssistantRequest('  show my bookings  ', [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'hi' }
  ]);

  assert.deepEqual(Object.keys(body).sort(), ['conversation', 'message']);
  assert.equal(body.message, 'show my bookings');
  assert.deepEqual(body.conversation, [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'hi' }
  ]);
  assert.equal('role' in body, false);
  assert.equal('personId' in body, false);
});

test('assistant request body keeps only the latest safe conversation window', () => {
  const conversation = Array.from({ length: 10 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
    content: `${index}-${'x'.repeat(4100)}`
  }));
  const body = buildAssistantRequest('next', conversation);

  assert.equal(body.conversation.length, 8);
  assert.equal(body.conversation[0].content.startsWith('2-'), true);
  assert.equal(body.conversation[0].content.length, 4000);
});

test('assistant examples are role-aware without exposing caller identifiers', () => {
  for (const kind of [null, 'participant', 'coach', 'admin'] as const) {
    const examples = assistantExamplesForKind(kind);
    assert.equal(examples.length, 3);
    assert.equal(examples.some((example) => /person_id|personId|role\s*=/i.test(example)), false);
  }
});

test('stub responses are cleaned before display', () => {
  assert.equal(
    cleanAssistantResponse('stub:anonymous; public_sessions=2'),
    'I found 2 public sessions in your authorized view.'
  );
  assert.equal(cleanAssistantResponse('stub:participant; tool=get_my_balance; ok=true; data={}'), 'The request was completed.');
});
