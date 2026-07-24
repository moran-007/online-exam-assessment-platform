import {
  getAiUserSeedPermissionCodes,
  permissions,
} from '../../prisma/seed';
import { syncPermissions } from '../../scripts/sync-permissions';

describe('permission catalog synchronization', () => {
  it('preserves disabled AI permissions when seed reruns and only grants newly registered reads', () => {
    const allCodes = ['course:read', 'new-module:read', 'course:update'];

    expect(getAiUserSeedPermissionCodes(
      allCodes,
      new Set(['course:read']),
    )).toEqual(['new-module:read']);
    expect(getAiUserSeedPermissionCodes(allCodes, new Set()))
      .toEqual(['course:read', 'new-module:read']);
  });

  function createClient(
    superAdminRole: { id: string } | null = { id: 'super-admin-role' },
    aiUserRole: { id: string } | null = null,
    _existingPermissionCodes: string[] = [],
  ) {
    const tx = {
      permission: {
        upsert: jest.fn().mockResolvedValue(undefined),
        findMany: jest.fn()
          .mockResolvedValue(permissions.map(([code]) => ({ id: `permission:${code}`, code }))),
      },
      role: {
        findUnique: jest.fn(({ where }: { where: { code: string } }) =>
          Promise.resolve(where.code === 'super_admin' ? superAdminRole : aiUserRole)),
        upsert: jest.fn().mockResolvedValue({ id: aiUserRole?.id ?? 'ai-user-role' }),
      },
      rolePermission: {
        createMany: jest.fn().mockResolvedValue({ count: permissions.length }),
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      aiUserPermissionExclusion: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const client = {
      $transaction: jest.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)),
    };
    return { client, tx };
  }

  it('upserts every registered permission and grants all of them to the super administrator', async () => {
    const { client, tx } = createClient();

    await syncPermissions(client as never);

    expect(tx.permission.upsert).toHaveBeenCalledTimes(permissions.length);
    expect(tx.rolePermission.createMany).toHaveBeenCalledWith({
      data: permissions.map(([code]) => ({
        roleId: 'super-admin-role',
        permissionId: `permission:${code}`,
      })),
      skipDuplicates: true,
    });
  });

  it('creates the protected AI user role and grants all readable permissions by default', async () => {
    const { client, tx } = createClient();

    await syncPermissions(client as never);

    expect(tx.role.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { code: 'ai_user' },
      create: expect.objectContaining({ code: 'ai_user', name: 'AI 用户' }),
    }));
    expect(tx.rolePermission.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([
        { roleId: 'ai-user-role', permissionId: 'permission:lesson-plan:read' },
        { roleId: 'ai-user-role', permissionId: 'permission:ai.data.lesson-plans' },
        { roleId: 'ai-user-role', permissionId: 'permission:ai.summary.view-own' },
        { roleId: 'ai-user-role', permissionId: 'permission:ai.summary.view-class' },
      ]),
    }));
    expect(tx.rolePermission.deleteMany).toHaveBeenCalledWith({
      where: {
        roleId: 'ai-user-role',
        permissionId: {
          in: expect.arrayContaining([
            'permission:lesson-plan:manage',
            'permission:ai.user.manage',
          ]),
        },
      },
    });
  });

  it('can initialize the permission catalog before the super administrator role exists', async () => {
    const { client, tx } = createClient(null);

    await syncPermissions(client as never);

    expect(tx.permission.upsert).toHaveBeenCalledTimes(permissions.length);
    expect(tx.rolePermission.createMany).toHaveBeenCalledTimes(1);
  });

  it('does not reopen an existing readable permission that an administrator disabled', async () => {
    const allCodes = permissions.map(([code]) => code);
    const { client, tx } = createClient(
      { id: 'super-admin-role' },
      { id: 'ai-user-role' },
      [...allCodes],
    );
    tx.aiUserPermissionExclusion.findMany.mockResolvedValue([
      { permissionId: 'permission:lesson-plan:read' },
    ]);

    await syncPermissions(client as never);

    const aiRoleCall = tx.rolePermission.createMany.mock.calls
      .map(([argument]) => argument)
      .find(({ data }) => data.some(({ roleId }: { roleId: string }) => roleId === 'ai-user-role'));
    expect(aiRoleCall.data).not.toContainEqual({
      roleId: 'ai-user-role',
      permissionId: 'permission:lesson-plan:read',
    });
    expect(tx.rolePermission.deleteMany).toHaveBeenCalledWith({
      where: {
        roleId: 'ai-user-role',
        permissionId: {
          in: expect.arrayContaining(['permission:lesson-plan:read']),
        },
      },
    });
  });

  it('backfills lesson-plan permissions for human roles that had the legacy lesson-record permissions', async () => {
    const { client, tx } = createClient(
      { id: 'super-admin-role' },
      { id: 'ai-user-role' },
      permissions.map(([code]) => code),
    );
    tx.rolePermission.findMany.mockImplementation(
      ({ where }: { where: { permissionId: string } }) => Promise.resolve(
        where.permissionId === 'permission:lesson-record:read'
          ? [{ roleId: 'teacher-role' }]
          : [{ roleId: 'admin-role' }],
      ),
    );

    await syncPermissions(client as never);

    expect(tx.rolePermission.createMany).toHaveBeenCalledWith({
      data: [{ roleId: 'teacher-role', permissionId: 'permission:lesson-plan:read' }],
      skipDuplicates: true,
    });
    expect(tx.rolePermission.createMany).toHaveBeenCalledWith({
      data: [{ roleId: 'admin-role', permissionId: 'permission:lesson-plan:manage' }],
      skipDuplicates: true,
    });
    expect(tx.rolePermission.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        role: { code: { not: 'ai_user' } },
      }),
    }));
  });
});
