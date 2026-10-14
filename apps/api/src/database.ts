import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';

@Injectable()
export class Database implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(Database.name);
  private purgeTimer?: ReturnType<typeof setInterval>;
  readonly pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10, connectionTimeoutMillis: 5000 });
  async onModuleInit() {
    if (!process.env.DATABASE_URL) throw new Error('请配置 apps/api/.env 的 DATABASE_URL');
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS rooms (
        code TEXT PRIMARY KEY,
        state JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS room_commands (
        room_code TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
        request_id UUID NOT NULL,
        actor_id UUID NOT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (room_code, request_id)
      );
      CREATE INDEX IF NOT EXISTS rooms_updated_at ON rooms(updated_at);
    `);
    await this.purgeExpiredRooms();
    this.purgeTimer = setInterval(() => void this.purgeExpiredRooms(), 60 * 60 * 1000).unref();
  }
  async onModuleDestroy() { clearInterval(this.purgeTimer); await this.pool.end(); }
  // 超过保留天数没有任何操作的房间连同命令记录一起删除，玩家设备上的历史缓存不受影响。
  async purgeExpiredRooms() {
    const days = Number(process.env.ROOM_RETENTION_DAYS ?? 7);
    if (!Number.isInteger(days) || days < 1) return;
    try {
      const result = await this.pool.query("DELETE FROM rooms WHERE updated_at < now() - make_interval(days => $1)", [days]);
      if (result.rowCount) this.logger.log(`已清理 ${result.rowCount} 个超过 ${days} 天未使用的房间`);
    } catch (error) { this.logger.warn(`清理过期房间失败：${(error as Error).message}`); }
  }
}
