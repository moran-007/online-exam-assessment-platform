import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { OBJECT_STORAGE, type ObjectStorage } from '../../storage/object-storage.interface';
import { Inject } from '@nestjs/common';

export type ScratchRuntimeJob = {
  runId: string;
  idempotencyKey: string;
  workId: string;
  version: number;
  project: { objectKey: string; fileName: string; mimeType: string | null; fileSize: bigint };
  assignment: {
    id: string;
    title: string;
    maxScore: unknown;
    runtimeConfigJson: unknown;
    template: { runtimeProvider: string | null; runtimeProblemId: string | null; runtimeProblemUrl: string | null };
  };
};

export type ScratchRuntimeResult = {
  externalJobId: string;
  status: 'processing' | 'succeeded' | 'failed';
  score?: number;
  passed?: boolean;
  message?: string;
  result?: Record<string, unknown>;
};

export class ScratchRuntimeUnavailableError extends Error {}

@Injectable()
export class ScratchRuntimeAdapter {
  constructor(
    private readonly config: ConfigService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  enabled() {
    return Boolean(this.config.get<string>('scratchRuntime.baseUrl')?.trim());
  }

  async submit(job: ScratchRuntimeJob): Promise<ScratchRuntimeResult> {
    const baseUrl = this.config.get<string>('scratchRuntime.baseUrl')?.trim();
    if (!baseUrl) throw new ScratchRuntimeUnavailableError('Scratch 外部运行时未配置，作品已安全保存在主平台');
    const endpoint = new URL(this.config.get<string>('scratchRuntime.submitPath') || '/api/scratch/judge', baseUrl);
    const project = await this.readProject(job.project.objectKey, Number(job.project.fileSize));
    const form = new FormData();
    form.set('project', new Blob([project], { type: job.project.mimeType || 'application/x.scratch.sb3' }), job.project.fileName);
    form.set('metadata', JSON.stringify({
      runId: job.runId,
      workId: job.workId,
      version: job.version,
      assignmentId: job.assignment.id,
      assignmentTitle: job.assignment.title,
      maxScore: Number(job.assignment.maxScore),
      provider: job.assignment.template.runtimeProvider,
      problemId: job.assignment.template.runtimeProblemId,
      problemUrl: job.assignment.template.runtimeProblemUrl,
      judgeConfig: job.assignment.runtimeConfigJson,
      callbackUrl: this.config.get<string>('scratchRuntime.callbackUrl') || null,
    }));
    const token = this.config.get<string>('scratchRuntime.apiToken')?.trim();
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Idempotency-Key': job.idempotencyKey,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: form,
      signal: AbortSignal.timeout(this.config.get<number>('scratchRuntime.timeoutMs') ?? 10_000),
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      const message = typeof payload.message === 'string' ? payload.message : `HTTP ${response.status}`;
      throw new ScratchRuntimeUnavailableError(`Scratch 外部运行时拒绝任务：${message.slice(0, 300)}`);
    }
    const externalJobId = String(payload.externalJobId ?? payload.jobId ?? '').trim();
    if (!externalJobId) throw new ScratchRuntimeUnavailableError('Scratch 外部运行时未返回任务编号');
    const status = ['succeeded', 'failed'].includes(String(payload.status))
      ? String(payload.status) as 'succeeded' | 'failed'
      : 'processing';
    return {
      externalJobId,
      status,
      score: this.number(payload.score),
      passed: typeof payload.passed === 'boolean' ? payload.passed : undefined,
      message: typeof payload.message === 'string' ? payload.message.slice(0, 4_000) : undefined,
      result: this.record(payload.result),
    };
  }

  verifyCallback(rawBody: Buffer, signature: string | undefined) {
    const secret = this.config.get<string>('scratchRuntime.callbackSecret')?.trim();
    if (!secret) return false;
    const supplied = signature?.replace(/^sha256=/i, '').trim();
    if (!supplied || !/^[a-f0-9]{64}$/i.test(supplied)) return false;
    const expected = createHmac('sha256', secret).update(rawBody).digest();
    return timingSafeEqual(expected, Buffer.from(supplied, 'hex'));
  }

  callbackTimeoutMs() {
    return this.config.get<number>('scratchRuntime.callbackTimeoutMs') ?? 300_000;
  }

  pollIntervalMs() {
    return this.config.get<number>('scratchRuntime.pollIntervalMs') ?? 5_000;
  }

  private async readProject(key: string, declaredSize: number) {
    if (declaredSize > 50 * 1024 * 1024) throw new ScratchRuntimeUnavailableError('Scratch 项目超过运行时发送上限');
    const stream = await this.storage.open(key);
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > 50 * 1024 * 1024) throw new ScratchRuntimeUnavailableError('Scratch 项目读取大小异常');
      chunks.push(buffer);
    }
    if (size !== declaredSize) throw new ScratchRuntimeUnavailableError('Scratch 项目对象大小校验失败');
    return Buffer.concat(chunks);
  }

  private number(value: unknown) {
    const result = Number(value);
    return Number.isFinite(result) ? result : undefined;
  }

  private record(value: unknown) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  }
}
