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
const latest = MIGRATIONS.at(-1)!.version;
const addColumn: Migration = { version: latest + 1, name: '测试：加一列', sql: 'ALTER TABLE rooms ADD COLUMN note TEXT' };
const all = MIGRATIONS.map(m => m.version);

test('全新的库：建好全部表，重复启动不会重复执行', async () => {
  await withSchema(async (pool, schema) => {
    const db = pool();
    assert.deepEqual(await migrate(db), all);
    assert.deepEqual(await tables(db, schema), ['room_commands', 'room_rounds', 'rooms', 'schema_migrations']);
    assert.deepEqual(await migrate(db), []);
    assert.deepEqual(await applied(db), all);
  });
});

test('引入迁移之前的旧库：只记录版本，已有数据不丢', async () => {
  await withSchema(async (pool) => {
    const db = pool();
    // 模拟线上现状：表已由旧的启动建表语句建好，但没有 schema_migrations。
    await db.query(MIGRATIONS[0]!.sql);
    await db.query(`INSERT INTO rooms (code, state) VALUES ('123456', '{"code":"123456"}')`);
    await db.query(`INSERT INTO room_commands (room_code, request_id, actor_id, payload) VALUES ('123456', gen_random_uuid(), gen_random_uuid(), '{}')`);
    assert.deepEqual(await migrate(db), all);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM rooms')).rows[0].n, 1);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM room_commands')).rows[0].n, 1);
    // 之后追加的迁移能在已有数据上执行。
    assert.deepEqual(await migrate(db, [...MIGRATIONS, addColumn]), [addColumn.version]);
    assert.equal((await db.query(`SELECT note FROM rooms WHERE code='123456'`)).rows[0].note, null);
  });
});

test('同一批中有一条失败时整批回滚', async () => {
  await withSchema(async (pool, schema) => {
    const db = pool();
    await migrate(db);
    const broken: Migration = { version: latest + 2, name: '测试：写错的迁移', sql: 'ALTER TABLE not_exists ADD COLUMN x TEXT' };
    await assert.rejects(migrate(db, [...MIGRATIONS, addColumn, broken]), /not_exists/);
    assert.deepEqual(await applied(db), all);
    const columns = (await db.query('SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2', [schema, 'rooms'])).rows.map(r => r.column_name);
    assert.equal(columns.includes('note'), false);
  });
});

test('多个进程同时启动：每条迁移只执行一次', async () => {
  await withSchema(async (pool) => {
    const results = await Promise.all(Array.from({ length: 4 }, () => migrate(pool(), [...MIGRATIONS, addColumn])));
    assert.deepEqual(results.flat().sort((a, b) => a - b), [...all, addColumn.version]);
    assert.deepEqual(await applied(pool()), [...all, addColumn.version]);
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

test('迁移 2：历史局从房间状态搬到 room_rounds 表', async () => {
  await withSchema(async (pool) => {
    const db = pool();
    await migrate(db, MIGRATIONS.slice(0, 1));
    const round = (id: string) => ({ id, initialScore: 100, rules: {}, members: [], events: [{ id: `${id}-e` }], startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-01-01T00:10:00Z' });
    await db.query(`INSERT INTO rooms (code, state, updated_at) VALUES
      ('111111', $1, now() - interval '3 days'),
      ('222222', '{"code":"222222","events":[]}', now()),
      ('333333', '{"code":"333333","rounds":[]}', now())`, [JSON.stringify({ code: '111111', version: 5, events: [], rounds: [round('r1'), round('r2')] })]);
    const before = (await db.query(`SELECT updated_at FROM rooms WHERE code='111111'`)).rows[0].updated_at;
    assert.deepEqual(await migrate(db), all.slice(1));
    const rows = (await db.query('SELECT room_code, round_id, seq, record FROM room_rounds ORDER BY room_code, seq')).rows;
    assert.deepEqual(rows.map(r => [r.room_code, r.round_id, r.seq]), [['111111', 'r1', 1], ['111111', 'r2', 2]]);
    assert.deepEqual(rows[1].record, round('r2'));
    const states = Object.fromEntries((await db.query('SELECT code, state, updated_at FROM rooms')).rows.map(r => [r.code, r]));
    assert.deepEqual(states['111111'].state, { code: '111111', version: 5, events: [], roundCount: 2 });
    // 搬迁不算房间活动，不影响过期清理。
    assert.equal(states['111111'].updated_at.getTime(), before.getTime());
    assert.deepEqual(states['222222'].state, { code: '222222', events: [] });
    assert.deepEqual(states['333333'].state, { code: '333333', roundCount: 0 });
    // 删除房间时历史局一起删除。
    await db.query(`DELETE FROM rooms WHERE code='111111'`);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM room_rounds')).rows[0].n, 0);
  });
});
