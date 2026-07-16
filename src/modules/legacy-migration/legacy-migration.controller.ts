import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { LegacyProfileSnapshotDto, ResolveMigrationConflictDto } from './dto/legacy-profile-snapshot.dto';
import { LegacyMigrationService } from './legacy-migration.service';

@ApiTags('Legacy Migration')
@ApiBearerAuth()
@Roles('SUPER_ADMIN', 'ADMIN')
@Permissions('legacy-migration:manage')
@Controller('legacy-migrations')
export class LegacyMigrationController {
  constructor(private readonly migrations: LegacyMigrationService) {}

  @Get()
  list() {
    return this.migrations.list();
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.migrations.detail(id);
  }

  @Post('preflight')
  preflight(@Body() snapshot: LegacyProfileSnapshotDto, @CurrentUser() actor: RequestUser) {
    return this.migrations.preflight(snapshot, actor);
  }

  @Patch('conflicts/:id')
  resolveConflict(
    @Param('id') id: string,
    @Body() dto: ResolveMigrationConflictDto,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.migrations.resolveConflict(id, dto, actor);
  }

  @Post(':id/approve')
  approve(@Param('id') id: string, @CurrentUser() actor: RequestUser) {
    return this.migrations.approve(id, actor);
  }

  @Post(':id/apply')
  apply(
    @Param('id') id: string,
    @Body() snapshot: LegacyProfileSnapshotDto,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.migrations.apply(id, snapshot, actor);
  }
}
