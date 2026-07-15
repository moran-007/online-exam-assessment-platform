import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { DataScopeService } from '../data-scope/data-scope.service';
import { PrismaService } from '../prisma/prisma.service';
import { CredentialCipherService } from '../../security/credential-cipher.service';
import { MetricsService } from '../../observability/metrics.service';

@Injectable()
export class HydroContext {
  pollTimer?: ReturnType<typeof setInterval>;
  readonly hydroBotChallengeMessage =
    'Hydro 触发人机验证/机器人检测，系统不会绕过该验证。请先在浏览器打开对应 OJ 完成人工验证，或改用自建 Hydro 站点后重试。';

  constructor(
    readonly prisma: PrismaService,
    readonly audit: AuditService,
    readonly dataScope: DataScopeService,
    readonly credentialCipher: CredentialCipherService,
    readonly metrics: MetricsService,
  ) {}
}
