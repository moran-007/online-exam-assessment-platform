import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { AiProviderGateway } from '../../src/modules/ai/ai-provider.gateway';

describe('AiProviderGateway', () => {
  class PublicNetworkGateway extends AiProviderGateway {
    protected override async resolveAddresses() {
      return [{ address: '203.0.113.10', family: 4 }];
    }
  }

  const gateway = new PublicNetworkGateway();
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('rejects insecure and private-network endpoints', () => {
    expect(() => gateway.validateBaseUrl('http://api.example.com/v1')).toThrow(BadRequestException);
    expect(() => gateway.validateBaseUrl('https://127.0.0.1/v1')).toThrow('私有网络');
    expect(() => gateway.validateBaseUrl('https://user:password@example.com/v1')).toThrow(BadRequestException);
  });

  it('rejects hostnames that resolve to a private address before sending', async () => {
    class PrivateNetworkGateway extends AiProviderGateway {
      protected override async resolveAddresses() {
        return [{ address: '127.0.0.1', family: 4 }];
      }
    }
    global.fetch = jest.fn();
    await expect(new PrivateNetworkGateway().complete({
      baseUrl: 'https://ai.internal.example/v1', apiKey: 'secret-key', model: 'model-a',
      systemPrompt: 'system', userPrompt: 'content', maxTokens: 4, timeoutMs: 3000,
    })).rejects.toThrow('私有网络');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('sends a bounded OpenAI-compatible request and extracts usage', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '简短总结' } }],
      usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const result = await gateway.complete({
      baseUrl: 'https://api.example.com/v1/', apiKey: 'secret-key', model: 'model-a',
      systemPrompt: 'system', userPrompt: 'content', maxTokens: 8, timeoutMs: 3000,
    });
    expect(result.content).toBe('简短总结');
    expect(result.usage).toMatchObject({ totalTokens: 13, reported: true });
    const [, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(options.body).toContain('"max_tokens":8');
    expect(options.headers.Authorization).toBe('Bearer secret-key');
  });

  it('normalizes missing or undersized provider total token counts', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: 'OK' } }],
      usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 2 },
    }), { status: 200 }));
    await expect(gateway.complete({
      baseUrl: 'https://api.example.com/v1', apiKey: 'secret-key', model: 'model-a',
      systemPrompt: 'system', userPrompt: 'content', maxTokens: 8, timeoutMs: 3000,
    })).resolves.toMatchObject({ usage: { promptTokens: 10, completionTokens: 3, totalTokens: 13 } });
  });

  it('marks token usage unreported when the provider omits it', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: 'OK' } }],
    }), { status: 200 }));
    await expect(gateway.complete({
      baseUrl: 'https://api.example.com/v1', apiKey: 'secret-key', model: 'model-a',
      systemPrompt: 'system', userPrompt: 'content', maxTokens: 8, timeoutMs: 3000,
    })).resolves.toMatchObject({
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, reported: false },
    });
  });

  it('does not expose a raw provider response when parsing fails', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response('not-json-with-secret', { status: 502 }));
    await expect(gateway.complete({
      baseUrl: 'https://api.example.com/v1', apiKey: 'secret-key', model: 'model-a',
      systemPrompt: 'system', userPrompt: 'content', maxTokens: 4, timeoutMs: 3000,
    })).rejects.toEqual(expect.any(BadGatewayException));
    await gateway.complete({
      baseUrl: 'https://api.example.com/v1', apiKey: 'secret-key', model: 'model-a',
      systemPrompt: 'system', userPrompt: 'content', maxTokens: 4, timeoutMs: 3000,
    }).catch((error: Error) => expect(error.message).not.toContain('secret'));
  });

  it('accepts an empty successful response only for a connection probe', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), { status: 200 }));
    const request = {
      baseUrl: 'https://api.example.com/v1', apiKey: 'secret-key', model: 'model-a',
      systemPrompt: 'system', userPrompt: 'content', maxTokens: 4, timeoutMs: 3000,
    };
    await expect(gateway.complete(request)).rejects.toThrow('未返回文本内容');
    await expect(gateway.complete({ ...request, allowEmptyContent: true })).resolves.toMatchObject({ content: '' });
  });
});
