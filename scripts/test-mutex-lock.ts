import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { mock } from 'node:test';
import { MutexLock } from 'src/services/base/MutexLock';
import { RedisService } from 'src/services/base/RedisService';

/** 使用内存 Redis 替身验证多实例锁的续租与释放。 */
async function main(): Promise<void> {
  const held = new Map<string, string>();
  const renewed = new Set<string>();
  const redis = {
    async client(name = 'default') {
      return {
        async set(key: string, value: string) {
          const identity = JSON.stringify([name.toLowerCase(), key]);
          if (held.has(identity)) return null;
          held.set(identity, value);
          return 'OK';
        },
        async eval(
          script: string,
          options: { keys: string[]; arguments: string[] },
        ) {
          const identity = JSON.stringify([
            name.toLowerCase(),
            options.keys[0],
          ]);
          if (held.get(identity) !== options.arguments[0]) return 0;
          if (script.includes('PEXPIRE')) {
            renewed.add(identity);
          } else {
            held.delete(identity);
          }
          return 1;
        },
      };
    },
  };
  const lock = new MutexLock(redis as unknown as RedisService);
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const started = ['cache', 'session'].map(() => {
    let ready!: () => void;
    const promise = new Promise<void>((resolve) => {
      ready = resolve;
    });
    return { ready, promise };
  });

  mock.timers.enable({ apis: ['setInterval'] });
  const tasks = ['cache', 'session'].map((redisName, index) =>
    lock.safeRun(
      'same-key',
      async () => {
        started[index].ready();
        await pending;
        return redisName;
      },
      { redisName, ttlMs: 5000 },
    ),
  );

  try {
    await Promise.all(started.map(({ promise }) => promise));
    assert.equal(held.size, 2);
    assert.deepEqual(
      await lock.safeRun(
        'same-key',
        () => {
          assert.fail('竞争失败时不应执行任务');
        },
        { redisName: 'CACHE' },
      ),
      { ok: false },
    );

    mock.timers.tick(2500);
    await setImmediate();
    assert.equal(renewed.size, 2, '不同 Redis 实例的同名锁都应续租');
    await lock.releaseAllHeldLocks();
    assert.equal(held.size, 0, '批量释放不能遗漏其他 Redis 实例的锁');
  } finally {
    finish();
    await Promise.all(tasks);
    await lock.onModuleDestroy();
    mock.timers.reset();
  }

  const failure = new Error('任务失败');
  await assert.rejects(
    lock.safeRun('failure', () => {
      throw failure;
    }),
    (error: unknown) => error === failure,
  );
  assert.equal(held.size, 0, '任务异常后仍应释放锁');
  assert.deepEqual(await lock.safeRun('success', () => 42), {
    ok: true,
    result: 42,
  });
  assert.equal(held.size, 0);
  console.log('分布式锁多实例、续租和异常清理测试通过');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
