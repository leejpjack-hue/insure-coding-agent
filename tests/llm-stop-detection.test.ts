// Stop-detection + error classification tests for LLMClient.
// We exercise parseResponse() and the typed-error contract directly without
// hitting any provider.

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  LLMClient,
  NetworkError,
  APIError,
  StopReason,
  LLMResponse,
} from '../src/core/llm-client.js';
import { setTestFetch } from '../src/core/http.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function withFakeFetch<T>(
  handler: (req: { url: string; init: RequestInit }) => Response | Promise<Response>,
  run: () => Promise<T>,
): Promise<T> {
  setTestFetch((url, init) => Promise.resolve(handler({ url, init: init! })));
  return run().finally(() => setTestFetch(null));
}

describe('LLMClient stop-reason normalisation', () => {
  it('OpenAI-compat: finish_reason "stop" → stopReason "stop"', async () => {
    const c = new LLMClient();
    const result = await withFakeFetch(
      () => jsonResponse({
        choices: [{
          message: { content: 'all done' },
          finish_reason: 'stop',
        }],
      }),
      () => c.chat({
        model: { provider: 'openai', model: 'gpt-4', apiKey: 'sk-test' },
        systemPrompt: '',
        messages: [],
      }),
    );
    assert.equal(result.type, 'text');
    assert.equal(result.stopReason, 'stop' as StopReason);
  });

  it('OpenAI-compat: finish_reason "tool_calls" → stopReason "tool_calls"', async () => {
    const c = new LLMClient();
    const result = await withFakeFetch(
      () => jsonResponse({
        choices: [{
          message: {
            tool_calls: [{ function: { name: 'file_read', arguments: '{"path":"x"}' } }],
          },
          finish_reason: 'tool_calls',
        }],
      }),
      () => c.chat({
        model: { provider: 'openai', model: 'gpt-4', apiKey: 'sk-test' },
        systemPrompt: '',
        messages: [],
      }),
    );
    assert.equal(result.type, 'tool_use');
    assert.equal(result.stopReason, 'tool_calls' as StopReason);
    assert.equal(result.toolCalls?.length, 1);
  });

  it('OpenAI-compat: finish_reason "length" → stopReason "length"', async () => {
    const c = new LLMClient();
    const result = await withFakeFetch(
      () => jsonResponse({
        choices: [{ message: { content: 'truncated...' }, finish_reason: 'length' }],
      }),
      () => c.chat({
        model: { provider: 'openai', model: 'gpt-4', apiKey: 'sk-test' },
        systemPrompt: '',
        messages: [],
      }),
    );
    assert.equal(result.stopReason, 'length' as StopReason);
  });

  it('OpenAI-compat: missing finish_reason → stopReason "unknown"', async () => {
    const c = new LLMClient();
    const result = await withFakeFetch(
      () => jsonResponse({ choices: [{ message: { content: 'hi' } }] }),
      () => c.chat({
        model: { provider: 'openai', model: 'gpt-4', apiKey: 'sk-test' },
        systemPrompt: '',
        messages: [],
      }),
    );
    assert.equal(result.stopReason, 'unknown' as StopReason);
  });

  it('Anthropic: stop_reason "end_turn" → stopReason "stop"', async () => {
    const c = new LLMClient();
    const result = await withFakeFetch(
      () => jsonResponse({
        content: [{ type: 'text', text: 'all done' }],
        stop_reason: 'end_turn',
      }),
      () => c.chat({
        model: { provider: 'anthropic', model: 'claude-test', apiKey: 'sk-ant-test' },
        systemPrompt: '',
        messages: [],
      }),
    );
    assert.equal(result.type, 'text');
    assert.equal(result.stopReason, 'stop' as StopReason);
  });

  it('Anthropic: stop_reason "tool_use" → stopReason "tool_calls"', async () => {
    const c = new LLMClient();
    const result = await withFakeFetch(
      () => jsonResponse({
        content: [{ type: 'tool_use', name: 'file_read', input: { path: 'x' } }],
        stop_reason: 'tool_use',
      }),
      () => c.chat({
        model: { provider: 'anthropic', model: 'claude-test', apiKey: 'sk-ant-test' },
        systemPrompt: '',
        messages: [],
      }),
    );
    assert.equal(result.type, 'tool_use');
    assert.equal(result.stopReason, 'tool_calls' as StopReason);
  });

  it('Anthropic: stop_reason "max_tokens" → stopReason "length"', async () => {
    const c = new LLMClient();
    const result = await withFakeFetch(
      () => jsonResponse({
        content: [{ type: 'text', text: 'cut off' }],
        stop_reason: 'max_tokens',
      }),
      () => c.chat({
        model: { provider: 'anthropic', model: 'claude-test', apiKey: 'sk-ant-test' },
        systemPrompt: '',
        messages: [],
      }),
    );
    assert.equal(result.stopReason, 'length' as StopReason);
  });
});

describe('LLMClient typed errors', () => {
  it('throws NetworkError when fetch itself rejects', async () => {
    const c = new LLMClient();
    await assert.rejects(
      withFakeFetch(
        () => { throw new TypeError('fetch failed'); },
        () => c.chat({
          model: { provider: 'openai', model: 'gpt-4', apiKey: 'sk-test' },
          systemPrompt: '',
          messages: [],
        }),
      ),
      (err: unknown) => {
        assert.ok(err instanceof NetworkError, 'expected NetworkError');
        assert.match((err as Error).message, /Network error reaching/);
        return true;
      },
    );
  });

  it('throws APIError on non-OK HTTP, with status preserved', async () => {
    const c = new LLMClient();
    await assert.rejects(
      withFakeFetch(
        () => new Response('Unauthorized', { status: 401 }),
        () => c.chat({
          model: { provider: 'openai', model: 'gpt-4', apiKey: 'sk-test' },
          systemPrompt: '',
          messages: [],
        }),
      ),
      (err: unknown) => {
        assert.ok(err instanceof APIError, 'expected APIError');
        assert.equal((err as APIError).status, 401);
        assert.equal((err as APIError).isRetryable(), false);
        return true;
      },
    );
  });

  it('APIError.isRetryable true for 5xx and 429, false for 4xx (other)', () => {
    assert.equal(new APIError('x', 500).isRetryable(), true);
    assert.equal(new APIError('x', 502).isRetryable(), true);
    assert.equal(new APIError('x', 429).isRetryable(), true);
    assert.equal(new APIError('x', 401).isRetryable(), false);
    assert.equal(new APIError('x', 403).isRetryable(), false);
    assert.equal(new APIError('x', 404).isRetryable(), false);
    assert.equal(new APIError('x', 422).isRetryable(), false);
  });
});
