import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { MySQLDriver } from 'src/services/base/mysql';
import { Redis } from 'src/services/base/redis/Redis';

/** 验证响应丢失时不会透明重放已经执行的数据库命令。 */
async function main(): Promise<void> {
  const failure = Object.assign(new Error('响应丢失'), { code: 'ECONNRESET' });
  const database = new MySQLDriver({ host: '127.0.0.1' });
  try {
    for (const method of ['execute', 'query'] as const) {
      let executions = 0;
      const mocked = mock.method(database.getPool(), method, async () => {
        executions++;
        if (executions === 1) throw failure;
        return [{ affectedRows: 1, insertId: 1 }, []];
      });
      try {
        await assert.rejects(
          database[method]('UPDATE counters SET value = value + 1'),
          (error: unknown) => error === failure,
        );
        assert.equal(executions, 1, `${method} 不能自动重放`);
        await database[method]('UPDATE counters SET value = value + 1');
        assert.equal(executions, 2, '后续显式调用仍能执行');
      } finally {
        mocked.mock.restore();
      }
    }
  } finally {
    await database.close();
  }

  const redis = Redis.create({ host: '127.0.0.1', port: 6379 });
  const internals = redis as unknown as {
    client: object | null;
    proxiedClient: { incr(key: string): Promise<number> };
    createProxiedClient(): void;
    recreateConnection(): Promise<void>;
  };
  let increments = 0;
  internals.client = {
    async incr() {
      increments++;
      if (increments === 1) throw failure;
      return increments;
    },
  };
  const reconnect = mock.method(
    internals,
    'recreateConnection',
    async () => {},
  );
  try {
    internals.createProxiedClient();
    await assert.rejects(
      internals.proxiedClient.incr('counter'),
      (error: unknown) => error === failure,
    );
    assert.equal(increments, 1, 'Redis INCR 不能自动重放');
    assert.equal(await internals.proxiedClient.incr('counter'), 2);
  } finally {
    reconnect.mock.restore();
    internals.client = null;
    await redis.close();
  }
  console.log('MySQL 与 Redis 命令响应丢失安全测试通过');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
