import { ModelConfig, Message, ToolCall, ToolResult } from './types.js';

export interface LLMResponse {
  type: 'text' | 'tool_use' | 'follow_up';
  content?: string;
  toolCall?: ToolCall;
  followUpQuestion?: string;
}

export interface LLMClientOptions {
  model: ModelConfig;
  systemPrompt: string;
  messages: Array<{ role: string; content: string }>;
  maxTokens?: number;
  temperature?: number;
}

export class LLMClient {
  private providerUrls: Map<string, string> = new Map([
    ['anthropic', 'https://api.anthropic.com/v1/messages'],
    ['openai', 'https://api.openai.com/v1/chat/completions'],
    ['google', 'https://generativelanguage.googleapis.com/v1beta'],
    ['deepseek', 'https://api.deepseek.com/v1/chat/completions'],
  ]);

  async chat(opts: LLMClientOptions): Promise<LLMResponse> {
    const { model } = opts;
    const baseUrl = model.baseUrl || this.providerUrls.get(model.provider);
    if (!baseUrl) throw new Error(`Unknown provider: ${model.provider}`);

    const apiKey = model.apiKey || process.env[`${model.provider.toUpperCase()}_API_KEY`];
    if (!apiKey) throw new Error(`No API key for provider: ${model.provider}`);

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

  private buildHeaders(provider: string, apiKey: string): Record<string, string> {
    if (provider === 'anthropic') {
      return {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      };
    }
    return {
      'content-type': 'application/json',
      'authorization': `Bearer ${apiKey}`,
    };
  }

  private buildBody(opts: LLMClientOptions): Record<string, unknown> {
    const { model, messages, maxTokens, temperature } = opts;

    if (model.provider === 'anthropic') {
      return {
        model: model.model,
        max_tokens: maxTokens || 4096,
        system: opts.systemPrompt,
        messages: messages.map(m => ({ role: m.role === 'tool' ? 'user' : m.role, content: m.content })),
        temperature: temperature || 0.1,
      };
    }

    // OpenAI-compatible (OpenAI, DeepSeek, Google)
    return {
      model: model.model,
      max_tokens: maxTokens || 4096,
      messages: [
        { role: 'system', content: opts.systemPrompt },
        ...messages.map(m => ({ role: m.role === 'tool' ? 'assistant' : m.role, content: m.content })),
      ],
      temperature: temperature || 0.1,
    };
  }

  private parseResponse(provider: string, data: Record<string, unknown>): LLMResponse {
    if (provider === 'anthropic') {
      const content = data.content as Array<{ type: string; text?: string; name?: string; input?: Record<string, unknown> }>;
      if (!content || content.length === 0) {
        return { type: 'text', content: '(no response)' };
      }

      const toolUse = content.find(c => c.type === 'tool_use');
      if (toolUse) {
        return {
          type: 'tool_use',
          toolCall: {
            id: `tc_${Date.now()}`,
            name: toolUse.name!,
            params: toolUse.input || {},
          },
        };
      }

      return { type: 'text', content: content.map(c => c.text || '').join('\n') };
    }

    // OpenAI-compatible
    const choices = data.choices as Array<{ message: { content?: string; tool_calls?: Array<{ function: { name: string; arguments: string } }> } }>;
    if (!choices || choices.length === 0) {
      return { type: 'text', content: '(no response)' };
    }

    const choice = choices[0];
    if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
      const tc = choice.message.tool_calls[0];
      return {
        type: 'tool_use',
        toolCall: {
          id: `tc_${Date.now()}`,
          name: tc.function.name,
          params: JSON.parse(tc.function.arguments),
        },
      };
    }

    return { type: 'text', content: choice.message.content || '' };
  }
}
