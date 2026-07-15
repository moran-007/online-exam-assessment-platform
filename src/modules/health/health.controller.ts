import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('Health')
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  check() {
    return {
      status: 'ok',
      serverTime: new Date().toISOString(),
    };
  }

  @Get('live')
  live() {
    return { status: 'ok', serverTime: new Date().toISOString() };
  }

  @Get('ready')
  async ready() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ready', database: 'ok', serverTime: new Date().toISOString() };
  }
}
