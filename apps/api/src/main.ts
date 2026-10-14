import 'reflect-metadata';
import { corsOrigins } from './env';
import { type ArgumentsHost, Catch, Module } from '@nestjs/common';
import { BaseExceptionFilter, NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Database } from './database';
import { RateLimiter, warnIfClientIpUnconfigured } from './limiter';
import { Rooms } from './rooms';
import { Realtime } from './realtime';
import { RoomController } from './controller';

@Module({ controllers: [RoomController], providers: [Database, Rooms, Realtime, RateLimiter] })
class AppModule {}

// 请求体超过上限时直接返回 413，不把错误堆栈写进日志，免得被大请求刷屏；其他异常照常处理。
@Catch()
class BodyLimitFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    if ((exception as { type?: string } | null)?.type !== 'entity.too.large') return super.catch(exception, host);
    host.switchToHttp().getResponse().status(413).json({ statusCode: 413, message: '请求内容过大' });
  }
}

export async function createApp() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn', 'log'] });
  // 正常请求不到 1 KB；限制请求体大小，避免大段数据被写进数据库（默认上限是 100 KB）。
  app.useBodyParser('json', { limit: '16kb' });
  app.useBodyParser('urlencoded', { limit: '16kb', extended: false });
  app.useGlobalFilters(new BodyLimitFilter(app.getHttpAdapter()));
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
