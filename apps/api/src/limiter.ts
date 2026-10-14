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
  private entry(key: string, windowMs: number) {
    const now = Date.now();
    if (now - this.sweptAt > windowMs) {
      for (const [item, entry] of this.hits) if (entry.resetAt <= now) this.hits.delete(item);
      this.sweptAt = now;
    }
    let entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) { entry = { count: 0, resetAt: now + windowMs }; this.hits.set(key, entry); }
    return entry;
  }
  // 每次请求都计数，超过上限返回 429。
  check(key: string, limit: number, windowMs = 60_000) {
    if (++this.entry(key, windowMs).count > limit) throw tooMany();
  }
  // 只统计失败的请求：先用 guard 确认还没超限，请求失败后再用 record 记一次。
  guard(key: string, limit: number) {
    const entry = this.hits.get(key);
    if (entry && entry.resetAt > Date.now() && entry.count >= limit) throw tooMany();
  }
  record(key: string, windowMs = 60_000) { this.entry(key, windowMs).count++; }
}
const tooMany = () => new HttpException('操作太频繁，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
