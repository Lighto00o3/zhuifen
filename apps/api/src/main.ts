import 'reflect-metadata';
import { corsOrigins } from './env';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Database } from './database';
import { RateLimiter, warnIfClientIpUnconfigured } from './limiter';
import { Rooms } from './rooms';
import { Realtime } from './realtime';
import { RoomController } from './controller';

@Module({ controllers: [RoomController], providers: [Database, Rooms, Realtime, RateLimiter] })
class AppModule {}

export async function createApp() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  app.enableCors({ origin: corsOrigins });
  // 部署在反向代理后面时按代理层数设置，否则所有请求都会被当成代理的 IP 限流。
  warnIfClientIpUnconfigured();
  const trustProxy = process.env.TRUST_PROXY?.trim();
  if (trustProxy) app.getHttpAdapter().getInstance().set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy === 'true');
  app.enableShutdownHooks();
  return app;
}
if (require.main === module) {
  void createApp().then(app => app.listen(Number(process.env.PORT ?? 3001), '0.0.0.0')).catch(error => {
    console.error('API 启动失败：', error.message); process.exitCode = 1;
  });
}
