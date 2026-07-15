import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AppModule } from '../app.module';
import { configureApplication } from '../app.setup';
import { createOpenApiDocument } from './openapi';

async function generate() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
  configureApplication(app, { setupSwagger: false });

  try {
    const outputPath = resolve(process.cwd(), 'docs/openapi.json');
    await mkdir(resolve(outputPath, '..'), { recursive: true });
    const document = sortObject(createOpenApiDocument(app));
    await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  } finally {
    await app.close();
  }
}

function sortObject<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => sortObject(item)) as T;
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortObject(item)]),
  ) as T;
}

void generate();
