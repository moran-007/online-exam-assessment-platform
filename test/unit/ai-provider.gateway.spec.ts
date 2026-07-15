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
    expect(result.usage.totalTokens).toBe(13);
    const [, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(options.body).toContain('"max_tokens":8');
    expect(options.headers.Authorization).toBe('Bearer secret-key');
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
});
