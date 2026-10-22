import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { trustedProxy } from './common/trusted-proxy.js';
import { config } from './config.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Behind Caddy in deployed environments: use X-Forwarded-For for the client IP.
  app.set('trust proxy', 1);
  // Storefront and admin on Vercel call through their /api proxy: real visitor IPs (see trusted-proxy.ts).
  app.use(trustedProxy(config.apiProxySecret));
  // Credentials are needed for the admin session cookie.
  app.enableCors({ origin: config.corsOrigins, credentials: true });
  app.enableShutdownHooks();
  await app.listen(config.port, '0.0.0.0');
}

void bootstrap();
