import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { BatchCreateStudentsDto, BatchCreateTeachersDto, CreateStudentDto } from './dto/batch-create-students.dto';
import {
  ChangeOwnPasswordDto,
  CreateManagedUserDto,
  ListManagedUsersQueryDto,
  ResetManagedUserPasswordDto,
  SaveRoleDto,
  UpdateManagedUserDto,
  UpdateRolePermissionsDto,
} from './dto/manage-users.dto';
import { RoleManagementUseCases } from './commands/role-management.use-cases';
import { UserAccountUseCases } from './commands/user-account.use-cases';
import { UserProvisioningUseCases } from './commands/user-provisioning.use-cases';
import { UserDirectoryQueries } from './queries/user-directory.queries';

@ApiTags('User')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(
    private readonly directory: UserDirectoryQueries,
    private readonly accounts: UserAccountUseCases,
    private readonly provisioning: UserProvisioningUseCases,
    private readonly roleUseCases: RoleManagementUseCases,
  ) {}

  @Get('students')
  @Permissions('exam:read')
  students() {
    return this.directory.listStudents();
  }

  @Post('students')
  @Roles('SUPER_ADMIN', 'ADMIN', 'TEACHER')
  createStudent(@Body() dto: CreateStudentDto, @CurrentUser() user: RequestUser) {
    return this.provisioning.createStudent(dto, user);
  }

  @Post('students/batch')
  @Roles('SUPER_ADMIN', 'ADMIN', 'TEACHER')
  batchCreateStudents(@Body() dto: BatchCreateStudentsDto, @CurrentUser() user: RequestUser) {
    return this.provisioning.batchCreateStudents(dto, user);
  }

  @Get('teachers')
  @Permissions('class:read')
  teachers() {
    return this.directory.listTeachers();
  }

  @Post('teachers')
  @Roles('SUPER_ADMIN', 'ADMIN')
  createTeacher(@Body() dto: CreateStudentDto, @CurrentUser() user: RequestUser) {
    return this.provisioning.createTeacher(dto, user);
  }

  @Post('teachers/batch')
  @Roles('SUPER_ADMIN', 'ADMIN')
  batchCreateTeachers(@Body() dto: BatchCreateTeachersDto, @CurrentUser() user: RequestUser) {
    return this.provisioning.batchCreateTeachers(dto, user);
  }

  @Get()
  @Roles('SUPER_ADMIN')
  users(@Query() query: ListManagedUsersQueryDto) {
    return this.directory.listManagedUsers(query);
  }

  @Post()
  @Roles('SUPER_ADMIN')
  createUser(@Body() dto: CreateManagedUserDto, @CurrentUser() user: RequestUser) {
    return this.accounts.createManagedUser(dto, user);
  }

  @Post('me/password')
  changeOwnPassword(@Body() dto: ChangeOwnPasswordDto, @CurrentUser() user: RequestUser) {
    return this.accounts.changeOwnPassword(dto, user);
  }

  @Post(':id/reset-password')
  @Roles('SUPER_ADMIN')
  resetPassword(@Param('id') id: string, @Body() dto: ResetManagedUserPasswordDto, @CurrentUser() user: RequestUser) {
    return this.accounts.resetManagedUserPassword(id, dto, user);
  }

  @Patch(':id')
  @Roles('SUPER_ADMIN')
  updateUser(@Param('id') id: string, @Body() dto: UpdateManagedUserDto, @CurrentUser() user: RequestUser) {
    return this.accounts.updateManagedUser(id, dto, user);
  }

  @Get('roles')
  @Roles('SUPER_ADMIN')
  roles() {
    return this.roleUseCases.listRoles();
  }

  @Post('roles')
  @Roles('SUPER_ADMIN')
  createRole(@Body() dto: SaveRoleDto, @CurrentUser() user: RequestUser) {
    return this.roleUseCases.createRole(dto, user);
  }

  @Patch('roles/:id')
  @Roles('SUPER_ADMIN')
  updateRole(@Param('id') id: string, @Body() dto: SaveRoleDto, @CurrentUser() user: RequestUser) {
    return this.roleUseCases.updateRole(id, dto, user);
  }

  @Put('roles/:id/permissions')
  @Roles('SUPER_ADMIN')
  updateRolePermissions(@Param('id') id: string, @Body() dto: UpdateRolePermissionsDto, @CurrentUser() user: RequestUser) {
    return this.roleUseCases.updateRolePermissions(id, dto, user);
  }

  @Get('permissions')
  @Roles('SUPER_ADMIN')
  permissions() {
    return this.roleUseCases.listPermissions();
  }
}
