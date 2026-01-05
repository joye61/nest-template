import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { RedisClientType } from 'redis';
import * as os from 'os';
import { RedisService } from './RedisService';

/**
 * 分布式锁配置选项
 */
export type SafeRunOptions = {
  ttlMs?: number; // 锁 TTL（毫秒）
  autoRenew?: boolean; // 是否自动续租
  renewIntervalRatio?: number; // 续租间隔 / ttl 比率
  prefix?: string; // key 前缀（namespace）
  redisName?: string; // Redis 实例名称（默认 'default'）
};

/**
 * 自动续租记录
 */
type RenewRecord = {
  value: string;
  timer?: NodeJS.Timeout;
  consecutiveRenewFailures: number;
};

/**
 * 分布式互斥锁服务
 *
 * 功能：
 * - 基于 Redis 的分布式锁实现
 * - 支持自动续租机制
 * - 安全释放（owner 校验）
 * - 模块销毁时自动清理
 * - 支持多 Redis 实例
 */
@Injectable()
export class MutexLock implements OnModuleDestroy {
  static readonly KEY_PREFIX = 'NT.MutexLock.';

  // TTL 配置常量
  private static readonly DEFAULT_TTL_MS = 30_000; // 30s
  private static readonly MIN_TTL_MS = 5_000; // 5s
  private static readonly MAX_TTL_MS = 600_000; // 10min
  private static readonly DEFAULT_AUTO_RENEW = true;
  private static readonly DEFAULT_RENEW_RATIO = 0.5;
  private static readonly MAX_RENEW_FAILURES = 3;
  private static readonly MIN_RENEW_INTERVAL_MS = 1_000;

  private readonly ownerId: string;
  private readonly renewMap = new Map<string, RenewRecord>();

  // Lua 脚本：安全释放锁
  private readonly releaseScript = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("DEL", KEYS[1])
    else
      return 0
    end
  `;

  // Lua 脚本：安全延长 TTL
  private readonly extendScript = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("PEXPIRE", KEYS[1], ARGV[2])
    else
      return 0
    end
  `;

  constructor(private readonly redis: RedisService) {
    this.ownerId = this.generateOwnerId();
  }

  /**
   * 获取 Redis 客户端
   */
  private async getClient(redisName?: string): Promise<RedisClientType> {
    return this.redis.client(redisName);
  }

  /**
   * 生成唯一的 owner ID
   */
  private generateOwnerId(): string {
    const hostname = os.hostname();
    const pid = process.pid;
    const random = Math.random().toString(36).slice(2, 10);
    return `${hostname}:${pid}:${random}`;
  }

  /**
   * 生成锁的唯一值
   */
  private generateLockValue(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).slice(2, 8);
    return `${this.ownerId}:${timestamp}:${random}`;
  }

  /**
   * 构建完整的锁 key
   */
  private buildLockKey(key: string, prefix?: string): string {
    const namespace = prefix?.trim() || 'mutex';
    const lockKey = key.trim();
    return `${namespace}:${lockKey}`;
  }

  /**
   * 规范化 TTL 值
   */
  private normalizeTtl(ttl?: number): number {
    const value = ttl ?? MutexLock.DEFAULT_TTL_MS;
    return Math.max(
      MutexLock.MIN_TTL_MS,
      Math.min(value, MutexLock.MAX_TTL_MS),
    );
  }

  /**
   * 尝试获取锁（单次，不重试）
   */
  private async acquire(
    key: string,
    ttl: number,
    redisName?: string,
  ): Promise<{ acquired: boolean; value?: string }> {
    const value = this.generateLockValue();
    try {
      const client = await this.getClient(redisName);
      const res = await client.set(key, value, { NX: true, PX: ttl });
      const acquired = res === 'OK';
      return { acquired, value: acquired ? value : undefined };
    } catch {
      return { acquired: false };
    }
  }

  /**
   * 安全释放锁（仅当 value 匹配时）
   */
  private async releaseLock(
    key: string,
    value: string,
    redisName?: string,
  ): Promise<boolean> {
    try {
      const client = await this.getClient(redisName);
      const res = await client.eval(this.releaseScript, {
        keys: [key],
        arguments: [value],
      });
      return res === 1;
    } catch {
      return false;
    }
  }

  /**
   * 安全延长锁 TTL（仅当 value 匹配时）
   */
  private async extendLockTtl(
    key: string,
    value: string,
    ttlMs: number,
    redisName?: string,
  ): Promise<boolean> {
    try {
      const client = await this.getClient(redisName);
      const res = await client.eval(this.extendScript, {
        keys: [key],
        arguments: [value, String(ttlMs)],
      });
      return res === 1;
    } catch {
      return false;
    }
  }

  /**
   * 启动自动续租
   */
  private startAutoRenew(
    key: string,
    value: string,
    ttlMs: number,
    ratio: number,
    redisName?: string,
  ): void {
    const existingRecord = this.renewMap.get(key);
    
    // 如果已有相同 value 的续租，无需重复启动
    if (existingRecord?.value === value) {
      return;
    }
    
    // 清理旧的续租记录
    if (existingRecord) {
      this.clearRenewTimer(existingRecord);
      this.renewMap.delete(key);
    }

    const interval = Math.max(
      MutexLock.MIN_RENEW_INTERVAL_MS,
      Math.floor(ttlMs * ratio),
    );
    const record: RenewRecord = { value, consecutiveRenewFailures: 0 };

    const timer = setInterval(async () => {
      const success = await this.extendLockTtl(key, value, ttlMs, redisName);
      
      if (success) {
        record.consecutiveRenewFailures = 0;
      } else {
        record.consecutiveRenewFailures++;
        // 连续失败次数过多，停止续租
        if (record.consecutiveRenewFailures >= MutexLock.MAX_RENEW_FAILURES) {
          this.stopAutoRenew(key, value, redisName);
        }
      }
    }, interval);

    timer.unref?.();
    record.timer = timer;
    this.renewMap.set(key, record);
  }

  /**
   * 停止自动续租（仅当 value 匹配时）
   */
  private stopAutoRenew(key: string, value: string, redisName?: string): void {
    const record = this.renewMap.get(key);
    if (!record || record.value !== value) {
      return;
    }
    this.clearRenewTimer(record);
    this.renewMap.delete(key);
  }

  /**
   * 强制停止自动续租
   */
  private forceStopAutoRenew(key: string): void {
    const record = this.renewMap.get(key);
    if (!record) {
      return;
    }
    this.clearRenewTimer(record);
    this.renewMap.delete(key);
  }

  /**
   * 清理续租定时器
   */
  private clearRenewTimer(record: RenewRecord): void {
    if (record.timer) {
      clearInterval(record.timer);
    }
  }

  /**
   * 释放锁并停止自动续租
   */
  private async releaseAndStopRenew(
    key: string,
    value: string,
    redisName?: string,
  ): Promise<void> {
    this.stopAutoRenew(key, value, redisName);
    try {
      await this.releaseLock(key, value, redisName);
    } catch {
      // 忽略释放失败
    }
  }

  /**
   * 单次尝试获取锁并执行任务（不重试）
   * 
   * 成功获取锁后执行 task，无论成功或失败都会尝试释放锁
   *
   * @param key - 锁的 key
   * @param task - 需要执行的任务
   * @param opts - 锁的配置选项
   * @returns { ok: boolean, result?: T }
   */
  async safeRun<T = any>(
    key: string,
    task: () => Promise<T> | T,
    opts?: SafeRunOptions,
  ): Promise<{ ok: boolean; result?: T }> {
    const prefix = opts?.prefix ?? MutexLock.KEY_PREFIX;
    const lockKey = this.buildLockKey(key, prefix);
    const ttl = this.normalizeTtl(opts?.ttlMs);
    const autoRenew = opts?.autoRenew ?? MutexLock.DEFAULT_AUTO_RENEW;
    const renewRatio = opts?.renewIntervalRatio ?? MutexLock.DEFAULT_RENEW_RATIO;
    const redisName = opts?.redisName;

    // 尝试获取锁
    const acquired = await this.acquire(lockKey, ttl, redisName);
    if (!acquired.acquired || !acquired.value) {
      return { ok: false };
    }

    const lockValue = acquired.value;

    // 启动自动续租
    if (autoRenew) {
      this.startAutoRenew(lockKey, lockValue, ttl, renewRatio, redisName);
    }

    try {
      const result = await Promise.resolve(task());
      await this.releaseAndStopRenew(lockKey, lockValue, redisName);
      return { ok: true, result };
    } catch (err) {
      await this.releaseAndStopRenew(lockKey, lockValue, redisName);
      throw err;
    }
  }

  /**
   * 释放所有持有的锁
   * 
   * 注意：由于锁可能分布在不同的 Redis 实例上，
   * 这里尝试在默认实例上释放所有锁
   */
  async releaseAllHeldLocks(): Promise<void> {
    const entries = Array.from(this.renewMap.entries());
    
    for (const [key, record] of entries) {
      this.forceStopAutoRenew(key);
      
      if (record.value) {
        try {
          // 在默认 Redis 实例上尝试释放
          await this.releaseLock(key, record.value);
        } catch {
          // 忽略释放失败
        }
      }
    }
  }

  /**
   * 模块销毁时清理所有锁
   */
  async onModuleDestroy(): Promise<void> {
    await this.releaseAllHeldLocks();
  }
}
