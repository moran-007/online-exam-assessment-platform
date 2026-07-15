import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

const JSON_CONTENT_TYPE = 'application/json';

export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('在线答题与智能测评平台 API')
    .setDescription('Online exam and intelligent assessment platform API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config, {
    operationIdFactory: (controllerKey, methodKey) =>
      `${controllerKey.replace(/Controller$/, '')}_${methodKey}`,
  });

  return applyWireResponseContract(document);
}

export function setupOpenApi(app: INestApplication, document: OpenAPIObject) {
  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'api/docs-json',
    yamlDocumentUrl: 'api/docs-yaml',
  });
}

function applyWireResponseContract(document: OpenAPIObject): OpenAPIObject {
  document.components ??= {};
  document.components.schemas ??= {};
  document.components.responses ??= {};
  document.components.schemas.ApiError = {
    type: 'object',
    required: ['code', 'message', 'data', 'requestId'],
    properties: {
      code: { type: 'integer', example: 40000 },
      message: { type: 'string', example: '请求参数错误' },
      data: { nullable: true, example: null },
      requestId: { type: 'string', nullable: true, example: '019f63ca-586f-7bc1-b8a6-830cf20092c9' },
    },
  };
  document.components.responses.ApiError = {
    description: '统一错误响应',
    content: {
      [JSON_CONTENT_TYPE]: { schema: { $ref: '#/components/schemas/ApiError' } },
    },
  };

  for (const pathItem of Object.values(document.paths)) {
    for (const operation of Object.values(pathItem ?? {})) {
      if (!operation || typeof operation !== 'object' || !('responses' in operation)) continue;

      for (const [status, response] of Object.entries(operation.responses ?? {})) {
        if (
          !/^2\d\d$/.test(status) ||
          !response ||
          typeof response !== 'object' ||
          !('content' in response)
        ) continue;
        const jsonContent = response.content?.[JSON_CONTENT_TYPE];
        if (!jsonContent) continue;
        jsonContent.schema = successEnvelopeSchema(jsonContent.schema);
      }

      for (const status of ['400', '401', '403', '404', '409', '429', '500']) {
        operation.responses[status] ??= { $ref: '#/components/responses/ApiError' };
      }
    }
  }

  return document;
}

function successEnvelopeSchema(dataSchema: object | undefined) {
  return {
    type: 'object' as const,
    required: ['code', 'message', 'data'],
    properties: {
      code: { type: 'integer' as const, example: 0 },
      message: { type: 'string' as const, example: 'ok' },
      data: dataSchema ?? {},
    },
  };
}
