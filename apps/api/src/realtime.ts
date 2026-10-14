import { Inject } from '@nestjs/common';
import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { corsOrigins } from './env';
import { PublicRoom, RoomState } from '@zhuifen/shared';
import { authenticate, object, Rooms } from './rooms';

@WebSocketGateway({ cors: { origin: corsOrigins }, maxHttpBufferSize: 4096 })
export class Realtime {
  @WebSocketServer() server!: Server;
  private presence = new Map<string, Map<string, string>>();
  constructor(@Inject(Rooms) private readonly rooms: Rooms) {}
  publicState(state: RoomState): PublicRoom {
    const online = new Set(this.presence.get(state.code)?.values());
    const { rounds: _, ...current } = state;
    return { ...current, members: state.members.map(({ tokenHash: _, ...player }) => ({ ...player, online: online.has(player.id) })) };
  }
  publish(state: RoomState) {
    const result = this.publicState(state);
    this.server?.to(state.code).emit('room:state', result);
    return result;
  }
  private publishPresence(code: string) {
    this.server.to(code).emit('room:presence', [...new Set(this.presence.get(code)?.values())]);
  }
  @SubscribeMessage('room:subscribe')
  async subscribe(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    try {
      const data = object(body);
      if (typeof data.code !== 'string') return { ok: false, code: 'denied', message: '房间号不正确' };
      const state = await this.rooms.read(data.code);
      const actor = authenticate(state, data.token);
      if (socket.data.code && socket.data.code !== state.code) {
        this.removePresence(socket); await socket.leave(socket.data.code);
      }
      await socket.join(state.code);
      socket.data.code = state.code;
      socket.data.playerId = actor.id;
      const connections = this.presence.get(state.code) ?? new Map<string, string>();
      connections.set(socket.id, actor.id); this.presence.set(state.code, connections);
      this.publishPresence(state.code);
      // 先订阅，再读取，避免读取和加入房间之间漏掉更新。
      return { ok: true, room: this.publicState(await this.rooms.read(state.code)) };
    } catch (error) {
      // 4xx（凭证无效、房间不存在、格式不对）时客户端不再重试；数据库暂时不可用等其他错误，客户端会稍后自动重试。
      // 两种 4xx 返回同样的结果，不能用来试探哪些房间号存在。
      const status = (error as { getStatus?: () => number } | null)?.getStatus?.();
      if (status !== undefined && status < 500) return { ok: false, code: 'denied', message: '无法连接房间，请检查加入凭证' };
      return { ok: false, code: 'unavailable', message: '暂时无法连接房间，正在重试' };
    }
  }
  private removePresence(socket: Socket) {
    const code: string | undefined = socket.data.code;
    if (!code) return;
    const connections = this.presence.get(code);
    connections?.delete(socket.id);
    if (!connections?.size) this.presence.delete(code);
    this.publishPresence(code);
  }
  handleDisconnect(socket: Socket) { this.removePresence(socket); }
}
