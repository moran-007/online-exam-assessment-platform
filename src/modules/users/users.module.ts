import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { RoleManagementUseCases } from './commands/role-management.use-cases';
import { UserAccountUseCases } from './commands/user-account.use-cases';
import { UserProvisioningUseCases } from './commands/user-provisioning.use-cases';
import { UserDirectoryQueries } from './queries/user-directory.queries';
import { UserIdentityReader } from './queries/user-identity.reader';
import { UserSupportOperations } from './user-support.operations';
import { UsersController } from './users.controller';

@Module({
  imports: [AuditModule],
  controllers: [UsersController],
  providers: [
    UserSupportOperations,
    UserIdentityReader,
    UserDirectoryQueries,
    UserAccountUseCases,
    UserProvisioningUseCases,
    RoleManagementUseCases,
  ],
  exports: [UserIdentityReader],
})
export class UsersModule {}
