import './load-env.js';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');

  // Dev only. In production the POS is served from the SAME ORIGIN as the API
  // (spec §15), which avoids both a CORS preflight on every non-simple request
  // — an extra round trip worth 200-400ms on salon 4G — and SameSite=None
  // cookie handling that Safari and privacy modes treat harshly.
  if (process.env.NODE_ENV !== 'production') {
    app.enableCors({
      origin: ['http://localhost:5173', 'http://localhost:3000'],
      credentials: true,
    });
  }

  await app.listen(process.env.PORT ?? 3001);
}

void bootstrap();
