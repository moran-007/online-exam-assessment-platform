import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { QueryAuditLogDto } from './dto/query-audit-log.dto';
import { AuditService } from './audit.service';

@ApiTags('AuditLog')
@ApiBearerAuth()
@Controller('audit-logs')
@Roles('SUPER_ADMIN')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  list(@Query() query: QueryAuditLogDto) {
    return this.auditService.list(query);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.auditService.detail(id);
  }
}
