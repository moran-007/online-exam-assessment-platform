import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import appConfig from './config/app.config';
import { validateEnv } from './config/env.validation';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { ClassesModule } from './modules/classes/classes.module';
import { CoursesModule } from './modules/courses/courses.module';
import { ExamsModule } from './modules/exams/exams.module';
import { ExportsModule } from './modules/exports/exports.module';
import { GradingModule } from './modules/grading/grading.module';
import { HealthModule } from './modules/health/health.module';
import { KnowledgePointsModule } from './modules/knowledge-points/knowledge-points.module';
import { PapersModule } from './modules/papers/papers.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { QuestionsModule } from './modules/questions/questions.module';
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
    PrismaModule,
    AuditModule,
    UsersModule,
    AuthModule,
    HealthModule,
    CoursesModule,
    ClassesModule,
    KnowledgePointsModule,
    TagsModule,
    UploadsModule,
    QuestionsModule,
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
