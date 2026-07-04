import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import { LoggerModule } from 'nestjs-pino';
import appConfig from './config/app.config';
import { validateEnv } from './config/env.validation';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { ConfiguredThrottlerGuard } from './common/guards/configured-throttler.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { ClassesModule } from './modules/classes/classes.module';
import { CoursesModule } from './modules/courses/courses.module';
import { DataScopeModule } from './modules/data-scope/data-scope.module';
import { ExamsModule } from './modules/exams/exams.module';
import { ExportsModule } from './modules/exports/exports.module';
import { GradingModule } from './modules/grading/grading.module';
import { HealthModule } from './modules/health/health.module';
import { HydroModule } from './modules/hydro/hydro.module';
import { KnowledgePointsModule } from './modules/knowledge-points/knowledge-points.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PapersModule } from './modules/papers/papers.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { QuestionsModule } from './modules/questions/questions.module';
import { QuestionTypesModule } from './modules/question-types/question-types.module';
import { ReviewRulesModule } from './modules/review-rules/review-rules.module';
import { StatisticsModule } from './modules/statistics/statistics.module';
import { StudentModule } from './modules/student/student.module';
import { TagsModule } from './modules/tags/tags.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      load: [appConfig],
      validate: validateEnv,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level: config.get<string>('logLevel') ?? 'info',
          transport: config.get<boolean>('logPretty')
            ? { target: 'pino-pretty', options: { colorize: true, singleLine: true } }
            : undefined,
          genReqId: (request, response) => {
            const header = request.headers['x-request-id'];
            const candidate = Array.isArray(header) ? header[0] : header;
            const requestId = candidate && /^[A-Za-z0-9._-]{1,64}$/.test(candidate) ? candidate : randomUUID();
            response.setHeader('X-Request-ID', requestId);
            return requestId;
          },
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.body.password',
              'req.body.refreshToken',
              'req.body.accessToken',
              'req.body.token',
              'req.body.secret',
              'req.body.loginPassword',
              'req.body.hydroPassword',
              'res.headers["set-cookie"]',
            ],
            censor: '[REDACTED]',
          },
        },
      }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          name: 'default',
          ttl: config.get<number>('rateLimit.ttlMs') ?? 60_000,
          limit: config.get<number>('rateLimit.max') ?? 120,
        },
      ],
    }),
    PrismaModule,
    AuditModule,
    UsersModule,
    AuthModule,
    HealthModule,
    HydroModule,
    CoursesModule,
    DataScopeModule,
    ClassesModule,
    KnowledgePointsModule,
    NotificationsModule,
    TagsModule,
    UploadsModule,
    QuestionTypesModule,
    QuestionsModule,
    ReviewRulesModule,
    PapersModule,
    ExamsModule,
    GradingModule,
    ExportsModule,
    StatisticsModule,
    StudentModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ConfiguredThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PermissionsGuard,
    },
  ],
})
export class AppModule {}
