import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

export function configureApplication(app: NestExpressApplication) {
  const config = app.get(ConfigService);
  const nodeEnv = config.get<string>('nodeEnv') ?? 'development';
  const configuredOrigins = config.get<string[]>('corsOrigins') ?? [];
  const corsOrigins = configuredOrigins.length
    ? configuredOrigins
    : nodeEnv === 'production'
      ? []
      : ['http://localhost:3000', 'http://localhost:5173'];

  app.setGlobalPrefix('api/v1');
  app.getHttpAdapter().getInstance().set('trust proxy', config.get<string | number>('trustProxy') ?? 'loopback');
  app.use(helmet());
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-ID', 'X-Session-Activity'],
    exposedHeaders: ['Content-Disposition', 'Retry-After', 'X-Request-ID'],
  });
  app.use(json({ limit: '20mb' }));
  app.use(urlencoded({ extended: true, limit: '20mb' }));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());

  if (config.get<boolean>('swaggerEnabled')) {
    const documentConfig = new DocumentBuilder()
      .setTitle('在线答题与智能测评平台 API')
      .setDescription('Online exam and intelligent assessment platform API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, documentConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  return app;
}
