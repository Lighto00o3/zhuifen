import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { migrate } from './migrations';

@Injectable()
export class Database implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(Database.name);
  private purgeTimer?: ReturnType<typeof setInterval>;
  readonly pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10, connectionTimeoutMillis: 5000 });
  constructor() {
    // 空闲连接被数据库端断开时（Neon 重启计算节点、网络中断），pg 会触发 error 事件，没有监听会导致进程退出。
    // 断开的连接会被连接池自动丢弃，下次查询时重新建立，这里只需记录日志。
    this.pool.on('error', error => this.logger.warn(`数据库空闲连接已断开：${error.message}`));
  }
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
