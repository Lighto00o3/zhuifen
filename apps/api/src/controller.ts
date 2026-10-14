import { Body, Controller, Get, Headers, Inject, Param, Post, Req } from '@nestjs/common';
import { Database } from './database';
import { clientIp, type ClientRequest, RateLimiter } from './limiter';
import { Realtime } from './realtime';
import { ACCESS_DENIED, authenticate, ROOM_NOT_FOUND, Rooms } from './rooms';

// 房间不存在返回 404、凭证不对返回 403，结果不同就能用来试探哪些房间号存在。
// 这两类失败按 IP 计数，每分钟超过 20 次就暂时拒绝查询；历史页一次最多查 12 个房间，正常使用碰不到。
const LOOKUP_FAILURES = 20;
function lookupFailure(error: unknown) {
  const response = (error as { getResponse?: () => unknown } | null)?.getResponse?.() as { code?: string } | undefined;
  return response?.code === ROOM_NOT_FOUND || response?.code === ACCESS_DENIED;
}

@Controller('api')
export class RoomController {
  constructor(@Inject(Rooms) private readonly rooms: Rooms, @Inject(Realtime) private readonly realtime: Realtime, @Inject(Database) private readonly db: Database, @Inject(RateLimiter) private readonly limiter: RateLimiter) {}
  @Get('health') async health() { await this.db.pool.query('SELECT 1'); return { ok: true }; }
  @Post('rooms') async create(@Body() body: unknown, @Req() request: ClientRequest) {
    this.limiter.check(`create:${clientIp(request)}`, 5);
    const { state, session } = await this.rooms.create(body);
    return { room: this.realtime.publicState(state), session };
  }
  @Post('rooms/:code/join') async join(@Param('code') code: string, @Body() body: unknown, @Req() request: ClientRequest) {
    this.limiter.check(`join:${clientIp(request)}`, 10);
    const { state, session } = await this.rooms.join(code, body);
    return { room: this.realtime.publish(state), session };
  }
  @Get('rooms/:code') async read(@Param('code') code: string, @Req() request: ClientRequest, @Headers('authorization') authorization?: string) {
    return this.lookup(request, async () => {
      const state = await this.rooms.read(code);
      authenticate(state, authorization?.replace(/^Bearer /, ''));
      return this.realtime.publicState(state);
    });
  }
  @Get('rooms/:code/rounds') async rounds(@Param('code') code: string, @Req() request: ClientRequest, @Headers('authorization') authorization?: string) {
    return this.lookup(request, () => this.rooms.rounds(code, authorization?.replace(/^Bearer /, '')));
  }
  @Post('rooms/:code/commands') async command(@Param('code') code: string, @Body() body: unknown, @Req() request: ClientRequest, @Headers('authorization') authorization?: string) {
    // 正常一桌每分钟只有几笔记分，同一球房共用网络也远远用不到 120 次。
    this.limiter.check(`command:${clientIp(request)}`, 120);
    return this.lookup(request, async () => this.realtime.publish(await this.rooms.command(code, authorization?.replace(/^Bearer /, ''), body)));
  }
  private async lookup<T>(request: ClientRequest, run: () => Promise<T>): Promise<T> {
    const key = `lookup:${clientIp(request)}`;
    this.limiter.guard(key, LOOKUP_FAILURES);
    try { return await run(); }
    catch (error) { if (lookupFailure(error)) this.limiter.record(key); throw error; }
  }
}
