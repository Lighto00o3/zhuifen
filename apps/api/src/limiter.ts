import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';

export interface ClientRequest { ip?: string; headers: Record<string, string | string[] | undefined> }

const logger = new Logger('RateLimiter');
let missingHeaderWarned = false;
// 托管平台的代理可能不过滤客户端自带的 X-Forwarded-For，可指定由平台写入、不可伪造的请求头。
export function clientIp(request: ClientRequest): string {
  const header = process.env.CLIENT_IP_HEADER?.trim().toLowerCase();
  const value = header ? request.headers[header] : undefined;
  const ip = (Array.isArray(value) ? value[0] : value)?.trim();
  if (header && !ip && !missingHeaderWarned) {
    // 平台没有提供这个请求头时会退回代理 IP，所有用户可能共用同一个限流额度。
    missingHeaderWarned = true;
    logger.warn(`请求中没有 ${header} 请求头，限流改用 ${request.ip ?? '未知 IP'}；请确认 CLIENT_IP_HEADER 配置正确`);
  }
  return ip || request.ip || 'unknown';
}
// 生产环境没有配置真实 IP 的来源时，限流拿到的往往是代理的 IP。
export function warnIfClientIpUnconfigured() {
  if (process.env.NODE_ENV === 'production' && !process.env.CLIENT_IP_HEADER?.trim() && !process.env.TRUST_PROXY?.trim()) {
    logger.warn('未配置 CLIENT_IP_HEADER 或 TRUST_PROXY：部署在反向代理后面时，所有用户会被当成同一个 IP 限流');
  }
}

// 进程内计数，只适用于单实例部署（见 docs/optimization.md 第 8 条）。
@Injectable()
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  private sweptAt = Date.now();
  check(key: string, limit: number, windowMs = 60_000) {
    const now = Date.now();
    if (now - this.sweptAt > windowMs) {
      for (const [item, entry] of this.hits) if (entry.resetAt <= now) this.hits.delete(item);
      this.sweptAt = now;
    }
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) { this.hits.set(key, { count: 1, resetAt: now + windowMs }); return; }
    if (++entry.count > limit) throw new HttpException('操作太频繁，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
  }
}
