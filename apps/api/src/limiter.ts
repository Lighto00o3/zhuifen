import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

export interface ClientRequest { ip?: string; headers: Record<string, string | string[] | undefined> }

// 托管平台的代理可能不过滤客户端自带的 X-Forwarded-For，可指定由平台写入、不可伪造的请求头。
export function clientIp(request: ClientRequest): string {
  const header = process.env.CLIENT_IP_HEADER?.trim().toLowerCase();
  const value = header ? request.headers[header] : undefined;
  return (Array.isArray(value) ? value[0] : value)?.trim() || request.ip || 'unknown';
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
