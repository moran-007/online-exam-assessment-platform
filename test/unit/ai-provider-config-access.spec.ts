import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AiProviderConfigScope } from '@prisma/client';
import { AiProviderConfigAccessService } from '../../src/modules/ai/ai-provider-config-access.service';

describe('AiProviderConfigAccessService', () => {
  const teacher = {
    id: '00000000-0000-0000-0000-000000000001', username: 'teacher', realName: 'Teacher',
    userType: 'TEACHER', roles: ['teacher'], permissions: [],
  };
  const admin = { ...teacher, id: '00000000-0000-0000-0000-000000000002', userType: 'SUPER_ADMIN' };
  const now = new Date('2026-07-16T00:00:00.000Z');

  it('prefers the current user personal default over a system default', async () => {
    const findMany = jest.fn().mockResolvedValue([
      config('system', AiProviderConfigScope.SYSTEM, null, true, now),
      config('personal', AiProviderConfigScope.PERSONAL, teacher.id, true, now),
    ]);
    const service = new AiProviderConfigAccessService({ aiProviderConfig: { findMany } } as never);
    await expect(service.resolve(teacher)).resolves.toMatchObject({ id: 'personal' });
    expect(findMany).toHaveBeenCalledWith({ where: {
      enabled: true,
      OR: [
        { scope: AiProviderConfigScope.SYSTEM },
        { scope: AiProviderConfigScope.PERSONAL, ownerUserId: teacher.id },
      ],
    } });
  });

  it('allows only super administrators to create system shared configs', () => {
    const service = new AiProviderConfigAccessService({} as never);
    expect(service.createOwnership(undefined, teacher)).toEqual({
      scope: AiProviderConfigScope.PERSONAL, ownerUserId: teacher.id,
    });
    expect(service.createOwnership('system', admin)).toEqual({
      scope: AiProviderConfigScope.SYSTEM, ownerUserId: null,
    });
    expect(() => service.createOwnership('system', teacher)).toThrow(ForbiddenException);
  });

  it('hides another user personal config instead of leaking its existence', async () => {
    const service = new AiProviderConfigAccessService({
      aiProviderConfig: { findUnique: jest.fn().mockResolvedValue(
        config('private', AiProviderConfigScope.PERSONAL, 'another-user', false, now),
      ) },
    } as never);
    await expect(service.requireManageable('private', teacher)).rejects.toBeInstanceOf(NotFoundException);
  });
});

function config(
  id: string,
  scope: AiProviderConfigScope,
  ownerUserId: string | null,
  isDefault: boolean,
  createdAt: Date,
) {
  return { id, scope, ownerUserId, isDefault, createdAt };
}
