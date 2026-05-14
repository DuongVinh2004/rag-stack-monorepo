import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { JsonLogger } from './common/observability/json-logger.service';
import {
  describeRuntimeConfig,
  getCorsOrigins,
  validateRuntimeConfig,
} from './config/runtime-config';

async function bootstrap() {
  try {
    validateRuntimeConfig();
    const runtimeSummary = describeRuntimeConfig();
    const corsOrigins = getCorsOrigins();
    const app = await NestFactory.create(AppModule, { bufferLogs: true });
    const logger = app.get(JsonLogger);
    app.useLogger(logger);
    app.setGlobalPrefix('api/v1');
    app.enableCors({
      origin: corsOrigins.length ? corsOrigins : '*',
      credentials: false,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    });
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));

    const config = new DocumentBuilder()
      .setTitle('RAG Backend API')
      .setDescription('The AI Knowledge Base API description')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/v1/docs', app, document);

    logger.log(
      {
        event: 'api_startup_validated',
        runtime_summary: runtimeSummary,
      },
      'Bootstrap',
    );

    await app.listen(3000, '0.0.0.0');
  } catch (error) {
    const payload = {
      event: 'api_startup_failed',
      error_code: 'STARTUP_FAILED',
      message: error instanceof Error ? error.message : 'Unknown startup failure',
    };
    process.stderr.write(`${JSON.stringify(payload)}\n`);
    throw error;
  }
}
bootstrap();
