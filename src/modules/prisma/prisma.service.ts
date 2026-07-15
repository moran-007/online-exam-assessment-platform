import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { MetricsService } from '../../observability/metrics.service';

type PrismaServiceOptions = {
  log: [{ emit: 'event'; level: 'query' }];
};

@Injectable()
export class PrismaService extends PrismaClient<PrismaServiceOptions> implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly metrics: MetricsService) {
    super({ log: [{ emit: 'event', level: 'query' }] });
    this.$on('query', (event: Prisma.QueryEvent) => {
      this.metrics.recordPrismaQuery(event.duration / 1000);
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
