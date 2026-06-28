import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { CreateExportDto } from './dto/create-export.dto';
import { QueryExportDto } from './dto/query-export.dto';
import { ExportsService } from './exports.service';

@ApiTags('Exports')
@ApiBearerAuth()
@Controller('exports')
export class ExportsController {
  constructor(private readonly exportsService: ExportsService) {}

  @Get()
  @Permissions('exam:result:export')
  list(@Query() query: QueryExportDto, @CurrentUser() user: RequestUser) {
    return this.exportsService.list(query, user.id);
  }

  @Post()
  @Permissions('exam:result:export')
  create(@Body() dto: CreateExportDto, @CurrentUser() user: RequestUser) {
    return this.exportsService.create(dto, user.id);
  }

  @Post('student/wrong-questions')
  createWrongQuestionExport(@Body() dto: CreateExportDto, @CurrentUser() user: RequestUser) {
    return this.exportsService.createWrongQuestionExport(dto, user);
  }

  @Get(':id/download')
  @Permissions('exam:result:export')
  download(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.exportsService.download(id, user.id);
  }
}
