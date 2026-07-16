import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { ClassesService } from './classes.service';
import { QueryClassDto } from './dto/query-class.dto';
import { SaveClassDto, UpdateClassDto } from './dto/save-class.dto';
import { UpdateClassMembersDto, UpdateClassTeachersDto } from './dto/update-class-members.dto';

@ApiTags('Classes')
@ApiBearerAuth()
@Controller('classes')
export class ClassesController {
  constructor(private readonly classesService: ClassesService) {}

  @Get()
  @Permissions('class:read')
  list(@Query() query: QueryClassDto, @CurrentUser() user: RequestUser) {
    return this.classesService.list(query, user);
  }

  @Post()
  @Permissions('class:create')
  create(@Body() dto: SaveClassDto, @CurrentUser() user: RequestUser) {
    return this.classesService.create(dto, user);
  }

  @Get(':id')
  @Permissions('class:read')
  detail(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.classesService.detail(id, user);
  }

  @Patch(':id')
  @Permissions('class:update')
  update(@Param('id') id: string, @Body() dto: UpdateClassDto, @CurrentUser() user: RequestUser) {
    return this.classesService.update(id, dto, user);
  }

  @Delete(':id')
  @Permissions('class:update')
  remove(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.classesService.remove(id, user);
  }

  @Post(':id/students')
  @Permissions('class:update')
  addStudents(@Param('id') id: string, @Body() dto: UpdateClassMembersDto, @CurrentUser() user: RequestUser) {
    return this.classesService.addStudents(id, dto.userIds, user);
  }

  @Delete(':id/students/:studentId')
  @Permissions('class:update')
  removeStudent(@Param('id') id: string, @Param('studentId') studentId: string, @CurrentUser() user: RequestUser) {
    return this.classesService.removeStudent(id, studentId, user);
  }

  @Post(':id/teachers')
  @Permissions('class:update')
  addTeachers(@Param('id') id: string, @Body() dto: UpdateClassTeachersDto, @CurrentUser() user: RequestUser) {
    return this.classesService.addTeachers(id, dto.userIds, user, dto.role);
  }

  @Delete(':id/teachers/:teacherId')
  @Permissions('class:update')
  removeTeacher(@Param('id') id: string, @Param('teacherId') teacherId: string, @CurrentUser() user: RequestUser) {
    return this.classesService.removeTeacher(id, teacherId, user);
  }
}
