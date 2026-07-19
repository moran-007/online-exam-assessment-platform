import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import {
  CourseUnitPageResponseDto,
  CourseUnitResponseDto,
  QueryCatalogDto,
  QueryCourseUnitDto,
  SaveCourseUnitDto,
  SaveLessonTypeDto,
} from './dto/catalog.dto';
import { LessonCatalogService } from './lesson-catalog.service';

@ApiTags('Academic operations - catalog')
@ApiBearerAuth()
@Controller()
export class LessonCatalogController {
  constructor(private readonly catalog: LessonCatalogService) {}

  @Get('lesson-types')
  @Permissions('lesson-type:read')
  lessonTypes(@Query() query: QueryCatalogDto) {
    return this.catalog.listLessonTypes(query);
  }

  @Post('lesson-types')
  @Permissions('lesson-type:manage')
  createLessonType(@Body() dto: SaveLessonTypeDto, @CurrentUser() actor: RequestUser) {
    return this.catalog.createLessonType(dto, actor);
  }

  @Patch('lesson-types/:id')
  @Permissions('lesson-type:manage')
  updateLessonType(@Param('id') id: string, @Body() dto: SaveLessonTypeDto, @CurrentUser() actor: RequestUser) {
    return this.catalog.updateLessonType(id, dto, actor);
  }

  @Get('course-unit-templates')
  @Permissions('course-unit:read')
  @ApiOkResponse({ type: CourseUnitPageResponseDto })
  courseUnits(@Query() query: QueryCourseUnitDto) {
    return this.catalog.listCourseUnits(query);
  }

  @Post('course-unit-templates')
  @Permissions('course-unit:manage')
  @ApiCreatedResponse({ type: CourseUnitResponseDto })
  createCourseUnit(@Body() dto: SaveCourseUnitDto, @CurrentUser() actor: RequestUser) {
    return this.catalog.createCourseUnit(dto, actor);
  }

  @Patch('course-unit-templates/:id')
  @Permissions('course-unit:manage')
  @ApiOkResponse({ type: CourseUnitResponseDto })
  updateCourseUnit(@Param('id') id: string, @Body() dto: SaveCourseUnitDto, @CurrentUser() actor: RequestUser) {
    return this.catalog.updateCourseUnit(id, dto, actor);
  }
}
