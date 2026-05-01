import { createHmac } from 'node:crypto';
import { ModelConfig, Message, ToolCall, ToolResult } from './types.js';

export interface LLMResponse {
  type: 'text' | 'tool_use' | 'follow_up';
  content?: string;
  reasoning?: string;
  /** Single-tool legacy shortcut. When present, also mirrored in toolCalls[0]. */
  toolCall?: ToolCall;
  /** All tool calls returned in this turn. Empty when type !== 'tool_use'. */
  toolCalls?: ToolCall[];
  followUpQuestion?: string;
}

export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required: string[];
    };
  };
}

export interface LLMClientOptions {
  model: ModelConfig;
  systemPrompt: string;
  messages: Array<{ role: string; content: string }>;
  maxTokens?: number;
  temperature?: number;
  tools?: OpenAITool[];
}

export interface LLMStreamChunk {
  type: 'reasoning' | 'content' | 'tool_call_start' | 'tool_call_delta' | 'done';
  text?: string;
  toolCall?: { id: string; name: string; argumentsDelta: string };
}

export class LLMClient {
  private providerUrls: Map<string, string> = new Map([
    ['anthropic', 'https://api.anthropic.com/v1/messages'],
    ['openai', 'https://api.openai.com/v1/chat/completions'],
    ['google', 'https://generativelanguage.googleapis.com/v1beta'],
    ['deepseek', 'https://api.deepseek.com/v1/chat/completions'],
    // Z.AI Coding endpoint (international). Uses straight Bearer auth — the
    // BigModel JWT-signing flow does NOT apply here. The /coding/paas/v4 path
    // is OpenAI-compatible (chat/completions, tools, streaming).
    ['zhipu', 'https://api.z.ai/api/coding/paas/v4/chat/completions'],
    ['copilot', 'https://api.githubcopilot.com/chat/completions'],
  ]);

  /** Resolve API key — for copilot we lazily fetch from the OAuth cache. */
  private async resolveApiKey(model: ModelConfig): Promise<string> {
    if (model.apiKey) return model.apiKey;
    if (model.provider === 'copilot') {
      const { getCopilotToken } = await import('./copilot-auth.js');
      return getCopilotToken();
    }
    const env = process.env[`${model.provider.toUpperCase()}_API_KEY`];
    if (!env) throw new Error(`No API key for provider: ${model.provider}. Set ${model.provider.toUpperCase()}_API_KEY in your .env or run \`insure-agent auth login\` for Copilot.`);
    return env;
  }

  async chat(opts: LLMClientOptions): Promise<LLMResponse> {
    const { model } = opts;
    const baseUrl = model.baseUrl
      ? (model.baseUrl.includes('/chat/completions') || model.baseUrl.includes('/v1/messages') ? model.baseUrl : model.baseUrl + '/chat/completions')
      : this.providerUrls.get(model.provider);
    if (!baseUrl) throw new Error(`Unknown provider: ${model.provider}`);

    const apiKey = await this.resolveApiKey(model);

    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: this.buildHeaders(model.provider, apiKey),
      body: JSON.stringify(this.buildBody(opts)),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`LLM API error (${response.status}): ${text}`);
    }

    const data = await response.json() as Record<string, unknown>;
    return this.parseResponse(model.provider, data);
  }

  async *chatStream(opts: LLMClientOptions): AsyncGenerator<LLMStreamChunk> {
    const { model } = opts;
    const baseUrl = model.baseUrl
      ? (model.baseUrl.includes('/chat/completions') || model.baseUrl.includes('/v1/messages') ? model.baseUrl : model.baseUrl + '/chat/completions')
      : this.providerUrls.get(model.provider);
    if (!baseUrl) throw new Error(`Unknown provider: ${model.provider}`);

    const apiKey = await this.resolveApiKey(model);

    const body = this.buildBody(opts);
    body.stream = true;
    body.stream_options = { include_usage: true };

    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: this.buildHeaders(model.provider, apiKey),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`LLM API error (${response.status}): ${text}`);
    }

    if (!response.body) {
      yield* this.fallbackNonStream(opts);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop()!;

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') {
            yield { type: 'done' };
            return;
          }
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta;
            if (!delta) continue;

            if (delta.reasoning_content) {
              yield { type: 'reasoning', text: delta.reasoning_content };
            }
            if (delta.content) {
              yield { type: 'content', text: delta.content };
            }
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                if (tc.function?.name) {
                  yield { type: 'tool_call_start', toolCall: { id: tc.id || `tc_${Date.now()}`, name: tc.function.name, argumentsDelta: '' } };
                }
                if (tc.function?.arguments) {
                  yield { type: 'tool_call_delta', toolCall: { id: '', name: '', argumentsDelta: tc.function.arguments } };
                }
              }
            }
          } catch {
            // Skip malformed SSE lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield { type: 'done' };
  }

  private async *fallbackNonStream(opts: LLMClientOptions): AsyncGenerator<LLMStreamChunk> {
    const resp = await this.chat(opts);
    if (resp.reasoning) yield { type: 'reasoning', text: resp.reasoning };
    if (resp.content) yield { type: 'content', text: resp.content };
    if (resp.toolCalls) {
      for (const tc of resp.toolCalls) {
        yield { type: 'tool_call_start', toolCall: { id: tc.id, name: tc.name, argumentsDelta: '' } };
        yield { type: 'tool_call_delta', toolCall: { id: '', name: '', argumentsDelta: JSON.stringify(tc.params) } };
      }
    }
    yield { type: 'done' };
  }

  private buildHeaders(provider: string, apiKey: string): Record<string, string> {
    if (provider === 'anthropic') {
      return {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      };
    }
    if (provider === 'zhipu') {
      // Z.AI Coding (api.z.ai): straight Bearer auth, no JWT signing.
      // (The legacy BigModel endpoint at open.bigmodel.cn required HMAC-signed
      // JWTs built from id.secret pairs; api.z.ai accepts the raw key.)
      return {
        'content-type': 'application/json',
        'authorization': `Bearer ${apiKey}`,
      };
    }
    if (provider === 'copilot') {
      return {
        'content-type': 'application/json',
        'authorization': `Bearer ${apiKey}`,
        'editor-version': 'vscode/1.95.0',
        'editor-plugin-version': 'copilot-chat/0.22.0',
        'copilot-integration-id': 'vscode-chat',
        'user-agent': 'GitHubCopilotChat/0.22.0',
        'openai-intent': 'conversation-panel',
      };
    }
    return {
      'content-type': 'application/json',
      'authorization': `Bearer ${apiKey}`,
    };
  }

  private generateZhipuToken(apiKey: string): string {
    const parts = apiKey.split('.');
    if (parts.length !== 2) return apiKey;
    const [id, secret] = parts;
    const now = Date.now();
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', sign_type: 'SIGN' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ api_key: id, exp: now + 3600 * 1000, timestamp: now })).toString('base64url');
    const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
    return `${header}.${payload}.${signature}`;
  }

  private buildBody(opts: LLMClientOptions): Record<string, unknown> {
    const { model, messages, maxTokens, temperature, tools } = opts;

    // GLM models share token budget between reasoning and content — needs a
    // much larger budget so long thinking doesn't starve the actual output.
    const defaultMaxTokens = model.provider === 'zhipu' ? 16384 : 4096;

    if (model.provider === 'anthropic') {
      return {
        model: model.model,
        max_tokens: maxTokens || defaultMaxTokens,
        system: opts.systemPrompt,
        messages: messages.map(m => ({ role: m.role === 'tool' ? 'user' : m.role, content: m.content })),
        temperature: temperature || 0.1,
      };
    }

    // OpenAI-compatible (OpenAI, DeepSeek, Google, Zhipu)
    const body: Record<string, unknown> = {
      model: model.model,
      max_tokens: maxTokens || defaultMaxTokens,
      messages: [
        { role: 'system', content: opts.systemPrompt },
        ...messages.map(m => ({ role: m.role === 'tool' ? 'assistant' : m.role, content: m.content })),
      ],
      temperature: temperature || 0.1,
    };

    if (tools && tools.length > 0) {
      body.tools = tools;
    }

    return body;
  }

  private parseResponse(provider: string, data: Record<string, unknown>): LLMResponse {
    if (provider === 'anthropic') {
      const content = data.content as Array<{ type: string; text?: string; name?: string; input?: Record<string, unknown> }>;
      if (!content || content.length === 0) {
        return { type: 'text', content: '(no response)' };
      }

      const toolUses = content.filter(c => c.type === 'tool_use');
      if (toolUses.length > 0) {
        const toolCalls: ToolCall[] = toolUses.map((tu, i) => ({
          id: `tc_${Date.now()}_${i}`,
          name: tu.name!,
          params: tu.input || {},
        }));
        return {
          type: 'tool_use',
          toolCall: toolCalls[0],
          toolCalls,
        };
      }

      return { type: 'text', content: content.map(c => c.text || '').join('\n') };
    }

    // OpenAI-compatible (OpenAI, DeepSeek, Google, Zhipu)
    const choices = data.choices as Array<{ message: { content?: string; reasoning_content?: string; tool_calls?: Array<{ function: { name: string; arguments: string } }> } }>;
    if (!choices || choices.length === 0) {
      return { type: 'text', content: '(no response)' };
    }

    const choice = choices[0];
    if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
      const toolCalls: ToolCall[] = choice.message.tool_calls.map((tc, i) => ({
        id: `tc_${Date.now()}_${i}`,
        name: tc.function.name,
        params: this.safeParseArgs(tc.function.arguments),
      }));
      return {
        type: 'tool_use',
        reasoning: choice.message.reasoning_content,
        toolCall: toolCalls[0],
        toolCalls,
      };
    }

    return {
      type: 'text',
      reasoning: choice.message.reasoning_content,
      content: choice.message.content || '',
    };
  }

  private safeParseArgs(args: string): Record<string, unknown> {
    if (!args) return {};
    try { return JSON.parse(args); } catch { return { _raw: args }; }
  }
}
