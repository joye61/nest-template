import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RedisClientType } from 'redis';
import { Redis, type RedisConfig } from './redis/index';

/**
 * Redis 服务入口类
 *
 * 职责：
 * 1. 统一管理多个 Redis 连接（通过环境变量或配置文件）
 * 2. 提供原生 node-redis 客户端实例
 * 3. 支持多实例管理和自动缓存
 *
 * 使用示例：
 *
 * ```typescript
 * // 1. 注入服务
 * constructor(private readonly redis: RedisService) {}
 *
 * // 2. 获取默认 Redis 客户端
 * const client = this.redis.client();
 *
 * // 3. 使用原生 node-redis API
 * await client.set('key', 'value', { EX: 3600 });
 * const value = await client.get('key');
 * await client.hSet('user:1', 'name', 'John');
 * await client.expire('key', 3600);
 *
 * // 4. 访问其他 Redis 实例
 * const cacheClient = this.redis.client('cache');
 * const sessionClient = this.redis.client('session');
 * ```
 *
 * 配置示例：
 *
 * 环境变量方式（.env）：
 * ```env
 * REDIS_URL_DEFAULT=redis://localhost:6379/0
 * REDIS_URL_CACHE=redis://:password@cache-server:6379/1
 * REDIS_URL_SESSION=redis://session-server:6379/2
 * ```
 *
 * 配置对象方式（config/default.ts）：
 * ```typescript
 * export default {
 *   redis: {
 *     default: { host: 'localhost', port: 6379, database: 0 },
 *     cache: { host: 'cache-server', port: 6379, password: 'secret', database: 1 },
 *     session: { host: 'session-server', port: 6379, database: 2 },
 *   },
 * };
 * ```
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  constructor(private readonly config: ConfigService) {}

  /**
   * 获取 Redis 实例
   *
   * 根据连接名从环境变量或配置读取连接信息，创建或获取缓存的 Redis 实例。
   *
   * @param name - Redis 连接名称（不区分大小写），默认 'default'
   * @returns Redis 实例
   * @throws {Error} 如果配置未找到
   */
  private getRedis(name: string = 'default'): Redis {
    const normalizedName = name.toLowerCase();

    // 方式 1：尝试从环境变量读取 URL
    const envKey = `REDIS_URL_${normalizedName.toUpperCase()}`;
    const url = this.config.get<string>(envKey);

    if (url) {
      return Redis.create(url);
    }

    // 方式 2：尝试从配置对象读取
    const configKey = `redis.${normalizedName}`;
    const redisConfig = this.config.get<RedisConfig>(configKey);

    if (redisConfig) {
      return Redis.create(redisConfig);
    }

    // 配置未找到
    throw new Error(
      `Redis 配置未找到: ${envKey} 或 ${configKey}\n` +
        `请在 .env 文件或配置文件中设置:\n` +
        `  方式 1: ${envKey}=redis://host:port/database\n` +
        `  方式 2: 在配置文件中设置 ${configKey} 对象`,
    );
  }

  /**
   * 获取原生 node-redis 客户端实例
   *
   * 自动等待连接初始化完成，这是最简单、最安全的使用方式。
   *
   * @param name - Redis 连接名称，默认 'default'
   * @returns node-redis 客户端实例（RedisClientType）
   *
   * @example
   * ```typescript
   * // 获取默认客户端
   * const client = await this.redis.client();
   * await client.set('key', 'value');
   * const value = await client.get('key');
   *
   * // 获取指定连接的客户端
   * const cacheClient = await this.redis.client('cache');
   * await cacheClient.hSet('user:1', 'name', 'John');
   *
   * // 使用完整的 node-redis API
   * await client.setEx('key', 3600, 'value');
   * await client.incr('counter');
   * await client.expire('key', 3600);
   * await client.del('key1', 'key2');
   * ```
   */
  public async client(name: string = 'default'): Promise<RedisClientType> {
    return this.getRedis(name).getClient();
  }

  /**
   * 关闭所有连接（应用关闭时调用）
   */
  public async onModuleDestroy(): Promise<void> {
    await Redis.closeAll();
  }
}
