import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CreateKnowledgePointDto } from './dto/create-knowledge-point.dto';
import { QueryKnowledgePointTreeDto } from './dto/query-knowledge-point-tree.dto';
import { UpdateKnowledgePointDto } from './dto/update-knowledge-point.dto';
import { KnowledgePointsService } from './knowledge-points.service';

@ApiTags('KnowledgePoint')
@ApiBearerAuth()
@Controller('knowledge-points')
export class KnowledgePointsController {
  constructor(private readonly knowledgePointsService: KnowledgePointsService) {}

  @Get('tree')
  @Permissions('knowledge-point:read')
  tree(@Query() query: QueryKnowledgePointTreeDto) {
    return this.knowledgePointsService.tree(query.courseId);
  }

  @Post()
  @Permissions('knowledge-point:create')
  create(@Body() dto: CreateKnowledgePointDto) {
    return this.knowledgePointsService.create(dto);
  }

  @Patch(':id')
  @Permissions('knowledge-point:update')
  update(@Param('id') id: string, @Body() dto: UpdateKnowledgePointDto) {
    return this.knowledgePointsService.update(id, dto);
  }

  @Delete(':id')
  @Permissions('knowledge-point:update')
  remove(@Param('id') id: string) {
    return this.knowledgePointsService.remove(id);
  }
}
