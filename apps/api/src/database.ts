import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';

@Injectable()
export class Database implements OnModuleInit, OnModuleDestroy {
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
    `);
  }
  async onModuleDestroy() { await this.pool.end(); }
}
