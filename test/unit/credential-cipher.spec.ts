import { ConfigService } from '@nestjs/config';
import {
  CredentialCipherError,
  CredentialCipherService,
} from '../../src/security/credential-cipher.service';

const firstKey = Buffer.from('first_credential_encryption_key1').toString('base64');
const secondKey = Buffer.from('second_credential_encryption_key').toString('base64');

function createCipher(activeVersion: number, keys: Record<string, string>) {
  return new CredentialCipherService(new ConfigService({
    nodeEnv: 'test',
    credentialEncryption: {
      activeVersion,
      keys: JSON.stringify(keys),
    },
  }));
}

describe('CredentialCipherService', () => {
  it('round-trips a credential without storing plaintext', () => {
    const cipher = createCipher(1, { 1: firstKey });
    const envelope = cipher.encrypt('external-password', 'hydro-account');

    expect(envelope.ciphertext).not.toContain('external-password');
    expect(envelope).toMatchObject({ keyVersion: 1 });
    expect(cipher.decrypt(envelope, 'hydro-account')).toBe('external-password');
  });

  it('rejects tampered authentication tags and a different purpose', () => {
    const cipher = createCipher(1, { 1: firstKey });
    const envelope = cipher.encrypt('external-password', 'hydro-account');
    const tampered = {
      ...envelope,
      authTag: Buffer.alloc(16, 1).toString('base64'),
    };

    expect(() => cipher.decrypt(tampered, 'hydro-account')).toThrow(CredentialCipherError);
    expect(() => cipher.decrypt(envelope, 'different-purpose')).toThrow(CredentialCipherError);
  });

  it('decrypts previous versions and reports that they need rotation', () => {
    const oldCipher = createCipher(1, { 1: firstKey });
    const envelope = oldCipher.encrypt('external-password', 'hydro-account');
    const rotatedCipher = createCipher(2, { 1: firstKey, 2: secondKey });

    expect(rotatedCipher.decrypt(envelope, 'hydro-account')).toBe('external-password');
    expect(rotatedCipher.needsRotation(envelope.keyVersion)).toBe(true);
    expect(rotatedCipher.encrypt('external-password').keyVersion).toBe(2);
  });

  it('rejects an unavailable key version', () => {
    const cipher = createCipher(1, { 1: firstKey });
    const envelope = { ...cipher.encrypt('external-password'), keyVersion: 99 };
    expect(() => cipher.decrypt(envelope)).toThrow(/unavailable/);
  });

  it('rejects empty credentials and malformed envelopes', () => {
    const cipher = createCipher(1, { 1: firstKey });
    expect(() => cipher.encrypt('')).toThrow('empty credential');
    expect(() => cipher.decrypt({
      ciphertext: '',
      iv: 'bad',
      authTag: 'bad',
      keyVersion: 1,
    })).toThrow(CredentialCipherError);
  });

  it('rejects invalid key configuration', () => {
    expect(() => createCipher(1, { 1: 'invalid' })).toThrow(/32 bytes/);
    expect(() => new CredentialCipherService(new ConfigService({
      nodeEnv: 'production',
      credentialEncryption: { activeVersion: 1, keys: '{}' },
    }))).toThrow(/active credential encryption key/);
  });
});
