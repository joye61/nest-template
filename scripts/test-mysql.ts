import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mock } from 'node:test';
import { ConfigService } from '@nestjs/config';
import type { PoolConnection } from 'mysql2/promise';
import { Database, SQLBuilder, Table } from 'src/services/base/mysql';
import { MySQLService } from 'src/services/base/MySQLService';
import { TableService } from 'src/services/base/TableService';
import { Log } from 'src/common/Log';

/** 验证 MySQL SQL 构建、连接配置、表操作和事务路由，不连接外部服务。 */
async function main(): Promise<void> {
  const builder = new SQLBuilder();
  assert.deepEqual(
    builder.buildSelect({
      table: 'users',
      fields: 'users.id',
      where: { active: true, OR: [{ name: 'Alice' }, { score: { gte: 10 } }] },
      join: { teams: { type: 'LEFT', on: 'users.team_id = teams.id' } },
      groupBy: 'users.id',
      having: ['COUNT(*) > ?', [1]],
      order: { id: 'desc' },
      limit: 5,
      offset: 10,
    }),
    {
      prepare:
        'SELECT users.id FROM `users` LEFT JOIN `teams` ON users.team_id = teams.id WHERE `active` = ? AND ( `name` = ? OR `score` >= ? ) GROUP BY `users`.`id` HAVING COUNT(*) > ? ORDER BY `id` DESC LIMIT 10, 5',
      holders: [1, 'Alice', 10, 1],
    },
  );
  assert.deepEqual(
    builder.buildInsert({
      table: 'users',
      data: [{ name: 'Alice' }, { name: 'Bob' }],
    }),
    {
      prepare: 'INSERT INTO `users` (`name`) VALUES (?), (?)',
      holders: ['Alice', 'Bob'],
    },
  );
  assert.deepEqual(
    builder.buildUpdate({
      table: 'users',
      data: { score: { increment: 2 } },
      where: { id: 1 },
      order: { id: 'ASC' },
      limit: 1,
    }),
    {
      prepare:
        'UPDATE `users` SET `score` = `score` + ? WHERE `id` = ? ORDER BY `id` ASC LIMIT 1',
      holders: [2, 1],
    },
  );
  assert.deepEqual(
    builder.buildDelete({ table: 'users', where: { id: 1 }, limit: 1 }),
    { prepare: 'DELETE FROM `users` WHERE `id` = ? LIMIT 1', holders: [1] },
  );
  assert.deepEqual(builder.buildCount({ table: 'users' }), {
    prepare: 'SELECT COUNT(*) as `total_num` FROM `users`',
    holders: [],
  });
  assert.deepEqual(builder.buildExists({ table: 'users', where: { id: 1 } }), {
    prepare: 'SELECT 1 FROM `users` WHERE `id` = ? LIMIT 1',
    holders: [1],
  });
  assert.deepEqual(
    builder.buildUpsert({
      table: 'users',
      data: { id: 1, score: 10 },
      uniqueKeys: ['id'],
      updateData: { score: { increment: 2 } },
    }),
    {
      prepare:
        'INSERT INTO `users` (`id`, `score`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `score` = `score` + ?',
      holders: [1, 10, 2],
    },
  );
  assert.match(
    builder.buildUpsert({ table: 'users', data: { id: 1 }, uniqueKeys: ['id'] })
      .prepare,
    /ON DUPLICATE KEY UPDATE `id` = `id`$/,
  );
  assert.throws(
    () => builder.createJoin({ users: { type: 'FULL' as never, on: '1=1' } }),
    /Invalid JOIN type/,
  );
  const date = new Date('2026-09-17T00:00:00Z');
  assert.equal(builder.createFilter('created_at', date).holders[0], date);
  assert.deepEqual(builder.createFilter('name', null), {
    prepare: '`name` IS NULL',
    holders: [],
  });
  assert.match(
    builder.createFilter('name', { notRlike: '^A' }).prepare,
    /NOT RLIKE/,
  );

  const config = {
    host: '127.0.0.1',
    database: 'mysql_test',
    timezone: '+08:00',
  };
  const db = Database.create(config);
  try {
    assert.equal(
      db,
      Database.create({
        timezone: '+08:00',
        database: 'mysql_test',
        host: '127.0.0.1',
      }),
    );
    assert.notEqual(db, Database.create({ ...config, timezone: 'Z' }));
    assert.notEqual(
      db,
      Database.create({ ...config, waitForConnections: false }),
    );
    assert.throws(
      () => Database.create('postgresql://localhost/test'),
      /mysql:/,
    );
    const service = new MySQLService(
      new ConfigService({ mysql: { default: config } }),
    );
    assert.equal(service.database('DEFAULT'), db);
    assert.equal(service.table('default::users'), db.table('users'));
    assert.equal(new TableService(service).example, db.table('example'));
    const url = 'mysql://root@127.0.0.1/mysql_test';
    const urlService = new MySQLService(
      new ConfigService({ MYSQL_URL_DEFAULT: url }),
    );
    assert.equal(urlService.database('default'), Database.create(url));

    const overrides = {
      timezone: 'Z',
      connectionLimit: 3,
      queueLimit: 7,
      waitForConnections: false,
      enableKeepAlive: false,
      connectTimeout: 0,
      keepAliveInitialDelay: 123,
    };
    const params = new URLSearchParams(
      Object.entries(overrides).map(([key, value]) => [key, String(value)]),
    );
    for (const input of [
      `${url}?${params}&flags=FOUND_ROWS`,
      { ...config, ...overrides },
      url,
      { ...config, timezone: undefined, connectTimeout: undefined },
    ]) {
      const database = Database.create(input);
      const actual = (
        database.getDriver().getPool() as unknown as {
          pool: {
            config: {
              connectionLimit: number;
              queueLimit: number;
              waitForConnections: boolean;
              connectionConfig: Record<string, unknown>;
            };
          };
        }
      ).pool.config;
      const custom =
        typeof input === 'string'
          ? input.includes('?')
          : input.timezone === 'Z';
      assert.equal(actual.connectionLimit, custom ? 3 : 10);
      assert.equal(actual.queueLimit, custom ? 7 : 0);
      assert.equal(actual.waitForConnections, !custom);
      assert.equal(actual.connectionConfig.timezone, custom ? 'Z' : '+08:00');
      assert.equal(actual.connectionConfig.enableKeepAlive, !custom);
      assert.equal(actual.connectionConfig.connectTimeout, custom ? 0 : 10000);
      assert.equal(
        actual.connectionConfig.keepAliveInitialDelay,
        custom ? 123 : 0,
      );
      assert.equal(Number(actual.connectionConfig.clientFlags) & 2, 0);
    }

    const pool = db.getDriver().getPool();
    for (const database of [db, Database.create(url)]) {
      const poolConfig = (
        database.getDriver().getPool() as unknown as {
          pool: { config: { connectionConfig: { clientFlags: number } } };
        }
      ).pool.config.connectionConfig;
      assert.equal(
        poolConfig.clientFlags & 2,
        0,
        '禁用 FOUND_ROWS，避免误判 UPSERT',
      );
    }
    const users = db.table('users');
    let header = { affectedRows: 2, insertId: 7 };
    const execute = mock.method(pool, 'execute', async () => [header, []]);
    let rows: object[] = [{ id: 1 }];
    const query = mock.method(pool, 'query', async () => [rows, []]);
    try {
      const added = await users.adds([{ name: 'Alice' }, { name: 'Bob' }]);
      assert.deepEqual(added, { type: 'insert', affectedRows: 2, insertId: 7 });
      assert.equal(users.getLastResult(), added);
      await assert.rejects(
        users.adds([{ name: 'Alice' }, { score: 1 }]),
        /different fields/,
      );
      assert.deepEqual(await users.get({ where: { id: 1 } }), { id: 1 });
      rows = [];
      assert.equal(await users.get(), null);
      assert.equal(await users.exists(), false);
      rows = [{ total_num: 3 }];
      assert.equal(await users.count(), 3);
      assert.equal((await users.update({ data: {} })).affectedRows, 0);
      for (const [affectedRows, action] of [
        [1, 'insert'],
        [2, 'update'],
        [0, 'update'],
      ] as const) {
        header = { affectedRows, insertId: affectedRows === 1 ? 8 : 0 };
        const result = await users.upsert({
          data: { id: 1 },
          uniqueKeys: ['id'],
        });
        assert.equal(result.action, action);
        assert.equal(result.insertId, affectedRows === 1 ? 8 : undefined);
      }
      header = { affectedRows: 1, insertId: 0 };
      assert.equal(
        (await users.update({ data: { score: 1 }, where: { id: 1 } }))
          .affectedRows,
        1,
      );
      assert.equal((await users.remove({ where: { id: 1 } })).affectedRows, 1);

      const previousLog = process.env.SHOW_SQL_LOG;
      const log = mock.method(Log, 'v', () => {});
      try {
        process.env.SHOW_SQL_LOG = 'on';
        await users.get();
        await db.query('SELECT ?', [1]);
        await db.getDriver().execute('UPDATE users SET score = ?', [2]);
        const written = await service.execute(
          'default:: UPDATE users SET score = ? ',
          [3],
        );
        assert.deepEqual(written, { affectedRows: 1, insertId: undefined });
        assert.equal(
          log.mock.callCount(),
          4,
          '不同入口执行的 SQL 均只记录一次',
        );
        assert.deepEqual(execute.mock.calls.at(-1)?.arguments, [
          'UPDATE users SET score = ?',
          [3],
        ]);
        process.env.SHOW_SQL_LOG = 'off';
        await service.query('SELECT 1');
        assert.equal(log.mock.callCount(), 4);
      } finally {
        log.mock.restore();
        if (previousLog === undefined) delete process.env.SHOW_SQL_LOG;
        else process.env.SHOW_SQL_LOG = previousLog;
      }

      const parentResult = users.getLastResult();
      let notifyFirst!: () => void;
      let releaseFirst!: () => void;
      const firstReady = new Promise<void>((resolve) => {
        notifyFirst = resolve;
      });
      const firstGate = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const first = Table.withResultContext(async () => {
        assert.equal(users.getLastResult(), undefined);
        const own = await users.update({ data: {} });
        notifyFirst();
        await firstGate;
        assert.equal(users.getLastResult(), own, '其他上下文不能覆盖当前结果');
        return own;
      });
      await firstReady;
      try {
        await Table.withResultContext(async () => {
          assert.equal(users.getLastResult(), undefined);
          const own = await users.remove({ where: { id: 1 } });
          await Table.withResultContext(async () => {
            assert.equal(users.getLastResult(), undefined);
            await users.update({ data: {} });
          });
          assert.equal(users.getLastResult(), own, '子上下文不能覆盖父上下文');
          const other = db.table('other');
          await other.update({ data: {} });
          assert.equal(users.getLastResult(), own, '不同表的结果彼此独立');
          const failed = mock.method(pool, 'execute', async () => {
            throw new Error('写入失败');
          });
          try {
            await assert.rejects(
              users.remove({ where: { id: 1 } }),
              /写入失败/,
            );
            assert.equal(
              users.getLastResult(),
              own,
              '失败写入保留上一次成功结果',
            );
          } finally {
            failed.mock.restore();
          }
        });
      } finally {
        releaseFirst();
        await first;
      }
      assert.equal(users.getLastResult(), parentResult);

      for (const fail of [false, true]) {
        let resume!: ReturnType<typeof AsyncLocalStorage.snapshot>;
        const task = Table.withResultContext(async () => {
          await users.update({ data: {} });
          resume = AsyncLocalStorage.snapshot();
          assert.ok(users.getLastResult());
          if (fail) throw new Error('上下文失败');
          return 42;
        });
        if (fail) await assert.rejects(task, /上下文失败/);
        else assert.equal(await task, 42);
        await resume(async () => {
          assert.equal(
            users.getLastResult(),
            undefined,
            '已结束上下文不再保留结果',
          );
          await users.update({ data: {} });
          assert.equal(
            users.getLastResult(),
            undefined,
            '延迟写入不能复活已结束上下文',
          );
        });
      }
      await assert.rejects(
        Table.withResultContext(() => {
          throw new Error('同步失败');
        }),
        /同步失败/,
      );
      assert.equal(users.getLastResult(), parentResult);
    } finally {
      execute.mock.restore();
      query.mock.restore();
    }

    const events: string[][] = [];
    const connection = mock.method(pool, 'getConnection', async () => {
      const calls: string[] = [];
      events.push(calls);
      return {
        async beginTransaction() {
          calls.push('begin');
        },
        async commit() {
          calls.push('commit');
        },
        async rollback() {
          calls.push('rollback');
        },
        release() {
          calls.push('release');
        },
        async execute(sql: string) {
          calls.push(sql);
          return [{ affectedRows: 1, insertId: 0 }, []];
        },
        async query(sql: string) {
          calls.push(sql);
          return [[{ id: 1 }], []];
        },
      } as unknown as PoolConnection;
    });
    let notifyStarted!: () => void;
    let releaseTransaction!: () => void;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releaseTransaction = resolve;
    });
    const failure = new Error('事务回滚');
    const outside = mock.method(pool, 'query', async () => [[], []]);
    try {
      const pending = assert.rejects(
        db.transaction(async () => {
          await db.execute('first');
          notifyStarted();
          await gate;
          throw failure;
        }),
        (error) => error === failure,
      );
      await started;
      try {
        await db.query('outside');
        assert.equal(outside.mock.callCount(), 1);
        await db.transaction(async () => {
          await service.execute('default::second');
          await db.transaction(async () => {
            await db.query('nested');
          });
        });
      } finally {
        releaseTransaction();
        await pending;
      }
      assert.deepEqual(events, [
        ['begin', 'first', 'rollback', 'release'],
        ['begin', 'second', 'nested', 'commit', 'release'],
      ]);

      for (const fail of [false, true]) {
        let resume!: ReturnType<typeof AsyncLocalStorage.snapshot>;
        const task = db.transaction(async () => {
          resume = AsyncLocalStorage.snapshot();
          assert.equal(await db.ping(), true);
          if (fail) throw failure;
          return 42;
        });
        if (fail) await assert.rejects(task, (error) => error === failure);
        else assert.equal(await task, 42);
        const before = events.map((calls) => [...calls]);
        const outsideCalls = outside.mock.callCount();
        await resume(async () => {
          await assert.rejects(db.query('late query'), /事务上下文已结束/);
          await assert.rejects(db.execute('late write'), /事务上下文已结束/);
          await assert.rejects(
            db.transaction(() => 'late nested'),
            /事务上下文已结束/,
          );
          assert.equal(await db.ping(), false);
        });
        assert.deepEqual(events, before, '结束后的事务不能再次使用或申请连接');
        assert.equal(
          outside.mock.callCount(),
          outsideCalls,
          '不能回退到连接池执行',
        );
        assert.deepEqual(events.at(-1), [
          'begin',
          'SELECT 1',
          fail ? 'rollback' : 'commit',
          'release',
        ]);
      }
    } finally {
      connection.mock.restore();
      outside.mock.restore();
    }
  } finally {
    await Database.closeAll();
  }
  console.log('MySQL 构建器、配置、表操作和事务测试通过');
}

Table.withResultContext(main)
  .then(async () => {
    const db = Database.create({ host: '127.0.0.1' });
    try {
      const users = db.table('users');
      const result = await users.update({ data: {} });
      assert.equal(result.affectedRows, 0);
      assert.equal(
        users.getLastResult(),
        undefined,
        '未建立上下文时不保存共享结果',
      );
    } finally {
      await Database.closeAll();
    }
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
