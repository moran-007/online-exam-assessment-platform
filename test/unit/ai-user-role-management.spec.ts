import * as bcrypt from 'bcryptjs';
import { AiUserPermissionService } from '../../src/modules/ai/ai-user-permission.service';
import { RoleManagementUseCases } from '../../src/modules/users/commands/role-management.use-cases';

describe('AI user role management', () => {
  const actor = {
    id: '00000000-0000-4000-8000-000000000001',
    username: 'admin',
    realName: '管理员',
    userType: 'SUPER_ADMIN',
    roles: ['super_admin'],
    permissions: ['ai.user.manage'],
  };

  async function fixture() {
    const passwordHash = await bcrypt.hash('admin-password', 4);
    const transaction = {
      aiUserPermissionExclusion: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      user: {
        findFirst: jest.fn().mockResolvedValue({ id: actor.id, passwordHash }),
      },
      role: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'ai-user-role',
          name: 'AI 用户',
          code: 'ai_user',
        }),
      },
      permission: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'lesson-plan-read', code: 'lesson-plan:read' },
          { id: 'course-read', code: 'course:read' },
          { id: 'lesson-plan-manage', code: 'lesson-plan:manage' },
        ]),
      },
      $transaction: jest.fn((callback) => callback(transaction)),
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const support = {
      uniqueIds: (ids: string[]) => [...new Set(ids)],
      syncRolePermissions: jest.fn().mockResolvedValue(undefined),
      getRoleOrThrow: jest.fn().mockResolvedValue({ id: 'ai-user-role', code: 'ai_user' }),
    };
    return {
      service: new RoleManagementUseCases(prisma as never, audit as never, support as never),
      prisma,
      transaction,
      audit,
      support,
    };
  }

  it('rejects an AI user permission change when the administrator password is wrong', async () => {
    const { service, support } = await fixture();

    await expect((service as any).updateAiUserPermissions({
      password: 'wrong-password',
      permissionIds: ['lesson-plan-read'],
    }, actor)).rejects.toThrow('当前密码不正确');
    expect(support.syncRolePermissions).not.toHaveBeenCalled();
  });

  it('accepts only readable permissions after verifying the administrator password', async () => {
    const { service, support, audit, transaction } = await fixture();

    await expect((service as any).updateAiUserPermissions({
      password: 'admin-password',
      permissionIds: ['lesson-plan-read', 'lesson-plan-manage'],
    }, actor)).resolves.toMatchObject({ code: 'ai_user' });

    expect(support.syncRolePermissions).toHaveBeenCalledWith(
      transaction,
      'ai-user-role',
      ['lesson-plan-read'],
    );
    expect(transaction.aiUserPermissionExclusion.createMany).toHaveBeenCalledWith({
      data: [{
        permissionId: 'course-read',
        updatedBy: actor.id,
      }],
      skipDuplicates: true,
    });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ai-user:update-permissions',
      targetId: 'ai-user-role',
    }));
  });

  it('subtracts persisted exclusions from the AI runtime permission upper bound', async () => {
    const prisma = {
      role: {
        findUnique: jest.fn().mockResolvedValue({
          status: 'ACTIVE',
          permissions: [
            { permission: { code: 'course:read' } },
            { permission: { code: 'lesson-plan:read' } },
            { permission: { code: 'lesson-plan:manage' } },
          ],
        }),
      },
      aiUserPermissionExclusion: {
        findMany: jest.fn().mockResolvedValue([
          { permission: { code: 'lesson-plan:read' } },
        ]),
      },
    };

    await expect(new AiUserPermissionService(prisma as never).codes())
      .resolves.toEqual(new Set(['course:read']));
  });
});
