import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { AcademicProfilesService } from './academic-profiles.service';
import {
  LinkParentStudentDto,
  ProfileListQueryDto,
  UpdateStudentProfileDto,
  UpdateTeacherProfileDto,
} from './dto/academic-profiles.dto';

@ApiTags('Academic Profile')
@ApiBearerAuth()
@Permissions('academic-profile:read')
@Controller('academic-profiles')
export class AcademicProfilesController {
  constructor(private readonly profiles: AcademicProfilesService) {}

  @Get('students')
  students(@Query() query: ProfileListQueryDto, @CurrentUser() actor: RequestUser) {
    return this.profiles.listStudents(query, actor);
  }

  @Get('students/:userId')
  student(@Param('userId') userId: string, @CurrentUser() actor: RequestUser) {
    return this.profiles.studentDetail(userId, actor);
  }

  @Patch('students/:userId')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @Permissions('academic-profile:update')
  updateStudent(
    @Param('userId') userId: string,
    @Body() dto: UpdateStudentProfileDto,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.profiles.updateStudent(userId, dto, actor);
  }

  @Get('teachers')
  teachers(@Query() query: ProfileListQueryDto, @CurrentUser() actor: RequestUser) {
    return this.profiles.listTeachers(query, actor);
  }

  @Get('teachers/:userId')
  teacher(@Param('userId') userId: string, @CurrentUser() actor: RequestUser) {
    return this.profiles.teacherDetail(userId, actor);
  }

  @Patch('teachers/:userId')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @Permissions('academic-profile:update')
  updateTeacher(
    @Param('userId') userId: string,
    @Body() dto: UpdateTeacherProfileDto,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.profiles.updateTeacher(userId, dto, actor);
  }

  @Get('parents')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @Permissions('parent-student:manage')
  parents(@Query() query: ProfileListQueryDto) {
    return this.profiles.listParents(query);
  }

  @Get('parents/me/students')
  myChildren(@CurrentUser() actor: RequestUser) {
    return this.profiles.myChildren(actor);
  }

  @Post('parent-students')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @Permissions('parent-student:manage')
  linkParent(@Body() dto: LinkParentStudentDto, @CurrentUser() actor: RequestUser) {
    return this.profiles.linkParent(dto, actor);
  }

  @Delete('parent-students/:parentId/:studentId')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @Permissions('parent-student:manage')
  unlinkParent(
    @Param('parentId') parentId: string,
    @Param('studentId') studentId: string,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.profiles.unlinkParent(parentId, studentId, actor);
  }
}
