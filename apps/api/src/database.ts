import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { migrate } from './migrations';

@Injectable()
export class Database implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(Database.name);
  private purgeTimer?: ReturnType<typeof setInterval>;
  readonly pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10, connectionTimeoutMillis: 5000 });
  async onModuleInit() {
    if (!process.env.DATABASE_URL) throw new Error('请配置 apps/api/.env 的 DATABASE_URL');
    await migrate(this.pool);
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
