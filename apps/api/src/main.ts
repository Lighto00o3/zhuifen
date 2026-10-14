import 'reflect-metadata';
import { corsOrigins } from './env';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Database } from './database';
import { Rooms } from './rooms';
import { Realtime } from './realtime';
import { RoomController } from './controller';

@Module({ controllers: [RoomController], providers: [Database, Rooms, Realtime] })
class AppModule {}

export async function createApp() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  app.enableCors({ origin: corsOrigins });
  app.enableShutdownHooks();
  return app;
}
if (require.main === module) {
  void createApp().then(app => app.listen(Number(process.env.PORT ?? 3001), '0.0.0.0')).catch(error => {
    console.error('API 启动失败：', error.message); process.exitCode = 1;
  });
}
