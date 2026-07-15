import { BadGatewayException, BadRequestException, Injectable } from '@nestjs/common';
import type { LookupAddress } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

type AiCompletionRequest = {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  timeoutMs: number;
};

type AiCompletionResult = {
  content: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  durationMs: number;
};

@Injectable()
export class AiProviderGateway {
  validateBaseUrl(value: string) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new BadRequestException('AI Base URL 格式无效');
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new BadRequestException('AI Base URL 必须是无认证信息、查询参数和片段的 HTTPS 地址');
    }
    const hostname = url.hostname.toLowerCase();
    if (this.isBlockedHostname(hostname)) throw new BadRequestException('AI Base URL 不能指向本机或私有网络');
    return url.toString().replace(/\/+$/, '');
  }

  async complete(request: AiCompletionRequest): Promise<AiCompletionResult> {
    const baseUrl = this.validateBaseUrl(request.baseUrl);
    const hostname = new URL(baseUrl).hostname.replace(/^\[|\]$/g, '');
    const addresses = await this.resolveAddresses(hostname).catch(() => {
      throw new BadGatewayException('AI 服务域名解析失败');
    });
    if (!addresses.length || addresses.some(({ address }) => this.isBlockedHostname(address))) {
      throw new BadRequestException('AI Base URL 解析到了本机或私有网络');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
    const startedAt = Date.now();
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${request.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          model: request.model,
          messages: [
            { role: 'system', content: request.systemPrompt },
            { role: 'user', content: request.userPrompt },
          ],
          max_tokens: request.maxTokens,
          stream: false,
        }),
        redirect: 'error',
        signal: controller.signal,
      });
      const payload = await this.readJson(response);
      if (!response.ok) throw new BadGatewayException(this.providerError(payload, response.status));
      const body = this.record(payload);
      const choices = Array.isArray(body.choices) ? body.choices : [];
      const first = this.record(choices[0]);
      const message = this.record(first.message);
      const content = typeof message.content === 'string' ? message.content.trim() : '';
      if (!content) throw new BadGatewayException('AI 服务未返回文本内容');
      const usage = this.record(body.usage);
      return {
        content,
        usage: {
          promptTokens: Number(usage.prompt_tokens ?? 0),
          completionTokens: Number(usage.completion_tokens ?? 0),
          totalTokens: Number(usage.total_tokens ?? 0),
        },
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof BadGatewayException) throw error;
      if (error instanceof Error && error.name === 'AbortError') throw new BadGatewayException('AI 服务调用超时');
      throw new BadGatewayException('AI 服务连接失败');
    } finally {
      clearTimeout(timeout);
    }
  }

  private providerError(value: unknown, status: number) {
    void value;
    return `AI 服务返回 HTTP ${status}`;
  }

  protected resolveAddresses(hostname: string): Promise<LookupAddress[]> {
    return lookup(hostname, { all: true, verbatim: true });
  }

  private async readJson(response: Response): Promise<unknown> {
    const limit = 2 * 1024 * 1024;
    const declaredLength = Number(response.headers.get('content-length') ?? 0);
    if (declaredLength > limit) throw new BadGatewayException('AI 响应体过大');
    if (!response.body) return null;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new BadGatewayException('AI 响应体过大');
      }
      chunks.push(value);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch {
      return null;
    }
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  }

  private isBlockedHostname(hostname: string) {
    hostname = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) return true;
    if (!isIP(hostname)) return false;
    if (hostname === '::' || hostname === '::1' || hostname === '0.0.0.0') return true;
    if (hostname.startsWith('::ffff:')) return this.isBlockedHostname(hostname.slice('::ffff:'.length));
    if (hostname.startsWith('fc') || hostname.startsWith('fd') || /^fe[89ab]/.test(hostname)) return true;
    if (hostname.startsWith('10.') || hostname.startsWith('127.') || hostname.startsWith('169.254.') || hostname.startsWith('192.168.')) return true;
    const second = Number(hostname.split('.')[1]);
    return hostname.startsWith('172.') && second >= 16 && second <= 31;
  }
}
