import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import appConfig from '../src/config/app.config';
import {
  CredentialCipherService,
  type EncryptedCredential,
} from '../src/security/credential-cipher.service';

type EnvelopeFields = {
  ciphertext: string | null;
  iv: string | null;
  authTag: string | null;
  keyVersion: number | null;
};

type AuditTarget = EnvelopeFields & {
  purpose: string;
};

const prisma = new PrismaClient();
const cipher = new CredentialCipherService(new ConfigService(appConfig()));

function envelope(fields: EnvelopeFields) {
  const values = [fields.ciphertext, fields.iv, fields.authTag, fields.keyVersion];
  if (values.every((value) => value == null)) return { state: 'empty' as const };
  if (values.some((value) => value == null)) return { state: 'partial' as const };
  return {
    state: 'complete' as const,
    value: fields as EncryptedCredential,
  };
}

function audit(targets: AuditTarget[], allowEmpty: boolean) {
  const result = { checkedRows: targets.length, emptyRows: 0, partialEnvelopeRows: 0, decryptFailures: 0 };
  for (const target of targets) {
    const candidate = envelope(target);
    if (candidate.state === 'empty') {
      result.emptyRows += 1;
      continue;
    }
    if (candidate.state === 'partial') {
      result.partialEnvelopeRows += 1;
      continue;
    }
    try {
      cipher.decrypt(candidate.value, target.purpose);
    } catch {
      result.decryptFailures += 1;
    }
  }
  const failures = result.partialEnvelopeRows + result.decryptFailures + (allowEmpty ? 0 : result.emptyRows);
  return { ...result, ok: failures === 0 };
}

async function main() {
  const [hydroRows, aiRows] = await Promise.all([
    prisma.hydroAccount.findMany({
      select: {
        loginPasswordCiphertext: true,
        loginPasswordIv: true,
        loginPasswordAuthTag: true,
        loginPasswordKeyVersion: true,
      },
    }),
    prisma.aiProviderConfig.findMany({
      select: {
        id: true,
        apiKeyCiphertext: true,
        apiKeyIv: true,
        apiKeyAuthTag: true,
        apiKeyKeyVersion: true,
      },
    }),
  ]);

  const hydro = audit(hydroRows.map((row) => ({
    ciphertext: row.loginPasswordCiphertext,
    iv: row.loginPasswordIv,
    authTag: row.loginPasswordAuthTag,
    keyVersion: row.loginPasswordKeyVersion,
    purpose: 'hydro-account',
  })), true);
  const ai = audit(aiRows.map((row) => ({
    ciphertext: row.apiKeyCiphertext,
    iv: row.apiKeyIv,
    authTag: row.apiKeyAuthTag,
    keyVersion: row.apiKeyKeyVersion,
    purpose: `ai-provider:${row.id}`,
  })), false);

  console.log(JSON.stringify({ hydro, ai }));
  if (!hydro.ok || !ai.ok) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Credential envelope verification failed.');
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
