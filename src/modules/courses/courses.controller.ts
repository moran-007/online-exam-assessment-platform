import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { CoursesService } from './courses.service';
import { CreateCourseDto } from './dto/create-course.dto';
import { QueryCourseDto } from './dto/query-course.dto';
import { UpdateCourseDto } from './dto/update-course.dto';

@ApiTags('Course')
@ApiBearerAuth()
@Controller('courses')
export class CoursesController {
  constructor(private readonly coursesService: CoursesService) {}

  @Get()
  @Permissions('course:read')
  list(@Query() query: QueryCourseDto) {
    return this.coursesService.list(query);
  }

  @Post()
  @Permissions('course:create')
  create(@Body() dto: CreateCourseDto, @CurrentUser() user: RequestUser) {
    return this.coursesService.create(dto, user.id);
  }

  @Patch(':id')
  @Permissions('course:update')
  update(@Param('id') id: string, @Body() dto: UpdateCourseDto) {
    return this.coursesService.update(id, dto);
  }

  @Delete(':id')
  @Permissions('course:update')
  remove(@Param('id') id: string) {
    return this.coursesService.remove(id);
  }
}
