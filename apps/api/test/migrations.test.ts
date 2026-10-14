import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { MIGRATIONS, migrate, type Migration } from '../src/migrations';

// 每个用例在独立的临时 schema 里执行，不影响开发库里现有的表。
async function withSchema(run: (pool: () => Pool, schema: string) => Promise<void>) {
  const schema = `migration_test_${randomBytes(4).toString('hex')}`;
  const admin = new Pool({ connectionString: process.env.DATABASE_URL });
  const pools: Pool[] = [];
  const pool = () => { const p = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}` }); pools.push(p); return p; };
  await admin.query(`CREATE SCHEMA ${schema}`);
  try { await run(pool, schema); }
  finally {
    await Promise.all(pools.map(p => p.end()));
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
}
const tables = async (pool: Pool, schema: string) =>
  (await pool.query<{ table_name: string }>('SELECT table_name FROM information_schema.tables WHERE table_schema=$1 ORDER BY table_name', [schema])).rows.map(r => r.table_name);
const applied = async (pool: Pool) => (await pool.query<{ version: number }>('SELECT version FROM schema_migrations ORDER BY version')).rows.map(r => r.version);
const addColumn: Migration = { version: 2, name: '测试：加一列', sql: 'ALTER TABLE rooms ADD COLUMN note TEXT' };

test('全新的库：建好全部表，重复启动不会重复执行', async () => {
  await withSchema(async (pool, schema) => {
    const db = pool();
    assert.deepEqual(await migrate(db), [1]);
    assert.deepEqual(await tables(db, schema), ['room_commands', 'rooms', 'schema_migrations']);
    assert.deepEqual(await migrate(db), []);
    assert.deepEqual(await applied(db), [1]);
  });
});

test('引入迁移之前的旧库：只记录版本，已有数据不丢', async () => {
  await withSchema(async (pool) => {
    const db = pool();
    // 模拟线上现状：表已由旧的启动建表语句建好，但没有 schema_migrations。
    await db.query(MIGRATIONS[0]!.sql);
    await db.query(`INSERT INTO rooms (code, state) VALUES ('123456', '{"code":"123456"}')`);
    await db.query(`INSERT INTO room_commands (room_code, request_id, actor_id, payload) VALUES ('123456', gen_random_uuid(), gen_random_uuid(), '{}')`);
    assert.deepEqual(await migrate(db), [1]);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM rooms')).rows[0].n, 1);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM room_commands')).rows[0].n, 1);
    // 之后追加的迁移能在已有数据上执行。
    assert.deepEqual(await migrate(db, [...MIGRATIONS, addColumn]), [2]);
    assert.equal((await db.query(`SELECT note FROM rooms WHERE code='123456'`)).rows[0].note, null);
  });
});

test('同一批中有一条失败时整批回滚', async () => {
  await withSchema(async (pool, schema) => {
    const db = pool();
    await migrate(db);
    const broken: Migration = { version: 3, name: '测试：写错的迁移', sql: 'ALTER TABLE not_exists ADD COLUMN x TEXT' };
    await assert.rejects(migrate(db, [...MIGRATIONS, addColumn, broken]), /not_exists/);
    assert.deepEqual(await applied(db), [1]);
    const columns = (await db.query('SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2', [schema, 'rooms'])).rows.map(r => r.column_name);
    assert.equal(columns.includes('note'), false);
  });
});

test('多个进程同时启动：每条迁移只执行一次', async () => {
  await withSchema(async (pool) => {
    const results = await Promise.all(Array.from({ length: 4 }, () => migrate(pool(), [...MIGRATIONS, addColumn])));
    assert.deepEqual(results.flat().sort(), [1, 2]);
    assert.deepEqual(await applied(pool()), [1, 2]);
  });
});

test('回滚到旧版本代码时照常启动；版本号不递增时拒绝执行', async () => {
  await withSchema(async (pool) => {
    const db = pool();
    await migrate(db, [...MIGRATIONS, addColumn]);
    assert.deepEqual(await migrate(db), []);
    await assert.rejects(migrate(db, [addColumn, MIGRATIONS[0]!]), /递增/);
    await assert.rejects(migrate(db, [{ ...addColumn, version: 0 }]), /递增/);
  });
});
