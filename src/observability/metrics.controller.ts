import { Controller, Get, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { MetricsService } from './metrics.service';

@ApiExcludeController()
@Public()
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  metricsEndpoint(@Res() response: Response) {
    response.type('text/plain; version=0.0.4; charset=utf-8');
    response.send(this.metrics.renderPrometheus());
  }
}
