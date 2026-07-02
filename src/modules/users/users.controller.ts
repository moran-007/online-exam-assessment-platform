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
import { UsersService } from './users.service';

@ApiTags('User')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('students')
  @Permissions('exam:read')
  students() {
    return this.usersService.listStudents();
  }

  @Post('students')
  @Roles('SUPER_ADMIN', 'ADMIN', 'TEACHER')
  createStudent(@Body() dto: CreateStudentDto, @CurrentUser() user: RequestUser) {
    return this.usersService.createStudent(dto, user);
  }

  @Post('students/batch')
  @Roles('SUPER_ADMIN', 'ADMIN', 'TEACHER')
  batchCreateStudents(@Body() dto: BatchCreateStudentsDto, @CurrentUser() user: RequestUser) {
    return this.usersService.batchCreateStudents(dto, user);
  }

  @Get('teachers')
  @Permissions('class:read')
  teachers() {
    return this.usersService.listTeachers();
  }

  @Post('teachers')
  @Roles('SUPER_ADMIN', 'ADMIN')
  createTeacher(@Body() dto: CreateStudentDto, @CurrentUser() user: RequestUser) {
    return this.usersService.createTeacher(dto, user);
  }

  @Post('teachers/batch')
  @Roles('SUPER_ADMIN', 'ADMIN')
  batchCreateTeachers(@Body() dto: BatchCreateTeachersDto, @CurrentUser() user: RequestUser) {
    return this.usersService.batchCreateTeachers(dto, user);
  }

  @Get()
  @Roles('SUPER_ADMIN')
  users(@Query() query: ListManagedUsersQueryDto) {
    return this.usersService.listManagedUsers(query);
  }

  @Post()
  @Roles('SUPER_ADMIN')
  createUser(@Body() dto: CreateManagedUserDto, @CurrentUser() user: RequestUser) {
    return this.usersService.createManagedUser(dto, user);
  }

  @Post('me/password')
  changeOwnPassword(@Body() dto: ChangeOwnPasswordDto, @CurrentUser() user: RequestUser) {
    return this.usersService.changeOwnPassword(dto, user);
  }

  @Post(':id/reset-password')
  @Roles('SUPER_ADMIN')
  resetPassword(@Param('id') id: string, @Body() dto: ResetManagedUserPasswordDto, @CurrentUser() user: RequestUser) {
    return this.usersService.resetManagedUserPassword(id, dto, user);
  }

  @Patch(':id')
  @Roles('SUPER_ADMIN')
  updateUser(@Param('id') id: string, @Body() dto: UpdateManagedUserDto, @CurrentUser() user: RequestUser) {
    return this.usersService.updateManagedUser(id, dto, user);
  }

  @Get('roles')
  @Roles('SUPER_ADMIN')
  roles() {
    return this.usersService.listRoles();
  }

  @Post('roles')
  @Roles('SUPER_ADMIN')
  createRole(@Body() dto: SaveRoleDto, @CurrentUser() user: RequestUser) {
    return this.usersService.createRole(dto, user);
  }

  @Patch('roles/:id')
  @Roles('SUPER_ADMIN')
  updateRole(@Param('id') id: string, @Body() dto: SaveRoleDto, @CurrentUser() user: RequestUser) {
    return this.usersService.updateRole(id, dto, user);
  }

  @Put('roles/:id/permissions')
  @Roles('SUPER_ADMIN')
  updateRolePermissions(@Param('id') id: string, @Body() dto: UpdateRolePermissionsDto, @CurrentUser() user: RequestUser) {
    return this.usersService.updateRolePermissions(id, dto, user);
  }

  @Get('permissions')
  @Roles('SUPER_ADMIN')
  permissions() {
    return this.usersService.listPermissions();
  }
}
