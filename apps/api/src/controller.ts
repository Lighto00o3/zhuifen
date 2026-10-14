import { Body, Controller, Get, Headers, Inject, Param, Post, Req } from '@nestjs/common';
import { Database } from './database';
import { clientIp, type ClientRequest, RateLimiter } from './limiter';
import { Realtime } from './realtime';
import { authenticate, Rooms } from './rooms';

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
  @Get('rooms/:code') async read(@Param('code') code: string, @Headers('authorization') authorization?: string) {
    const state = await this.rooms.read(code);
    authenticate(state, authorization?.replace(/^Bearer /, ''));
    return this.realtime.publicState(state);
  }
  @Post('rooms/:code/commands') async command(@Param('code') code: string, @Body() body: unknown, @Headers('authorization') authorization?: string) {
    return this.realtime.publish(await this.rooms.command(code, authorization?.replace(/^Bearer /, ''), body));
  }
}
