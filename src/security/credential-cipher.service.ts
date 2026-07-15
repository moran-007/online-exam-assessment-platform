import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const AUTH_TAG_BYTES = 16;
const DEFAULT_PURPOSE = 'external-account-credential';

export type EncryptedCredential = {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
};

export class CredentialCipherError extends Error {
  constructor(message = 'Credential encryption operation failed.') {
    super(message);
    this.name = 'CredentialCipherError';
  }
}

function decodeKey(value: string, version: number) {
  let key: Buffer;
  try {
    key = Buffer.from(value, 'base64');
  } catch {
    throw new CredentialCipherError(`Credential key version ${version} is not valid base64.`);
  }
  if (key.length !== KEY_BYTES) {
    throw new CredentialCipherError(`Credential key version ${version} must decode to ${KEY_BYTES} bytes.`);
  }
  return key;
}

function parseKeys(raw: string | undefined) {
  if (!raw?.trim()) return new Map<number, Buffer>();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CredentialCipherError('CREDENTIAL_ENCRYPTION_KEYS must be a JSON object.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CredentialCipherError('CREDENTIAL_ENCRYPTION_KEYS must be a JSON object.');
  }

  const result = new Map<number, Buffer>();
  for (const [rawVersion, rawKey] of Object.entries(parsed)) {
    const version = Number(rawVersion);
    if (!Number.isInteger(version) || version <= 0 || typeof rawKey !== 'string') {
      throw new CredentialCipherError('Credential key versions must be positive integers with base64 values.');
    }
    result.set(version, decodeKey(rawKey, version));
  }
  return result;
}

function decodeEnvelopePart(value: string, label: string) {
  try {
    return Buffer.from(value, 'base64');
  } catch {
    throw new CredentialCipherError(`Credential ${label} is not valid base64.`);
  }
}

@Injectable()
export class CredentialCipherService {
  private readonly keys: Map<number, Buffer>;
  private readonly activeVersion: number;

  constructor(config: ConfigService) {
    const nodeEnv = config.get<string>('nodeEnv') ?? process.env.NODE_ENV ?? 'development';
    const rawKeys = config.get<string>('credentialEncryption.keys') ?? process.env.CREDENTIAL_ENCRYPTION_KEYS;
    this.keys = parseKeys(rawKeys);
    this.activeVersion = Number(
      config.get<number>('credentialEncryption.activeVersion') ??
        process.env.CREDENTIAL_ENCRYPTION_ACTIVE_VERSION ??
        1,
    );

    if (!this.keys.size && nodeEnv !== 'production') {
      // Development and tests remain runnable without distributing a shared real key.
      // Production validation rejects this fallback before the application starts.
      this.keys.set(1, createHash('sha256').update('development-only-credential-key').digest());
      this.activeVersion = 1;
    }

    if (!Number.isInteger(this.activeVersion) || !this.keys.has(this.activeVersion)) {
      throw new CredentialCipherError('The active credential encryption key version is not configured.');
    }
  }

  encrypt(plaintext: string, purpose = DEFAULT_PURPOSE): EncryptedCredential {
    if (!plaintext) throw new CredentialCipherError('Cannot encrypt an empty credential.');
    const key = this.keys.get(this.activeVersion);
    if (!key) throw new CredentialCipherError();

    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES });
    cipher.setAAD(this.additionalData(purpose, this.activeVersion));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      keyVersion: this.activeVersion,
    };
  }

  decrypt(envelope: EncryptedCredential, purpose = DEFAULT_PURPOSE) {
    const key = this.keys.get(envelope.keyVersion);
    if (!key) throw new CredentialCipherError('The credential key version is unavailable.');

    try {
      const iv = decodeEnvelopePart(envelope.iv, 'IV');
      const authTag = decodeEnvelopePart(envelope.authTag, 'authentication tag');
      const ciphertext = decodeEnvelopePart(envelope.ciphertext, 'ciphertext');
      if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES || !ciphertext.length) {
        throw new CredentialCipherError('The encrypted credential envelope is malformed.');
      }

      const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES });
      decipher.setAAD(this.additionalData(purpose, envelope.keyVersion));
      decipher.setAuthTag(authTag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch (error) {
      if (error instanceof CredentialCipherError) throw error;
      throw new CredentialCipherError('The encrypted credential could not be authenticated.');
    }
  }

  needsRotation(keyVersion: number) {
    return keyVersion !== this.activeVersion;
  }

  activeKeyVersion() {
    return this.activeVersion;
  }

  private additionalData(purpose: string, keyVersion: number) {
    return Buffer.from(`credential-envelope:${purpose}:v${keyVersion}`, 'utf8');
  }
}
