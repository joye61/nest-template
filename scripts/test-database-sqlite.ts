import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { Database, SQLiteDriver } from '../src/services/base/database';
import { SQLiteService } from '../src/services/base/SQLiteService';
import { TableService } from '../src/services/base/TableService';
import { shouldUseSQLiteForTableService } from '../src/services/base/module';

interface UserRow {
  id: number;
  email: string;
  name: string;
  score: number;
}

async function main(): Promise<void> {
  const db = Database.create('sqlite::memory:');
  assert.equal(db.getDriver().type, 'sqlite');
  assert.equal(db.getDialect().type, 'sqlite');
  assert.equal(await db.ping(), true);

  await db.execute(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      score INTEGER NOT NULL DEFAULT 0
    )
  `);

  const users = db.table('users');
  const inserted = await users.adds([
    { email: 'alice@example.com', name: 'Alice', score: 10 },
    { email: 'bob@example.com', name: 'Bob', score: 20 },
    { email: 'carol@example.com', name: 'Carol', score: 30 },
  ]);
  assert.equal(inserted.affectedRows, 3);
  assert.equal(inserted.insertId, 3);

  const page = await users.gets<UserRow>({
    where: { score: { gte: 10 } },
    order: { score: 'DESC' },
    limit: 1,
    offset: 1,
  });
  assert.equal(page[0].email, 'bob@example.com');
  assert.equal(await users.count(), 3);
  assert.equal(await users.exists({ email: 'alice@example.com' }), true);

  const regexpRows = await users.gets<UserRow>({
    where: { email: { rlike: '^(alice|bob)@' } },
    order: { id: 'ASC' },
  });
  assert.deepEqual(
    regexpRows.map((row) => row.name),
    ['Alice', 'Bob'],
  );

  const updated = await users.update({
    data: { score: { increment: 5 } },
    where: { score: { gte: 10 } },
    order: { score: 'DESC' },
    limit: 1,
  });
  assert.equal(updated.affectedRows, 1);
  assert.equal(
    (await users.get<UserRow>({ where: { email: 'carol@example.com' } }))
      ?.score,
    35,
  );

  const upserted = await users.upsert({
    data: { email: 'alice@example.com', name: 'Alice 2', score: 1 },
    uniqueKeys: ['email'],
    updateData: { name: 'Alice 2', score: { increment: 2 } },
  });
  assert.equal(upserted.affectedRows, 1);
  assert.equal(upserted.action, undefined);
  assert.equal(upserted.insertId, undefined);
  assert.equal(
    (await users.get<UserRow>({ where: { email: 'alice@example.com' } }))
      ?.score,
    12,
  );

  await assert.rejects(
    db.transaction(async () => {
      await users.add({
        email: 'rollback@example.com',
        name: 'Rollback',
        score: 0,
      });
      throw new Error('触发回滚');
    }),
    /触发回滚/,
  );
  assert.equal(await users.exists({ email: 'rollback@example.com' }), false);

  const countBeforeIsolationTest = await users.count();
  let notifyTransactionStarted!: () => void;
  let releaseTransaction!: () => void;
  const transactionStarted = new Promise<void>((resolve) => {
    notifyTransactionStarted = resolve;
  });
  const transactionGate = new Promise<void>((resolve) => {
    releaseTransaction = resolve;
  });
  const isolatedTransaction = assert.rejects(
    db.transaction(async () => {
      await users.add({
        email: 'isolated@example.com',
        name: 'Isolated',
        score: 0,
      });
      notifyTransactionStarted();
      await transactionGate;
      throw new Error('隔离事务回滚');
    }),
    /隔离事务回滚/,
  );
  await transactionStarted;
  const outsideCount = users.count();
  releaseTransaction();
  await isolatedTransaction;
  assert.equal(await outsideCount, countBeforeIsolationTest);

  await db.transaction(async () => {
    await users.add({ email: 'commit@example.com', name: 'Commit', score: 5 });
    await db.transaction(async () => {
      await users.update({
        data: { score: { increment: 1 } },
        where: { email: 'commit@example.com' },
      });
    });
  });
  assert.equal(
    (await users.get<UserRow>({ where: { email: 'commit@example.com' } }))
      ?.score,
    6,
  );

  const removed = await users.remove({
    where: { score: { lt: 20 } },
    order: { id: 'DESC' },
    limit: 1,
  });
  assert.equal(removed.affectedRows, 1);

  const driver = db.getDriver() as SQLiteDriver;
  assert.match(driver.format('SELECT ? AS value', ["O'Reilly"]), /O''Reilly/);

  const sqliteService = new SQLiteService(
    new ConfigService({ SQLITE_URL_DEFAULT: 'sqlite::memory:' }),
  );
  assert.equal(sqliteService.database('DEFAULT'), db);
  await sqliteService.database('default').execute(`
    CREATE TABLE example (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL
    )
  `);
  const tableService = new TableService(sqliteService);
  assert.equal(tableService.example, sqliteService.table('example'));
  await tableService.example.add({ name: 'SQLite TableService' });
  assert.equal(
    (await tableService.example.get<{ name: string }>({ where: { id: 1 } }))
      ?.name,
    'SQLite TableService',
  );

  assert.equal(
    shouldUseSQLiteForTableService(
      new ConfigService({ sqlite: { default: { filename: ':memory:' } } }),
    ),
    true,
  );
  assert.equal(
    shouldUseSQLiteForTableService(
      new ConfigService({ mysql: { default: { database: 'app' } } }),
    ),
    false,
  );
  assert.throws(
    () =>
      new SQLiteService(
        new ConfigService({
          sqlite: { default: { connectionString: 'mysql://root@localhost/app' } },
        }),
      ).database('default'),
    /sqlite\.default\.connectionString 不是有效的 SQLite 连接地址/,
  );

  await Database.closeAll();
  console.log('SQLite 数据库封装集成测试通过');
}

main().catch(async (error) => {
  await Database.closeAll();
  console.error(error);
  process.exitCode = 1;
});
