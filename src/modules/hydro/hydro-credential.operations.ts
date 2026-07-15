import { InternalServerErrorException } from '@nestjs/common';
import type { HydroAccount } from '@prisma/client';
import type { EncryptedCredential } from '../../security/credential-cipher.service';
import type { HydroContext } from './hydro.context';

type HydroCredentialFields = Pick<
  HydroAccount,
  | 'loginPasswordCiphertext'
  | 'loginPasswordIv'
  | 'loginPasswordAuthTag'
  | 'loginPasswordKeyVersion'
>;

function envelope(account: HydroCredentialFields): EncryptedCredential | null {
  const values = [
    account.loginPasswordCiphertext,
    account.loginPasswordIv,
    account.loginPasswordAuthTag,
    account.loginPasswordKeyVersion,
  ];
  if (values.every((value) => value == null)) return null;
  if (values.some((value) => value == null)) {
    throw new InternalServerErrorException('外部账号凭据不完整，请重新绑定');
  }
  return {
    ciphertext: account.loginPasswordCiphertext as string,
    iv: account.loginPasswordIv as string,
    authTag: account.loginPasswordAuthTag as string,
    keyVersion: account.loginPasswordKeyVersion as number,
  };
}

export function hasHydroCredential(account: HydroCredentialFields) {
  const encrypted = [
    account.loginPasswordCiphertext,
    account.loginPasswordIv,
    account.loginPasswordAuthTag,
    account.loginPasswordKeyVersion,
  ];
  return encrypted.every((value) => value != null);
}

export function encryptHydroPassword(ctx: HydroContext, plaintext: string) {
  const encrypted = ctx.credentialCipher.encrypt(plaintext, 'hydro-account');
  return {
    loginPasswordCiphertext: encrypted.ciphertext,
    loginPasswordIv: encrypted.iv,
    loginPasswordAuthTag: encrypted.authTag,
    loginPasswordKeyVersion: encrypted.keyVersion,
  };
}

export async function resolveHydroPassword(ctx: HydroContext, account: HydroAccount) {
  try {
    const encrypted = envelope(account);
    if (encrypted) {
      const plaintext = ctx.credentialCipher.decrypt(encrypted, 'hydro-account');
      if (ctx.credentialCipher.needsRotation(encrypted.keyVersion)) {
        await ctx.prisma.hydroAccount.update({
          where: { id: account.id },
          data: encryptHydroPassword(ctx, plaintext),
        });
      }
      return plaintext;
    }
  } catch (error) {
    if (error instanceof InternalServerErrorException) throw error;
    throw new InternalServerErrorException('外部账号凭据无法解密，请重新绑定');
  }
  throw new InternalServerErrorException('外部账号缺少登录凭据，请重新绑定');
}
