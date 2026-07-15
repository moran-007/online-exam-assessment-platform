import { ConfigService } from '@nestjs/config';
import { PrismaClient, type HydroAccount } from '@prisma/client';
import appConfig from '../src/config/app.config';
import {
  CredentialCipherService,
  type EncryptedCredential,
} from '../src/security/credential-cipher.service';

const prisma = new PrismaClient();
const cipher = new CredentialCipherService(new ConfigService(appConfig()));
const dryRun = process.argv.includes('--dry-run');
const verifyOnly = process.argv.includes('--verify');
const batchSize = 100;

type CredentialRow = Pick<
  HydroAccount,
  | 'id'
  | 'loginPasswordCiphertext'
  | 'loginPasswordIv'
  | 'loginPasswordAuthTag'
  | 'loginPasswordKeyVersion'
>;

function encryptedEnvelope(row: CredentialRow): EncryptedCredential | null {
  const values = [
    row.loginPasswordCiphertext,
    row.loginPasswordIv,
    row.loginPasswordAuthTag,
    row.loginPasswordKeyVersion,
  ];
  if (values.every((value) => value == null)) return null;
  if (values.some((value) => value == null)) {
    throw new Error(`Hydro account ${row.id} has an incomplete encrypted credential envelope.`);
  }
  return {
    ciphertext: row.loginPasswordCiphertext as string,
    iv: row.loginPasswordIv as string,
    authTag: row.loginPasswordAuthTag as string,
    keyVersion: row.loginPasswordKeyVersion as number,
  };
}

function encryptedData(credential: EncryptedCredential) {
  return {
    loginPasswordCiphertext: credential.ciphertext,
    loginPasswordIv: credential.iv,
    loginPasswordAuthTag: credential.authTag,
    loginPasswordKeyVersion: credential.keyVersion,
  };
}

async function verify() {
  const [rows, partialRows] = await Promise.all([
    prisma.hydroAccount.findMany({
      select: {
        id: true,
        loginPasswordCiphertext: true,
        loginPasswordIv: true,
        loginPasswordAuthTag: true,
        loginPasswordKeyVersion: true,
      },
    }),
    prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM hydro_accounts
      WHERE num_nonnulls(
        login_password_ciphertext,
        login_password_iv,
        login_password_auth_tag,
        login_password_key_version
      ) NOT IN (0, 4)
      LIMIT 20
    `,
  ]);
  let decryptFailures = 0;
  for (const row of rows) {
    const envelope = encryptedEnvelope(row);
    if (!envelope) continue;
    try {
      cipher.decrypt(envelope, 'hydro-account');
    } catch {
      decryptFailures += 1;
    }
  }
  const result = { checkedRows: rows.length, partialEnvelopeRows: partialRows.length, decryptFailures };
  console.log(JSON.stringify(result));
  if (partialRows.length || decryptFailures) process.exitCode = 1;
  return result;
}

async function migrate() {
  let cursor: string | undefined;
  let scanned = 0;
  let migrated = 0;
  let rotated = 0;

  while (true) {
    const rows = await prisma.hydroAccount.findMany({
      take: batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: {
        id: true,
        loginPasswordCiphertext: true,
        loginPasswordIv: true,
        loginPasswordAuthTag: true,
        loginPasswordKeyVersion: true,
      },
    });
    if (!rows.length) break;
    cursor = rows.at(-1)?.id;
    scanned += rows.length;

    const updates: Array<{ id: string; data: ReturnType<typeof encryptedData>; kind: 'repair' | 'rotate' }> = [];
    for (const row of rows) {
      const currentEnvelope = encryptedEnvelope(row);
      if (!currentEnvelope) continue;
      let plaintext: string;
      let legacyPurpose = false;
      try {
        plaintext = cipher.decrypt(currentEnvelope, 'hydro-account');
      } catch {
        plaintext = cipher.decrypt(currentEnvelope);
        legacyPurpose = true;
      }
      if (legacyPurpose || cipher.needsRotation(currentEnvelope.keyVersion)) {
        updates.push({
          id: row.id,
          data: encryptedData(cipher.encrypt(plaintext, 'hydro-account')),
          kind: legacyPurpose ? 'repair' : 'rotate',
        });
      }
    }

    if (!dryRun && updates.length) {
      await prisma.$transaction(
        updates.map((update) => prisma.hydroAccount.update({ where: { id: update.id }, data: update.data })),
      );
    }
    migrated += updates.filter((update) => update.kind === 'repair').length;
    rotated += updates.filter((update) => update.kind === 'rotate').length;
  }

  console.log(JSON.stringify({ dryRun, scanned, migrated, rotated, activeKeyVersion: cipher.activeKeyVersion() }));
  if (!dryRun) await verify();
}

async function main() {
  if (verifyOnly) await verify();
  else await migrate();
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Hydro credential migration failed.');
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
