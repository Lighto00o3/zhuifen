import { Logger } from '@nestjs/common';
import type { Pool } from 'pg';

export interface Migration { version: number; name: string; sql: string }

// 表结构的每次变更都追加一条新迁移，版本号递增；已经上线的迁移不要再修改。
// 所有待执行的迁移在同一个事务里执行，所以不能使用 CREATE INDEX CONCURRENTLY 这类不能放进事务的语句。
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: '创建房间与命令表',
    // 引入迁移之前，线上库已经由启动时的建表语句建好了这些表，所以这里保留 IF NOT EXISTS。
    sql: `
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
    `,
  },
];

// 任意固定的数字，用来保证同一时间只有一个进程在执行迁移。
const MIGRATION_LOCK = 20261014;
const logger = new Logger('Migrations');

export async function migrate(pool: Pool, migrations: Migration[] = MIGRATIONS) {
  const versions = migrations.map(m => m.version);
  if (versions.some((v, i) => !Number.isInteger(v) || v < 1 || (i > 0 && v <= versions[i - 1]!))) throw new Error('迁移版本号必须是递增的正整数');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // 事务级的锁在提交或回滚时自动释放，经过连接池（如 Neon 的 pgbouncer）也能正常工作。
    await client.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    const applied = new Set((await client.query<{ version: number }>('SELECT version FROM schema_migrations')).rows.map(r => r.version));
    const pending = migrations.filter(m => !applied.has(m.version));
    for (const migration of pending) {
      await client.query(migration.sql);
      await client.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [migration.version, migration.name]);
    }
    await client.query('COMMIT');
    for (const migration of pending) logger.log(`已执行迁移 ${migration.version}：${migration.name}`);
    // 回滚到旧版本代码时，数据库里可能有它不认识的迁移，只提示，不阻止启动。
    const unknown = [...applied].filter(v => !versions.includes(v)).sort((a, b) => a - b);
    if (unknown.length) logger.warn(`数据库中有当前代码不认识的迁移：${unknown.join('、')}，可能是部署了旧版本`);
    return pending.map(m => m.version);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}
